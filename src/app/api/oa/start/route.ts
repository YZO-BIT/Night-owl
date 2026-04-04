import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";
import { addLeaderboardXp } from "@/lib/leaderboard";

type Body = { topic?: unknown; question?: unknown };

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;
    const topic = typeof body.topic === "string" ? body.topic : null;
    const question = typeof body.question === "string" ? body.question : null;
    const authUser = await getAuthUser();

    if (authUser?.id && topic) {
      try {
        await addLeaderboardXp({
          userId: authUser.id,
          delta: 0,
          name: authUser.name,
          email: authUser.email,
          subject: topic,
        });
      } catch {
        // Best-effort leaderboard subject registration.
      }
    }

    const session = await prisma.oASession.create({
      data: {
        userId: authUser?.id ?? null,
        topic,
        question,
      },
      select: { id: true, createdAt: true },
    });

    return NextResponse.json({ sessionId: session.id, createdAt: session.createdAt });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
