import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../../src/persistence/prisma.service.js";
import { ReferenceRepository, validateLeadReferences } from "../../src/references/reference.repository.js";
import { ReferenceService } from "../../src/references/reference.service.js";
import { DefaultGrantProvider, PermissionService } from "../../src/permissions/permission.service.js";
import { PersistentIngestionService, type ConfirmPersistentImportInput } from "../../src/ingestion/persistent-ingestion.service.js";
import { AuditService } from "../../src/audit/audit.service.js";
import type { Principal } from "../../src/auth/auth.types.js";

const explicitEphemeral = process.env.CRMY44_EPHEMERAL_TEST === "true";
test("CRMY-44 PostgreSQL: constraints, transaction rollback, concurrency, partial import and replay", { skip: !explicitEphemeral }, async () => {
  const url = new URL(process.env.DATABASE_URL ?? "");
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname)); assert.equal(url.pathname, "/crm_crmy44");
  const prisma = new PrismaService(); const client = prisma.client!;
  const repository = new ReferenceRepository(prisma); const service = new ReferenceService(repository, new PermissionService(new DefaultGrantProvider()));
  const marker = randomUUID().slice(0, 8).toUpperCase();
  const principal: Principal = { userId: randomUUID(), roles: ["SUPER_ADMIN"], scopes: [{ kind: "GLOBAL" }], sessionId: randomUUID() };
  try {
    const create = (kind: "CAMPUS" | "PROGRAM" | "CAMPAIGN" | "TAG", code: string): ReturnType<ReferenceService["create"]> => service.create({ kind, code, label: code, scope: "GLOBAL", campusId: null }, principal, `crmy44-${marker}`);
    const campus = await create("CAMPUS", `SYNTHETIC-${marker}`); const program = await create("PROGRAM", `B1-${marker}`); const campaign = await create("CAMPAIGN", `TEST-${marker}`);
    await service.availability(program.id, campus.id, true, 0, principal, "availability");
    const values = { campus: campus.code, program: program.code, campaign: campaign.code };
    assert.deepEqual(await repository.transaction((tx) => validateLeadReferences(tx, values)), values);
    const before = await client.crmReference.count();
    await assert.rejects(() => service.create({ kind: "TAG", code: `ROLLBACK-${marker}`, label: "Synthétique", scope: "GLOBAL", campusId: null }, { ...principal, userId: "x".repeat(65) }, "audit-rollback"));
    assert.equal(await client.crmReference.count(), before, "failed audit must roll back definition");
    const lead = await client.lead.create({ data: { ...values, leadCode: `SYNTHETIC-${marker}`, firstName: "Lead", lastName: "Synthétique", educationLevel: "BAC", source: "TEST" } });
    const tag = await create("TAG", `TAG-${marker}`);
    const mutations = await Promise.allSettled([1, 2].map((n) => service.assignTags(lead.id, { tagIds: [tag.id], expectedVersion: 1, idempotencyKey: `crmy44-${marker}-${n}` }, principal, `tag-${n}`)));
    assert.equal(mutations.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(await client.leadActivity.count({ where: { leadId: lead.id, type: "TAGS_CHANGED" } }), 1);
    assert.equal((await client.lead.findUniqueOrThrow({ where: { id: lead.id } })).version, 2);
    await service.update(tag.id, { state: "ARCHIVED", expectedVersion: 1 }, principal, "archive");
    assert.equal((await service.leadTags(lead.id, principal)).items[0]?.state, "ARCHIVED");
    const ingestion = new PersistentIngestionService(prisma, new AuditService());
    const input: ConfirmPersistentImportInput = { idempotencyKey: `crmy44-import-${marker}`, profile: "FORMINATOR_ZAPIER", confirmed: true, mappingId: "mapping-1234567890abcdef12345678", mappingVersion: 1, sourceFileSha256: "a".repeat(64), assignment: { strategy: "UNASSIGNED" }, records: [
      { ...values, lineNumber: 1, firstName: "Import", lastName: "Synthétique", email: `valid-${marker}@example.invalid`, educationLevel: "BAC", source: "WEB_FORM", technicalSystem: "CRMY44_SYNTHETIC", originalSource: "TEST", externalId: `valid-${marker}` },
      { ...values, program: "UNKNOWN", lineNumber: 2, firstName: "Import", lastName: "Synthétique", email: `review-${marker}@example.invalid`, educationLevel: "BAC", source: "WEB_FORM", technicalSystem: "CRMY44_SYNTHETIC", originalSource: "TEST", externalId: `review-${marker}` },
    ] };
    const imported = await ingestion.confirm(input, principal, "partial-import");
    assert.equal(imported.created, 1); assert.equal(imported.manualReview, 1);
    assert.equal((await ingestion.confirm(input, principal, "replay-import")).replayed, true);
    const rejections = await client.importRejection.findMany({ where: { reportId: imported.reportId } });
    assert.equal(rejections[0]?.reasonCode, "reference_value_unknown"); assert.equal(JSON.stringify(rejections).includes("@example.invalid"), false);
    const retry = { ...input, idempotencyKey: `crmy44-corrected-${marker}`, records: [{ ...input.records[1]!, program: program.code }] };
    assert.equal((await ingestion.confirm(retry, principal, "corrected-import")).created, 1);
    assert.equal((await ingestion.confirm(retry, principal, "corrected-replay")).replayed, true);
    const legacyLead = await client.lead.create({ data: { ...values, program: `Historical ${marker} `, leadCode: `LEGACY-${marker}`, firstName: "Legacy", lastName: "Synthétique", educationLevel: "BAC", source: "TEST" } });
    await service.captureLegacy(principal, "legacy-inventory");
    assert.equal((await client.lead.findUniqueOrThrow({ where: { id: legacyLead.id } })).program, `Historical ${marker} `);
    assert.ok(await client.crmReference.findFirst({ where: { label: `Historical ${marker} `, state: "LEGACY" } }));
  } finally { await prisma.onModuleDestroy(); }
});
