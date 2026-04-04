"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft,
  Plus,
  Loader2,
  X,
  MessageSquareText,
} from "lucide-react";
import {
  fetchProblems,
  fetchThreads,
  createThread,
} from "@/lib/discussions";
import type { ProblemSummary, ThreadSummary } from "@/lib/discussions";
import ThreadCard from "@/components/discussion/ThreadCard";

const DIFFICULTY_COLORS: Record<string, string> = {
  Easy: "text-emerald-300 border-emerald-400/50 bg-emerald-500/15",
  Medium: "text-amber-300 border-amber-400/50 bg-amber-500/15",
  Hard: "text-rose-300 border-rose-400/50 bg-rose-500/15",
};

export default function ProblemDiscussionPage() {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const [problem, setProblem] = useState<ProblemSummary | null>(null);
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newContent, setNewContent] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let active = true;
    (async () => {
      try {
        const [problems, threadList] = await Promise.all([
          fetchProblems(),
          fetchThreads(id),
        ]);
        if (!active) return;
        const found = problems.find((p) => p.id === id) ?? null;
        setProblem(found);
        setThreads(threadList);
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

  const handleCreate = async () => {
    if (!newTitle.trim() || !newContent.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const created = await createThread({
        title: newTitle.trim(),
        content: newContent.trim(),
        problemId: id,
      });
      setThreads((prev) => [created, ...prev]);
      setShowCreate(false);
      setNewTitle("");
      setNewContent("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create thread");
    } finally {
      setCreating(false);
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
            onClick={() => router.push("/discussions")}
            className="p-2 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 transition-colors mr-2"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="p-2 bg-gradient-to-br from-cyan-500 to-indigo-600 rounded-xl">
            <MessageSquareText className="w-6 h-6 text-white" />
          </div>
          <span className="text-xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-slate-900 to-slate-600 dark:from-white dark:to-slate-400">
            Discussion
          </span>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-5 py-2.5 rounded-full border border-cyan-500/30 bg-cyan-500/10 hover:bg-cyan-500/20 transition-colors text-sm font-bold text-cyan-300"
        >
          <Plus className="w-4 h-4" /> New Thread
        </button>
      </nav>

      <main className="relative z-10 max-w-4xl mx-auto px-6 py-12">
        {loading ? (
          <div className="flex items-center justify-center gap-3 py-20 text-slate-400">
            <Loader2 className="w-5 h-5 animate-spin" /> Loading...
          </div>
        ) : (
          <>
            {/* Problem Header */}
            {problem && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="rounded-3xl border border-white/10 bg-white/[0.03] p-8 backdrop-blur mb-10"
              >
                <div className="flex items-start justify-between gap-4 mb-4">
                  <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight">
                    {problem.title}
                  </h1>
                  <span
                    className={`shrink-0 rounded-full border px-3 py-1 text-[11px] font-bold uppercase tracking-widest ${
                      DIFFICULTY_COLORS[problem.difficulty] ?? "text-slate-300 border-white/10 bg-white/5"
                    }`}
                  >
                    {problem.difficulty}
                  </span>
                </div>
                <p className="text-sm text-slate-400 whitespace-pre-wrap leading-relaxed mb-4">
                  {problem.description}
                </p>
                <div className="flex items-center gap-2 flex-wrap">
                  {problem.tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-bold uppercase tracking-widest text-slate-400"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </motion.div>
            )}

            {/* Thread count */}
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-sm font-bold tracking-widest uppercase text-cyan-300">
                {threads.length} {threads.length === 1 ? "Thread" : "Threads"}
              </h2>
            </div>

            {/* Thread List */}
            {threads.length === 0 ? (
              <div className="text-center py-16">
                <p className="text-slate-400 text-base mb-4">
                  No discussions yet. Start the first thread!
                </p>
                <button
                  onClick={() => setShowCreate(true)}
                  className="rounded-xl border border-cyan-400/60 bg-cyan-500/20 hover:bg-cyan-500/30 px-6 py-3 text-sm font-bold uppercase tracking-widest text-cyan-200 transition-colors"
                >
                  Create Thread
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                {threads.map((thread, i) => (
                  <motion.div
                    key={thread.id}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.04 }}
                  >
                    <ThreadCard
                      thread={thread}
                      onClick={() =>
                        router.push(`/discussions/thread/${thread.id}`)
                      }
                    />
                  </motion.div>
                ))}
              </div>
            )}

            {/* Create Thread Modal */}
            <AnimatePresence>
              {showCreate && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-6"
                >
                  <motion.div
                    initial={{ scale: 0.9, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.9, opacity: 0 }}
                    className="w-full max-w-lg rounded-3xl border border-white/10 bg-[hsl(var(--background))] p-8 shadow-2xl"
                  >
                    <div className="flex items-center justify-between mb-6">
                      <h2 className="text-xl font-bold text-slate-100">
                        New Thread
                      </h2>
                      <button
                        onClick={() => setShowCreate(false)}
                        className="p-2 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>

                    <div className="space-y-4">
                      <input
                        value={newTitle}
                        onChange={(e) => setNewTitle(e.target.value)}
                        placeholder="Thread Title"
                        className="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
                      />
                      <textarea
                        value={newContent}
                        onChange={(e) => setNewContent(e.target.value)}
                        placeholder="Share your approach, question, or insight..."
                        rows={6}
                        className="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-cyan-500 resize-none"
                      />
                      {error && (
                        <p className="text-sm text-rose-300">{error}</p>
                      )}
                      <button
                        onClick={() => void handleCreate()}
                        disabled={
                          creating || !newTitle.trim() || !newContent.trim()
                        }
                        className="w-full rounded-xl border border-cyan-400/60 bg-cyan-500/20 hover:bg-cyan-500/30 px-6 py-3 text-sm font-bold uppercase tracking-widest text-cyan-200 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                      >
                        {creating && (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        )}
                        Create Thread
                      </button>
                    </div>
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>
          </>
        )}
      </main>
    </div>
  );
}
