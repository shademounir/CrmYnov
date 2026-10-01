export type HealthStatus = Readonly<{
  service: "frontend" | "api";
  status: "ok";
  timestamp: string;
}>;

export function health(service: HealthStatus["service"], now = new Date()): HealthStatus {
  return { service, status: "ok", timestamp: now.toISOString() };
}
