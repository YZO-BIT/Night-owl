"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowLeft, Loader2, MessageSquareText } from "lucide-react";
import { fetchThread, createReply } from "@/lib/discussions";
import type { ThreadDetail, ReplyData } from "@/lib/discussions";
import VoteButtons from "@/components/discussion/VoteButtons";
import ReplyBox from "@/components/discussion/ReplyBox";

function timeAgo(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(isoDate).toLocaleDateString();
}

export default function ThreadPage() {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const [thread, setThread] = useState<ThreadDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let active = true;
    (async () => {
      try {
        const data = await fetchThread(id);
        if (active) setThread(data);
      } catch {
        // silent
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [id]);

  const handleReply = async (content: string) => {
    if (!thread) return;
    setSubmitting(true);
    setError(null);
    try {
      const reply = await createReply({ content, threadId: thread.id });
      setThread((prev) =>
        prev
          ? { ...prev, replies: [...prev.replies, reply], replyCount: prev.replyCount + 1 }
          : prev
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to post reply");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[hsl(var(--background))] text-[hsl(var(--foreground))] overflow-x-hidden selection:bg-cyan-500/30">
      {/* Background */}
      <div className="fixed inset-0 pointer-events-none z-0">
        <div className="absolute top-1/4 -left-1/4 w-[800px] h-[800px] bg-cyan-900/20 blur-[120px] rounded-full mix-blend-screen" />
        <div className="absolute bottom-1/4 -right-1/4 w-[800px] h-[800px] bg-indigo-900/20 blur-[120px] rounded-full mix-blend-screen" />
      </div>

      {/* Nav */}
      <nav className="relative z-50 flex items-center justify-between p-6 md:px-12 backdrop-blur-md border-b border-white/5">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.back()}
            className="p-2 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 transition-colors mr-2"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="p-2 bg-gradient-to-br from-cyan-500 to-indigo-600 rounded-xl">
            <MessageSquareText className="w-6 h-6 text-white" />
          </div>
          <span className="text-xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-slate-900 to-slate-600 dark:from-white dark:to-slate-400">
            Thread
          </span>
        </div>
      </nav>

      <main className="relative z-10 max-w-3xl mx-auto px-6 py-12">
        {loading ? (
          <div className="flex items-center justify-center gap-3 py-20 text-slate-400">
            <Loader2 className="w-5 h-5 animate-spin" /> Loading thread...
          </div>
        ) : !thread ? (
          <div className="text-center py-20">
            <p className="text-slate-400 text-lg">Thread not found.</p>
          </div>
        ) : (
          <>
            {/* Thread Content */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="rounded-3xl border border-white/10 bg-white/[0.03] p-8 backdrop-blur mb-10"
            >
              <div className="flex gap-5">
                <VoteButtons
                  threadId={thread.id}
                  upvotes={thread.upvotes}
                  downvotes={thread.downvotes}
                  userVote={thread.userVote}
                />
                <div className="flex-1 min-w-0">
                  <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight mb-4">
                    {thread.title}
                  </h1>
                  <p className="text-sm text-slate-300 whitespace-pre-wrap leading-relaxed mb-6">
                    {thread.content}
                  </p>
                  <div className="flex items-center gap-4 text-xs text-slate-500">
                    <span className="text-slate-300 font-semibold">
                      {thread.authorName}
                    </span>
                    <span>{timeAgo(thread.createdAt)}</span>
                    <span className="flex items-center gap-1 text-slate-400">
                      <MessageSquareText className="w-3.5 h-3.5" />
                      {thread.replyCount}{" "}
                      {thread.replyCount === 1 ? "reply" : "replies"}
                    </span>
                  </div>
                </div>
              </div>
            </motion.div>

            {/* Replies + Compose */}
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15 }}
              className="rounded-3xl border border-white/10 bg-white/[0.03] p-8 backdrop-blur"
            >
              {error && (
                <p className="text-sm text-rose-300 mb-4">{error}</p>
              )}
              <ReplyBox
                replies={thread.replies}
                onSubmit={handleReply}
                submitting={submitting}
              />
            </motion.div>
          </>
        )}
      </main>
    </div>
  );
}
