import { NextResponse } from "next/server";
import { prisma, getDatabaseApiError } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const problemId = searchParams.get("problemId");

    if (!problemId) {
      return NextResponse.json(
        { error: "problemId is required" },
        { status: 400 }
      );
    }

    const user = await getAuthUser();
    const userId = user?.id ?? null;

    const threads = await prisma.thread.findMany({
      where: { problemId },
      orderBy: { createdAt: "desc" },
      include: {
        user: { select: { id: true, name: true, email: true } },
        _count: { select: { replies: true } },
        votes: userId ? { where: { userId } } : false,
      },
    });

    return NextResponse.json({
      threads: threads.map((t) => ({
        id: t.id,
        title: t.title,
        content: t.content,
        authorName: t.user.name || t.user.email || "Anonymous",
        authorId: t.user.id,
        problemId: t.problemId,
        upvotes: t.upvotes,
        downvotes: t.downvotes,
        replyCount: t._count.replies,
        userVote:
          userId && Array.isArray(t.votes) && t.votes.length > 0
            ? t.votes[0].value
            : 0,
        createdAt: t.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    const dbErr = getDatabaseApiError(error);
    if (dbErr) return NextResponse.json({ error: dbErr }, { status: 503 });
    return NextResponse.json(
      { error: "Failed to load threads" },
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
    const { title, content, problemId } = body as {
      title?: string;
      content?: string;
      problemId?: string;
    };

    if (!title?.trim() || !content?.trim() || !problemId?.trim()) {
      return NextResponse.json(
        { error: "Title, content, and problemId are required" },
        { status: 400 }
      );
    }

    const problem = await prisma.problem.findUnique({
      where: { id: problemId },
    });
    if (!problem) {
      return NextResponse.json(
        { error: "Problem not found" },
        { status: 404 }
      );
    }

    const thread = await prisma.thread.create({
      data: {
        title: title.trim(),
        content: content.trim(),
        userId: user.id,
        problemId,
      },
      include: {
        user: { select: { id: true, name: true, email: true } },
        _count: { select: { replies: true } },
      },
    });

    return NextResponse.json({
      thread: {
        id: thread.id,
        title: thread.title,
        content: thread.content,
        authorName: thread.user.name || thread.user.email || "Anonymous",
        authorId: thread.user.id,
        problemId: thread.problemId,
        upvotes: thread.upvotes,
        downvotes: thread.downvotes,
        replyCount: thread._count.replies,
        userVote: 0,
        createdAt: thread.createdAt.toISOString(),
      },
    });
  } catch (error) {
    const dbErr = getDatabaseApiError(error);
    if (dbErr) return NextResponse.json({ error: dbErr }, { status: 503 });
    return NextResponse.json(
      { error: "Failed to create thread" },
      { status: 500 }
    );
  }
}
