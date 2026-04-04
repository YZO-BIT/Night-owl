import { NextResponse } from "next/server";
import { getDatabaseApiError, prisma } from "@/lib/prisma";
import { createLoginSession, verifyPassword } from "@/lib/auth";
import { ensureLeaderboardUser } from "@/lib/leaderboard";

type LoginBody = {
  email?: unknown;
  password?: unknown;
};

async function withTimeout<T>(promise: Promise<T>, timeoutMs = 700): Promise<T | null> {
  return Promise.race([
    promise,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
  ]);
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as LoginBody;
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";

    if (!email || !password) {
      return NextResponse.json({ error: "Email and password required" }, { status: 400 });
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user?.passwordHash) {
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    }

    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) {
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    }

    await createLoginSession(user.id);
    try {
      await withTimeout(ensureLeaderboardUser({ userId: user.id, name: user.name, email: user.email }));
    } catch {
      // Best-effort leaderboard sync should not block login.
    }

    return NextResponse.json({
      user: { id: user.id, email: user.email ?? null, name: user.name ?? null },
    });
  } catch (error: unknown) {
    const dbError = getDatabaseApiError(error);
    if (dbError) {
      return NextResponse.json({ error: dbError }, { status: 503 });
    }

    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
