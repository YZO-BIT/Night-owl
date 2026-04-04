import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { buildInterviewSummary, type InterviewMessage } from "@/lib/interviewSummary";
import { addLeaderboardXp } from "@/lib/leaderboard";

type Body = {
  sessionId?: unknown;
  transcript?: unknown;
};

type SessionMessage = {
  role?: string;
  text?: string;
  kind?: string;
  questions?: unknown;
  qIndex?: unknown;
  [key: string]: unknown;
};

function isWarmupTranscript(text: string) {
  return /start the interview with the first question|i just studied .*start the interview/i.test(text);
}

function extractTopic(messages: SessionMessage[]) {
  const system = messages.find((m) => m?.role === "system" && typeof m?.text === "string");
  const txt = (system?.text || "").trim();
  const match = txt.match(/\bTopic:\s*(.+)$/i);
  return match?.[1]?.trim() || "";
}

function fallbackPlan(topic: string) {
  const base = [
    `What are the fundamental concepts of ${topic || "this topic"}?`,
    `Can you explain one core architecture/pattern used in ${topic || "this topic"}?`,
    `How would you implement a basic solution in ${topic || "this topic"}?`,
    `What are common mistakes learners make in ${topic || "this topic"}?`,
    `How would you debug a failure in ${topic || "this topic"}?`,
    `What trade-offs are important in ${topic || "this topic"} design decisions?`,
    `How would you optimize performance in ${topic || "this topic"}?`,
    `How would you test correctness and reliability in ${topic || "this topic"}?`,
    `What security or safety concerns apply to ${topic || "this topic"}?`,
    `How would you explain ${topic || "this topic"} to a junior engineer?`,
    `Describe a real-world use case where ${topic || "this topic"} is the right choice.`,
    `What advanced concept in ${topic || "this topic"} would you learn next and why?`,
  ];
  return base;
}

function extractPlan(messages: SessionMessage[], topic: string) {
  const planMsg = messages.find((m) => m?.role === "system" && m?.kind === "question_plan");
  if (!planMsg || !Array.isArray(planMsg.questions)) {
    return fallbackPlan(topic);
  }

  const questions = (planMsg.questions as unknown[])
    .filter((q): q is string => typeof q === "string")
    .map((q) => q.trim())
    .filter(Boolean)
    .slice(0, 20);

  if (questions.length < 10) return fallbackPlan(topic);
  return questions;
}

function countAskedQuestions(messages: SessionMessage[]) {
  return messages.filter((m) => m?.role === "ai" && m?.kind === "question" && typeof m?.qIndex === "number").length;
}

function makeLeadIn(answer: string) {
  const wc = answer.trim().split(/\s+/).filter(Boolean).length;
  if (wc < 8) return "Noted. Add more depth in your next answer.";
  if (wc > 80) return "Good detail. Keep the next one concise and structured.";
  return "Good response. Let us move to the next question.";
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;
    const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
    const transcript = typeof body.transcript === "string" ? body.transcript : "";

    if (!sessionId || !transcript.trim()) {
      return NextResponse.json({ error: "Missing sessionId/transcript" }, { status: 400 });
    }

    const existing = await prisma.interviewSession.findUnique({ where: { id: sessionId } });

    if (!existing) {
      return NextResponse.json({ error: "Interview session not found" }, { status: 404 });
    }

    const now = new Date().toISOString();
    const messages = Array.isArray(existing.messages)
      ? ((existing.messages as unknown[]) as SessionMessage[])
      : [];
    const topic = extractTopic(messages);
    const plan = extractPlan(messages, topic);
    const totalQuestions = Math.max(10, Math.min(20, plan.length));
    const askedSoFar = countAskedQuestions(messages);
    const warmup = isWarmupTranscript(transcript);

    const nextMessages: InterviewMessage[] = [...(messages as InterviewMessage[])];
    if (!warmup) {
      nextMessages.push({ role: "user", text: transcript.trim(), ts: now });
    }

    // End only when all planned questions are already asked and user answered the last one.
    if (askedSoFar >= totalQuestions && !warmup) {
      const summaryDone = buildInterviewSummary(nextMessages, topic || undefined, {
        targetQuestions: totalQuestions,
        forceComplete: true,
      });
      nextMessages.push({
        role: "ai",
        kind: "final_feedback",
        text: summaryDone.finalFeedback,
        ts: now,
      } as InterviewMessage);

      await prisma.interviewSession.update({
        where: { id: sessionId },
        data: { status: "ended", endedAt: new Date(), messages: nextMessages },
      });

      return NextResponse.json({
        response_text: summaryDone.finalFeedback,
        audio_url: null,
        is_complete: true,
        total_questions: totalQuestions,
        asked_questions: totalQuestions,
        remaining_questions: 0,
        summary: summaryDone,
      });
    }

    const nextQuestion = plan[Math.min(askedSoFar, totalQuestions - 1)] || plan[0];
    const leadIn = warmup ? "Interview initialized from your studied content." : makeLeadIn(transcript);
    const responseText = `${leadIn} Question ${Math.min(askedSoFar + 1, totalQuestions)}/${totalQuestions}: ${nextQuestion}`;

    nextMessages.push({
      role: "ai",
      kind: "question",
      qIndex: Math.min(askedSoFar + 1, totalQuestions),
      text: responseText,
      ts: now,
    } as InterviewMessage);

    await prisma.interviewSession.update({ where: { id: sessionId }, data: { messages: nextMessages } });

    if (!warmup && existing.userId) {
      try {
        await addLeaderboardXp({ userId: existing.userId, delta: 3, subject: topic || null });
      } catch {
        // Best-effort leaderboard update.
      }
    }

    const summary = buildInterviewSummary(nextMessages, topic || undefined, {
      targetQuestions: totalQuestions,
    });

    return NextResponse.json({
      response_text: responseText,
      audio_url: null,
      is_complete: false,
      total_questions: totalQuestions,
      asked_questions: Math.min(askedSoFar + 1, totalQuestions),
      remaining_questions: Math.max(0, totalQuestions - Math.min(askedSoFar + 1, totalQuestions)),
      summary,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
