import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

type Body = {
  sessionId?: unknown;
  transcript?: unknown;
};

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;
    const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
    const transcript = typeof body.transcript === "string" ? body.transcript : "";

    if (!sessionId || !transcript.trim()) {
      return NextResponse.json({ error: "Missing sessionId/transcript" }, { status: 400 });
    }

    const controller = new AbortController();
    const timeoutMs = 15000;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    const existing = await prisma.interviewSession.findUnique({ where: { id: sessionId } });
    let topic: string | null = null;
    if (existing && Array.isArray(existing.messages)) {
      const systemMsg = (existing.messages as any[]).find((m) => m && m.role === "system" && typeof m.text === "string");
      const txt = typeof systemMsg?.text === "string" ? systemMsg.text : "";
      const m = txt.match(/\bTopic:\s*(.+)$/i);
      if (m && m[1]) topic = m[1].trim();
    }

    const pyRes = await fetch("http://127.0.0.1:8000/api/interview_cycle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Ask Python backend to prefer a low-latency path.
      body: JSON.stringify({ transcript, mode: "fast", topic, session_id: sessionId }),
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout));

    const pyData = await pyRes.json().catch(() => ({}));
    if (!pyRes.ok) {
      const detail = typeof pyData?.detail === "string" ? pyData.detail : "Python backend error";
      return NextResponse.json({ error: detail }, { status: 502 });
    }

    const responseText = typeof pyData.response_text === "string" ? pyData.response_text : "";
    const audioUrl = typeof pyData.audio_url === "string" ? pyData.audio_url : null;

    // Append messages to DB (best-effort).
    if (existing) {
      const messages = Array.isArray((existing as any).messages) ? ((existing as any).messages as any[]) : [];
      const now = new Date().toISOString();
      messages.push({ role: "user", text: transcript, ts: now });
      messages.push({ role: "ai", text: responseText, ts: now });
      await prisma.interviewSession.update({ where: { id: sessionId }, data: { messages } });
    }

    return NextResponse.json({ response_text: responseText, audio_url: audioUrl });
  } catch (error: unknown) {
    if (error instanceof Error && error.name === "AbortError") {
      return NextResponse.json(
        { error: "Interview backend timed out. Try a shorter reply." },
        { status: 504 }
      );
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
