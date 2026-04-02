import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

type Body = {
  sessionId?: unknown;
  kind?: unknown;
  payload?: unknown;
};

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;
    const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
    const kind = typeof body.kind === "string" ? body.kind : "";
    const payload = body.payload;

    if (!sessionId || !kind) {
      return NextResponse.json({ error: "Missing sessionId/kind" }, { status: 400 });
    }

    await prisma.proctorEvent.create({
      data: {
        kind,
        payload: payload ?? {},
        oaSessionId: sessionId,
      },
    });

    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
