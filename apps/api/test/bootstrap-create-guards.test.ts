import "reflect-metadata";
import assert from "node:assert/strict";
import test from "node:test";
import { UnprocessableEntityException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { PermissionTransaction } from "../src/permissions/dynamic-repository.js";
import { historicalStatusResolutionReason, normalizeHistoricalEmail, normalizeHistoricalPhone, requireExplicitHistoricalStatus, requireNoHistoricalContactCollision, MAX_CONTACT_SCOPE_ROWS } from "../src/bootstrap-import/bootstrap-create-guards.js";
import { mapHistoricalRow } from "../src/bootstrap-import/bootstrap-import.service.js";
import type { HistoricalSheetMapping } from "../src/bootstrap-import/bootstrap-import.contract.js";

const mapping: HistoricalSheetMapping = { name: "VISITES ET APPELS", campaign: "SYNTHETIC", fields: { status: "A" }, commentColumns: [], ownerAliases: {} };

test("historical blank and milestone statuses require an explicit motivated override; raw evidence survives", () => {
  for (const status of [null, "", "  ", "À qualifier", "RDV planifié", "RDV effectué", "Dossier ouvert"]) {
    const mapped = mapHistoricalRow({ rowNumber: 9, cells: { A: { value: status, raw: status, type: "inlineStr" } } }, mapping);
    assert.equal(mapped.values.status, null); assert.equal(mapped.rawStatus, status);
    const code = status?.trim() ? "HISTORICAL_MILESTONE_STATUS_REVIEW" : "STATUS_MISSING_REVIEW";
    assert.ok(mapped.reasons.includes(code));
    assert.throws(() => requireExplicitHistoricalStatus(mapped.reasons, { reason: "Décision documentée" }), (error: unknown) => {
      assert.ok(error instanceof UnprocessableEntityException); assert.deepEqual(error.getResponse(), { code: "bootstrap_status_explicit_resolution_required" }); return true;
    });
    assert.throws(() => requireExplicitHistoricalStatus(mapped.reasons, { reason: "court", overrides: { status: "PROSPECT" } }));
    assert.doesNotThrow(() => requireExplicitHistoricalStatus(mapped.reasons, { reason: "Qualification explicite sans déduction de jalon", overrides: { status: "PROSPECT" } }));
  }
});

test("legacy mapped payload without new reason codes still requires precommit source-status resolution", () => {
  for (const rawStatus of [null, "", "RDV planifié", "Dossier ouvert"]) {
    assert.ok(historicalStatusResolutionReason(rawStatus));
    assert.throws(() => requireExplicitHistoricalStatus([], { reason: "Ancienne décision M3 sans résolution du statut" }, rawStatus));
    assert.doesNotThrow(() => requireExplicitHistoricalStatus([], { reason: "Nouvelle résolution explicite précommit", overrides: { status: "PROSPECT" } }, rawStatus));
  }
  assert.equal(historicalStatusResolutionReason("Contacté"), null);
  assert.doesNotThrow(() => requireExplicitHistoricalStatus([], { reason: "État explicite existant" }, "Contacté"));
});

test("known, terminal, unknown and duplicate source states keep their separate guards", () => {
  const cases: Array<[string, string | null, string | null]> = [["À contacter", "PROSPECT", null], ["Contacté", "CONTACTED", null], ["Inscrit", "ENROLLED", "HISTORICAL_TERMINAL_STATUS_REVIEW"], ["Doublon", null, "HISTORICAL_DUPLICATE_STATUS_REVIEW"], ["État inconnu", null, "STATUS_UNKNOWN"]];
  for (const [raw, expected, reason] of cases) {
    const mapped = mapHistoricalRow({ rowNumber: 9, cells: { A: { value: raw, raw, type: "inlineStr" } } }, mapping);
    assert.equal(mapped.values.status, expected); assert.equal(mapped.rawStatus, raw);
    if (reason) assert.ok(mapped.reasons.includes(reason));
  }
});

test("contact equivalence keeps one formatted contact without invented country or concatenated extensions", () => {
  assert.equal(normalizeHistoricalEmail("  SYNTHETIC@Example.Invalid "), "synthetic@example.invalid");
  for (const email of ["two@example.invalid;second@example.invalid", "bad address@example.invalid", "missing-at", "a".repeat(65) + "@example.invalid"]) assert.equal(normalizeHistoricalEmail(email), null);
  assert.equal(normalizeHistoricalPhone(" +212 (6) 12.34-56 78 "), "+212612345678");
  assert.equal(normalizeHistoricalPhone("06 12 34 56 78"), "0612345678");
  for (const phone of ["06 12 34 56 78 / 1234", "0612345678;0612345679", "0612345678 ext123", "++212612345678", "1234567"]) assert.equal(normalizeHistoricalPhone(phone), null);
  assert.notEqual(normalizeHistoricalPhone("0612345678"), normalizeHistoricalPhone("+212612345678"));
});

test("collision query is scoped, parameterized, bounded and never selects a matching lead ID", async () => {
  let captured: Prisma.Sql | undefined;
  const tx = { $queryRaw: (query: Prisma.Sql): Promise<Array<{ overflow: boolean; collision: boolean }>> => { captured = query; return Promise.resolve([{ overflow: false, collision: false }]); } } as unknown as PermissionTransaction;
  const input = { campusId: "11111111-1111-4111-8111-111111111111", campusKeys: ["CAMPUS_SYNTHETIC"], rowId: "22222222-2222-4222-8222-222222222222", email: "parameter@example.invalid' OR true --", phone: "0612345678" };
  await requireNoHistoricalContactCollision(tx, input);
  assert.ok(captured); assert.ok(captured.values.includes(input.email)); assert.ok(!captured.text.includes(input.email));
  assert.ok(captured.text.includes("AS MATERIALIZED")); assert.ok(captured.text.includes("r.state = 'READY'")); assert.ok(captured.text.includes("CREATE_DOSSIER"));
  assert.ok(captured.values.includes(MAX_CONTACT_SCOPE_ROWS + 1)); assert.ok(!captured.text.includes("SELECT id")); assert.ok(!captured.text.includes("retired"));
});

test("collision or incomplete search refuses generically, not as an invented automatic merge", async () => {
  for (const result of [undefined, { overflow: true, collision: false }, { overflow: false, collision: true }]) {
    const tx = { $queryRaw: (): Promise<unknown[]> => Promise.resolve(result ? [result] : []) } as unknown as PermissionTransaction;
    await assert.rejects(() => requireNoHistoricalContactCollision(tx, { campusId: "11111111-1111-4111-8111-111111111111", campusKeys: ["SYNTHETIC"], rowId: "22222222-2222-4222-8222-222222222222", email: "synthetic@example.invalid", phone: null }), (error: unknown) => {
      assert.ok(error instanceof UnprocessableEntityException); const response = error.getResponse(); assert.ok(response && typeof response === "object" && "code" in response);
      assert.match(String(response.code), /^bootstrap_contact_(?:scope_review|reconciliation)_required$/); assert.ok(!JSON.stringify(response).includes("11111111")); return true;
    });
  }
});
