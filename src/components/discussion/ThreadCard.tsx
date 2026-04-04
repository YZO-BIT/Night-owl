"use client";

import { MessageSquare } from "lucide-react";
import VoteButtons from "./VoteButtons";
import type { ThreadSummary } from "@/lib/discussions";

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

type ThreadCardProps = {
  thread: ThreadSummary;
  onClick: () => void;
};

export default function ThreadCard({ thread, onClick }: ThreadCardProps) {
  return (
    <div className="flex gap-4 rounded-2xl border border-white/10 bg-white/[0.03] p-5 backdrop-blur hover:bg-white/[0.06] transition-all group">
      <VoteButtons
        threadId={thread.id}
        upvotes={thread.upvotes}
        downvotes={thread.downvotes}
        userVote={thread.userVote}
      />
      <div className="flex-1 min-w-0 cursor-pointer" onClick={onClick}>
        <h3 className="text-base font-bold text-slate-100 group-hover:text-cyan-300 transition-colors truncate mb-1">
          {thread.title}
        </h3>
        <p className="text-sm text-slate-400 line-clamp-2 mb-3">
          {thread.content}
        </p>
        <div className="flex items-center gap-4 text-xs text-slate-500">
          <span className="text-slate-300 font-semibold">
            {thread.authorName}
          </span>
          <span>{timeAgo(thread.createdAt)}</span>
          <span className="flex items-center gap-1 text-slate-400">
            <MessageSquare className="w-3.5 h-3.5" />
            {thread.replyCount}
          </span>
        </div>
      </div>
    </div>
  );
}
