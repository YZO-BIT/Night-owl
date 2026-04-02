import { PrismaClient } from "@prisma/client";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createPrismaClient() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not set");
  }

  const url = new URL(databaseUrl);
  const sslmode = url.searchParams.get("sslmode");
  const needsSsl = sslmode && sslmode !== "disable";

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
