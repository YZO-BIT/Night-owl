import { NextResponse } from "next/server";

const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY;
const STT_MODEL = process.env.DEEPGRAM_STT_MODEL || "nova-2";

export async function POST(req: Request) {
  try {
    if (!DEEPGRAM_API_KEY) {
      return NextResponse.json({ error: "Missing DEEPGRAM_API_KEY" }, { status: 500 });
    }

    const contentType = req.headers.get("content-type") || "";
    if (!contentType.includes("multipart/form-data")) {
      return NextResponse.json(
        { error: "Expected multipart/form-data with an audio file" },
        { status: 400 }
      );
    }

    const form = await req.formData();
    const file = form.get("audio");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Missing audio file" }, { status: 400 });
    }

    const mimetype = file.type || "application/octet-stream";
    const bytes = await file.arrayBuffer();
    if (!bytes || bytes.byteLength < 1_500) {
      return NextResponse.json({ transcript: "" });
    }

    const url = new URL("https://api.deepgram.com/v1/listen");
    url.searchParams.set("model", STT_MODEL);
    url.searchParams.set("smart_format", "true");
    url.searchParams.set("punctuate", "true");
    url.searchParams.set("utterances", "false");

    const candidateContentTypes: string[] = [];
    const pushType = (value: string) => {
      const normalized = (value || "").trim();
      if (!normalized) return;
      if (!candidateContentTypes.includes(normalized)) candidateContentTypes.push(normalized);
    };

    pushType(mimetype);
    if (mimetype.includes("webm")) pushType("audio/webm");
    if (mimetype.includes("ogg")) pushType("audio/ogg");
    if (mimetype === "application/octet-stream") {
      const lowerName = (file.name || "").toLowerCase();
      if (lowerName.endsWith(".webm")) pushType("audio/webm");
      if (lowerName.endsWith(".ogg")) pushType("audio/ogg");
      if (lowerName.endsWith(".mp4") || lowerName.endsWith(".m4a")) pushType("audio/mp4");
    }
    if (candidateContentTypes.length === 0) pushType("audio/webm");

    let lastError = "Deepgram STT failed";
    let lastStatus = 502;

    for (const contentType of candidateContentTypes) {
      const controller = new AbortController();
      const timeoutMs = 12_000;
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      const dgRes = await fetch(url.toString(), {
        method: "POST",
        headers: {
          Authorization: `Token ${DEEPGRAM_API_KEY}`,
          "Content-Type": contentType,
          Accept: "application/json",
        },
        body: bytes,
        signal: controller.signal,
      }).finally(() => clearTimeout(timeout));

      const rawText = await dgRes.text().catch(() => "");
      const dgJson = (() => {
        try {
          return rawText ? JSON.parse(rawText) : null;
        } catch {
          return null;
        }
      })() as any;

      if (dgRes.ok) {
        const transcript: string =
          dgJson?.results?.channels?.[0]?.alternatives?.[0]?.transcript || "";
        return NextResponse.json({ transcript, raw: dgJson });
      }

      const detail =
        dgJson?.error ||
        dgJson?.message ||
        (typeof rawText === "string" && rawText.trim() ? rawText.trim().slice(0, 500) : "Deepgram STT failed");
      lastError = detail;
      lastStatus = dgRes.status;

      const canRetry = /corrupt|unsupported|failed to process audio/i.test(String(detail));
      if (!canRetry) {
        break;
      }
    }

    const transientDecodeFailure = /corrupt|unsupported|failed to process audio/i.test(String(lastError));
    if (transientDecodeFailure) {
      return NextResponse.json({ transcript: "", warning: "transient_decode_failure", deepgram_status: lastStatus });
    }

    return NextResponse.json({ error: lastError, deepgram_status: lastStatus }, { status: 502 });
  } catch (error: unknown) {
    if (error instanceof Error && error.name === "AbortError") {
      return NextResponse.json({ error: "Deepgram STT timed out" }, { status: 504 });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
