import { NextResponse } from "next/server";
import { YoutubeTranscript, type TranscriptItem } from "youtube-transcript";

type Body = { videoId?: unknown; url?: unknown };

function extractVideoId(input: string): string {
  const s = input.trim();
  if (!s) return "";

  // If it's already an id
  if (/^[a-zA-Z0-9_-]{6,}$/.test(s) && !s.includes("/")) return s;

  try {
    const u = new URL(s);

    if (u.hostname === "youtu.be") {
      return u.pathname.replace("/", "").trim();
    }

    const v = u.searchParams.get("v");
    if (v) return v.trim();

    const parts = u.pathname.split("/").filter(Boolean);
    const embedIdx = parts.indexOf("embed");
    if (embedIdx >= 0 && parts[embedIdx + 1]) return parts[embedIdx + 1].trim();

    const shortsIdx = parts.indexOf("shorts");
    if (shortsIdx >= 0 && parts[shortsIdx + 1]) return parts[shortsIdx + 1].trim();

    return "";
  } catch {
    return "";
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as Body;
    const videoId =
      typeof body.videoId === "string"
        ? extractVideoId(body.videoId)
        : typeof body.url === "string"
          ? extractVideoId(body.url)
          : "";

    if (!videoId) {
      return NextResponse.json({ error: "Missing videoId" }, { status: 400 });
    }

    const items = (await YoutubeTranscript.fetchTranscript(videoId).catch((e: unknown) => {
      const msg = e instanceof Error ? e.message : "Failed to fetch transcript";
      throw new Error(msg);
    })) as TranscriptItem[];

    const text = (items || [])
      .map((x: TranscriptItem) => (typeof x.text === "string" ? x.text.trim() : ""))
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();

    if (!text) {
      return NextResponse.json(
        { error: "No transcript available for this video." },
        { status: 502 }
      );
    }

    // Keep payload bounded
    const clipped = text.slice(0, 60_000);

    return NextResponse.json({ videoId, text: clipped });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
