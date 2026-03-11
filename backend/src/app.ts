import cors from "cors";
import express from "express";

// Prisma returns BigInt for price fields — patch JSON serialization globally
(BigInt.prototype as unknown as Record<string, unknown>).toJSON = function () {
  return this.toString();
};
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import pino from "pino";
import { pinoHttp } from "pino-http";
import { env } from "./config/env.js";
import { apiRouter } from "./routes/index.js";

const localhostOriginPattern = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i;

const isAllowedCorsOrigin = (origin: string): boolean => {
  if (env.corsOrigins.includes(origin)) {
    return true;
  }

  // In dev/test, allow localhost origins regardless of port so Next can auto-pick
  // alternative ports (e.g. 3002, 3003) without breaking API calls.
  if (env.nodeEnv !== "production" && localhostOriginPattern.test(origin)) {
    return true;
  }

  return false;
};

export const createApp = () => {
  const app = express();

  app.set("trust proxy", env.trustProxy);
  app.use(helmet());
  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin) {
          callback(null, true);
          return;
        }

        if (isAllowedCorsOrigin(origin)) {
          callback(null, true);
          return;
        }

        callback(new Error(`Origin not allowed by CORS: ${origin}`));
      },
      credentials: true,
    }),
  );
  app.use(express.json({ limit: "2mb" }));


  const logger = pino({
    level: env.nodeEnv === "development" ? "debug" : "info",
    redact: ["req.headers.authorization"],
  });

  app.use(
    pinoHttp({
      logger,
      customLogLevel: (_req: unknown, res: { statusCode: number }, err?: Error) => {
        if (err || res.statusCode >= 500) return "error";
        if (res.statusCode >= 400) return "warn";
        return "info";
      },
    }),
  );

  app.use(
    rateLimit({
      windowMs: env.rateLimitWindowMs,
      max: env.rateLimitMax,
      standardHeaders: true,
      legacyHeaders: false,
    }),
  );

  app.use("/api", apiRouter);

  return app;
};
