import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

type Body = {
  sessionId?: unknown;
  text?: unknown;
  source?: unknown;
};

type SessionMessage = {
  role?: string;
  text?: string;
  kind?: string;
  [key: string]: unknown;
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function extractTopic(messages: SessionMessage[]) {
  const system = messages.find((m) => m?.role === "system" && typeof m?.text === "string");
  const txt = (system?.text || "").trim();
  const match = txt.match(/\bTopic:\s*(.+)$/i);
  return match?.[1]?.trim() || "";
}

function parseQuestionPlan(raw: string, desiredCount: number) {
  const out: string[] = [];
  const seen = new Set<string>();
  const text = (raw || "").trim();

  // First try JSON array output.
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        if (typeof item !== "string") continue;
        let q = item.replace(/^\s*\d+[\).:-]?\s*/, "").trim();
        if (!q) continue;
        if (!q.endsWith("?")) q = `${q}?`;
        const key = q.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(q);
        if (out.length >= desiredCount) return out;
      }
    }
  } catch {
    // fallback to line parsing
  }

  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    let q = line.replace(/^\s*[-*]\s*/, "").replace(/^\s*\d+[\).:-]?\s*/, "").trim();
    if (!q) continue;
    if (!q.endsWith("?")) {
      if (q.length < 12) continue;
      q = `${q}?`;
    }
    const key = q.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(q);
    if (out.length >= desiredCount) break;
  }

  return out;
}

function fallbackQuestionPlan(topic: string, contextText: string, desiredCount: number) {
  const sentences = contextText
    .split(/[.!?]\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 30)
    .slice(0, 60);

  const starters = [
    "Can you explain",
    "What trade-offs do you see in",
    "How would you apply",
    "Why is",
    "How does",
  ];

  const questions: string[] = [];
  for (let i = 0; i < sentences.length && questions.length < desiredCount; i += 1) {
    const sentence = sentences[i].replace(/\s+/g, " ").trim();
    const stem = sentence.length > 120 ? `${sentence.slice(0, 120).trim()}...` : sentence;
    const starter = starters[i % starters.length];
    questions.push(`${starter} ${stem} in the context of ${topic || "this topic"}?`);
  }

  while (questions.length < desiredCount) {
    const idx = questions.length + 1;
    questions.push(`Question ${idx}: explain one key concept from ${topic || "the studied content"} with an example and a trade-off?`);
  }

  return questions;
}

async function generateQuestionPlan(topic: string, contextText: string, desiredCount: number) {
  const safeContext = contextText.replace(/\s+/g, " ").slice(0, 9000);
  const prompt = [
    `You are creating an interview on topic: ${topic || "Unknown"}.`,
    `Generate EXACTLY ${desiredCount} technical interview questions.`,
    "Rules:",
    "- Questions must be strictly based on the study material context below.",
    "- No repeated or rephrased duplicate questions.",
    "- Start easier, then increase difficulty.",
    "- Each line must be one question.",
    "- Do not output any explanation, only the numbered questions.",
    "",
    "Study material context:",
    safeContext,
  ].join("\n");

  try {
    const pyRes = await fetch("http://127.0.0.1:8000/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt }),
    });

    const pyData = await pyRes.json().catch(() => ({}));
    const raw = typeof (pyData as { generated_text?: unknown }).generated_text === "string"
      ? (pyData as { generated_text: string }).generated_text
      : "";
    const parsed = parseQuestionPlan(raw, desiredCount);
    if (parsed.length >= Math.min(6, desiredCount)) {
      return parsed.slice(0, desiredCount);
    }
  } catch {
    // fall back below
  }

  return fallbackQuestionPlan(topic, contextText, desiredCount);
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as Body;
    const sessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : "";
    const text = typeof body.text === "string" ? body.text.trim() : "";
    const source = typeof body.source === "string" ? body.source.trim() : "";

    if (!sessionId) return NextResponse.json({ error: "Missing sessionId" }, { status: 400 });
    if (!text) return NextResponse.json({ error: "Missing text" }, { status: 400 });

    const controller = new AbortController();
    const timeoutMs = 20_000;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    const pyRes = await fetch("http://127.0.0.1:8000/api/ingest_context", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: sessionId, text, source: source || "context" }),
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout));

    const pyData = await pyRes.json().catch(() => ({}));
    if (!pyRes.ok) {
      const detail = typeof (pyData as any)?.detail === "string" ? (pyData as any).detail : "Ingest failed";
      return NextResponse.json({ error: detail }, { status: 502 });
    }

    const session = await prisma.interviewSession.findUnique({ where: { id: sessionId } });
    if (session && Array.isArray(session.messages)) {
      const rawMessages = session.messages as unknown[];
      const messages = rawMessages
        .filter((m): m is SessionMessage => typeof m === "object" && m !== null)
        .map((m) => m as SessionMessage);

      const topic = extractTopic(messages);
      const wordCount = text.split(/\s+/).filter(Boolean).length;
      const desiredCount = clamp(
        source.toLowerCase() === "youtube" ? (wordCount > 2200 ? 16 : 14) : (wordCount > 2200 ? 14 : 12),
        10,
        20
      );
      const questions = await generateQuestionPlan(topic, text, desiredCount);

      const nextMessages = messages.filter((m) => !(m.role === "system" && m.kind === "question_plan"));
      nextMessages.push({
        role: "system",
        kind: "question_plan",
        source: source || "context",
        total: questions.length,
        questions,
        text: `Interview plan prepared with ${questions.length} questions based on ingested ${source || "context"}.`,
        ts: new Date().toISOString(),
      });

      await prisma.interviewSession.update({
        where: { id: sessionId },
        data: { messages: nextMessages as any },
      });

      return NextResponse.json({ ok: true, question_count: questions.length, ...pyData });
    }

    return NextResponse.json({ ok: true, ...pyData });
  } catch (error: unknown) {
    if (error instanceof Error && error.name === "AbortError") {
      return NextResponse.json({ error: "Ingest timed out" }, { status: 504 });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
