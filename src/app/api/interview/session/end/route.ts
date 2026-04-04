import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { buildInterviewSummary, type InterviewMessage } from "@/lib/interviewSummary";
import { addLeaderboardXp } from "@/lib/leaderboard";

type Body = { sessionId?: unknown };

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;
    const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
    if (!sessionId) {
      return NextResponse.json({ error: "Missing sessionId" }, { status: 400 });
    }

    const existing = await prisma.interviewSession.findUnique({ where: { id: sessionId } });
    if (!existing) {
      return NextResponse.json({ error: "Interview session not found" }, { status: 404 });
    }

    let topic: string | undefined;
    const messages = Array.isArray(existing.messages)
      ? ((existing.messages as unknown[]) as InterviewMessage[])
      : [];

    const totalFromPlan = (() => {
      const planMessage = (messages as Array<InterviewMessage & { kind?: unknown; questions?: unknown }>).find(
        (m) => m?.role === "system" && m?.kind === "question_plan" && Array.isArray(m?.questions)
      );
      if (!planMessage || !Array.isArray(planMessage.questions)) return undefined;
      const count = planMessage.questions.filter((q) => typeof q === "string").length;
      if (!Number.isFinite(count) || count <= 0) return undefined;
      return Math.max(10, Math.min(20, count));
    })();

    const askedCount = (messages as Array<InterviewMessage & { kind?: unknown }>).filter(
      (m) => m?.role === "ai" && m?.kind === "question"
    ).length;

    const systemMsg = messages.find((m) => m && m.role === "system" && typeof m.text === "string");
    const topicMatch = (systemMsg?.text || "").match(/\bTopic:\s*(.+)$/i);
    if (topicMatch?.[1]) topic = topicMatch[1].trim();

    const summary = buildInterviewSummary(messages, topic, {
      targetQuestions: totalFromPlan,
      forceComplete: typeof totalFromPlan === "number" ? askedCount >= totalFromPlan : undefined,
    });

    if (existing.userId) {
      const bonus = Math.max(8, Math.round((summary.efficiencyScore || 0) / 5));
      try {
        await addLeaderboardXp({ userId: existing.userId, delta: bonus, subject: topic || null });
      } catch {
        // Best-effort leaderboard update.
      }
    }

    await prisma.interviewSession.update({
      where: { id: sessionId },
      data: { status: "ended", endedAt: new Date() },
    });

    const totalQuestions = typeof totalFromPlan === "number" ? totalFromPlan : 10;
    const askedQuestions = Math.max(0, Math.min(totalQuestions, askedCount));

    return NextResponse.json({
      ok: true,
      summary,
      total_questions: totalQuestions,
      asked_questions: askedQuestions,
      remaining_questions: Math.max(0, totalQuestions - askedQuestions),
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
