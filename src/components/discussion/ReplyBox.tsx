"use client";

import { useState } from "react";
import { Send } from "lucide-react";
import VoteButtons from "./VoteButtons";
import type { ReplyData } from "@/lib/discussions";

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

type ReplyItemProps = {
  reply: ReplyData;
};

function ReplyItem({ reply }: ReplyItemProps) {
  return (
    <div className="flex gap-4 rounded-xl border border-white/10 bg-black/20 p-4">
      <VoteButtons
        replyId={reply.id}
        upvotes={reply.upvotes}
        downvotes={reply.downvotes}
        userVote={reply.userVote}
      />
      <div className="flex-1 min-w-0">
        <p className="text-sm text-slate-200 whitespace-pre-wrap mb-2">
          {reply.content}
        </p>
        <div className="flex items-center gap-3 text-xs text-slate-500">
          <span className="text-slate-300 font-semibold">
            {reply.authorName}
          </span>
          <span>{timeAgo(reply.createdAt)}</span>
        </div>
      </div>
    </div>
  );
}

type ReplyBoxProps = {
  replies: ReplyData[];
  onSubmit: (content: string) => Promise<void>;
  submitting?: boolean;
};

export default function ReplyBox({
  replies,
  onSubmit,
  submitting,
}: ReplyBoxProps) {
  const [content, setContent] = useState("");

  const handleSubmit = async () => {
    const trimmed = content.trim();
    if (!trimmed || submitting) return;
    await onSubmit(trimmed);
    setContent("");
  };

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-bold tracking-widest uppercase text-cyan-300">
        {replies.length} {replies.length === 1 ? "Reply" : "Replies"}
      </h3>

      {replies.length === 0 ? (
        <p className="rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-slate-400">
          No replies yet. Be the first to contribute!
        </p>
      ) : (
        <div className="space-y-3">
          {replies.map((reply) => (
            <ReplyItem key={reply.id} reply={reply} />
          ))}
        </div>
      )}

      <div className="flex gap-3">
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              void handleSubmit();
            }
          }}
          placeholder="Write a reply… (Ctrl+Enter to submit)"
          rows={3}
          className="flex-1 bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-cyan-500 resize-none"
        />
        <button
          onClick={() => void handleSubmit()}
          disabled={!content.trim() || submitting}
          className="self-end rounded-xl border border-cyan-400/60 bg-cyan-500/20 hover:bg-cyan-500/30 px-5 py-3 text-sm font-bold uppercase tracking-widest text-cyan-200 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Send className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
