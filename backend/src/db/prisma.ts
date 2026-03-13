import { PrismaClient } from "@prisma/client";
import { env } from "../config/env.js";

// Ensure a single PrismaClient in dev hot-reload.
declare global {
  // eslint-disable-next-line no-var
  var __innercirclePrisma: PrismaClient | undefined;
}

export const prisma =
  global.__innercirclePrisma ??
  new PrismaClient({
    datasourceUrl: env.databaseUrl,
    log: env.nodeEnv === "development" ? ["error", "warn"] : ["error"],
  });

if (env.nodeEnv !== "production") {
  global.__innercirclePrisma = prisma;
}
