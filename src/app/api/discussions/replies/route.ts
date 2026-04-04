import { NextResponse } from "next/server";
import { prisma, getDatabaseApiError } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";

export async function POST(request: Request) {
  try {
    const user = await getAuthUser();
    if (!user) {
      return NextResponse.json({ error: "Login required" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const { content, threadId } = body as {
      content?: string;
      threadId?: string;
    };

    if (!content?.trim() || !threadId?.trim()) {
      return NextResponse.json(
        { error: "Content and threadId are required" },
        { status: 400 }
      );
    }

    const thread = await prisma.thread.findUnique({
      where: { id: threadId },
    });
    if (!thread) {
      return NextResponse.json(
        { error: "Thread not found" },
        { status: 404 }
      );
    }

    const reply = await prisma.reply.create({
      data: {
        content: content.trim(),
        userId: user.id,
        threadId,
      },
      include: {
        user: { select: { id: true, name: true, email: true } },
      },
    });

    return NextResponse.json({
      reply: {
        id: reply.id,
        content: reply.content,
        authorName: reply.user.name || reply.user.email || "Anonymous",
        authorId: reply.user.id,
        upvotes: reply.upvotes,
        downvotes: reply.downvotes,
        userVote: 0,
        createdAt: reply.createdAt.toISOString(),
      },
    });
  } catch (error) {
    const dbErr = getDatabaseApiError(error);
    if (dbErr) return NextResponse.json({ error: dbErr }, { status: 503 });
    return NextResponse.json(
      { error: "Failed to create reply" },
      { status: 500 }
    );
  }
}
