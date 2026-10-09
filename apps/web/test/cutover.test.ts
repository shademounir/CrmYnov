import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ManifestSummary } from "../app/imports/cutover/cutover-workspace.js";
import { CutoverApiError, cutoverAttempt, cutoverCan, cutoverFailure, cutoverFreezeAtT0, cutoverId, cutoverLocalInstant, cutoverRequest, cutoverUtc, cutoverZone, type CutoverManifest } from "../app/imports/cutover/cutover-client.js";

export const cutoverFixture: CutoverManifest = {
  id: "00000000-0000-4000-8000-000000000063", campusId: "00000000-0000-4000-8000-000000000061", state: "READY_FOR_CATCHUP", version: 4,
  contract: { bootstrapPackageId: "00000000-0000-4000-8000-000000000062", connectorId: "00000000-0000-4000-8000-000000000064", excelSha256: "a".repeat(64), configurationSha256: "b".repeat(64), t0: "2026-10-09T09:00:00.000Z", timeZone: "Africa/Casablanca", excelFrozenAt: "2026-10-09T09:00:00.000Z", originalArrivalColumn: "original_arrived_at", externalIdColumn: "submission_id", identityEvidenceSha256: "c".repeat(64), sourceSheetId: 0 },
  counts: { total: 2, excludedPreT0: 1, backlog: 1, sourceIssues: 0, overlapReview: 0, linkedBaseline: 0, keptForCatchup: 1 }, sourceCount: 2, headerSha256: "d".repeat(64), snapshotSha256: "e".repeat(64), observedAt: "2026-10-09T10:00:00.000Z", reportSha256: "f".repeat(64), suspensionReason: null,
  localT0: "Affichage fourni par le serveur", submissions: [{ key: "1".repeat(64), externalId: "SYNTHETIC-OLD", fingerprint: "2".repeat(64), originalArrivedAt: "2026-10-08T08:00:00.000Z", classification: "EXCLUDED_PRE_T0", issue: null, decision: null, targetBootstrapRowId: null }],
  automaticActivationAvailable: false, effectsApplied: false, limitations: ["SOURCE_IDENTITY_EVIDENCE_DECLARED_NOT_UPSTREAM_ATTESTED", "CATCHUP_CONSUMER_NOT_IMPLEMENTED", "LOCAL_ROW_NOT_SUPPORTED", "SHEETS_REMAINS_DISABLED"], bindingValid: true,
  capabilities: { canObserve: true, canDecide: true, canReconcile: true, canSuspend: true, canResume: false, canConsume: false, canCompensate: false },
};

test("cutover instants require exact UTC originals, never inferred dates, offsets or rollover", () => {
  for (const value of ["2026-10-09T09:00:00Z", "2026-10-09T09:00:00.000Z"]) assert.equal(cutoverUtc(value), true);
  for (const value of ["2026-10-09", "2026-10-09T09:00:00+01:00", "2026-02-30T09:00:00Z", " 2026-10-09T09:00:00Z", "2026-10-09T09:00Z"]) assert.equal(cutoverUtc(value), false);
  assert.equal(cutoverZone("Africa/Casablanca"), true); assert.equal(cutoverZone("fake/calendar"), false);
  assert.equal(cutoverLocalInstant("", "Africa/Casablanca"), "Instant ou fuseau à vérifier");
  assert.equal(cutoverLocalInstant("2026-10-09T09:00:00Z", "Africa/Casablanca"), new Intl.DateTimeFormat("fr-MA", { timeZone: "Africa/Casablanca", dateStyle: "medium", timeStyle: "long" }).format(new Date("2026-10-09T09:00:00Z")));
});
test("cutover uses UUID references, never a row position or traversable path", () => {
  assert.equal(cutoverId(cutoverFixture.id), cutoverFixture.id);
  for (const value of ["42", "../../private", "a/b", "", "fake-id"]) assert.equal(cutoverId(value), undefined);
});

test("first-lot freeze requires the same normalized UTC instant as T0, not a declared earlier window", () => {
  assert.equal(cutoverFreezeAtT0("2026-10-01T08:00:00Z", "2026-10-01T08:00:00.000Z"), true);
  assert.equal(cutoverFreezeAtT0("2026-10-01T08:00:00.000Z", "2026-10-01T08:00:00Z"), true);
  assert.equal(cutoverFreezeAtT0("2026-10-01T07:59:59Z", "2026-10-01T08:00:00Z"), false);
  assert.equal(cutoverFreezeAtT0("2026-10-01T08:00:00Z", "2026-10-01T08:00:00.001Z"), false);
  assert.equal(cutoverFreezeAtT0("2026-10-01T09:00:00+01:00", "2026-10-01T08:00:00Z"), false);
  assert.equal(cutoverFreezeAtT0("", ""), false);
});
test("each unchanged uncertain operation retains its key; changed decisions and separate operations do not", () => {
  const attempts = new Map<string, { payload: string; key: string }>(), body = { expectedVersion: 4, confirmed: true };
  const first = cutoverAttempt(attempts, "observe", body);
  assert.equal(cutoverAttempt(attempts, "observe", body), first);
  assert.notEqual(cutoverAttempt(attempts, "reconcile", body), first);
  assert.notEqual(cutoverAttempt(attempts, "observe", { ...body, expectedVersion: 5 }), first);
});
test("cutover never borrows nominal role or another campus grant, and stale binding disables every mutation", () => {
  assert.equal(cutoverCan(cutoverFixture, "canObserve"), true);
  assert.equal(cutoverCan(cutoverFixture, "canConsume"), false);
  const old = { ...cutoverFixture }; delete old.capabilities;
  assert.equal(cutoverCan(old, "canObserve"), false);
  assert.equal(cutoverCan({ ...cutoverFixture, bindingValid: false }, "canObserve"), false);
});
test("cutover transport is same-origin, no-store and does not expose returned private error text", async (t) => {
  let request: RequestInit | undefined;
  t.mock.method(globalThis, "fetch", (path: string | URL | Request, init?: RequestInit) => { assert.equal(path, "/api/crm/lead-import/cutover/manifests"); request = init; return Promise.resolve(Response.json({ id: cutoverFixture.id })); });
  assert.deepEqual(await cutoverRequest("/manifests", { idempotencyKey: "attempt" }), { id: cutoverFixture.id });
  assert.equal(request?.credentials, "same-origin"); assert.equal(request?.cache, "no-store"); assert.equal(request?.method, "POST");
});
test("cutover failures are honest, bounded and never leak unknown error messages", () => {
  assert.match(cutoverFailure(new CutoverApiError(401, "private-token")), /session a expiré/u);
  assert.match(cutoverFailure(new CutoverApiError(403, "private-token")), /périmètre/u);
  assert.match(cutoverFailure(new CutoverApiError(409, "cutover_producer_must_be_stopped")), /désactivé/u);
  assert.match(cutoverFailure(new CutoverApiError(409, "cutover_reconciliation_incomplete")), /incomplète/u);
  assert.match(cutoverFailure(new CutoverApiError(400, "cutover_freeze_delta_unqualified")), /snapshot final/u);
  assert.match(cutoverFailure(new CutoverApiError(409, "unknown")), /Relisez/u);
  assert.equal(cutoverFailure(new Error("secret-token")).includes("secret-token"), false);
});
test("ready preparation preserves limits, server timezone and no-Lead statement instead of claiming activation", () => {
  const html = renderToStaticMarkup(createElement(ManifestSummary, { manifest: cutoverFixture }));
  for (const text of ["aucune activation automatique", "Affichage fourni par le serveur", "ne constitue jamais une identité durable", "désactivé", "Aucun effet Lead", "pas à elle seule", "n’est ni une activation automatique"]) assert.ok(html.includes(text), text);
  assert.equal(html.includes("onclick"), false);
  const unsafe = renderToStaticMarkup(createElement(ManifestSummary, { manifest: { ...cutoverFixture, suspensionReason: "<script>private</script>" } }));
  assert.ok(unsafe.includes("&lt;script&gt;private&lt;/script&gt;")); assert.equal(unsafe.includes("<script>"), false);
});
test("cutover layout keeps minmax tracks, wrapped controls and visible focus at all five target widths", () => {
  const css = readFileSync(new URL("../app/imports/cutover/cutover.css", import.meta.url), "utf8");
  for (const rule of ["repeat(2, minmax(0, 1fr))", "repeat(3, minmax(0, 1fr))", "max-width: 1280px", "max-width: 1024px", "max-width: 768px", "max-width: 480px", ":focus-visible", "overflow-wrap: anywhere", "white-space: normal", "min-height: 44px"]) assert.ok(css.includes(rule), rule);
  assert.doesNotMatch(css, /overflow(?:-x)?:\s*hidden/u);
});

test("a preserved older manifest with an unqualified freeze window remains honest and readable", () => {
  const html = renderToStaticMarkup(createElement(ManifestSummary, { manifest: { ...cutoverFixture, contract: { ...cutoverFixture.contract, excelFrozenAt: "2026-10-08T09:00:00.000Z" } } }));
  assert.ok(html.includes("La fenêtre entre gel Excel et T0 n’est pas qualifiée"));
  assert.ok(html.includes("Le journal est conservé"));
  assert.ok(html.includes(cutoverFixture.id));
});
