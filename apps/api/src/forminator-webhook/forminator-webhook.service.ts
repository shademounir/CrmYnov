import { BadRequestException, ConflictException, HttpException, HttpStatus, Injectable, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export interface ForminatorLeadWebhook {
  schemaVersion: "1";
  eventId: string;
  occurredAt: string;
  lead: { firstName: string; lastName: string; email?: string; phone?: string; educationLevel: string; program: string; source?: string; campaign?: string };
}

export interface ForminatorWebhookHeaders { timestamp: string; signature: string; idempotencyKey: string }
export interface ForminatorWebhookResult { accepted: true; replayed: boolean; eventDigest: string; mutated: false }

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonical(object[key])}`).join(",")}}`;
}

@Injectable()
export class ForminatorWebhookService {
  private readonly receipts = new Map<string, string>();
  private readonly rateBuckets = new Map<number, number>();

  constructor(private readonly secret = process.env.FORMINATOR_WEBHOOK_SECRET?.trim() ?? "",
    private readonly enabled = process.env.FORMINATOR_WEBHOOK_ENABLED === "true") {}

  receive(headers: ForminatorWebhookHeaders, payload: ForminatorLeadWebhook, now = Date.now()): ForminatorWebhookResult {
    if (!this.enabled || this.secret.length < 32) throw new ServiceUnavailableException({ code: "forminator_webhook_disabled" });
    this.validateHeaders(headers, now); this.validatePayload(payload); this.enforceRateLimit(now);
    const canonicalPayload = canonical(payload);
    this.verifySignature(headers.timestamp, headers.signature, canonicalPayload);
    const digest = createHash("sha256").update(canonicalPayload).digest("hex");
    const existing = this.receipts.get(headers.idempotencyKey);
    if (existing && existing !== digest) throw new ConflictException({ code: "forminator_idempotency_conflict" });
    if (!existing) this.receipts.set(headers.idempotencyKey, digest);
    return { accepted: true, replayed: existing === digest, eventDigest: digest.slice(0, 24), mutated: false };
  }

  private validateHeaders(headers: ForminatorWebhookHeaders, now: number): void {
    if (!/^\d{10,13}$/.test(headers.timestamp) || !/^sha256=[a-f0-9]{64}$/.test(headers.signature) || !/^[A-Za-z0-9_-]{8,128}$/.test(headers.idempotencyKey))
      throw new BadRequestException({ code: "forminator_headers_invalid" });
    const timestamp = Number(headers.timestamp.length === 10 ? `${headers.timestamp}000` : headers.timestamp);
    if (!Number.isSafeInteger(timestamp) || Math.abs(now - timestamp) > 300_000) throw new UnauthorizedException({ code: "forminator_timestamp_expired" });
  }

  private validatePayload(payload: ForminatorLeadWebhook): void {
    if (!payload || payload.schemaVersion !== "1" || !/^[A-Za-z0-9_-]{8,128}$/.test(payload.eventId) || Number.isNaN(Date.parse(payload.occurredAt)))
      throw new BadRequestException({ code: "forminator_payload_invalid" });
    const lead = payload.lead;
    if (!lead || !this.text(lead.firstName, 100) || !this.text(lead.lastName, 100) || !this.text(lead.educationLevel, 100) || !this.text(lead.program, 160))
      throw new BadRequestException({ code: "forminator_payload_invalid" });
    if ((!lead.email && !lead.phone) || (lead.email && !this.text(lead.email, 254)) || (lead.phone && !this.text(lead.phone, 32)))
      throw new BadRequestException({ code: "forminator_identity_invalid" });
    const allowed = new Set(["firstName", "lastName", "email", "phone", "educationLevel", "program", "source", "campaign"]);
    if (Object.keys(lead).some((key) => !allowed.has(key))) throw new BadRequestException({ code: "forminator_unknown_field" });
  }

  private text(value: unknown, max: number): boolean { return typeof value === "string" && value.trim().length > 0 && value.length <= max && !/[\0\r\n]/.test(value); }

  private verifySignature(timestamp: string, signature: string, payload: string): void {
    const expected = createHmac("sha256", this.secret).update(`${timestamp}.${payload}`).digest();
    const received = Buffer.from(signature.slice(7), "hex");
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) throw new UnauthorizedException({ code: "forminator_signature_invalid" });
  }

  private enforceRateLimit(now: number): void {
    const bucket = Math.floor(now / 60_000); const count = (this.rateBuckets.get(bucket) ?? 0) + 1;
    for (const key of this.rateBuckets.keys()) if (key < bucket - 1) this.rateBuckets.delete(key);
    if (count > 60) throw new HttpException({ code: "forminator_rate_limited" }, HttpStatus.TOO_MANY_REQUESTS);
    this.rateBuckets.set(bucket, count);
  }
}

export function canonicalizeForminatorPayload(payload: ForminatorLeadWebhook): string { return canonical(payload); }
