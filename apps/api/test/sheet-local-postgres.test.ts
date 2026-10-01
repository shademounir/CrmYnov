import "reflect-metadata";
import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { PrismaService } from "../src/persistence/prisma.service.js";
import { localObservation, observeLocalRow, sheetStreamId, verifyLocalLedger } from "../src/sheet-import/sheet-local-ledger.js";

const options = { skip: process.env.CRMY171_EPHEMERAL_TEST !== "true", timeout: 30_000 };

function fixture(t: TestContext): { client: PrismaClient; other: PrismaClient; campusId: string; workbookId: string; connectorId: string; runId: string; streamId: string } {
  const url = new URL(process.env.DATABASE_URL ?? "");
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname));
  assert.equal(url.pathname, "/crmy171_synthetic");
  const first = new PrismaService(), second = new PrismaService();
  t.after(async (): Promise<void> => { await first.onModuleDestroy(); await second.onModuleDestroy(); });
  const client = first.client, other = second.client;
  assert.ok(client); assert.ok(other);
  const workbookId = `synthetic_local_${randomUUID()}`;
  return { client, other, campusId: randomUUID(), workbookId, connectorId: randomUUID(), runId: randomUUID(), streamId: sheetStreamId(workbookId, 7) };
}

test("CRMY-171 LOCAL_ROW PostgreSQL: distinct local identities, empty positions and replay survive another instance", options, async (t) => {
  const f = fixture(t);
  const observation = localObservation(f.workbookId, 7, "A1:B6", [["name", "email"], ["SYNTHETIC A", "synthetic-a@example.invalid"], [], ["SYNTHETIC A", "synthetic-a@example.invalid"]]);
  assert.equal(await f.client.$transaction((tx) => verifyLocalLedger(tx, f.campusId, f.connectorId, f.runId, "A1:B6", observation)), true);
  const original = await f.client.sheetLocalRow.findMany({ where: { streamId: f.streamId }, orderBy: { rowNumber: "asc" } });
  assert.deepEqual(original.map((row) => [row.rowNumber, row.status]), [[2, "PENDING"], [3, "EMPTY"], [4, "PENDING"]]);
  assert.equal(new Set(original.map((row) => row.id)).size, 3, "identical content at two positions does not collapse two local identities");
  assert.equal(original[0]?.fingerprint, original[2]?.fingerprint);
  assert.equal(await f.other.$transaction((tx) => verifyLocalLedger(tx, f.campusId, randomUUID(), randomUUID(), "A1:B6", observation)), true);
  for (const position of observation.positions) {
    const replay = await f.other.$transaction((tx) => observeLocalRow(tx, f.streamId, f.campusId, position.row, position.fingerprint, position.empty));
    assert.equal(replay.id, original.find((row) => row.rowNumber === position.row)?.id);
  }
  assert.equal(await f.client.sheetLocalRow.count({ where: { streamId: f.streamId } }), 3);
  assert.equal(await f.client.auditEvent.count({ where: { resourceId: f.connectorId } }), 0, "observation is not an effective assignment or ingestion audit");
  assert.doesNotMatch(JSON.stringify(original), /synthetic-a@example\.invalid|SYNTHETIC A/u, "ledger stores fingerprints, not raw contact data");
});

test("CRMY-171 LOCAL_ROW PostgreSQL: changes, reorder and disappearance suspend once without overwriting history", options, async (t) => {
  const f = fixture(t);
  const variants = [
    [["name", "email"], ["SYNTHETIC changed", "synthetic-a@example.invalid"], ["SYNTHETIC B", "synthetic-b@example.invalid"]],
    [["name", "email"], ["SYNTHETIC B", "synthetic-b@example.invalid"], ["SYNTHETIC A", "synthetic-a@example.invalid"]],
    [["name", "email"], ["SYNTHETIC A", "synthetic-a@example.invalid"]],
  ];
  for (const changed of variants) {
    const workbookId = `synthetic_changed_${randomUUID()}`, connectorId = randomUUID(), runId = randomUUID();
    const streamId = sheetStreamId(workbookId, 7);
    const baseline = localObservation(workbookId, 7, "A1:B6", [["name", "email"], ["SYNTHETIC A", "synthetic-a@example.invalid"], ["SYNTHETIC B", "synthetic-b@example.invalid"]]);
    await f.client.$transaction((tx) => verifyLocalLedger(tx, f.campusId, connectorId, runId, "A1:B6", baseline));
    const before = await f.client.sheetLocalRow.findMany({ where: { streamId }, orderBy: { rowNumber: "asc" } });
    const current = localObservation(workbookId, 7, "A1:B6", changed);
    assert.equal(await f.other.$transaction((tx) => verifyLocalLedger(tx, f.campusId, connectorId, runId, "A1:B6", current)), false);
    assert.equal(await f.client.$transaction((tx) => verifyLocalLedger(tx, f.campusId, connectorId, randomUUID(), "A1:B6", current)), false);
    assert.deepEqual(await f.client.sheetLocalRow.findMany({ where: { streamId }, orderBy: { rowNumber: "asc" } }), before);
    const stream = await f.client.sheetLocalStream.findUniqueOrThrow({ where: { id: streamId } });
    assert.equal(stream.suspended, true); assert.equal(stream.errorCode, "observed_row_changed");
    const audits = await f.client.auditEvent.findMany({ where: { resourceId: connectorId } });
    assert.equal(audits.length, 1); assert.equal(audits[0]?.eventType, "SHEET_RECONCILIATION_REQUIRED");
    assert.equal(audits[0]?.result, "FAILED"); assert.equal(audits[0]?.campusId, f.campusId);
    assert.equal(audits[0]?.correlationId, runId); assert.equal(audits[0]?.actorId, `SYSTEM:SHEETS:${connectorId}`);
    assert.doesNotMatch(JSON.stringify(audits), /synthetic-[ab]@example\.invalid|SYNTHETIC changed/u);
    const first = baseline.positions[0]; assert.ok(first);
    await assert.rejects(f.client.$transaction((tx) => observeLocalRow(tx, streamId, f.campusId, first.row, first.fingerprint, false)), /sheet_reconciliation_required/u);
  }
});

test("CRMY-171 LOCAL_ROW PostgreSQL: baseline and reconciliation audit roll back together", options, async (t) => {
  const f = fixture(t);
  const baseline = localObservation(f.workbookId, 7, "A1:B6", [["name", "email"], ["SYNTHETIC A", "synthetic-a@example.invalid"]]);
  await assert.rejects(f.client.$transaction(async (tx): Promise<void> => {
    assert.equal(await verifyLocalLedger(tx, f.campusId, f.connectorId, f.runId, "A1:B6", baseline), true);
    throw new Error("synthetic_transaction_failure");
  }), /synthetic_transaction_failure/u);
  assert.equal(await f.client.sheetLocalStream.count({ where: { id: f.streamId } }), 0);
  assert.equal(await f.client.sheetLocalRow.count({ where: { streamId: f.streamId } }), 0);
  await f.client.$transaction((tx) => verifyLocalLedger(tx, f.campusId, f.connectorId, f.runId, "A1:B6", baseline));
  const changed = localObservation(f.workbookId, 7, "A1:B6", [["name", "email"], ["SYNTHETIC B", "synthetic-b@example.invalid"]]);
  await assert.rejects(f.client.$transaction((tx) => verifyLocalLedger(tx, f.campusId, f.connectorId, "x".repeat(100), "A1:B6", changed)));
  assert.equal((await f.client.sheetLocalStream.findUniqueOrThrow({ where: { id: f.streamId } })).suspended, false, "audit constraint failure rolls back suspension");
  assert.equal(await f.client.auditEvent.count({ where: { resourceId: f.connectorId } }), 0);
  assert.equal(await f.client.$transaction((tx) => verifyLocalLedger(tx, f.campusId, f.connectorId, f.runId, "A1:B6", baseline)), true);
});

test("CRMY-171 LOCAL_ROW PostgreSQL: shared source cannot cross campus and concurrent clients keep one identity", options, async (t) => {
  const f = fixture(t);
  const observation = localObservation(f.workbookId, 7, "A1:B6", [["name", "email"], ["SYNTHETIC A", "synthetic-a@example.invalid"]]);
  const results = await Promise.all([f.client, f.other].map((client) => client.$transaction((tx) => verifyLocalLedger(tx, f.campusId, f.connectorId, f.runId, "A1:B6", observation))));
  assert.deepEqual(results, [true, true]);
  assert.equal(await f.client.sheetLocalStream.count({ where: { id: f.streamId } }), 1);
  assert.equal(await f.client.sheetLocalRow.count({ where: { streamId: f.streamId } }), 1);
  const position = observation.positions[0]; assert.ok(position);
  const rows = await Promise.all([f.client, f.other].map((client) => client.$transaction((tx) => observeLocalRow(tx, f.streamId, f.campusId, position.row, position.fingerprint, false))));
  assert.equal(rows[0]?.id, rows[1]?.id);
  const before = await f.client.sheetLocalStream.findUniqueOrThrow({ where: { id: f.streamId } });
  const outsideCampus = randomUUID();
  await assert.rejects(f.other.$transaction((tx) => verifyLocalLedger(tx, outsideCampus, randomUUID(), randomUUID(), "A1:B6", observation)), /sheet_source_scope_refused/u);
  await assert.rejects(f.other.$transaction((tx) => observeLocalRow(tx, f.streamId, outsideCampus, position.row, position.fingerprint, false)), /sheet_source_scope_refused/u);
  assert.deepEqual(await f.client.sheetLocalStream.findUniqueOrThrow({ where: { id: f.streamId } }), before);
  assert.equal(await f.client.sheetLocalRow.count({ where: { streamId: f.streamId } }), 1);
  assert.equal(await f.client.auditEvent.count({ where: { resourceId: f.connectorId } }), 0);
});
