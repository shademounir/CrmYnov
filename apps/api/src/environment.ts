export type ApiEnvironment = Readonly<{ port: number; databaseUrl: string; logLevel: "error" | "warn" | "log" }>;

export function loadEnvironment(env: NodeJS.ProcessEnv): ApiEnvironment {
  const databaseUrl = env.DATABASE_URL?.trim();
  if (!databaseUrl?.startsWith("postgresql://")) throw new Error("DATABASE_URL must be a PostgreSQL connection URL.");
  const port = Number(env.API_PORT ?? "3001");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("API_PORT must be a valid TCP port.");
  const logLevel = env.LOG_LEVEL ?? "log";
  if (!(["error", "warn", "log"] as const).includes(logLevel as ApiEnvironment["logLevel"])) {
    throw new Error("LOG_LEVEL must be error, warn, or log.");
  }
  return { port, databaseUrl, logLevel: logLevel as ApiEnvironment["logLevel"] };
}
