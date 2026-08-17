import type { Role } from "../auth/auth.types.js";

export type AuditResult = "SUCCESS" | "DENIED" | "FAILED";

export interface AuditEvent {
  id: string;
  eventType: string;
  actorId?: string | undefined;
  actorRoles: Role[];
  minimizedIp?: string | undefined;
  sessionId?: string | undefined;
  correlationId: string;
  before?: Record<string, unknown> | undefined;
  after?: Record<string, unknown> | undefined;
  result: AuditResult;
  idempotencyKey: string;
  occurredAt: string;
}

export type AuditInput = Omit<AuditEvent, "id" | "occurredAt" | "minimizedIp"> & { ip?: string | undefined };
