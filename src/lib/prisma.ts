import { PrismaClient } from "@prisma/client";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

class DatabaseConnectionConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DatabaseConnectionConfigError";
  }
}

const PLACEHOLDER_VALUES = new Set(["USER", "PASSWORD", "HOST", "DB_NAME"]);
const PLACEHOLDER_PREFIX = "YOUR_";

function isPlaceholderValue(value: string | undefined) {
  if (!value) return false;
  const normalized = decodeURIComponent(value).trim().toUpperCase();
  return PLACEHOLDER_VALUES.has(normalized) || normalized.startsWith(PLACEHOLDER_PREFIX);
}

function getDatabaseUrl() {
  const databaseUrl = (process.env.DATABASE_URL ?? process.env.DIRECT_URL ?? "").trim();
  if (!databaseUrl) {
    throw new DatabaseConnectionConfigError(
      "Database connection string is missing. Set DATABASE_URL or DIRECT_URL in .env."
    );
  }

  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    throw new DatabaseConnectionConfigError(
      "Database connection string is invalid. Check DATABASE_URL or DIRECT_URL in .env."
    );
  }

  const dbName = url.pathname?.replace(/^\//, "") ?? "";
  if (
    isPlaceholderValue(url.username) ||
    isPlaceholderValue(url.password) ||
    isPlaceholderValue(url.hostname) ||
    isPlaceholderValue(dbName)
  ) {
    throw new DatabaseConnectionConfigError(
      "Database connection string contains placeholders. Update DATABASE_URL or DIRECT_URL in .env with real values."
    );
  }

  return databaseUrl;
}

export function getDatabaseApiError(error: unknown): string | null {
  if (error instanceof DatabaseConnectionConfigError) {
    return error.message;
  }

  const message = error instanceof Error ? error.message : String(error ?? "");
  if (
    /(Can't reach database server|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|connect ECONN|Connection terminated unexpectedly)/i.test(
      message
    )
  ) {
    return "Database is unreachable. Verify DATABASE_URL or DIRECT_URL in .env and ensure Postgres is running and reachable.";
  }

  return null;
}

function createPrismaClient() {
  const databaseUrl = getDatabaseUrl();

  const url = new URL(databaseUrl);
  const sslmode = url.searchParams.get("sslmode");
  const hostname = url.hostname.toLowerCase();
  const isLocalHost = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  const needsSsl = sslmode ? sslmode !== "disable" : !isLocalHost;

  // Don't pass sslmode through to `pg` connection-string parsing; it can force strict verification.
  // We control TLS via the explicit Pool `ssl` option below.
  if (sslmode) {
    url.searchParams.delete("sslmode");
  }

  // `pg` currently treats sslmode=require as verify-full unless libpq-compat is enabled.
  // This breaks common hosted DBs that use self-signed/intermediate chains unless a CA bundle is provided.
  if (needsSsl && !url.searchParams.has("uselibpqcompat")) {
    url.searchParams.set("uselibpqcompat", "true");
  }

  const connectionString = url.toString();
  const rejectUnauthorizedEnv = process.env.DATABASE_SSL_REJECT_UNAUTHORIZED;
  const rejectUnauthorized = rejectUnauthorizedEnv
    ? rejectUnauthorizedEnv.toLowerCase() === "true"
    : false;

  const pool = new Pool({
    connectionString,
    ssl: needsSsl ? { rejectUnauthorized } : undefined,
  });
  const adapter = new PrismaPg(pool);

  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
