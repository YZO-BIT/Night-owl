import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { addLeaderboardXp } from '@/lib/leaderboard';

type PerplexityResponse = {
  scores?: Array<[string, number]> | Array<[string, string | number]>;
};

type EvaluationRequest = {
  answers: string;
  context: string;
  // optional fields for later session/proctoring support
  sessionId?: string;
  proctoring?: unknown;
};

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export async function POST(req: Request) {
  try {
    const body: unknown = await req.json();
    const { answers, context, sessionId } = body as Partial<EvaluationRequest>;
    if (typeof answers !== 'string' || typeof context !== 'string' || !answers.trim() || !context.trim()) {
      return NextResponse.json({ error: 'Missing answers/context' }, { status: 400 });
    }

    // 1. Plagiarism Detection via Perplexity (from Python Backend)
    const pplRes = await fetch("http://127.0.0.1:8000/api/perplexity", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: [answers] })
    });
    
    if (!pplRes.ok) {
        throw new Error("Python backend perplexity check failed");
    }

    const pplData: PerplexityResponse = await pplRes.json();
    const perplexityValue = Array.isArray(pplData.scores) && pplData.scores[0] ? pplData.scores[0][1] : null;
    const perplexityScore = toNumber(perplexityValue);
    if (perplexityScore === null) {
      throw new Error('Invalid perplexity response');
    }
    
    // Heuristic: GPT-2 perplexity lower than ~50 often indicates generated text or very standard text.
    const isCheating = perplexityScore < 50;

    // 2. Response Evaluation (using generated text from Python backend)
    const prompt = [
      `Context: ${context}`,
      `User's Answer Summary: ${answers}`,
      'You are grading a quiz consisting of multiple questions (MCQs and Descriptive tasks).',
      'Return a strict, structured evaluation of the answers above, providing individual feedback per question. You MUST include:',
      '- Score: a single number out of 100 on the first line (e.g. Score: 85)',
      '- What is Correct: Explicitly state why the selected MCQ options or descriptive statements were right.',
      '- What is Wrong/Missing: If an MCQ is wrong, provide the correct option and explain why. If a descriptive answer is lacking, explain what was missed.',
      '- Overall Concept Summary: Brief correct overview.',
      '- Next steps to improve: 1-3 bullet points.',
      'Evaluation:'
    ].join('\n');
    const evalRes = await fetch("http://127.0.0.1:8000/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt })
    });
    
    if (!evalRes.ok) {
        throw new Error("Python backend generation failed");
    }

    const evalData: { generated_text?: string } = await evalRes.json();
    const evaluation = (evalData.generated_text || '').replace(prompt, "").trim();

    // Heuristic score extraction (best-effort)
    const scoreMatch = evaluation.match(/\bscore\b\s*[:=-]?\s*(\d{1,3})/i);
    const evaluationScore = scoreMatch ? Math.min(100, Math.max(0, Number(scoreMatch[1]))) : null;

    let oaUserId: string | null = null;
    let oaTopic: string | null = null;

    if (typeof sessionId === 'string' && sessionId) {
      const existing = await prisma.oASession.findUnique({
        where: { id: sessionId },
        select: { userId: true, topic: true },
      });
      oaUserId = existing?.userId ?? null;
      oaTopic = existing?.topic ?? null;

      await prisma.oASession.update({
        where: { id: sessionId },
        data: {
          question: context,
          answer: answers,
          evaluation,
          evaluationScore: evaluationScore === null ? undefined : Math.trunc(evaluationScore),
          perplexityScore,
          isCheating,
        },
      });

      await prisma.proctorEvent.create({
        data: {
          kind: 'evaluation_submitted',
          payload: {
            ts: new Date().toISOString(),
            evaluationScore,
            perplexityScore,
            isCheating,
          },
          oaSessionId: sessionId,
        },
      });
    }

    if (!isCheating && oaUserId && evaluationScore !== null) {
      const gain = Math.max(5, Math.round(evaluationScore / 5));
      try {
        await addLeaderboardXp({ userId: oaUserId, delta: gain, subject: oaTopic || null });
      } catch {
        // Best-effort leaderboard update.
      }
    }

    return NextResponse.json({
      evaluation,
      evaluationScore,
      perplexityScore,
      isCheating
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
