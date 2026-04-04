import { createClient } from "redis";

type AnyRedisClient = ReturnType<typeof createClient>;

type GlobalRedis = typeof globalThis & {
  __redisClient?: AnyRedisClient;
  __redisConnectPromise?: Promise<AnyRedisClient | null>;
  __redisDisabledUntil?: number;
};

function buildRedisUrl(): string | null {
  const explicit = (process.env.REDIS_URL || "").trim();
  if (explicit) return explicit;

  const host = (process.env.REDIS_HOST || "").trim();
  const port = Number(process.env.REDIS_PORT || 0);
  if (!host || !Number.isFinite(port) || port <= 0) return null;

  const username = encodeURIComponent((process.env.REDIS_USERNAME || "default").trim() || "default");
  const password = encodeURIComponent((process.env.REDIS_PASSWORD || "").trim());
  const protocol = (process.env.REDIS_TLS || "true").toLowerCase() === "false" ? "redis" : "rediss";

  if (!password) {
    return `${protocol}://${host}:${port}`;
  }

  return `${protocol}://${username}:${password}@${host}:${port}`;
}

export async function getRedisClient(): Promise<AnyRedisClient | null> {
  const g = globalThis as GlobalRedis;
  if (typeof g.__redisDisabledUntil === "number" && Date.now() < g.__redisDisabledUntil) {
    return null;
  }
  if (g.__redisClient?.isOpen) return g.__redisClient;
  if (g.__redisConnectPromise) return g.__redisConnectPromise;

  const url = buildRedisUrl();
  if (!url) return null;

  g.__redisConnectPromise = (async () => {
    try {
      const connectTimeoutMs = 3000;
      const client = createClient({
        url,
        socket: {
          connectTimeout: connectTimeoutMs,
          keepAlive: true,
          reconnectStrategy: (retries) => {
            if (retries > 2) {
              return new Error("redis connect retries exceeded");
            }
            return Math.min(600, retries * 200);
          },
        },
      });

      client.on("error", () => {
        // Ignore to prevent noisy logs in transient network failures.
      });

      await Promise.race([
        client.connect(),
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error("redis connect timeout")), connectTimeoutMs + 500);
        }),
      ]);

      g.__redisClient = client;
      return client;
    } catch {
      g.__redisDisabledUntil = Date.now() + 15_000;
      return null;
    } finally {
      g.__redisConnectPromise = undefined;
    }
  })();

  return g.__redisConnectPromise ?? null;
}
