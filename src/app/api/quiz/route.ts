import { NextResponse } from 'next/server';

type TavilySearchResult = {
  url?: string;
  content?: string;
};

export async function POST(req: Request) {
  try {
    const body: unknown = await req.json();
    const topic = typeof (body as { topic?: unknown })?.topic === 'string' ? (body as { topic: string }).topic : '';
    if (!topic.trim()) {
      return NextResponse.json({ error: 'Missing topic' }, { status: 400 });
    }

    // 1. Search Tavily for recent info (via Python backend)
    const searchRes = await fetch("http://127.0.0.1:8000/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: `${topic} interview questions site:leetcode.com OR site:reddit.com` })
    });
    
    if (searchRes.ok) {
        const searchData = await searchRes.json();
        // The results field depends on what Tavily returns, usually searchData.results
        const rawResults = (searchData as { results?: unknown }).results;
        const results: TavilySearchResult[] = Array.isArray((rawResults as { results?: unknown })?.results)
          ? ((rawResults as { results: TavilySearchResult[] }).results)
          : (Array.isArray(rawResults) ? (rawResults as TavilySearchResult[]) : []);
        
        // Store top 3 results in Vector DB
        for (const resItem of results.slice(0, 3)) {
          if (resItem.content) {
                await fetch("http://127.0.0.1:8000/api/store", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ id: resItem.url || String(Math.random()), text: resItem.content })
                });
            }
        }
    }

    // 2. Generate Quiz based on retrieved context
    const retrieveRes = await fetch("http://127.0.0.1:8000/api/retrieve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: `${topic} interview` })
    });
    
    const contextData: { context?: string } = await retrieveRes.json();
    
    const prompt = `Based on this real-world context: ${contextData.context}. Generate exactly 1 multiple choice mock interview question about ${topic}:\n`;
    
    const generateRes = await fetch("http://127.0.0.1:8000/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt })
    });
    
    const evaluateData: { generated_text?: string } = await generateRes.json();

    return NextResponse.json({ 
      quiz: (evaluateData.generated_text || '').replace(prompt, "").trim()
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
