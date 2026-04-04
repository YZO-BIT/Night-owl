import { NextResponse } from "next/server";
import { getDatabaseApiError, prisma } from "@/lib/prisma";
import { createLoginSession, hashPassword } from "@/lib/auth";
import { ensureLeaderboardUser } from "@/lib/leaderboard";

type RegisterBody = {
  email?: unknown;
  password?: unknown;
  name?: unknown;
};

async function withTimeout<T>(promise: Promise<T>, timeoutMs = 700): Promise<T | null> {
  return Promise.race([
    promise,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
  ]);
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as RegisterBody;
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const name = typeof body.name === "string" ? body.name.trim() : null;

    if (!email || !password || password.length < 8) {
      return NextResponse.json(
        { error: "Email and password (min 8 chars) required" },
        { status: 400 }
      );
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return NextResponse.json({ error: "Email already in use" }, { status: 409 });
    }

    const passwordHash = await hashPassword(password);
    const user = await prisma.user.create({
      data: { email, name, passwordHash },
      select: { id: true, email: true, name: true },
    });

    await createLoginSession(user.id);
    try {
      await withTimeout(ensureLeaderboardUser({ userId: user.id, name: user.name, email: user.email }));
    } catch {
      // Best-effort leaderboard sync should not block registration.
    }

    return NextResponse.json({ user });
  } catch (error: unknown) {
    const dbError = getDatabaseApiError(error);
    if (dbError) {
      return NextResponse.json({ error: dbError }, { status: 503 });
    }

    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
