import { NextResponse } from "next/server";
import { prisma, getDatabaseApiError } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";

export async function GET() {
  try {
    const problems = await prisma.problem.findMany({
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { threads: true } } },
    });

    return NextResponse.json({
      problems: problems.map((p) => ({
        id: p.id,
        title: p.title,
        description: p.description,
        difficulty: p.difficulty,
        tags: p.tags,
        threadCount: p._count.threads,
        createdAt: p.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    const dbErr = getDatabaseApiError(error);
    if (dbErr) return NextResponse.json({ error: dbErr }, { status: 503 });
    return NextResponse.json(
      { error: "Failed to load problems" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const user = await getAuthUser();
    if (!user) {
      return NextResponse.json({ error: "Login required" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const { title, description, difficulty, tags } = body as {
      title?: string;
      description?: string;
      difficulty?: string;
      tags?: string[];
    };

    if (!title?.trim() || !description?.trim()) {
      return NextResponse.json(
        { error: "Title and description are required" },
        { status: 400 }
      );
    }

    const validDifficulties = ["Easy", "Medium", "Hard"];
    const safeDifficulty = validDifficulties.includes(difficulty ?? "")
      ? difficulty!
      : "Medium";

    const safeTags = Array.isArray(tags)
      ? tags.filter((t): t is string => typeof t === "string" && t.trim().length > 0).map((t) => t.trim())
      : [];

    const problem = await prisma.problem.create({
      data: {
        title: title.trim(),
        description: description.trim(),
        difficulty: safeDifficulty,
        tags: safeTags,
      },
      include: { _count: { select: { threads: true } } },
    });

    return NextResponse.json({
      problem: {
        id: problem.id,
        title: problem.title,
        description: problem.description,
        difficulty: problem.difficulty,
        tags: problem.tags,
        threadCount: problem._count.threads,
        createdAt: problem.createdAt.toISOString(),
      },
    });
  } catch (error) {
    const dbErr = getDatabaseApiError(error);
    if (dbErr) return NextResponse.json({ error: dbErr }, { status: 503 });
    return NextResponse.json(
      { error: "Failed to create problem" },
      { status: 500 }
    );
  }
}
