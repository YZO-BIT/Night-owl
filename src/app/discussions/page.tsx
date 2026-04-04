"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  MessageSquareText,
  Search,
  Plus,
  Loader2,
  ArrowLeft,
  X,
} from "lucide-react";
import { fetchProblems, createProblem } from "@/lib/discussions";
import type { ProblemSummary } from "@/lib/discussions";

const DIFFICULTY_COLORS: Record<string, string> = {
  Easy: "text-emerald-300 border-emerald-400/50 bg-emerald-500/15",
  Medium: "text-amber-300 border-amber-400/50 bg-amber-500/15",
  Hard: "text-rose-300 border-rose-400/50 bg-rose-500/15",
};

export default function DiscussionsPage() {
  const router = useRouter();
  const [problems, setProblems] = useState<ProblemSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterDifficulty, setFilterDifficulty] = useState<string>("All");
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newDifficulty, setNewDifficulty] = useState("Medium");
  const [newTags, setNewTags] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        // Seed problems on first visit
        await fetch("/api/discussions/seed", { method: "POST" }).catch(
          () => ({})
        );
        const data = await fetchProblems();
        if (active) setProblems(data);
      } catch {
        // silent
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const filtered = problems.filter((p) => {
    const matchesSearch =
      !search ||
      p.title.toLowerCase().includes(search.toLowerCase()) ||
      p.tags.some((t) => t.toLowerCase().includes(search.toLowerCase()));
    const matchesDifficulty =
      filterDifficulty === "All" || p.difficulty === filterDifficulty;
    return matchesSearch && matchesDifficulty;
  });

  const handleCreate = async () => {
    if (!newTitle.trim() || !newDesc.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const tags = newTags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      const created = await createProblem({
        title: newTitle.trim(),
        description: newDesc.trim(),
        difficulty: newDifficulty,
        tags,
      });
      setProblems((prev) => [created, ...prev]);
      setShowCreate(false);
      setNewTitle("");
      setNewDesc("");
      setNewTags("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create problem");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="min-h-screen bg-[hsl(var(--background))] text-[hsl(var(--foreground))] overflow-x-hidden selection:bg-cyan-500/30">
      {/* Background effects */}
      <div className="fixed inset-0 pointer-events-none z-0">
        <div className="absolute top-1/4 -left-1/4 w-[800px] h-[800px] bg-cyan-900/20 blur-[120px] rounded-full mix-blend-screen" />
        <div className="absolute bottom-1/4 -right-1/4 w-[800px] h-[800px] bg-indigo-900/20 blur-[120px] rounded-full mix-blend-screen" />
      </div>

      {/* Nav */}
      <nav className="relative z-50 flex items-center justify-between p-6 md:px-12 backdrop-blur-md border-b border-white/5">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push("/")}
            className="p-2 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 transition-colors mr-2"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="p-2 bg-gradient-to-br from-cyan-500 to-indigo-600 rounded-xl">
            <MessageSquareText className="w-6 h-6 text-white" />
          </div>
          <span className="text-xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-slate-900 to-slate-600 dark:from-white dark:to-slate-400">
            Discussions
          </span>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-5 py-2.5 rounded-full border border-cyan-500/30 bg-cyan-500/10 hover:bg-cyan-500/20 transition-colors text-sm font-bold text-cyan-300"
        >
          <Plus className="w-4 h-4" /> New Problem
        </button>
      </nav>

      <main className="relative z-10 max-w-5xl mx-auto px-6 py-12">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="text-center mb-12"
        >
          <h1 className="text-5xl md:text-7xl font-extrabold tracking-tight mb-4">
            Problem Discussions
          </h1>
          <p className="text-slate-400 text-lg md:text-xl max-w-2xl mx-auto">
            Explore problem threads, share your approach, and learn from the
            community.
          </p>
        </motion.div>

        {/* Filters */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="flex flex-col sm:flex-row gap-3 mb-8"
        >
          <div className="relative flex-1">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by title or tag..."
              className="w-full bg-black/30 border border-white/10 rounded-xl pl-11 pr-4 py-3 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
            />
          </div>
          <div className="flex gap-2">
            {["All", "Easy", "Medium", "Hard"].map((d) => (
              <button
                key={d}
                onClick={() => setFilterDifficulty(d)}
                className={`rounded-xl border px-4 py-2.5 text-xs font-bold uppercase tracking-widest transition-colors ${
                  filterDifficulty === d
                    ? "border-cyan-400/70 bg-cyan-500/20 text-cyan-200"
                    : "border-white/10 bg-white/5 text-slate-300 hover:bg-white/10"
                }`}
              >
                {d}
              </button>
            ))}
          </div>
        </motion.div>

        {/* Create Problem Modal */}
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
                    Create Problem
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
                    placeholder="Problem Title"
                    className="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
                  />
                  <textarea
                    value={newDesc}
                    onChange={(e) => setNewDesc(e.target.value)}
                    placeholder="Problem Description"
                    rows={5}
                    className="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-cyan-500 resize-none"
                  />
                  <div className="grid grid-cols-3 gap-2">
                    {["Easy", "Medium", "Hard"].map((d) => (
                      <button
                        key={d}
                        onClick={() => setNewDifficulty(d)}
                        className={`rounded-xl border px-3 py-2 text-xs font-bold uppercase tracking-widest transition-colors ${
                          newDifficulty === d
                            ? DIFFICULTY_COLORS[d]
                            : "border-white/10 bg-white/5 text-slate-300 hover:bg-white/10"
                        }`}
                      >
                        {d}
                      </button>
                    ))}
                  </div>
                  <input
                    value={newTags}
                    onChange={(e) => setNewTags(e.target.value)}
                    placeholder="Tags (comma-separated: Array, Hash Table)"
                    className="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
                  />
                  {error && (
                    <p className="text-sm text-rose-300">{error}</p>
                  )}
                  <button
                    onClick={() => void handleCreate()}
                    disabled={creating || !newTitle.trim() || !newDesc.trim()}
                    className="w-full rounded-xl border border-cyan-400/60 bg-cyan-500/20 hover:bg-cyan-500/30 px-6 py-3 text-sm font-bold uppercase tracking-widest text-cyan-200 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {creating && <Loader2 className="w-4 h-4 animate-spin" />}
                    Create Problem
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Problem List */}
        {loading ? (
          <div className="flex items-center justify-center gap-3 py-20 text-slate-400">
            <Loader2 className="w-5 h-5 animate-spin" /> Loading problems...
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-slate-400 text-lg">
              {search || filterDifficulty !== "All"
                ? "No problems match your filters."
                : "No problems yet. Create the first one!"}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {filtered.map((problem, i) => (
              <motion.div
                key={problem.id}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                whileHover={{ y: -4, scale: 1.005 }}
                onClick={() =>
                  router.push(`/discussions/problem/${problem.id}`)
                }
                className="rounded-3xl border border-white/10 bg-white/[0.03] p-6 backdrop-blur cursor-pointer hover:bg-white/[0.06] transition-all group"
              >
                <div className="flex items-start justify-between gap-4 mb-3">
                  <h2 className="text-xl font-bold text-slate-100 group-hover:text-cyan-300 transition-colors">
                    {problem.title}
                  </h2>
                  <span
                    className={`shrink-0 rounded-full border px-3 py-1 text-[11px] font-bold uppercase tracking-widest ${
                      DIFFICULTY_COLORS[problem.difficulty] ??
                      "text-slate-300 border-white/10 bg-white/5"
                    }`}
                  >
                    {problem.difficulty}
                  </span>
                </div>
                <p className="text-sm text-slate-400 line-clamp-2 mb-4">
                  {problem.description}
                </p>
                <div className="flex items-center gap-3 flex-wrap">
                  {problem.tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-bold uppercase tracking-widest text-slate-400"
                    >
                      {tag}
                    </span>
                  ))}
                  <span className="ml-auto flex items-center gap-1.5 text-xs text-slate-500">
                    <MessageSquareText className="w-3.5 h-3.5" />
                    {problem.threadCount}{" "}
                    {problem.threadCount === 1 ? "thread" : "threads"}
                  </span>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
