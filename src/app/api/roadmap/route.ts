import { NextResponse } from 'next/server';

type RoadmapStage = {
  id: string;
  title: string;
  objectives: string;
  difficulty: 'Beginner' | 'Intermediate' | 'Advanced';
  band: 'Stage 1-10' | 'Stage 11-20' | 'Stage 21-30';
  level: 'Easy' | 'Medium' | 'Hard';
};

type TaskPriority = 'Low' | 'Medium' | 'High';
type StageBand = 'Stage 1-10' | 'Stage 11-20' | 'Stage 21-30';

function parseLevel(input: unknown): 'Easy' | 'Medium' | 'Hard' {
  const txt = typeof input === 'string' ? input.trim().toLowerCase() : '';
  if (txt === 'easy') return 'Easy';
  if (txt === 'hard') return 'Hard';
  return 'Medium';
}

function parsePriority(input: unknown): TaskPriority {
  const txt = typeof input === 'string' ? input.trim().toLowerCase() : '';
  if (txt === 'low') return 'Low';
  if (txt === 'high') return 'High';
  return 'Medium';
}

function stageBandsForLevel(level: 'Easy' | 'Medium' | 'Hard'): StageBand[] {
  if (level === 'Easy') return ['Stage 1-10'];
  if (level === 'Medium') return ['Stage 1-10', 'Stage 11-20'];
  return ['Stage 1-10', 'Stage 11-20', 'Stage 21-30'];
}

function stageNumbersFromBands(bands: StageBand[]) {
  const out: number[] = [];
  for (const band of bands) {
    if (band === 'Stage 1-10') {
      for (let n = 1; n <= 10; n += 1) out.push(n);
      continue;
    }
    if (band === 'Stage 11-20') {
      for (let n = 11; n <= 20; n += 1) out.push(n);
      continue;
    }
    for (let n = 21; n <= 30; n += 1) out.push(n);
  }
  return out;
}

function stageBand(index: number): 'Stage 1-10' | 'Stage 11-20' | 'Stage 21-30' {
  if (index < 10) return 'Stage 1-10';
  if (index < 20) return 'Stage 11-20';
  return 'Stage 21-30';
}

function stageDifficulty(index: number): 'Beginner' | 'Intermediate' | 'Advanced' {
  if (index < 10) return 'Beginner';
  if (index < 20) return 'Intermediate';
  return 'Advanced';
}

function levelTitleBank(level: 'Easy' | 'Medium' | 'Hard') {
  if (level === 'Easy') {
    return {
      foundational: ['Concept Basics', 'Core Terms', 'Simple Workflow', 'Starter Patterns', 'Guided Example', 'Basic Components', 'Beginner Exercises', 'Foundational Review', 'Mini Use Case', 'Checkpoint 1'],
      applied: ['Applied Patterns', 'Hands-on Task', 'Scenario Practice', 'Debug Basics', 'Data Flow', 'Integration Intro', 'Boundary Cases', 'Mini Build', 'Review and Refine', 'Checkpoint 2'],
      advanced: ['Optimization Intro', 'Scaling Basics', 'Reliability Basics', 'Trade-off Thinking', 'Architecture View', 'Performance Checks', 'Secure Defaults', 'Refactor Pass', 'Capstone Draft', 'Final Review'],
    };
  }
  if (level === 'Hard') {
    return {
      foundational: ['Deep Fundamentals', 'Low-level Mechanics', 'Advanced Primitives', 'Edge-first Thinking', 'Constraint Modeling', 'Complexity Profiling', 'Failure Modes', 'Protocol Mapping', 'Design Heuristics', 'Checkpoint 1'],
      applied: ['System Integration', 'Performance Tuning', 'Reliability Engineering', 'Concurrency Patterns', 'State Consistency', 'Load Handling', 'Observability Design', 'Recovery Flows', 'Benchmark Lab', 'Checkpoint 2'],
      advanced: ['Scalability Strategies', 'Security Hardening', 'Optimization Trade-offs', 'Architecture Critique', 'Production Readiness', 'Cost-performance Balance', 'Stress Testing', 'Interview-grade Scenarios', 'Capstone Build', 'Final Review'],
    };
  }

  return {
    foundational: ['Core Foundations', 'Key Concepts', 'System Basics', 'Practical Intro', 'Pattern Basics', 'Guided Build', 'Problem Framing', 'Validation Basics', 'Mini Challenge', 'Checkpoint 1'],
    applied: ['Applied Systems', 'Hands-on Implementation', 'Scenario Solving', 'Debug and Improve', 'Data and Flow', 'Integration Practice', 'Edge Handling', 'Quality Checks', 'Refinement Cycle', 'Checkpoint 2'],
    advanced: ['Optimization Pass', 'Scalable Design', 'Reliability Patterns', 'Security and Safety', 'Architecture Decisions', 'Performance Analysis', 'Trade-off Review', 'Production Scenarios', 'Capstone Run', 'Final Review'],
  };
}

function buildFallback(
  topic: string,
  level: 'Easy' | 'Medium' | 'Hard',
  task: string,
  priority: TaskPriority,
  stageNumbers: number[]
) {
  const bank = levelTitleBank(level);
  const cadenceHint = priority === 'High'
    ? 'Keep tasks concise and outcome-focused for faster delivery.'
    : priority === 'Low'
      ? 'Focus on depth, concept clarity, and reflection before moving on.'
      : 'Balance speed and depth with one concept and one implementation step.';
  const taskHint = task.trim() ? `Today task context: ${task.trim()}.` : '';

  const stages: RoadmapStage[] = [];
  const topicShort = topic.trim().slice(0, 24) || 'Topic';
  for (const n of stageNumbers) {
    const i = n - 1;
    const pool = i < 10 ? bank.foundational : i < 20 ? bank.applied : bank.advanced;
    const title = `${topicShort} ${pool[i % 10]} ${n}`;
    const objective =
      level === 'Easy'
        ? `Study one clear concept in ${topic}, solve one guided exercise, and write one short reflection. ${taskHint} ${cadenceHint}`
        : level === 'Hard'
          ? `Study advanced ${topic} patterns and complete one optimization-focused implementation with trade-off notes. ${taskHint} ${cadenceHint}`
          : `Study key ${topic} concepts and complete one practical implementation task with quick evaluation. ${taskHint} ${cadenceHint}`;

    stages.push({
      id: `stage-${i + 1}`,
      title,
      objectives: objective,
      difficulty: stageDifficulty(i),
      band: stageBand(i),
      level,
    });
  }
  return stages;
}

export async function POST(req: Request) {
  try {
    const body: unknown = await req.json();
    const topic = typeof (body as { topic?: unknown })?.topic === 'string' ? (body as { topic: string }).topic : '';
    const todayTask = typeof (body as { task?: unknown })?.task === 'string' ? (body as { task: string }).task.trim() : '';
    const priority = parsePriority((body as { priority?: unknown })?.priority);
    const level = parseLevel((body as { level?: unknown })?.level);
    const stageBands = stageBandsForLevel(level);
    const stageNumbers = stageNumbersFromBands(stageBands);
    const targetCount = stageNumbers.length;
    if (!topic.trim()) {
      return NextResponse.json({ error: 'Missing topic' }, { status: 400 });
    }
    // Prompt template: force a level-appropriate roadmap with progression bands and level adaptation.
    const prompt = [
      "You are an expert curriculum coach.",
      "Generate a structured mentorship roadmap.",
      "Topic: " + topic.trim(),
      "Selected level: " + level,
      "Today's task: " + (todayTask || 'General mastery'),
      "Task priority: " + priority,
      "Selected stage bands: " + stageBands.join(', '),
      "Constraints:",
      `- Output EXACTLY ${targetCount} items.`,
      "- Each item must be ONE line.",
      "- Format: N. <Descriptive Topic Title>: <detailed objective on what specifically to study and a practice task>",
      "- NEVER use the word 'Stage' or 'Step' in the title itself. Make titles specific to the topic.",
      "- Keep titles short (3-7 words) but highly descriptive.",
      "- Make the objective detailed (at least 1-2 sentences).",
      "- Stages 1-10 should be foundational, 11-20 applied, 21-30 advanced.",
      "- Each item must be unique and non-repeating.",
      "- Do NOT mention any other language/topic.",
      "Output:",
    ]
      .filter(Boolean)
      .join("\n");
    
    let roadmapText = "";
    try {
      const generateRes = await fetch("http://127.0.0.1:8000/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt })
      });

      if (generateRes.ok) {
        const generateData: { generated_text?: unknown } = await generateRes.json().catch(() => ({}));
        roadmapText = typeof generateData.generated_text === "string" ? generateData.generated_text : "";
      } else {
        console.warn("Python backend returned error, using fallback roadmap.");
      }
    } catch (apiError) {
      console.warn("Could not reach Python backend (is it running?), using fallback roadmap.", apiError);
    }
    const lines = roadmapText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .filter((l) => l.length >= 6);

    const uniqueLines: string[] = [];
    const seen = new Set<string>();
    for (const raw of lines) {
      const normalized = raw
        .replace(/^\s*[-*]\s*/, '')
        .replace(/^\s*\d+[).:-]?\s*/, '')
        .replace(/^N\.\s*/i, '')
        .replace(/\s+/g, ' ')
        .trim();
      if (!normalized) continue;
      const key = normalized.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      uniqueLines.push(normalized);
      if (uniqueLines.length >= targetCount) break;
    }

    const stages: RoadmapStage[] = uniqueLines.slice(0, targetCount).map((line: string, i: number) => {
      const stageNumber = stageNumbers[i] || i + 1;
      let cleaned = line.replace(/^\d+[\.\):-]?\s*/, "");
      
      // Separate by first colon or hyphen
      const separatorMatch = cleaned.match(/[:\-–—]/);
      let title = cleaned;
      let objectives = "Core concepts and practice";

      if (separatorMatch && separatorMatch.index !== undefined) {
        title = cleaned.slice(0, separatorMatch.index).trim();
        objectives = cleaned.slice(separatorMatch.index + 1).trim() || objectives;
      }

      // If the model ignored instructions and returned "Stage X" as the title, try to salvage it
      if (title.toLowerCase().startsWith("stage") && objectives.length > 5) {
        const innerMatch = objectives.match(/[:\-–—]/);
        if (innerMatch && innerMatch.index !== undefined) {
           title = objectives.slice(0, innerMatch.index).trim();
           objectives = objectives.slice(innerMatch.index + 1).trim();
        } else {
           // Swap: title absorbs first words of objective, if needed
           title = objectives.split(" ").slice(0, 5).join(" ");
        }
      }

      // Clean up leading numbers or 'Stage' words that might have leaked into the 'new' title
      title = title.replace(/^(Stage|Step)\s*\d*\s*[:\-–—]?\s*/i, "");
      title = title.replace(/^\d+[\.\):-]?\s*/, "");
      title = title.trim();
      
      if (!title || title.length < 2) {
          title = `Core Concepts ${stageNumber}`;
      }

      return {
        id: `stage-${stageNumber}`,
        title,
        objectives,
        difficulty: stageDifficulty(stageNumber - 1),
        band: stageBand(stageNumber - 1),
        level,
      };
    });

    if (stages.length < targetCount) {
      const remainingStageNumbers = stageNumbers.slice(stages.length);
      const fallbackStages = buildFallback(topic.trim(), level, todayTask, priority, remainingStageNumbers);
      return NextResponse.json({ roadmap: [...stages, ...fallbackStages] });
    }

    return NextResponse.json({ roadmap: stages });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
