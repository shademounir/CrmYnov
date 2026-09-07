import "reflect-metadata";
import assert from "node:assert/strict";
import test from "node:test";
import { createHash, randomUUID } from "node:crypto";
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { PrismaService } from "../src/persistence/prisma.service.js";
import { SheetImportAdminService } from "../src/sheet-import/sheet-import-admin.service.js";
import { DynamicPermissionRepository } from "../src/permissions/dynamic-repository.js";
import { currentPrincipal } from "../src/permissions/dynamic-context.js";
import { AuditService } from "../src/audit/audit.service.js";
import { ImportMappingService } from "../src/import-mapping/import-mapping.service.js";
import { IngestionService } from "../src/ingestion/ingestion.service.js";
import { LeadService } from "../src/leads/lead.service.js";
import { AssignmentService } from "../src/assignment/assignment.service.js";
import { LeadAssignmentService } from "../src/assignment/lead-assignment.service.js";
import { referenceKey } from "../src/references/reference.contract.js";
import { localObservation, sheetStreamId } from "../src/sheet-import/sheet-local-ledger.js";
import type { SheetSource } from "../src/sheet-import/synthetic-sheet-source.js";
import type { SheetValues } from "../src/sheet-import/google-sheets-adapter.js";
import { readSheetConfiguration } from "../src/sheet-import/sheet-import-configuration.js";

test("LOCAL_ROW admin simulation PostgreSQL preserves ledger, detects reconciliation and rechecks authority/version after read", {
  skip: process.env.CRMY171_EPHEMERAL_TEST !== "true", timeout: 60_000,
}, async (t) => {
  const url = new URL(process.env.DATABASE_URL ?? "");
  assert.equal(url.hostname, "127.0.0.1"); assert.equal(url.pathname, "/crmy171_synthetic");
  const prisma = new PrismaService(); t.after(() => prisma.onModuleDestroy());
  const client = prisma.client; assert.ok(client);
  const marker = randomUUID().slice(0, 8);
  const refs = await Promise.all((["CAMPUS", "PROGRAM", "CAMPAIGN"] as const).map((kind) => {
    const code = `SYNTHETIC-SIM-${kind}-${marker}`;
    return client.crmReference.create({ data: { kind, code, label: code, scope: "GLOBAL", scopeKey: "GLOBAL",
      keys: { create: { kind, scopeKey: "GLOBAL", key: referenceKey(code) } } } });
  }));
  const [campus, program, campaign] = refs; assert.ok(campus); assert.ok(program); assert.ok(campaign);
  await client.crmProgramAvailability.create({ data: { campusId: campus.id, programId: program.id } });
  const author = await client.collaborator.create({ data: { professionalEmail: `synthetic-sim-${marker}@example.invalid`, roles: ["ADMIN"], campusId: campus.id, firstLoginRequired: false } });
  const sessionId = randomUUID();
  await client.localSession.create({ data: { id: sessionId, collaboratorId: author.id, roles: ["ADMIN"], scopes: [{ kind: "CAMPUS", id: campus.id }],
    tokenDigest: createHash("sha256").update(sessionId).digest("hex"), authenticationVersion: author.authenticationVersion, expiresAt: new Date(Date.now() + 3_600_000) } });
  const actor = await client.$transaction((tx) => currentPrincipal(tx, { userId: author.id, roles: [], scopes: [], sessionId }));
  const audit = new AuditService(), leads = new LeadService(audit);
  const mappings = new ImportMappingService(new IngestionService(leads, new LeadAssignmentService(leads, new AssignmentService(audit), audit), audit), audit);
  const columns = ["First", "Last", "Email", "Campus", "Program", "Education", "Campaign"];
  const row = ["Synthetic", "Example", `synthetic-sim-lead-${marker}@example.invalid`, campus.code, program.code, "BAC", campaign.code];
  let raw = [columns, row];
  let onRead: (() => Promise<void>) | undefined;
  const source: SheetSource = { read: async (): Promise<SheetValues> => {
    await onRead?.();
    return { columns: raw[0] ?? [], rows: [], observation: { sheetId: 0, range: "A1:G6", values: raw } };
  } };
  const service = new SheetImportAdminService(new DynamicPermissionRepository(prisma), mappings, source);
  const mapping = mappings.snapshot({ mappingKey: `synthetic-sim-${marker}`, name: "Simulation synthétique", profile: "CUSTOM", expectedVersion: 0, columns: [
    { sourceColumn: "First", targetField: "firstName", action: "TRIM", required: true }, { sourceColumn: "Last", targetField: "lastName", action: "TRIM", required: true },
    { sourceColumn: "Email", targetField: "email", action: "LOWERCASE" }, { sourceColumn: "Campus", targetField: "campus", action: "TRIM", required: true },
    { sourceColumn: "Program", targetField: "program", action: "TRIM", required: true }, { sourceColumn: "Education", targetField: "educationLevel", action: "TRIM", required: true },
    { sourceColumn: "Campaign", targetField: "campaign", action: "TRIM", required: true },
  ] }, author.id, new Date().toISOString());
  const connector = await client.sheetImportConnector.create({ data: { campusId: campus.id, workbookId: `synthetic_sim_${marker}`, tab: "Synthétique", updatedBy: author.id, enabled: false,
    configuration: { mapping: { ...mapping, columns: mapping.columns.map((column) => ({ ...column })) }, assignment: { strategy: "UNASSIGNED" },
      source: { mode: "SIMULATED", identityMode: "LOCAL_ROW", sheetId: 0, range: "A1:G6" },
      context: { source: "OTHER_CONTROLLED", technicalSystem: "GOOGLE_SHEETS_LOCAL", originalSource: "Synthetic origin", campus: campus.code, program: program.code, campaign: campaign.code, educationLevel: "BAC" } } } });
  const streamId = sheetStreamId(connector.workbookId, 0);
  const snapshot = async (): Promise<string> => {
    return JSON.stringify({ stream: await client.sheetLocalStream.findUnique({ where: { id: streamId } }), rows: await client.sheetLocalRow.findMany({ where: { streamId }, orderBy: { rowNumber: "asc" } }),
      audits: await client.auditEvent.count({ where: { resourceId: connector.id } }), leads: await client.lead.count({ where: { campus: campus.code } }),
      runs: await client.sheetImportRun.count({ where: { connectorId: connector.id } }), receipts: await client.sheetImportRunReceipt.count({ where: { run: { connectorId: connector.id } } }) });
  };
  const initial = await snapshot();
  assert.deepEqual(await service.simulate(actor, connector.id), { rows: 1, mapped: 1, review: 0, mutated: false, simulated: true, reconciliationRequired: false, reason: null });
  assert.equal(await snapshot(), initial, "first simulation must not establish a persisted baseline");
  raw = [columns, [...row.slice(0, 2), "", ...row.slice(3)]];
  const noContact = await service.simulate(actor, connector.id);
  assert.equal(noContact.mapped, 0); assert.equal(noContact.review, 1);
  assert.equal(await snapshot(), initial, "missing contact must remain reviewable without creating local identities or Leads");
  raw = [columns, [...row.slice(0, 4), "SYNTHETIC-UNKNOWN", ...row.slice(5)]];
  const unknown = await service.simulate(actor, connector.id);
  assert.equal(unknown.mapped, 0); assert.equal(unknown.review, 1); assert.equal(unknown.reconciliationRequired, false);
  assert.equal(await snapshot(), initial, "unknown reference becomes review, not a write or a success");
  raw = [columns, row];
  const observed = localObservation(connector.workbookId, 0, "A1:G6", raw);
  await client.sheetLocalStream.create({ data: { id: streamId, campusId: campus.id, workbookId: connector.workbookId, sheetId: 0, range: "A1:G6", headerFingerprint: observed.headerFingerprint, lastObservedRow: 2 } });
  await client.sheetLocalRow.createMany({ data: observed.positions.map((position) => ({ streamId, rowNumber: position.row, fingerprint: position.fingerprint, status: "PENDING" })) });
  const baseline = await snapshot();
  assert.equal((await service.simulate(actor, connector.id)).mapped, 1);
  assert.equal(await snapshot(), baseline);
  for (const changed of [[columns, ["Changed synthetic", ...row.slice(1)]], [columns], [["NewFirst", ...columns.slice(1)], row]]) {
    raw = changed;
    const result = await service.simulate(actor, connector.id);
    assert.equal(result.reconciliationRequired, true); assert.equal(result.mapped, 0); assert.equal(result.review, raw.length - 1);
    assert.equal(await snapshot(), baseline, "detected change must neither suspend persistently nor create an audit during simulation");
  }
  raw = [columns, row];
  await client.sheetLocalStream.update({ where: { id: streamId }, data: { suspended: true, errorCode: "observed_row_changed" } });
  const suspended = await snapshot();
  const refusal = await service.simulate(actor, connector.id);
  assert.equal(refusal.reconciliationRequired, true); assert.equal(refusal.reason, "observed_row_changed"); assert.equal(refusal.mapped, 0);
  assert.equal(await snapshot(), suspended);
  const saveInput = { ...readSheetConfiguration(connector.configuration), expectedVersion: 0, enabled: false, intervalMinutes: 15,
    workbookLink: `https://docs.google.com/spreadsheets/d/${connector.workbookId}/edit`, tab: `${connector.tab}-Revue`, campusId: campus.id };
  const saved = await service.save(actor, saveInput);
  assert.equal(saved.enabled, false, "disabled configuration may be retained for a suspended stream without enabling imports");
  await assert.rejects(service.save(actor, { ...saveInput, expectedVersion: saved.version, enabled: true }, saved.id), ConflictException);
  await assert.rejects(service.save(actor, { ...saveInput, enabled: true, source: { mode: "GOOGLE", identityMode: "LOCAL_ROW", sheetId: 0, range: "A1:G6" } }), BadRequestException);
  assert.equal(await snapshot(), suspended, "source and activation checks must not mutate the existing suspended stream");
  const otherCode = `SYNTHETIC-SIM-OTHER-${marker}`;
  const otherCampus = await client.crmReference.create({ data: { kind: "CAMPUS", code: otherCode, label: otherCode, scope: "GLOBAL", scopeKey: "GLOBAL",
    keys: { create: { kind: "CAMPUS", scopeKey: "GLOBAL", key: referenceKey(otherCode) } } } });
  await client.sheetLocalStream.update({ where: { id: streamId }, data: { campusId: otherCampus.id } });
  const foreignBaseline = await snapshot();
  await assert.rejects(service.simulate(actor, connector.id), NotFoundException);
  await assert.rejects(service.save(actor, { ...saveInput, expectedVersion: saved.version }, saved.id), ForbiddenException);
  assert.equal(await snapshot(), foreignBaseline, "foreign-campus ledger metadata is neither exposed nor changed");
  await client.sheetLocalStream.update({ where: { id: streamId }, data: { campusId: campus.id } });
  onRead = async (): Promise<void> => { await client.collaborator.update({ where: { id: author.id }, data: { campusId: otherCampus.id } }); };
  await assert.rejects(service.simulate(actor, connector.id), NotFoundException);
  await client.collaborator.update({ where: { id: author.id }, data: { campusId: campus.id } });
  onRead = async (): Promise<void> => { await client.sheetImportConnector.update({ where: { id: connector.id }, data: { version: { increment: 1 } } }); };
  await assert.rejects(service.simulate(actor, connector.id), ConflictException);
  onRead = (): Promise<void> => Promise.reject(new ServiceUnavailableException({ code: "synthetic_source_unavailable" }));
  await assert.rejects(service.simulate(actor, connector.id), ServiceUnavailableException);
  onRead = async (): Promise<void> => { await client.localSession.update({ where: { id: sessionId }, data: { active: false } }); };
  await assert.rejects(service.simulate(actor, connector.id), NotFoundException);
  assert.equal(await snapshot(), suspended, "permission revocation does not mutate the ledger or business records");
});
