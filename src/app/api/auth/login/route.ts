import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createLoginSession, verifyPassword } from "@/lib/auth";

type LoginBody = {
  email?: unknown;
  password?: unknown;
};

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

    return NextResponse.json({
      user: { id: user.id, email: user.email ?? null, name: user.name ?? null },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
