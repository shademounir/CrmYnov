import { BadRequestException, ConflictException, Inject, Injectable, ServiceUnavailableException } from "@nestjs/common";
import { createHash } from "node:crypto";
import type { Principal } from "../auth/auth.types.js";
import { PrismaService } from "../persistence/prisma.service.js";

export const leadTemperatures = ["UNEVALUATED", "COLD", "WARM", "HOT"] as const;
export type LeadTemperature = (typeof leadTemperatures)[number];
export const leadTemperatureLabels: Readonly<Record<LeadTemperature, string>> = {
  UNEVALUATED: "Non évalué",
  COLD: "Froid",
  WARM: "Tiède",
  HOT: "Chaud",
};

export interface LeadQualificationRecord {
  id?: string;
  leadId: string;
  temperature: LeadTemperature;
  temperatureLabel: string;
  reason?: string;
  comment?: string;
  authorId?: string;
  version: number;
  createdAt?: string;
}

export interface LeadQualificationInput {
  temperature: string;
  reason: string;
  comment?: string;
  expectedVersion: number;
  idempotencyKey: string;
}

interface NormalizedQualificationInput {
  temperature: Exclude<LeadTemperature, "UNEVALUATED">;
  reason: string;
  comment?: string;
  expectedVersion: number;
  idempotencyKey: string;
}

export function normalizeQualificationInput(input: LeadQualificationInput): NormalizedQualificationInput {
  const allowed = ["temperature", "reason", "comment", "expectedVersion", "idempotencyKey"];
  if (!input || typeof input !== "object" || Object.keys(input).some((key) => !allowed.includes(key))) {
    throw new BadRequestException({ code: "lead_qualification_input_invalid" });
  }
  if (!(["COLD", "WARM", "HOT"] as const).some((value) => value === input.temperature)) {
    throw new BadRequestException({ code: "lead_temperature_invalid" });
  }
  const reason = typeof input.reason === "string" ? input.reason.normalize("NFC").trim() : "";
  const comment = typeof input.comment === "string" ? input.comment.normalize("NFC").trim() : "";
  if (reason.length < 3 || reason.length > 240 || comment.length > 1000) {
    throw new BadRequestException({ code: "lead_qualification_reason_invalid" });
  }
  if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0) {
    throw new BadRequestException({ code: "lead_qualification_version_invalid" });
  }
  if (typeof input.idempotencyKey !== "string" || !/^[a-zA-Z0-9:_-]{8,128}$/.test(input.idempotencyKey)) {
    throw new BadRequestException({ code: "lead_qualification_idempotency_invalid" });
  }
  return {
    temperature: input.temperature as Exclude<LeadTemperature, "UNEVALUATED">,
    reason,
    ...(comment ? { comment } : {}),
    expectedVersion: input.expectedVersion,
    idempotencyKey: input.idempotencyKey,
  };
}

@Injectable()
export class LeadQualificationService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async read(leadId: string): Promise<{ current: LeadQualificationRecord; history: LeadQualificationRecord[] }> {
    const client = this.requiredClient();
    const rows = await client.leadCommercialQualification.findMany({ where: { leadId }, orderBy: [{ version: "desc" }, { id: "desc" }], take: 100 });
    const history = rows.map((row) => this.map(row));
    return { current: history[0] ?? this.unevaluated(leadId), history };
  }

  async update(leadId: string, raw: LeadQualificationInput, principal: Principal, correlationId: string): Promise<LeadQualificationRecord> {
    const input = normalizeQualificationInput(raw);
    if (!principal.userId || !principal.sessionId || !principal.roles.length) throw new ServiceUnavailableException({ code: "audit_actor_required" });
    const fingerprint = createHash("sha256").update(JSON.stringify({ leadId, actorId: principal.userId, ...input })).digest("hex");
    const client = this.requiredClient();
    try {
      return await client.$transaction(async (tx) => {
        const replay = await tx.leadCommercialQualification.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
        if (replay) return this.replay(replay, leadId, fingerprint);
        const lead = await tx.lead.findUnique({ where: { id: leadId }, select: { campus: true } });
        if (!lead) throw new ConflictException({ code: "lead_qualification_unavailable" });
        const latest = await tx.leadCommercialQualification.findFirst({ where: { leadId }, orderBy: [{ version: "desc" }, { id: "desc" }] });
        const currentVersion = latest?.version ?? 0;
        if (input.expectedVersion !== currentVersion) throw new ConflictException({ code: "lead_qualification_version_conflict", currentVersion });
        const next = await tx.leadCommercialQualification.create({ data: {
          leadId, temperature: input.temperature, reason: input.reason, comment: input.comment ?? null,
          authorId: principal.userId, version: currentVersion + 1, idempotencyKey: input.idempotencyKey, fingerprint,
        } });
        await tx.auditEvent.create({ data: {
          campusId: lead.campus, resourceType: "LEAD", resourceId: leadId, eventType: "LEAD_QUALIFICATION_UPDATED",
          actorId: principal.userId, actorRoles: principal.roles, sessionId: principal.sessionId,
          correlationId, result: "SUCCESS", idempotencyKey: `qualification-audit:${input.idempotencyKey}`,
          before: latest ? { temperature: latest.temperature, version: latest.version } : { temperature: "UNEVALUATED", version: 0 },
          after: { temperature: next.temperature, version: next.version },
        } });
        return this.map(next);
      }, { isolationLevel: "Serializable" });
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
      if (code === "P2002") {
        const replay = await client.leadCommercialQualification.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
        if (replay) return this.replay(replay, leadId, fingerprint);
        throw new ConflictException({ code: "lead_qualification_version_conflict" });
      }
      throw error;
    }
  }

  private requiredClient(): NonNullable<PrismaService["client"]> {
    const client = this.prisma.client;
    if (!client) throw new ServiceUnavailableException({ code: "lead_qualification_store_unavailable" });
    return client;
  }

  private unevaluated(leadId: string): LeadQualificationRecord {
    return { leadId, temperature: "UNEVALUATED", temperatureLabel: leadTemperatureLabels.UNEVALUATED, version: 0 };
  }

  private map(row: { id: string; leadId: string; temperature: string; reason: string; comment: string | null; authorId: string; version: number; createdAt: Date }): LeadQualificationRecord {
    const temperature = row.temperature as Exclude<LeadTemperature, "UNEVALUATED">;
    return { id: row.id, leadId: row.leadId, temperature, temperatureLabel: leadTemperatureLabels[temperature], reason: row.reason,
      ...(row.comment ? { comment: row.comment } : {}), authorId: row.authorId, version: row.version, createdAt: row.createdAt.toISOString() };
  }

  private replay(row: { id: string; leadId: string; temperature: string; reason: string; comment: string | null; authorId: string; version: number; createdAt: Date; fingerprint: string }, leadId: string, fingerprint: string): LeadQualificationRecord {
    if (row.leadId !== leadId || row.fingerprint !== fingerprint) throw new ConflictException({ code: "lead_qualification_idempotency_conflict" });
    return this.map(row);
  }
}
