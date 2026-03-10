import { PrismaClient } from "@prisma/client";
import { env } from "../config/env.js";

// Ensure a single PrismaClient in dev hot-reload.
declare global {
  // eslint-disable-next-line no-var
  var __onlyaleoPrisma: PrismaClient | undefined;
}

export const prisma =
  global.__onlyaleoPrisma ??
  new PrismaClient({
    datasourceUrl: env.databaseUrl,
    log: env.nodeEnv === "development" ? ["error", "warn"] : ["error"],
  });

if (env.nodeEnv !== "production") {
  global.__onlyaleoPrisma = prisma;
}

