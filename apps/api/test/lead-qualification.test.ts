import "reflect-metadata";
/* eslint-disable @typescript-eslint/explicit-function-return-type, @typescript-eslint/require-await -- compact in-memory Prisma transaction double */
import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaService } from "../src/persistence/prisma.service.js";
import { LeadQualificationService, leadTemperatureLabels, normalizeQualificationInput } from "../src/qualification/lead-qualification.service.js";

const leadId = "00000000-0000-4000-8000-000000000171";
const principal = { userId: "synthetic-adviser", roles: ["ADMISSIONS"], scopes: [{ kind: "CAMPUS", id: "SYNTHETIC" }], sessionId: "00000000-0000-4000-8000-000000000172" } as const;
type Row = { id: string; leadId: string; temperature: string; reason: string; comment: string | null; authorId: string; version: number; idempotencyKey: string; fingerprint: string; createdAt: Date };

function database(): { service: LeadQualificationService; rows: Row[]; audits: unknown[]; failAudit: () => void } {
  const rows: Row[] = [];
  const audits: unknown[] = [];
  let auditFailure = false;
  let sequence = 0;
  const createTx = (workingRows: Row[], workingAudits: unknown[]) => ({
    lead: { findUnique: async ({ where }: { where: { id: string } }) => where.id === leadId ? { campus: "SYNTHETIC" } : null },
    leadCommercialQualification: {
      findUnique: async ({ where }: { where: { idempotencyKey: string } }) => workingRows.find((row) => row.idempotencyKey === where.idempotencyKey) ?? null,
      findFirst: async ({ where }: { where: { leadId: string } }) => [...workingRows].filter((row) => row.leadId === where.leadId).sort((a, b) => b.version - a.version)[0] ?? null,
      findMany: async ({ where }: { where: { leadId: string } }) => [...workingRows].filter((row) => row.leadId === where.leadId).sort((a, b) => b.version - a.version),
      create: async ({ data }: { data: Omit<Row, "id" | "createdAt"> }) => {
        if (workingRows.some((row) => row.idempotencyKey === data.idempotencyKey || row.leadId === data.leadId && row.version === data.version)) throw Object.assign(new Error("unique"), { code: "P2002" });
        const row = { ...data, id: `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`, createdAt: new Date("2026-09-10T10:00:00.000Z") };
        workingRows.push(row); return row;
      },
    },
    auditEvent: { create: async ({ data }: { data: unknown }) => { if (auditFailure) throw new Error("audit_failure"); workingAudits.push(data); return data; } },
  });
  const client = {
    leadCommercialQualification: {
      findMany: async ({ where }: { where: { leadId: string } }) => [...rows].filter((row) => row.leadId === where.leadId).sort((a, b) => b.version - a.version),
      findUnique: async ({ where }: { where: { idempotencyKey: string } }) => rows.find((row) => row.idempotencyKey === where.idempotencyKey) ?? null,
    },
    $transaction: async (action: (tx: ReturnType<typeof createTx>) => Promise<unknown>) => {
      const workingRows = rows.map((row) => ({ ...row })); const workingAudits = [...audits];
      const result = await action(createTx(workingRows, workingAudits));
      rows.splice(0, rows.length, ...workingRows); audits.splice(0, audits.length, ...workingAudits);
      return result;
    },
  };
  return { service: new LeadQualificationService({ client } as unknown as PrismaService), rows, audits, failAudit: (): void => { auditFailure = true; } };
}

test("commercial temperatures keep the approved manual vocabulary", () => {
  assert.deepEqual(leadTemperatureLabels, { UNEVALUATED: "Non évalué", COLD: "Froid", WARM: "Tiède", HOT: "Chaud" });
  assert.deepEqual(normalizeQualificationInput({ temperature: "WARM", reason: " Projet à préciser ", comment: " Rentrée synthétique ", expectedVersion: 0, idempotencyKey: "qualification:one" }), { temperature: "WARM", reason: "Projet à préciser", comment: "Rentrée synthétique", expectedVersion: 0, idempotencyKey: "qualification:one" });
  for (const input of [
    { temperature: "UNEVALUATED", reason: "motif", expectedVersion: 0, idempotencyKey: "qualification:one" },
    { temperature: "COLD", reason: " ", expectedVersion: 0, idempotencyKey: "qualification:one" },
    { temperature: "HOT", reason: "motif", expectedVersion: -1, idempotencyKey: "qualification:one" },
    { temperature: "HOT", reason: "motif", expectedVersion: 0, idempotencyKey: "short" },
    { temperature: "HOT", reason: "motif", expectedVersion: 0, idempotencyKey: "qualification:one", status: "QUALIFIED" },
  ]) assert.throws(() => normalizeQualificationInput(input as never));
});

test("qualification is append-only, versioned and exact replay does not append audit", async () => {
  const db = database();
  assert.deepEqual(await db.service.read(leadId), { current: { leadId, temperature: "UNEVALUATED", temperatureLabel: "Non évalué", version: 0 }, history: [] });
  const input = { temperature: "HOT", reason: "Rentrée identifiée et rendez-vous daté", comment: "Contexte synthétique", expectedVersion: 0, idempotencyKey: "qualification:replay" };
  const first = await db.service.update(leadId, input, principal as never, "corr-one");
  const replay = await db.service.update(leadId, input, principal as never, "corr-two");
  assert.deepEqual(replay, first); assert.equal(db.rows.length, 1); assert.equal(db.audits.length, 1);
  const audit = JSON.stringify(db.audits[0]);
  assert.match(audit, /LEAD_QUALIFICATION_UPDATED/);
  assert.doesNotMatch(audit, /Rentrée identifiée|Contexte synthétique/, "free-text qualification details must not leak into the audit payload");
  await assert.rejects(() => db.service.update(leadId, { ...input, reason: "Autre motif" }, principal as never, "corr-conflict"), /ConflictException|idempotency/i);
  await assert.rejects(() => db.service.update(leadId, { ...input, idempotencyKey: "qualification:stale" }, principal as never, "corr-stale"), /ConflictException|version/i);
  assert.equal(db.rows.length, 1); assert.equal(db.audits.length, 1);
});

test("audit failure rolls back the qualification", async () => {
  const db = database(); db.failAudit();
  await assert.rejects(() => db.service.update(leadId, { temperature: "COLD", reason: "Projet sans échéance", expectedVersion: 0, idempotencyKey: "qualification:rollback" }, principal as never, "corr-rollback"), /audit_failure/);
  assert.equal(db.rows.length, 0); assert.equal(db.audits.length, 0);
});
