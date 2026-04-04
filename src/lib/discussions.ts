export type ProblemSummary = {
  id: string;
  title: string;
  description: string;
  difficulty: string;
  tags: string[];
  threadCount: number;
  createdAt: string;
};

export type ThreadSummary = {
  id: string;
  title: string;
  content: string;
  authorName: string;
  authorId: string;
  problemId: string;
  upvotes: number;
  downvotes: number;
  replyCount: number;
  userVote: number;
  createdAt: string;
};

export type ReplyData = {
  id: string;
  content: string;
  authorName: string;
  authorId: string;
  upvotes: number;
  downvotes: number;
  userVote: number;
  createdAt: string;
};

export type ThreadDetail = ThreadSummary & {
  replies: ReplyData[];
};

async function apiFetch<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: "no-store", ...options });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      typeof (data as { error?: unknown }).error === "string"
        ? (data as { error: string }).error
        : "Request failed";
    throw new Error(msg);
  }
  return data as T;
}

export async function fetchProblems(): Promise<ProblemSummary[]> {
  const data = await apiFetch<{ problems: ProblemSummary[] }>(
    "/api/discussions/problems"
  );
  return data.problems ?? [];
}

export async function createProblem(body: {
  title: string;
  description: string;
  difficulty: string;
  tags: string[];
}): Promise<ProblemSummary> {
  const data = await apiFetch<{ problem: ProblemSummary }>(
    "/api/discussions/problems",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
  return data.problem;
}

export async function fetchThreads(problemId: string): Promise<ThreadSummary[]> {
  const data = await apiFetch<{ threads: ThreadSummary[] }>(
    `/api/discussions/threads?problemId=${encodeURIComponent(problemId)}`
  );
  return data.threads ?? [];
}

export async function fetchThread(threadId: string): Promise<ThreadDetail> {
  const data = await apiFetch<{ thread: ThreadDetail }>(
    `/api/discussions/threads/${encodeURIComponent(threadId)}`
  );
  return data.thread;
}

export async function createThread(body: {
  title: string;
  content: string;
  problemId: string;
}): Promise<ThreadSummary> {
  const data = await apiFetch<{ thread: ThreadSummary }>(
    "/api/discussions/threads",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
  return data.thread;
}

export async function createReply(body: {
  content: string;
  threadId: string;
}): Promise<ReplyData> {
  const data = await apiFetch<{ reply: ReplyData }>(
    "/api/discussions/replies",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
  return data.reply;
}

export async function vote(body: {
  threadId?: string;
  replyId?: string;
  value: 1 | -1;
}): Promise<{ upvotes: number; downvotes: number; userVote: number }> {
  return apiFetch("/api/discussions/vote", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
