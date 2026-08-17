import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { AuditEvent, AuditInput } from "./audit.types.js";

const SENSITIVE_KEYS = /password|secret|token|authorization|cookie|credential|recovery|link|url/i;

function sanitize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitize);
  if (!value || typeof value !== "object") return typeof value === "string" && /^https?:\/\//i.test(value) ? "[redacted-link]" : value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([key]) => !SENSITIVE_KEYS.test(key))
    .map(([key, item]) => [key, sanitize(item)]));
}

export function minimizeIp(ip?: string): string | undefined {
  if (!ip) return undefined;
  const normalized = ip.replace(/^::ffff:/, "");
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\d{1,3}$/.exec(normalized);
  if (ipv4) return `${ipv4[1]}.${ipv4[2]}.${ipv4[3]}.0`;
  if (normalized.includes(":")) return `${normalized.split(":").slice(0, 4).join(":")}::`;
  return "unknown";
}

@Injectable()
export class AuditService {
  private readonly events = new Map<string, Readonly<AuditEvent>>();

  record(input: AuditInput): AuditEvent {
    const existing = this.events.get(input.idempotencyKey);
    if (existing) return { ...existing };
    const event = Object.freeze({
      ...input,
      id: randomUUID(),
      actorRoles: [...input.actorRoles],
      minimizedIp: minimizeIp(input.ip),
      before: sanitize(input.before) as Record<string, unknown> | undefined,
      after: sanitize(input.after) as Record<string, unknown> | undefined,
      occurredAt: new Date().toISOString(),
      ip: undefined,
    });
    this.events.set(input.idempotencyKey, event);
    return { ...event };
  }

  list(limit = 100): AuditEvent[] {
    const bounded = Math.max(1, Math.min(limit, 500));
    return [...this.events.values()].slice(-bounded).reverse().map((event) => ({ ...event }));
  }
}
