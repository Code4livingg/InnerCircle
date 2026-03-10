import { config } from "dotenv";
import { z } from "zod";

config();

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(8080),
  CORS_ORIGINS: z.string().optional(),
  SESSION_SECRET: z.string().min(16),
  SESSION_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  FINGERPRINT_SESSION_TTL_SECONDS: z.coerce.number().int().positive().default(1800),
  STREAM_TTL_SECONDS: z.coerce.number().int().positive().default(600),

  DATABASE_URL: z.string().min(10),
  DB_CONNECT_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(5),

  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(120),

  STORAGE_PROVIDER: z.enum(["local", "s3"]).default("local"),
  STORAGE_LOCAL_DIR: z.string().default("storage"),
  S3_ENDPOINT: z.string().url().optional(),
  S3_REGION: z.string().optional(),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),

  ADMIN_API_KEY: z.string().min(16).optional(),

  PROOF_VERIFICATION_MODE: z.enum(["tx", "mock"]).default("tx"),
  ALEO_ADDRESS: z.string().min(10).optional(),
  ALEO_PRIVATE_KEY: z.string().min(20).optional(),
  ALEO_NETWORK: z.string().default("testnet"),
  ALEO_ENDPOINT: z.string().url(),
  SUBSCRIPTION_PROGRAM_ID: z.string().default("sub_pay_v3_xwnxp.aleo"),
  PPV_PROGRAM_ID: z.string().default("ppv_pay_v2_xwnxp.aleo"),
  CREATOR_REGISTRY_PROGRAM_ID: z.string().default("creator_reg_v2_xwnxp.aleo"),
  MASTER_KEY_BASE64: z.string().min(10),

  CONTENT_CHUNK_SIZE_BYTES: z.coerce.number().int().positive().default(1_048_576),
});

const parsed = envSchema.parse(process.env);

const parseCommaSeparated = (value?: string): string[] => {
  if (!value) return [];
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
};

const withPostgresTimeout = (urlValue: string, timeoutSeconds: number): string => {
  try {
    const parsedUrl = new URL(urlValue);
    if (!parsedUrl.searchParams.has("connect_timeout")) {
      parsedUrl.searchParams.set("connect_timeout", String(timeoutSeconds));
    }
    return parsedUrl.toString();
  } catch {
    return urlValue;
  }
};

export const env = {
  nodeEnv: parsed.NODE_ENV,
  port: parsed.PORT,
  corsOrigins: parseCommaSeparated(parsed.CORS_ORIGINS),
  sessionSecret: parsed.SESSION_SECRET,
  sessionTtlSeconds: parsed.SESSION_TTL_SECONDS,
  fingerprintSessionTtlSeconds: parsed.FINGERPRINT_SESSION_TTL_SECONDS,
  streamTtlSeconds: parsed.STREAM_TTL_SECONDS,
  databaseUrl: withPostgresTimeout(parsed.DATABASE_URL, parsed.DB_CONNECT_TIMEOUT_SECONDS),
  dbConnectTimeoutSeconds: parsed.DB_CONNECT_TIMEOUT_SECONDS,
  rateLimitWindowMs: parsed.RATE_LIMIT_WINDOW_MS,
  rateLimitMax: parsed.RATE_LIMIT_MAX,
  storageProvider: parsed.STORAGE_PROVIDER,
  storageLocalDir: parsed.STORAGE_LOCAL_DIR,
  s3Endpoint: parsed.S3_ENDPOINT,
  s3Region: parsed.S3_REGION,
  s3Bucket: parsed.S3_BUCKET,
  s3AccessKeyId: parsed.S3_ACCESS_KEY_ID,
  s3SecretAccessKey: parsed.S3_SECRET_ACCESS_KEY,
  adminApiKey: parsed.ADMIN_API_KEY,
  proofVerificationMode: parsed.PROOF_VERIFICATION_MODE,
  aleoAddress: parsed.ALEO_ADDRESS,
  aleoPrivateKey: parsed.ALEO_PRIVATE_KEY,
  aleoNetwork: parsed.ALEO_NETWORK,
  aleoEndpoint: parsed.ALEO_ENDPOINT,
  subscriptionProgramId: parsed.SUBSCRIPTION_PROGRAM_ID,
  ppvProgramId: parsed.PPV_PROGRAM_ID,
  creatorRegistryProgramId: parsed.CREATOR_REGISTRY_PROGRAM_ID,
  masterKeyBase64: parsed.MASTER_KEY_BASE64,
  contentChunkSizeBytes: parsed.CONTENT_CHUNK_SIZE_BYTES,
};
