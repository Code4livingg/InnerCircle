export const DB_UNAVAILABLE_CODE = "DB_UNAVAILABLE";
export const DB_UNAVAILABLE_MESSAGE =
  "Database is unavailable. Start PostgreSQL and retry the request.";
export const DB_SCHEMA_MISMATCH_CODE = "DB_SCHEMA_MISMATCH";
export const DB_SCHEMA_MISMATCH_MESSAGE =
  "Database schema is out of sync. Apply the latest Prisma schema changes and retry.";

const DB_UNAVAILABLE_PATTERNS = [
  "can't reach database server",
  "connection refused",
  "timed out fetching a new connection",
  "server closed the connection unexpectedly",
  "could not connect to server",
  "connection terminated unexpectedly",
];

const DB_SCHEMA_MISMATCH_PATTERNS = [
  "does not exist in the current database",
  "the table `public.",
  "the column `public.",
  "could not find the table",
];

export const isDatabaseUnavailableError = (error: unknown): boolean => {
  const message = (error as Error)?.message?.toLowerCase() ?? "";
  return DB_UNAVAILABLE_PATTERNS.some((pattern) => message.includes(pattern));
};

export const isDatabaseSchemaMismatchError = (error: unknown): boolean => {
  const message = (error as Error)?.message?.toLowerCase() ?? "";
  return DB_SCHEMA_MISMATCH_PATTERNS.some((pattern) => message.includes(pattern));
};
