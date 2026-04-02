import { NextResponse } from "next/server";

const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY;
const TTS_MODEL = process.env.DEEPGRAM_TTS_MODEL || "aura-asteria-en";

type Body = { text?: unknown };

export async function POST(req: Request) {
  try {
    if (!DEEPGRAM_API_KEY) {
      return NextResponse.json({ error: "Missing DEEPGRAM_API_KEY" }, { status: 500 });
    }

    const body = (await req.json().catch(() => ({}))) as Body;
    const text = typeof body.text === "string" ? body.text.trim() : "";
    if (!text) {
      return NextResponse.json({ error: "Missing text" }, { status: 400 });
    }

    const url = new URL("https://api.deepgram.com/v1/speak");
    url.searchParams.set("model", TTS_MODEL);
    url.searchParams.set("encoding", "mp3");

    const dgRes = await fetch(url.toString(), {
      method: "POST",
      headers: {
        Authorization: `Token ${DEEPGRAM_API_KEY}`,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({ text }),
    });

    if (!dgRes.ok) {
      const errText = await dgRes.text().catch(() => "");
      return NextResponse.json(
        { error: errText || "Deepgram TTS failed" },
        { status: 502 }
      );
    }

    const audio = await dgRes.arrayBuffer();
    return new Response(audio, {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-store",
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
