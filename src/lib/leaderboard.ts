import { getRedisClient } from "@/lib/redis";

const LEADERBOARD_ZSET = "leaderboard:global:xp";
const USER_HASH_PREFIX = "leaderboard:user:";
const SUBJECT_SET_KEY = "leaderboard:subjects";
const SUBJECT_ZSET_PREFIX = "leaderboard:subject:";

function userHashKey(userId: string) {
  return `${USER_HASH_PREFIX}${userId}`;
}

function normalizeSubject(input: string | null | undefined) {
  return (input || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .slice(0, 80);
}

function subjectZsetKey(subject: string) {
  return `${SUBJECT_ZSET_PREFIX}${subject}`;
}

function displayName(name: string | null | undefined, email: string | null | undefined, fallback: string) {
  const n = (name || "").trim();
  if (n) return n;
  const e = (email || "").trim();
  if (!e) return fallback;
  const local = e.split("@")[0] || "";
  return local ? local.slice(0, 24) : fallback;
}

function toStringMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object") return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === "string") out[k] = v;
  }
  return out;
}

export type LeaderboardRow = {
  rank: number;
  userId: string;
  name: string;
  score: number;
  isCurrentUser: boolean;
};

export type LeaderboardPayload = {
  enabled: boolean;
  top: LeaderboardRow[];
  me: LeaderboardRow | null;
  scope: "global" | "subject";
  subject: string | null;
  subjects: string[];
  totalUsers: number;
};

export async function ensureLeaderboardUser(user: {
  userId: string;
  name?: string | null;
  email?: string | null;
}) {
  const client = await getRedisClient();
  if (!client) return;

  const n = displayName(user.name, user.email, "Learner");
  const now = new Date().toISOString();

  await client.zAdd(LEADERBOARD_ZSET, [{ score: 0, value: user.userId }], { NX: true });
  await client.hSet(userHashKey(user.userId), {
    name: n,
    email: (user.email || "").slice(0, 120),
    updatedAt: now,
  });
}

export async function addLeaderboardXp(user: {
  userId: string;
  delta: number;
  name?: string | null;
  email?: string | null;
  subject?: string | null;
}) {
  const client = await getRedisClient();
  if (!client) return null;

  const gain = Math.max(0, Math.trunc(user.delta));
  const subject = normalizeSubject(user.subject);

  if (subject) {
    const subjectZset = subjectZsetKey(subject);
    await client.sAdd(SUBJECT_SET_KEY, subject);
    await client.zAdd(subjectZset, [{ score: 0, value: user.userId }], { NX: true });
  }

  if (gain <= 0) return null;

  const n = displayName(user.name, user.email, "Learner");
  const now = new Date().toISOString();

  await client.zAdd(LEADERBOARD_ZSET, [{ score: 0, value: user.userId }], { NX: true });
  const score = await client.zIncrBy(LEADERBOARD_ZSET, gain, user.userId);
  await client.hSet(userHashKey(user.userId), {
    name: n,
    email: (user.email || "").slice(0, 120),
    updatedAt: now,
  });

  if (subject) {
    const subjectZset = subjectZsetKey(subject);
    await client.zIncrBy(subjectZset, gain, user.userId);
  }

  return Math.max(0, Math.trunc(Number(score) || 0));
}

export async function fetchLeaderboard(
  currentUserId: string,
  options?: { limit?: number; subject?: string | null }
): Promise<LeaderboardPayload> {
  const client = await getRedisClient();
  if (!client) {
    return {
      enabled: false,
      top: [],
      me: null,
      scope: "global",
      subject: null,
      subjects: [],
      totalUsers: 0,
    };
  }

  const normalizedSubject = normalizeSubject(options?.subject);
  const scope: "global" | "subject" = normalizedSubject ? "subject" : "global";
  const zsetKey = normalizedSubject ? subjectZsetKey(normalizedSubject) : LEADERBOARD_ZSET;
  const requestedLimit =
    typeof options?.limit === "number" && Number.isFinite(options.limit)
      ? Math.max(1, Math.trunc(options.limit))
      : null;
  const totalUsers = Number(await client.zCard(zsetKey)) || 0;
  const limit = Math.min(5000, requestedLimit ?? totalUsers);

  const subjects = (await client.sMembers(SUBJECT_SET_KEY)).sort((a, b) => a.localeCompare(b));
  const topRaw =
    limit > 0
      ? await client.zRangeWithScores(zsetKey, 0, Math.max(0, limit - 1), { REV: true })
      : [];

  const myRankZero = await client.zRevRank(zsetKey, currentUserId);
  const myScoreRaw = await client.zScore(zsetKey, currentUserId);

  const currentUserInTop = topRaw.some((entry) => entry.value === currentUserId);
  const metaPipeline = client.multi();
  for (const entry of topRaw) {
    metaPipeline.hGetAll(userHashKey(entry.value));
  }
  if (myRankZero !== null && !currentUserInTop) {
    metaPipeline.hGetAll(userHashKey(currentUserId));
  }
  const metaResultsRaw = (await metaPipeline.exec()) as unknown[];

  const top: LeaderboardRow[] = [];
  for (let i = 0; i < topRaw.length; i += 1) {
    const entry = topRaw[i];
    const meta = toStringMap(metaResultsRaw[i]);
    top.push({
      rank: i + 1,
      userId: entry.value,
      name: displayName(meta.name, meta.email, `Learner ${i + 1}`),
      score: Math.max(0, Math.trunc(entry.score)),
      isCurrentUser: entry.value === currentUserId,
    });
  }

  const meMeta = (() => {
    if (myRankZero === null) return {} as Record<string, string>;
    if (currentUserInTop) {
      const idx = topRaw.findIndex((entry) => entry.value === currentUserId);
      if (idx >= 0) {
        return toStringMap(metaResultsRaw[idx]);
      }
    }
    return toStringMap(metaResultsRaw[topRaw.length]);
  })();

  const me: LeaderboardRow | null =
    myRankZero === null
      ? null
      : {
          rank: myRankZero + 1,
          userId: currentUserId,
          name: displayName(meMeta.name, meMeta.email, "You"),
          score: Math.max(0, Math.trunc(Number(myScoreRaw) || 0)),
          isCurrentUser: true,
        };

  return {
    enabled: true,
    top,
    me,
    scope,
    subject: normalizedSubject || null,
    subjects,
    totalUsers,
  };
}
