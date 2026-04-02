import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

type Body = { sessionId?: unknown };

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;
    const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
    if (!sessionId) {
      return NextResponse.json({ error: "Missing sessionId" }, { status: 400 });
    }

    await prisma.oASession.update({
      where: { id: sessionId },
      data: { status: "ended", endedAt: new Date() },
    });

    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
