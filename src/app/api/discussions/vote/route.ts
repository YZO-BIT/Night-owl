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
    const { threadId, replyId, value } = body as {
      threadId?: string;
      replyId?: string;
      value?: number;
    };

    if (value !== 1 && value !== -1) {
      return NextResponse.json(
        { error: "Value must be 1 or -1" },
        { status: 400 }
      );
    }

    if (!threadId && !replyId) {
      return NextResponse.json(
        { error: "threadId or replyId is required" },
        { status: 400 }
      );
    }

    // Vote on a thread
    if (threadId) {
      const thread = await prisma.thread.findUnique({ where: { id: threadId } });
      if (!thread) {
        return NextResponse.json({ error: "Thread not found" }, { status: 404 });
      }

      const existing = await prisma.vote.findUnique({
        where: { userId_threadId: { userId: user.id, threadId } },
      });

      if (existing) {
        if (existing.value === value) {
          // Toggle off: remove vote
          await prisma.$transaction([
            prisma.vote.delete({ where: { id: existing.id } }),
            prisma.thread.update({
              where: { id: threadId },
              data: value === 1 ? { upvotes: { decrement: 1 } } : { downvotes: { decrement: 1 } },
            }),
          ]);

          const updated = await prisma.thread.findUnique({
            where: { id: threadId },
            select: { upvotes: true, downvotes: true },
          });

          return NextResponse.json({
            upvotes: updated?.upvotes ?? 0,
            downvotes: updated?.downvotes ?? 0,
            userVote: 0,
          });
        } else {
          // Switch vote direction
          const incrField = value === 1 ? "upvotes" : "downvotes";
          const decrField = value === 1 ? "downvotes" : "upvotes";

          await prisma.$transaction([
            prisma.vote.update({ where: { id: existing.id }, data: { value } }),
            prisma.thread.update({
              where: { id: threadId },
              data: { [incrField]: { increment: 1 }, [decrField]: { decrement: 1 } },
            }),
          ]);

          const updated = await prisma.thread.findUnique({
            where: { id: threadId },
            select: { upvotes: true, downvotes: true },
          });

          return NextResponse.json({
            upvotes: updated?.upvotes ?? 0,
            downvotes: updated?.downvotes ?? 0,
            userVote: value,
          });
        }
      } else {
        // New vote
        await prisma.$transaction([
          prisma.vote.create({ data: { userId: user.id, threadId, value } }),
          prisma.thread.update({
            where: { id: threadId },
            data: value === 1 ? { upvotes: { increment: 1 } } : { downvotes: { increment: 1 } },
          }),
        ]);

        const updated = await prisma.thread.findUnique({
          where: { id: threadId },
          select: { upvotes: true, downvotes: true },
        });

        return NextResponse.json({
          upvotes: updated?.upvotes ?? 0,
          downvotes: updated?.downvotes ?? 0,
          userVote: value,
        });
      }
    }

    // Vote on a reply
    if (replyId) {
      const reply = await prisma.reply.findUnique({ where: { id: replyId } });
      if (!reply) {
        return NextResponse.json({ error: "Reply not found" }, { status: 404 });
      }

      const existing = await prisma.vote.findUnique({
        where: { userId_replyId: { userId: user.id, replyId } },
      });

      if (existing) {
        if (existing.value === value) {
          await prisma.$transaction([
            prisma.vote.delete({ where: { id: existing.id } }),
            prisma.reply.update({
              where: { id: replyId },
              data: value === 1 ? { upvotes: { decrement: 1 } } : { downvotes: { decrement: 1 } },
            }),
          ]);

          const updated = await prisma.reply.findUnique({
            where: { id: replyId },
            select: { upvotes: true, downvotes: true },
          });

          return NextResponse.json({
            upvotes: updated?.upvotes ?? 0,
            downvotes: updated?.downvotes ?? 0,
            userVote: 0,
          });
        } else {
          const incrField = value === 1 ? "upvotes" : "downvotes";
          const decrField = value === 1 ? "downvotes" : "upvotes";

          await prisma.$transaction([
            prisma.vote.update({ where: { id: existing.id }, data: { value } }),
            prisma.reply.update({
              where: { id: replyId },
              data: { [incrField]: { increment: 1 }, [decrField]: { decrement: 1 } },
            }),
          ]);

          const updated = await prisma.reply.findUnique({
            where: { id: replyId },
            select: { upvotes: true, downvotes: true },
          });

          return NextResponse.json({
            upvotes: updated?.upvotes ?? 0,
            downvotes: updated?.downvotes ?? 0,
            userVote: value,
          });
        }
      } else {
        await prisma.$transaction([
          prisma.vote.create({ data: { userId: user.id, replyId, value } }),
          prisma.reply.update({
            where: { id: replyId },
            data: value === 1 ? { upvotes: { increment: 1 } } : { downvotes: { increment: 1 } },
          }),
        ]);

        const updated = await prisma.reply.findUnique({
          where: { id: replyId },
          select: { upvotes: true, downvotes: true },
        });

        return NextResponse.json({
          upvotes: updated?.upvotes ?? 0,
          downvotes: updated?.downvotes ?? 0,
          userVote: value,
        });
      }
    }

    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  } catch (error) {
    const dbErr = getDatabaseApiError(error);
    if (dbErr) return NextResponse.json({ error: dbErr }, { status: 503 });
    return NextResponse.json(
      { error: "Failed to process vote" },
      { status: 500 }
    );
  }
}
