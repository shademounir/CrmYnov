import { createHash } from "node:crypto";
import { ConflictException } from "@nestjs/common";
import type { Prisma, PrismaClient } from "@prisma/client";
import { DynamicPermissionRepository } from "../permissions/dynamic-repository.js";
import { resourceEvaluationContext } from "../permissions/dynamic-context.js";
import { canonicalCampus } from "../permissions/dynamic-resources.js";
import { businessMailConfigurationCapability } from "../permissions/dynamic-evaluator.js";
import { currentMailIdentity } from "./business-mail-recipients.js";
import { BUSINESS_MAIL_CONFIGURATION_ID as id, mailUuid, parseBusinessMailSettings, type BusinessMailSettings } from "./business-mail-settings.js";
import { BusinessMailJournal } from "./business-mail-journal.js";
import { businessMailEvidence } from "./business-mail-evidence.js";
import { renderBusinessMailFixture } from "./business-mail-template.js";
import { GmailBusinessMailSender } from "./gmail-business-mail.sender.js";
import type { PreparedBusinessMail } from "./business-mail-policy.js";
import { BusinessMailRuntime, type MailRuntimeReport } from "./business-mail-runtime.js";
import { isRole } from "../auth/auth.types.js";

export interface MailOperatorRequest {
  mode: "PREPARE" | "FIXTURE" | "PREFLIGHT" | "ACTIVATE" | "PAUSE";
  authorizationSubjectId: string; operationId: string; expectedVersion: number;
  sourceSha: string; decisionSha256: string; settings?: BusinessMailSettings;
}
export function parseMailOperatorRequest(value: unknown): MailOperatorRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("business_mail_operator_invalid");
  const row = value as Record<string, unknown>;
  const fields = ["mode", "authorizationSubjectId", "operationId", "expectedVersion", "sourceSha", "decisionSha256", ...(row.mode === "PREPARE" ? ["settings"] : [])];
  if (Object.keys(row).length !== fields.length || fields.some(key => !Object.hasOwn(row, key)) || !["PREPARE", "FIXTURE", "PREFLIGHT", "ACTIVATE", "PAUSE"].includes(String(row.mode))
    || !mailUuid(row.authorizationSubjectId) || !mailUuid(row.operationId) || typeof row.expectedVersion !== "number" || !Number.isSafeInteger(row.expectedVersion) || row.expectedVersion < 0
    || typeof row.sourceSha !== "string" || !/^[a-f0-9]{40}$/.test(row.sourceSha) || typeof row.decisionSha256 !== "string" || !/^[a-f0-9]{64}$/.test(row.decisionSha256)) throw new Error("business_mail_operator_invalid");
  return { mode: row.mode as MailOperatorRequest["mode"], authorizationSubjectId: row.authorizationSubjectId, operationId: row.operationId,
    expectedVersion: row.expectedVersion, sourceSha: row.sourceSha, decisionSha256: row.decisionSha256,
    ...(row.mode === "PREPARE" ? { settings: parseBusinessMailSettings(row.settings) } : {}) };
}
const digest = (value: unknown): string => createHash("sha256").update(JSON.stringify(value)).digest("hex");
class MailOperationRefused extends ConflictException {
  constructor(code: string) { super({ code, message: code }); }
}

/** Explicit objective-bound delegated operation. Not an HTTP principal and not a
 * PO impersonation: audits name the system executor and separately its real
 * authorization anchor. IAM, protected publication and deployment gate this job. */
export class BusinessMailOperator {
  constructor(private readonly client: PrismaClient, private readonly permissions: DynamicPermissionRepository,
    private readonly journal: BusinessMailJournal, private readonly sender = new GmailBusinessMailSender(), private readonly origin = process.env.CRM_PUBLIC_ORIGIN ?? "") {}

  async execute(input: MailOperatorRequest): Promise<{ version: number; enabled: boolean; activatedAt: string | null; replayed: boolean; preflight?: MailRuntimeReport }> {
    const request = parseMailOperatorRequest(input), fingerprint = digest(request);
    if (request.mode === "PREFLIGHT") await this.permissions.readTransaction(async tx => {
      const configuration = await tx.businessMailConfiguration.findUniqueOrThrow({ where: { id } });
      await this.authorize(tx, request.authorizationSubjectId, parseBusinessMailSettings(configuration.settings));
    });
    const preflight = request.mode === "PREFLIGHT" ? await new BusinessMailRuntime(this.client, this.permissions, this.journal, this.sender, this.origin).run("PREFLIGHT") : null;
    const signal = AbortSignal.timeout(20000);
    // Shared fence for the bounded fixture call, exclusive for configuration or
    // membership changes. The independent journal never reacquires this lock.
    return this.permissions.transaction(async tx => {
      const current = await tx.businessMailConfiguration.findUnique({ where: { id } });
      const settings = request.mode === "PREPARE" ? request.settings! : current ? parseBusinessMailSettings(current.settings) : null;
      if (!settings) throw new MailOperationRefused("business_mail_configuration_missing");
      await this.authorize(tx, request.authorizationSubjectId, settings);
      const previousAudit = await tx.auditEvent.findUnique({ where: { idempotencyKey: "business-mail-operator:" + request.operationId } });
      if (previousAudit) {
        const after = previousAudit.after as Prisma.JsonObject | null;
        if (after?.fingerprint !== fingerprint || previousAudit.result !== "SUCCESS") throw new MailOperationRefused("business_mail_operation_conflict");
        return { version: current?.version ?? 0, enabled: current?.enabled ?? false, activatedAt: current?.activatedAt?.toISOString() ?? null, replayed: true };
      }
      if ((current?.version ?? 0) !== request.expectedVersion) throw new MailOperationRefused("business_mail_configuration_version_conflict");
      const before = current ? { version: current.version, enabled: current.enabled, activatedAt: current.activatedAt?.toISOString() ?? null } : null;
      if (request.mode === "PREPARE") await this.prepare(tx, settings, current?.enabled ?? false, request, current?.version);
      else if (request.mode === "FIXTURE") {
        if (current!.enabled) throw new MailOperationRefused("business_mail_fixture_requires_paused_configuration");
        const key = await this.fixture(tx, request.authorizationSubjectId, settings, signal);
        await tx.businessMailConfiguration.update({ where: { id, version: current!.version }, data: { qualificationKey: key, version: { increment: 1 } } });
      } else if (request.mode === "PREFLIGHT") {
        if (!preflight || preflight.configurationVersion !== current!.version || current!.enabled) throw new MailOperationRefused("business_mail_preflight_configuration_changed");
        const at = (await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`)[0]!.now;
        await tx.businessMailConfiguration.update({ where: { id, version: current!.version }, data: { preflight: { report: preflight as unknown as Prisma.InputJsonObject, sourceSha: request.sourceSha, settingsHash: digest(settings), qualifiedVersion: current!.version + 1 }, preflightAt: at, version: { increment: 1 } } });
      } else {
        if (request.mode === "ACTIVATE" && (!current!.qualificationKey || (await tx.businessMailDelivery.findUnique({ where: { key: current!.qualificationKey } }))?.status !== "ACCEPTED")) throw new MailOperationRefused("business_mail_transport_not_qualified");
        const now = (await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`)[0]!.now;
        if (request.mode === "ACTIVATE") this.assertPreflight(current!, request, settings, now);
        await tx.businessMailConfiguration.update({ where: { id, version: current!.version }, data: { enabled: request.mode === "ACTIVATE", activatedAt: request.mode === "ACTIVATE" ? current!.activatedAt ?? now : current!.activatedAt, version: { increment: 1 } } });
      }
      const result = await tx.businessMailConfiguration.findUniqueOrThrow({ where: { id } });
      await tx.auditEvent.create({ data: { resourceType: "BUSINESS_MAIL_CONFIGURATION", resourceId: id, campusId: settings.campusId, eventType: "BUSINESS_MAIL_" + request.mode,
        actorId: "system:codex-internal-mail-operator", actorRoles: [], correlationId: request.operationId, result: "SUCCESS", idempotencyKey: "business-mail-operator:" + request.operationId,
        ...(before ? { before } : {}), after: { fingerprint, executor: "Codex", delegation: "crm-ynov-po-delegation-20261001", authorizationSubjectId: request.authorizationSubjectId,
          sourceSha: request.sourceSha, decisionSha256: request.decisionSha256, version: result.version, enabled: result.enabled,
          activatedAt: result.activatedAt?.toISOString() ?? null, settings: settings as unknown as Prisma.InputJsonObject, ...(preflight ? { preflight: preflight as unknown as Prisma.InputJsonObject } : {}), personalHumanAcceptanceClaimed: false } } });
      return { version: result.version, enabled: result.enabled, activatedAt: result.activatedAt?.toISOString() ?? null, replayed: false, ...(preflight ? { preflight } : {}) };
    }, request.mode === "FIXTURE" ? "read-audited" : "write");
  }

  private async authorize(tx: Prisma.TransactionClient, userId: string, settings: BusinessMailSettings): Promise<void> {
    const anchor = await currentMailIdentity(tx, userId); if (!anchor) throw new MailOperationRefused("business_mail_operator_not_authorized");
    const campus = await canonicalCampus(tx, settings.campusId);
    const context = await resourceEvaluationContext(tx, anchor.identity, { scope: "CAMPUS", campusKeys: campus.keys, active: true });
    if (!businessMailConfigurationCapability(anchor.identity.roles, await this.permissions.snapshots(tx), context)) throw new MailOperationRefused("business_mail_operator_not_authorized");
    const campaigns = await tx.crmReference.findMany({ where: { id: { in: settings.campaignIds }, kind: "CAMPAIGN", state: "ACTIVE" } });
    if (campaigns.length !== settings.campaignIds.length || campaigns.some(row => row.scope !== "GLOBAL" && row.campusId !== campus.id)) throw new MailOperationRefused("business_mail_campaign_scope_invalid");
    for (const memberId of settings.memberUserIds) {
      const member = await tx.collaborator.findUnique({ where: { id: memberId } });
      if (!member?.active || !member.roles.length || !member.roles.every(isRole)) throw new MailOperationRefused("business_mail_member_scope_invalid");
      if (!member.roles.includes("SUPER_ADMIN") && (!member.campusId || (await canonicalCampus(tx, member.campusId)).id !== campus.id)) throw new MailOperationRefused("business_mail_member_scope_invalid");
      // Membership configuration is not activation or permission. First-login
      // accounts may be selected, but currentMailIdentity excludes them from ALL
      // real To/Cc resolution until their own official activation is completed.
    }
  }

  private assertPreflight(current: { version: number; preflight: Prisma.JsonValue | null; preflightAt: Date | null }, request: MailOperatorRequest, settings: BusinessMailSettings, now: Date): void {
    const proof = current.preflight as Prisma.JsonObject | null;
    const report = proof?.report as unknown as MailRuntimeReport | undefined;
    if (!current.preflightAt || now.valueOf() - current.preflightAt.valueOf() > 300000 || current.preflightAt > now
      || proof?.qualifiedVersion !== current.version || proof.settingsHash !== digest(settings) || proof.sourceSha !== request.sourceSha || !report
      || ![report.inspected, report.prepared, report.accepted, report.uncertain, report.recipientDeliveries].every(value => Number.isSafeInteger(value) && value >= 0)
      || report.configurationVersion !== current.version - 1 || report.accepted !== 0 || report.uncertain !== 0
      || report.prepared > settings.messagesPerHour || report.prepared > settings.messagesPerDay || report.recipientDeliveries > settings.recipientsPerHour || report.recipientDeliveries > settings.recipientsPerDay) throw new MailOperationRefused("business_mail_fresh_bounded_preflight_required");
  }

  private async prepare(tx: Prisma.TransactionClient, settings: BusinessMailSettings, enabled: boolean, request: MailOperatorRequest, version?: number): Promise<void> {
    if (enabled) throw new MailOperationRefused("business_mail_configuration_must_be_paused");
    const existing = await tx.businessMailMembership.findMany({ where: { active: true } });
    const desired = settings.campaignIds.flatMap(campaignId => settings.memberUserIds.map(userId => ({ campusId: settings.campusId, campaignId, userId })));
    if (existing.some(row => !desired.some(wanted => wanted.campusId === row.campusId && wanted.campaignId === row.campaignId && wanted.userId === row.userId))) throw new MailOperationRefused("business_mail_membership_change_requires_separate_objective");
    for (const membership of desired) {
      const previous = await tx.businessMailMembership.findUnique({ where: { campusId_campaignId_userId: membership } });
      await tx.businessMailMembership.upsert({ where: { campusId_campaignId_userId: membership }, create: membership, update: { active: true } });
      if (!previous?.active) await tx.auditEvent.create({ data: { resourceType: "BUSINESS_MAIL_MEMBERSHIP", resourceId: membership.userId, campusId: membership.campusId,
        eventType: "BUSINESS_MAIL_MEMBERSHIP_ACTIVATED", actorId: "system:codex-internal-mail-operator", actorRoles: [], correlationId: request.operationId, result: "SUCCESS",
        idempotencyKey: "business-mail-membership:" + digest([request.operationId, membership]), after: { ...membership, active: true, executor: "Codex", authorizationSubjectId: request.authorizationSubjectId, decisionSha256: request.decisionSha256 } } });
    }
    const data = { settings: settings as unknown as Prisma.InputJsonObject, enabled: false };
    if (version === undefined) await tx.businessMailConfiguration.create({ data: { id, ...data } });
    else await tx.businessMailConfiguration.update({ where: { id, version }, data: { ...data, version: { increment: 1 } } });
  }

  private async fixture(tx: Prisma.TransactionClient, userId: string, settings: BusinessMailSettings, signal: AbortSignal): Promise<string> {
    const current = await currentMailIdentity(tx, userId); if (!current) throw new MailOperationRefused("business_mail_operator_not_authorized");
    const key = digest(["business-mail-explicit-transport-fixture-v1", id]);
    const existing = await tx.businessMailDelivery.findUnique({ where: { key } });
    if (existing) {
      if (existing.status !== "ACCEPTED" || !Array.isArray(existing.recipientUserIds)) throw new MailOperationRefused("business_mail_fixture_uncertain_no_replay");
      const first = existing.recipientUserIds[0];
      if (!Array.isArray(first) || first[1] !== userId || first[2] !== current.email) throw new MailOperationRefused("business_mail_fixture_identity_changed_no_replay");
      return key;
    }
    const now = (await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`)[0]!.now.toISOString();
    const message: PreparedBusinessMail = { type: "FOLLOW_UP_DUE", key, templateVersion: "fr-v1", leadReference: "LD-SYNTHETIC-TEST", deadline: now, generatedAt: now, occurrence: 0, to: current.email, cc: [], recipientUserIds: [userId] };
    const evidence = businessMailEvidence(message, { campusId: settings.campusId, campaignId: settings.campaignIds[0]! }, this.origin);
    evidence.fingerprint = digest([evidence.fingerprint, renderBusinessMailFixture(message, this.origin)]);
    const reservation = await this.journal.reserveSending({ key, eventType: message.type, resourceId: "synthetic-transport-fixture-v1", templateVersion: message.templateVersion, ...evidence, limits: settings });
    if (!reservation.reserved) throw new MailOperationRefused("business_mail_fixture_retained_no_replay");
    let transportAccepted = false;
    try {
      await tx.$queryRaw`SELECT 1`; signal.throwIfAborted();
      const result = await this.sender.sendFixture(message, signal); transportAccepted = true;
      if (!await this.journal.accepted(key, reservation.token, result.providerMessageId)) throw new Error("business_mail_acceptance_commit_unconfirmed");
      return key;
    } catch {
      await this.journal.uncertain(key, reservation.token, transportAccepted ? "ACCEPTANCE_COMMIT_UNCONFIRMED" : "TRANSPORT_UNCONFIRMED");
      throw new MailOperationRefused("business_mail_fixture_uncertain_no_replay");
    }
  }
}
