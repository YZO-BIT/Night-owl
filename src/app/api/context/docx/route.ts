import { NextResponse } from "next/server";
import mammoth from "mammoth";

export async function POST(req: Request) {
  try {
    const contentType = req.headers.get("content-type") || "";
    if (!contentType.includes("multipart/form-data")) {
      return NextResponse.json(
        { error: "Expected multipart/form-data with a .docx file" },
        { status: 400 }
      );
    }

    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Missing file" }, { status: 400 });
    }

    const name = typeof file.name === "string" ? file.name.toLowerCase() : "";
    if (!name.endsWith(".docx")) {
      return NextResponse.json({ error: "Only .docx supported" }, { status: 400 });
    }

    const buf = Buffer.from(await file.arrayBuffer());
    const result = await mammoth.extractRawText({ buffer: buf });
    const text = (result?.value || "").replace(/\s+/g, " ").trim();

    if (!text) {
      return NextResponse.json({ error: "No text extracted from docx" }, { status: 502 });
    }

    return NextResponse.json({ text: text.slice(0, 60_000) });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
