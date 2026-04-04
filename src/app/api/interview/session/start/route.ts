import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";
import { addLeaderboardXp } from "@/lib/leaderboard";

type Body = { topic?: unknown };

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;
    const topic = typeof body.topic === "string" ? body.topic : null;
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

    const session = await prisma.interviewSession.create({
      data: {
        userId: authUser?.id ?? null,
        messages: [],
      },
      select: { id: true, createdAt: true },
    });

    // Optional: store topic as first message metadata (keeps schema minimal)
    if (topic) {
      await prisma.interviewSession.update({
        where: { id: session.id },
        data: {
          messages: [
            {
              role: "system",
              text: `Topic: ${topic}`,
              ts: new Date().toISOString(),
            },
          ],
        },
      });
    }

    return NextResponse.json({ sessionId: session.id, createdAt: session.createdAt });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
