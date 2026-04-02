import { NextResponse } from 'next/server';

type RoadmapStage = {
  id: string;
  title: string;
  objectives: string;
  difficulty: 'Beginner' | 'Intermediate' | 'Advanced';
};

export async function POST(req: Request) {
  try {
    const body: unknown = await req.json();
    const topic = typeof (body as { topic?: unknown })?.topic === 'string' ? (body as { topic: string }).topic : '';
    if (!topic.trim()) {
      return NextResponse.json({ error: 'Missing topic' }, { status: 400 });
    }

    // Prompt template: force 10 point-wise items for the exact topic
    const prompt = [
      "You are an expert curriculum coach.",
      "Generate a study roadmap for TODAY.",
      "Topic: " + topic.trim(),
      "Constraints:",
      "- Output EXACTLY 10 items.",
      "- Each item must be ONE line.",
      "- Format: N. <Short stage title>: <what to study + tiny practice task>",
      "- Keep titles short (3-7 words).",
      "- Do NOT mention any other language/topic.",
      "Output:",
    ]
      .filter(Boolean)
      .join("\n");
    
    const generateRes = await fetch("http://127.0.0.1:8000/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt })
    });

    if (!generateRes.ok) {
        throw new Error("Python backend generation failed");
    }

    const generateData = await generateRes.json().catch(() => ({} as any));
    const roadmapText = typeof (generateData as any)?.generated_text === "string" ? (generateData as any).generated_text : "";
    const lines = roadmapText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .filter((l) => /^\d+\./.test(l));

    const stages: RoadmapStage[] = lines.slice(0, 10).map((line: string, i: number) => {
      const cleaned = line.replace(/^\d+\.\s*/, "");
      // Try to split `Title: objectives...` (fallback to whole line as title)
      const parts = cleaned.split(/\s*[:\-–—]\s*/, 2);
      const title = (parts[0] || cleaned).trim();
      const objectives = (parts[1] || "Core concepts and practice").trim();
      return {
        id: `stage-${i}`,
        title,
        objectives,
        difficulty: i < 3 ? "Beginner" : i < 7 ? "Intermediate" : "Advanced",
      };
    });

    if (stages.length === 0) {
      return NextResponse.json({ error: "Roadmap generation returned no numbered items." }, { status: 502 });
    }

    return NextResponse.json({ roadmap: stages });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
