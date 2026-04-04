"use client";

import { ChevronUp, ChevronDown } from "lucide-react";
import { useState } from "react";
import { vote } from "@/lib/discussions";

type VoteButtonsProps = {
  threadId?: string;
  replyId?: string;
  upvotes: number;
  downvotes: number;
  userVote: number;
};

export default function VoteButtons({
  threadId,
  replyId,
  upvotes: initialUp,
  downvotes: initialDown,
  userVote: initialVote,
}: VoteButtonsProps) {
  const [upvotes, setUpvotes] = useState(initialUp);
  const [downvotes, setDownvotes] = useState(initialDown);
  const [userVote, setUserVote] = useState(initialVote);
  const [loading, setLoading] = useState(false);

  const handleVote = async (value: 1 | -1) => {
    if (loading) return;
    setLoading(true);
    try {
      const result = await vote({ threadId, replyId, value });
      setUpvotes(result.upvotes);
      setDownvotes(result.downvotes);
      setUserVote(result.userVote);
    } catch {
      // silent — user might not be logged in
    } finally {
      setLoading(false);
    }
  };

  const score = upvotes - downvotes;

  return (
    <div className="flex flex-col items-center gap-1">
      <button
        onClick={() => handleVote(1)}
        disabled={loading}
        className={`p-1.5 rounded-lg border transition-all ${
          userVote === 1
            ? "border-cyan-400/70 bg-cyan-500/25 text-cyan-300"
            : "border-white/10 bg-white/5 text-slate-400 hover:bg-white/10 hover:text-cyan-300"
        } ${loading ? "opacity-50 cursor-not-allowed" : ""}`}
        aria-label="Upvote"
      >
        <ChevronUp className="w-4 h-4" />
      </button>
      <span
        className={`text-sm font-bold tabular-nums ${
          score > 0
            ? "text-cyan-300"
            : score < 0
              ? "text-rose-300"
              : "text-slate-400"
        }`}
      >
        {score}
      </span>
      <button
        onClick={() => handleVote(-1)}
        disabled={loading}
        className={`p-1.5 rounded-lg border transition-all ${
          userVote === -1
            ? "border-rose-400/70 bg-rose-500/25 text-rose-300"
            : "border-white/10 bg-white/5 text-slate-400 hover:bg-white/10 hover:text-rose-300"
        } ${loading ? "opacity-50 cursor-not-allowed" : ""}`}
        aria-label="Downvote"
      >
        <ChevronDown className="w-4 h-4" />
      </button>
    </div>
  );
}
