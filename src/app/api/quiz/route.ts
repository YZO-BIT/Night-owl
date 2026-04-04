import { NextResponse } from 'next/server';

type TavilySearchResult = {
  url?: string;
  content?: string;
};

function parseLevel(input: unknown): "Easy" | "Medium" | "Hard" {
  const txt = typeof input === "string" ? input.trim().toLowerCase() : "";
  if (txt === "easy") return "Easy";
  if (txt === "hard") return "Hard";
  return "Medium";
}

export async function POST(req: Request) {
  try {
    const body: unknown = await req.json();
    const topic = typeof (body as { topic?: unknown })?.topic === 'string' ? (body as { topic: string }).topic : '';
    const mode = typeof (body as { mode?: unknown })?.mode === "string" ? (body as { mode: string }).mode : "practice";
    const sessionNumber = typeof (body as { sessionNumber?: unknown })?.sessionNumber === "number"
      ? (body as { sessionNumber: number }).sessionNumber
      : 1;
    const level = parseLevel((body as { level?: unknown })?.level);
    if (!topic.trim()) {
      return NextResponse.json({ error: 'Missing topic' }, { status: 400 });
    }

    // 1. Search Tavily for recent info (via Python backend)
    const searchRes = await fetch("http://127.0.0.1:8000/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: `${topic} interview questions site:leetcode.com OR site:reddit.com OR site:geeksforgeeks.org` })
    });
    
    let freshContext = "";
    if (searchRes.ok) {
        const searchData = await searchRes.json();
        // The results field depends on what Tavily returns, usually searchData.results
        const rawResults = (searchData as { results?: unknown }).results;
        const results: TavilySearchResult[] = Array.isArray((rawResults as { results?: unknown })?.results)
          ? ((rawResults as { results: TavilySearchResult[] }).results)
          : (Array.isArray(rawResults) ? (rawResults as TavilySearchResult[]) : []);
        
        // Grab context directly from the search hits without polluting the global Vector DB
        freshContext = results.slice(0, 3).map(r => r.content || "").join("\n").slice(0, 1500);
    }
    
    
    const assessmentFlag = mode === "assessment" ? "Retention checkpoint" : "Practice session";
    
    let qCount = 10;
    if (level === "Medium") qCount = 15;
    if (level === "Hard") qCount = 20;

    const mcqCount = Math.floor(qCount * 0.6);
    const descCount = qCount - mcqCount;

    const setTypeInstruction = `a mixed diagnostic assessment of exactly ${qCount} questions including: ${mcqCount} Multiple Choice Questions (MCQs) with 4 options each, and ${descCount} descriptive analytical questions.`;
    
    const prompt = [
      `Context: ${freshContext}`,
      `Topic: ${topic}`,
      `Level: ${level}`,
      `Session number: ${sessionNumber}`,
      `Mode: ${assessmentFlag}`,
      `Generate ONE proper set of test questions covering the topic.`,
      `You MUST strictly format your output as follows:`,
      `Question:`,
      `[For Descriptive questions, format exactly: "[DESCRIPTIVE] 1. <Question text>" ]`,
      `[For MCQs, format exactly: "[MCQ] 2. <Question text>\\nA) <Option 1>\\nB) <Option 2>\\nC) <Option 3>\\nD) <Option 4>" ]`,
      `[Write ${setTypeInstruction} here using those EXACT prefix tags.]`,
      `FollowUp1: <follow-up question>`,
      `FollowUp2: <follow-up question>`,
      `OptimizationHint: <one optimization/improvement direction>`,
      `Do not add extra header or footer sections. Stick exactly to this layout and structure.`
    ].join("\n");
    
    const generateRes = await fetch("http://127.0.0.1:8000/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt })
    });
    
    const evaluateData: { generated_text?: string } = await generateRes.json();

    const generated = (evaluateData.generated_text || '').replace(prompt, "").trim();
    const qMatch = generated.match(/Question:\s*([\s\S]*?)(?:FollowUp1:|FollowUp2:|OptimizationHint:|$)/i);
    const f1Match = generated.match(/FollowUp1:\s*(.+)/i);
    const f2Match = generated.match(/FollowUp2:\s*(.+)/i);
    const optMatch = generated.match(/OptimizationHint:\s*(.+)/i);

    const mainQuestion = (qMatch?.[1] || generated || `Explain one important concept in ${topic}.`).replace(/^Question:\s*/i, "").trim();
    const followUps = [f1Match?.[1], f2Match?.[1]].filter((x): x is string => typeof x === "string" && x.trim().length > 0);
    const optimizationHint = (optMatch?.[1] || "Suggest one optimization and one trade-off in your answer.").trim();

    // Parse into structured quiz items
    const parsedItems = [];
    const itemMatches = [...mainQuestion.matchAll(/(?:\[(MCQ|DESCRIPTIVE)\]\s*)([^\[]+)/gi)];
    
    if (itemMatches.length > 0) {
      itemMatches.forEach((match, i) => {
          const typeStr = match[1].toUpperCase();
          const content = match[2].trim();
          if (typeStr === 'MCQ') {
              const lines = content.split('\n').map(l => l.trim()).filter(l => l);
              const optionsIndex = lines.findIndex(l => /^[A-D][)\.]/i.test(l));
              if (optionsIndex !== -1) {
                  const questionText = lines.slice(0, optionsIndex).join('\n');
                  const options = lines.slice(optionsIndex).filter(l => /^[A-D][)\.]/i.test(l)).slice(0, 4);
                  parsedItems.push({ id: `q${i}`, type: 'mcq', question: questionText, options });
                  return;
              }
          }
          parsedItems.push({ id: `q${i}`, type: 'descriptive', question: content });
      });
    } else {
      // Fallback if LLM forgets prefixes
      parsedItems.push({ id: 'q0', type: 'descriptive', question: mainQuestion });
    }

    // Shuffle the parsedItems array so MCQ and descriptive questions are mixed randomly
    for (let i = parsedItems.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [parsedItems[i], parsedItems[j]] = [parsedItems[j], parsedItems[i]];
    }

    return NextResponse.json({
      quiz: mainQuestion,
      quizItems: parsedItems,
      followUps,
      optimizationHint,
      mode: assessmentFlag,
      level,
      sessionNumber,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
