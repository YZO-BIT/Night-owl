import { NextResponse } from "next/server";
import { prisma, getDatabaseApiError } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const user = await getAuthUser();
    const userId = user?.id ?? null;

    const thread = await prisma.thread.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, name: true, email: true } },
        _count: { select: { replies: true } },
        votes: userId ? { where: { userId } } : false,
        replies: {
          orderBy: { createdAt: "asc" },
          include: {
            user: { select: { id: true, name: true, email: true } },
            votes: userId ? { where: { userId } } : false,
          },
        },
      },
    });

    if (!thread) {
      return NextResponse.json({ error: "Thread not found" }, { status: 404 });
    }

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
        userVote:
          userId && Array.isArray(thread.votes) && thread.votes.length > 0
            ? thread.votes[0].value
            : 0,
        createdAt: thread.createdAt.toISOString(),
        replies: thread.replies.map((r) => ({
          id: r.id,
          content: r.content,
          authorName: r.user.name || r.user.email || "Anonymous",
          authorId: r.user.id,
          upvotes: r.upvotes,
          downvotes: r.downvotes,
          userVote:
            userId && Array.isArray(r.votes) && r.votes.length > 0
              ? r.votes[0].value
              : 0,
          createdAt: r.createdAt.toISOString(),
        })),
      },
    });
  } catch (error) {
    const dbErr = getDatabaseApiError(error);
    if (dbErr) return NextResponse.json({ error: dbErr }, { status: 503 });
    return NextResponse.json(
      { error: "Failed to load thread" },
      { status: 500 }
    );
  }
}
