import { NextResponse } from "next/server";
import { getSessionTokenFromCookie, revokeLoginSession } from "@/lib/auth";

export async function POST() {
  try {
    const token = await getSessionTokenFromCookie();
    if (token) {
      await revokeLoginSession(token);
    }
    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
