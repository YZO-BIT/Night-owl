import { NextResponse } from "next/server";

type Body = {
  sessionId?: unknown;
  text?: unknown;
  source?: unknown;
};

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as Body;
    const sessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : "";
    const text = typeof body.text === "string" ? body.text.trim() : "";
    const source = typeof body.source === "string" ? body.source.trim() : "";

    if (!sessionId) return NextResponse.json({ error: "Missing sessionId" }, { status: 400 });
    if (!text) return NextResponse.json({ error: "Missing text" }, { status: 400 });

    const controller = new AbortController();
    const timeoutMs = 20_000;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    const pyRes = await fetch("http://127.0.0.1:8000/api/ingest_context", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: sessionId, text, source: source || "context" }),
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout));

    const pyData = await pyRes.json().catch(() => ({}));
    if (!pyRes.ok) {
      const detail = typeof (pyData as any)?.detail === "string" ? (pyData as any).detail : "Ingest failed";
      return NextResponse.json({ error: detail }, { status: 502 });
    }

    return NextResponse.json({ ok: true, ...pyData });
  } catch (error: unknown) {
    if (error instanceof Error && error.name === "AbortError") {
      return NextResponse.json({ error: "Ingest timed out" }, { status: 504 });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
