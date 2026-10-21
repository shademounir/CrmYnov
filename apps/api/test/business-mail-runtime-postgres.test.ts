import "reflect-metadata";
import assert from "node:assert/strict";
import test from "node:test";
import { createHash, randomUUID } from "node:crypto";
import { PrismaService } from "../src/persistence/prisma.service.js";
import { DynamicPermissionRepository } from "../src/permissions/dynamic-repository.js";
import { acquirePermissionFence } from "../src/permissions/permission-fence.js";
import { BusinessMailJournal } from "../src/business-mail/business-mail-journal.js";
import { BusinessMailRuntime } from "../src/business-mail/business-mail-runtime.js";
import { BusinessMailOperator, type MailOperatorRequest } from "../src/business-mail/business-mail-operator.js";
import { GmailBusinessMailSender } from "../src/business-mail/gmail-business-mail.sender.js";
import type { PreparedBusinessMail } from "../src/business-mail/business-mail-policy.js";
import type { BusinessMailSettings } from "../src/business-mail/business-mail-settings.js";
import { referenceKey } from "../src/references/reference.contract.js";
import { currentMailFacts } from "../src/business-mail/business-mail-facts.js";
import { auditView } from "../src/audit/audit-view.js";
import type { CrmReference, Collaborator } from "@prisma/client";

const options = { skip: process.env.CRMY_MAIL_EPHEMERAL_TEST !== "true", timeout: 90000 };
const digest = (value: string): string => createHash("sha256").update(value).digest("hex");
class SyntheticTransport extends GmailBusinessMailSender {
  business: PreparedBusinessMail[] = []; fixtures: PreparedBusinessMail[] = [];
  failNext = false; block: ((message: PreparedBusinessMail) => Promise<void>) | undefined;
  override configured(): boolean { return true; }
  override sendFixture(message: PreparedBusinessMail): Promise<{ providerMessageId: string }> { this.fixtures.push(message); return Promise.resolve({ providerMessageId: "synthetic-fixture-accepted" }); }
  override async sendPrepared(message: PreparedBusinessMail): Promise<{ providerMessageId: string }> {
    this.business.push(message); await this.block?.(message);
    if (this.failNext) { this.failNext = false; throw new Error("synthetic-unconfirmed"); }
    return { providerMessageId: "synthetic-business-" + this.business.length };
  }
}

test("Internal mail real PostgreSQL: explicit32 memberships, fixture/activation, exact recipients, no replay, closure and revocation fences", options, async () => {
  const url = new URL(process.env.DATABASE_URL ?? ""); assert.equal(url.hostname, "127.0.0.1"); assert.equal(url.pathname, "/crmy_mail_synthetic");
  const prisma = new PrismaService(), db = prisma.client!, journal = new BusinessMailJournal(), transport = new SyntheticTransport();
  const permissions = new DynamicPermissionRepository(prisma);
  try {
    assert.deepEqual(await db.$queryRaw`SELECT nonce FROM business_mail_test_identity.marker`, [{ nonce: process.env.CRMY_MAIL_DATABASE_NONCE }]);
    const suffix = randomUUID().slice(0, 8).toUpperCase(), campusCode = "MAIL-" + suffix;
    const campus = await db.crmReference.create({ data: { kind: "CAMPUS", scope: "GLOBAL", scopeKey: "GLOBAL", code: campusCode, label: "Synthetic mail campus " + suffix,
      keys: { create: { kind: "CAMPUS", scopeKey: "GLOBAL", key: referenceKey(campusCode) } } } });
    const campaigns: CrmReference[] = [];
    for (let index = 0; index < 5; index++) {
      const code = "MAIL-CAMPAIGN-" + suffix + "-" + index;
      campaigns.push(await db.crmReference.create({ data: { kind: "CAMPAIGN", scope: "CAMPUS", scopeKey: campus.id, campusId: campus.id, code, label: code,
        keys: { create: { kind: "CAMPAIGN", scopeKey: campus.id, key: referenceKey(code) } } } }));
    }
    const users: Collaborator[] = [];
    for (let index = 0; index < 8; index++) users.push(await db.collaborator.create({ data: { professionalEmail: `synthetic-mail-${suffix.toLowerCase()}-${index}@example.test`, roles: [index === 0 ? "SUPER_ADMIN" : "ADMISSIONS"], campusId: campus.id, active: true, firstLoginRequired: false } }));
    const owner = await db.collaborator.create({ data: { professionalEmail: `synthetic-owner-${suffix.toLowerCase()}@example.test`, roles: ["MANAGER"], campusId: campus.id, firstLoginRequired: false } });
    await db.collaborator.update({ where: { id: users[7]!.id }, data: { firstLoginRequired: true } });
    const settings: BusinessMailSettings = { campusId: campus.id, campaignIds: campaigns.slice(0, 4).map(row => row.id).sort((a, b) => a.localeCompare(b, "en")), memberUserIds: users.map(row => row.id).sort((a, b) => a.localeCompare(b, "en")), warningCadenceHours: 24, maximumWarnings: 3, warningIntervalHours: 24, messagesPerHour: 1000, messagesPerDay: 1000, recipientsPerHour: 10000, recipientsPerDay: 10000 };
    const operator = new BusinessMailOperator(db, permissions, journal, transport, "https://crm.example.test");
    const operation = async (mode: MailOperatorRequest["mode"]): Promise<Awaited<ReturnType<BusinessMailOperator["execute"]>>> => {
      const current = await db.businessMailConfiguration.findUnique({ where: { id: "internal-business-v1" } });
      return operator.execute({ mode, authorizationSubjectId: users[0]!.id, operationId: randomUUID(), expectedVersion: current?.version ?? 0, sourceSha: "a".repeat(40), decisionSha256: "b".repeat(64), ...(mode === "PREPARE" ? { settings } : {}) });
    };
    const invitationCount = await db.localAccessInvitation.count();
    const preparation = await operation("PREPARE"); assert.equal(preparation.enabled, false); assert.equal(preparation.activatedAt, null);
    assert.equal(await db.businessMailMembership.count({ where: { campusId: campus.id, active: true } }), 32);
    assert.equal(await db.auditEvent.count({ where: { campusId: campus.id, eventType: "BUSINESS_MAIL_MEMBERSHIP_ACTIVATED" } }), 32);
    await assert.rejects(() => operation("ACTIVATE"), /transport_not_qualified/);
    await operation("FIXTURE"); assert.equal(transport.fixtures.length, 1); assert.equal(transport.fixtures[0]!.to, users[0]!.professionalEmail); assert.deepEqual(transport.fixtures[0]!.cc, []);
    await assert.rejects(() => operation("ACTIVATE"), /fresh_bounded_preflight_required/);
    const initialPreflight = await operation("PREFLIGHT"); assert.equal(initialPreflight.preflight?.roster.firstLoginPending, 1);
    const activated = await operation("ACTIVATE"); assert.equal(activated.enabled, true); assert(activated.activatedAt);
    const activation = new Date(activated.activatedAt);
    const now = (await db.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`)[0]!.now;
    const lead = async (label: string, changed: Record<string, unknown> = {}): Promise<{ id: string; leadCode: string }> => db.lead.create({ data: { leadCode: "LD-MAIL-" + suffix + "-" + label,
      firstName: "Synthetic", lastName: "Mail fixture", campus: campus.code, campaign: campaigns[0]!.code, educationLevel: "BAC", program: "SYNTHETIC", source: "TEST", assignedToId: owner.id, ...changed } });
    const task = async (leadId: string, label: string, dueAt = now): Promise<void> => { await db.leadFollowUp.create({ data: { leadId, ownerId: owner.id, dueAt, createdAt: new Date(dueAt.valueOf() - 1000), state: "DUE", reason: "Synthetic internal mail only", idempotencyKey: "mail-test-" + suffix + "-" + label, fingerprint: digest(label) } }); };
    const active = await lead("ACTIVE"); await task(active.id, "active");
    const closed = await lead("CLOSED", { status: "CLOSED_LOST" }); await task(closed.id, "closed");
    const historical = await lead("HISTORICAL"); await task(historical.id, "historical", new Date(activation.valueOf() - 1000));
    const foreign = await lead("FOREIGN", { campaign: campaigns[4]!.code }); await task(foreign.id, "foreign");
    const first = await lead("FIRST", { assignedToId: users[1]!.id, acquisitionKind: "NEW", createdAt: new Date(activation.valueOf() - 86400000 + 1) });
    await lead("BASELINE", { acquisitionKind: "BASELINE", createdAt: new Date(activation.valueOf() - 86400000 + 1) });
    const returning = await lead("RETURN");
    const responsibility = await db.admissionsResponsibility.create({ data: { userId: users[1]!.id, campus: campus.id, active: true } });
    const booking = await db.appointment.create({ data: { leadId: returning.id, type: "ENTRETIEN_ADMISSION", mode: "TELEPHONE", state: "CONFIRME", startsAt: new Date(activation.valueOf() - 60000 + 1), durationMinutes: 1,
      campus: campus.code, adviserId: owner.id, organizerId: owner.id, evaluatorId: users[1]!.id, admissionsBooking: { create: { responsibilityId: responsibility.id, state: "ACCEPTED" } } } });
    const pendingLead = await lead("PENDING");
    const pending = await db.appointment.create({ data: { leadId: pendingLead.id, type: "ENTRETIEN_ADMISSION", mode: "TELEPHONE", state: "BROUILLON", startsAt: now, durationMinutes: 30,
      campus: campus.code, adviserId: owner.id, organizerId: owner.id, evaluatorId: users[1]!.id, admissionsBooking: { create: { responsibilityId: responsibility.id, state: "PENDING" } } } });
    const confirmation = await permissions.transaction(tx => currentMailFacts(tx, { type: "CONFIRMATION_EXPECTED", resourceId: pending.id, leadId: pendingLead.id }, settings), "read-audited");
    assert.equal(confirmation?.deadline, null, "No confirmation deadline is invented by a job");
    const runtime = new BusinessMailRuntime(db, permissions, journal, transport, "https://crm.example.test");
    const before = { tasks: await db.leadFollowUp.findMany({ orderBy: { id: "asc" } }), appointment: await db.appointment.findUnique({ where: { id: booking.id }, include: { admissionsBooking: true, interviewReports: true } }) };
    const preview = await runtime.run("PREFLIGHT"); assert.equal(transport.business.length, 0); assert.equal(preview.prepared, 3); assert.equal(preview.held.HISTORICAL_FOLLOW_UPS_HELD, 1); assert.equal(preview.held.CONFIRMATION_NO_PERSISTED_DEADLINE, 1);
    const sent = await runtime.run("SEND"); assert.equal(sent.accepted, 3); assert.equal(sent.uncertain, 0); assert.equal(transport.business.length, 3);
    const followUp = transport.business.find(message => message.leadReference === active.leadCode)!;
    assert.equal(followUp.to, owner.professionalEmail, "Actual action owner may be outside the human Cc roster");
    assert.deepEqual(new Set(followUp.cc), new Set(users.slice(0, 7).map(user => user.professionalEmail)), "Selected first-login account remains excluded from all real data mail");
    const firstMessage = transport.business.find(message => message.leadReference === first.leadCode)!; assert.equal(firstMessage.to, users[1]!.professionalEmail); assert.equal(firstMessage.cc.length, 6);
    assert.equal(transport.business.find(message => message.type === "RETURN_EXPECTED")?.to, users[1]!.professionalEmail);
    await runtime.run("SEND"); assert.equal(transport.business.length, 3, "Repeated passages never resend retained events");
    assert.deepEqual(await db.leadFollowUp.findMany({ orderBy: { id: "asc" } }), before.tasks);
    assert.deepEqual(await db.appointment.findUnique({ where: { id: booking.id }, include: { admissionsBooking: true, interviewReports: true } }), before.appointment, "Return expected never simulates attendance, no-show or a report");
    const uncertain = await lead("UNCERTAIN"); await task(uncertain.id, "uncertain"); transport.failNext = true;
    const uncertainReport = await runtime.run("SEND"); assert.equal(uncertainReport.uncertain, 1);
    const attempted = transport.business.length; await runtime.run("SEND"); assert.equal(transport.business.length, attempted, "Unconfirmed provider attempt is not replayed");

    const concurrent = await lead("CONCURRENT"); await task(concurrent.id, "concurrent");
    let reached!: () => void, release!: () => void;
    const atTransport = new Promise<void>(resolve => { reached = resolve; }), finish = new Promise<void>(resolve => { release = resolve; });
    transport.block = async (message): Promise<void> => { if (message.leadReference === concurrent.leadCode) { reached(); await finish; } };
    const emission = runtime.run("SEND"); await atTransport;
    let closedCommitted = false;
    const closure = db.lead.update({ where: { id: concurrent.id }, data: { status: "CLOSED_LOST" } }).then(() => { closedCommitted = true; });
    let revokedCommitted = false;
    const revocation = db.$transaction(async tx => { await acquirePermissionFence(tx, "write"); await tx.collaborator.update({ where: { id: owner.id }, data: { active: false } }); }).then(() => { revokedCommitted = true; });
    await new Promise(resolve => setTimeout(resolve, 100)); assert.equal(closedCommitted, false); assert.equal(revokedCommitted, false);
    release(); await emission; await Promise.all([closure, revocation]); transport.block = undefined;
    const revokedLead = await lead("REVOKED"); await task(revokedLead.id, "revoked");
    const afterRevocation = transport.business.length; const blocked = await runtime.run("SEND"); assert.equal(transport.business.length, afterRevocation); assert(blocked.held.ACTION_OWNER_UNAVAILABLE! > 0);
    assert.equal(await db.localAccessInvitation.count(), invitationCount, "No invitation path was readied or replayed");
    const paused = await operation("PAUSE"); assert.equal(paused.enabled, false); assert.equal(paused.activatedAt, activated.activatedAt, "Pause never resets the historical activation fence");
    assert.equal((await runtime.run("SEND")).held.DISABLED, 1);
    assert.equal((await db.lead.findUniqueOrThrow({ where: { id: closed.id } })).status, "CLOSED_LOST");
    const audits = await db.auditEvent.findMany({ where: { campusId: campus.id, actorId: "system:codex-internal-mail-operator" } });
    assert.equal(audits.length, 37, "32 memberships and five successful operator actions; refused operations add no false success");
    assert.deepEqual(new Set(audits.filter(row => row.resourceType === "BUSINESS_MAIL_CONFIGURATION").map(row => row.eventType)),
      new Set(["BUSINESS_MAIL_PREPARE", "BUSINESS_MAIL_FIXTURE", "BUSINESS_MAIL_PREFLIGHT", "BUSINESS_MAIL_ACTIVATE", "BUSINESS_MAIL_PAUSE"]));
    for (const audit of audits) {
      assert.deepEqual(audit.actorRoles, ["SYSTEM"], "System attribution is not the authorizing Super Admin's role");
      assert.equal(auditView(audit).actorDisplay.kind, "SYSTEM", "The carried API audit projection must identify the technical executor");
      assert.equal(auditView(audit).actorId, null, "No human identity is manufactured from the system actor ID");
    }
  } finally { await Promise.all([journal.close(), prisma.onModuleDestroy()]); }
});
