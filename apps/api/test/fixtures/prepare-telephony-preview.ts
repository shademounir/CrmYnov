import { basename } from "node:path";
import { randomUUID } from "node:crypto";
import { AuditService } from "../../src/audit/audit.service.js";
import type { Principal } from "../../src/auth/auth.types.js";
import { LeadPersistenceRepository } from "../../src/leads/lead-persistence.repository.js";
import { LeadService } from "../../src/leads/lead.service.js";
import { PrismaService } from "../../src/persistence/prisma.service.js";
import { TelephonyPersistenceRepository } from "../../src/telephony/telephony-persistence.repository.js";
import { TelephonyService } from "../../src/telephony/telephony.service.js";

export async function prepareTelephonyPreview(): Promise<{ callId: string; state: string; matchState: string }> {
  const database = new URL(process.env.DATABASE_URL ?? "");
  if (!["127.0.0.1", "localhost"].includes(database.hostname) || database.pathname !== "/crmy165_telephony_preview_20260916") throw new Error("telephony_preview_database_refused");
  const prisma = new PrismaService(); const client = prisma.client; if (!client) throw new Error("telephony_preview_database_unavailable");
  try {
    const candidateRows = await client.lead.findMany({ where: { phone: { not: null } }, orderBy: { id: "asc" } });
    const candidate = candidateRows.find((row) => Boolean(row.phone?.trim())); if (!candidate?.phone) throw new Error("telephony_preview_phone_fixture_missing");
    const actor = await client.collaborator.findFirst({ where: { active: true, roles: { has: "SUPER_ADMIN" } }, orderBy: { id: "asc" } });
    if (!actor) throw new Error("telephony_preview_actor_missing");
    const principal: Principal = { userId: actor.id, roles: ["SUPER_ADMIN"], scopes: [{ kind: "GLOBAL" }], sessionId: randomUUID() };
    const audit = new AuditService(); const leads = new LeadService(audit, new LeadPersistenceRepository(prisma)); await leads.onModuleInit();
    await leads.createLeadForApi({ firstName: "Appel", lastName: "Recette", phone: candidate.phone, campus: candidate.campus, campaign: candidate.campaign, educationLevel: candidate.educationLevel, program: candidate.program, source: "PHONE_CALL", idempotencyKey: "telephony-preview-lead-20260916" }, principal, "telephony-preview-lead");
    const telephony = new TelephonyService(audit, leads, new TelephonyPersistenceRepository(prisma)); await telephony.onModuleInit();
    const configuration = await telephony.configurationForApi();
    if (configuration.mode !== "MANUAL_EXTERNAL" || !configuration.inboundEnabled) await telephony.configureForApi({ expectedVersion: configuration.version, mode: "MANUAL_EXTERNAL", clickToCallEnabled: false, inboundEnabled: true, outboundEnabled: false, recordingPolicy: "METADATA_ONLY", maxCallDurationSeconds: 7200 }, principal, "telephony-preview-config");
    const base = Date.now() - 20_000;
    let call = await telephony.ingestSyntheticIncomingForApi({ provider: "MANUAL_EXTERNAL", externalId: "preview-ambiguous-missed-v2-20260916", phone: candidate.phone, idempotencyKey: "preview-ambiguous-v2-20260916", occurredAt: new Date(base).toISOString() }, principal, "telephony-preview-create");
    if (call.state === "REQUESTED") call = await telephony.receiveEventForApi(call.id, { idempotencyKey: "preview-ringing-v2-20260916", state: "RINGING", occurredAt: new Date(base + 1_000).toISOString() }, principal, "telephony-preview-ringing");
    if (call.state === "RINGING") call = await telephony.receiveEventForApi(call.id, { idempotencyKey: "preview-missed-v2-20260916", state: "MISSED", occurredAt: new Date(base + 10_000).toISOString() }, principal, "telephony-preview-missed");
    const afterFixture = await telephony.configurationForApi();
    if (afterFixture.mode !== "DISABLED" || afterFixture.inboundEnabled || afterFixture.outboundEnabled || afterFixture.clickToCallEnabled) {
      await telephony.configureForApi({ expectedVersion: afterFixture.version, mode: "DISABLED", clickToCallEnabled: false, inboundEnabled: false,
        outboundEnabled: false, recordingPolicy: "DISABLED", maxCallDurationSeconds: afterFixture.maxCallDurationSeconds }, principal, "telephony-preview-disable");
    }
    return { callId: call.id, state: call.state, matchState: call.matchState };
  } finally { await prisma.onModuleDestroy(); }
}

if (basename(process.argv[1] ?? "") === "prepare-telephony-preview.ts") {
  void prepareTelephonyPreview().then((result) => process.stdout.write(`${JSON.stringify(result)}\n`)).catch((error: unknown) => { process.stderr.write(`${error instanceof Error ? error.message : "telephony_preview_failed"}\n`); process.exitCode = 1; });
}
