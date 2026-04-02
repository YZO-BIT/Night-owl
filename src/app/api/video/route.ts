import { NextResponse } from "next/server";

type TavilyResult = {
  url?: unknown;
  title?: unknown;
  content?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isYouTubeUrl(url: string) {
  return (
    url.includes("youtube.com/watch") ||
    url.includes("youtu.be/") ||
    url.includes("youtube.com/shorts/") ||
    url.includes("m.youtube.com/") ||
    url.includes("youtube.com/embed/") ||
    url.includes("youtube.com/live/") ||
    url.includes("youtube-nocookie.com/")
  );
}

function toYouTubeEmbed(url: string): string | null {
  try {
    const u = new URL(url);

    // youtu.be/<id>
    if (u.hostname === "youtu.be") {
      const id = u.pathname.replace("/", "").trim();
      return id ? `https://www.youtube.com/embed/${id}` : null;
    }

    const isYouTubeHost =
      u.hostname === "youtube.com" ||
      u.hostname.endsWith(".youtube.com") ||
      u.hostname === "youtube-nocookie.com" ||
      u.hostname.endsWith(".youtube-nocookie.com");

    // youtube.com/watch?v=<id>
    if (isYouTubeHost) {
      if (u.pathname === "/watch") {
        const id = u.searchParams.get("v")?.trim();
        return id ? `https://www.youtube.com/embed/${id}` : null;
      }

      // youtube.com/embed/<id>
      const embedPrefix = "/embed/";
      if (u.pathname.startsWith(embedPrefix)) {
        const id = u.pathname.slice(embedPrefix.length).split("/")[0]?.trim();
        return id ? `https://www.youtube.com/embed/${id}` : null;
      }

      // youtube.com/shorts/<id>
      const shortsPrefix = "/shorts/";
      if (u.pathname.startsWith(shortsPrefix)) {
        const id = u.pathname.slice(shortsPrefix.length).split("/")[0]?.trim();
        return id ? `https://www.youtube.com/embed/${id}` : null;
      }

      // youtube.com/live/<id>
      const livePrefix = "/live/";
      if (u.pathname.startsWith(livePrefix)) {
        const id = u.pathname.slice(livePrefix.length).split("/")[0]?.trim();
        return id ? `https://www.youtube.com/embed/${id}` : null;
      }
    }

    return null;
  } catch {
    return null;
  }
}

type VideoHit = {
  title: string;
  url: string;
  embedUrl: string | null;
  source: "youtube" | "web";
};

type Body = { topic?: unknown; stageTitle?: unknown };

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;
    const topic = asString(body.topic);
    const stageTitle = asString(body.stageTitle);
    if (!topic) {
      return NextResponse.json({ error: "Missing topic" }, { status: 400 });
    }

    // Prefer ranked video results via python; fall back to raw search if backend doesn't support it.
    let results: TavilyResult[] = [];

    try {
      const ac = new AbortController();
      const timeout = setTimeout(() => ac.abort(), 12000);
      const pickRes = await fetch("http://127.0.0.1:8000/api/video_pick", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic, stage_title: stageTitle || topic, top_k: 10, max_youtube: 10 }),
        signal: ac.signal,
      });
      clearTimeout(timeout);
      const pickData: unknown = await pickRes.json().catch(() => null);
      if (pickRes.ok && isRecord(pickData) && Array.isArray(pickData.results)) {
        results = pickData.results as TavilyResult[];
      }
    } catch {
      // ignore; fall back below
    }

    if (results.length === 0) {
      const query = `${stageTitle || topic} tutorial video`;

      const ac = new AbortController();
      const timeout = setTimeout(() => ac.abort(), 12000);
      const pyRes = await fetch("http://127.0.0.1:8000/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
        signal: ac.signal,
      });
      clearTimeout(timeout);

      const pyData: unknown = await pyRes.json().catch(() => null);
      if (!pyRes.ok) {
        const detail = isRecord(pyData)
          ? typeof pyData.detail === "string"
            ? pyData.detail
            : typeof pyData.error === "string"
              ? pyData.error
              : ""
          : "";
        const suffix = detail ? ` (${detail})` : "";
        return NextResponse.json(
          { error: `Video search backend error${suffix}` },
          { status: 502 }
        );
      }

      // python returns { results: <tavilyResponse> }
      const tavilyPayload = isRecord(pyData) ? pyData.results : null;

      if (isRecord(tavilyPayload) && Array.isArray(tavilyPayload.results)) {
        results = tavilyPayload.results as TavilyResult[];
      } else if (Array.isArray(tavilyPayload)) {
        results = tavilyPayload as TavilyResult[];
      } else if (isRecord(pyData) && Array.isArray(pyData.results)) {
        results = pyData.results as TavilyResult[];
      }
    }

    const hits: VideoHit[] = [];
    for (const r of results) {
      const url = typeof r.url === "string" ? r.url : "";
      if (!url) continue;

      const title = typeof r.title === "string" && r.title.trim() ? r.title.trim() : url;

      const embedUrl = isYouTubeUrl(url) ? toYouTubeEmbed(url) : null;
      const source: VideoHit["source"] = embedUrl ? "youtube" : "web";

      hits.push({ title, url, embedUrl, source });
      if (hits.length >= 5) break;
    }

    // Prefer YouTube embeds first
    hits.sort((a, b) => Number(Boolean(b.embedUrl)) - Number(Boolean(a.embedUrl)));

    return NextResponse.json({ videos: hits.slice(0, 1) });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
