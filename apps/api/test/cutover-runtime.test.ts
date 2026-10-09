import "reflect-metadata";
import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestException } from "@nestjs/common";
import { runSheetCutoverJob, type SheetCutoverJobDependencies } from "../src/jobs/sheet-cutover.js";
import { cutoverRuntimeError, cutoverWorkerEnabled } from "../src/cutover/cutover-runtime.service.js";
import { SyntheticSheetSource } from "../src/sheet-import/synthetic-sheet-source.js";
import type { SheetConfiguration } from "../src/sheet-import/sheet-import-configuration.js";
import { cutoverPaths, cutoverSchemas } from "../src/cutover/cutover.openapi.js";
type JobContext = Awaited<ReturnType<SheetCutoverJobDependencies["createContext"]>>;

test("cutover worker two literal opt-ins are OFF before context/credentials/DB/I/O", async () => {
  for (const environment of [{}, { SHEETS_ENABLED: "true" }, { SHEET_CUTOVER_ENABLED: "true" }, { SHEETS_ENABLED: "TRUE", SHEET_CUTOVER_ENABLED: "true" }]) {
    let calls = 0; const messages: string[] = [];
    await runSheetCutoverJob({ environment, createContext: () => { calls++; return Promise.reject(new Error("must_not_bootstrap")); }, write: (value) => messages.push(value) });
    assert.equal(calls, 0); assert.equal(JSON.parse(messages[0]!).skipped, "cutover_flags_off");
  }
  assert.equal(cutoverWorkerEnabled({ SHEETS_ENABLED: "true", SHEET_CUTOVER_ENABLED: "true" }), true);
});
test("cutover external job closes the context and does not claim CI success on failure", async () => {
  let closed = 0;
  await assert.rejects(() => runSheetCutoverJob({ environment: { SHEETS_ENABLED: "true", SHEET_CUTOVER_ENABLED: "true", CRM_BACKGROUND_WORKERS: "external" },
    createContext: () => Promise.resolve({ get: (): ReturnType<JobContext["get"]> => ({ tick: (): Promise<unknown> => Promise.reject(new Error("fixture_failure")) }), close: (): Promise<void> => { closed++; return Promise.resolve(); } }), write: () => {} }), /fixture_failure/u);
  assert.equal(closed, 1);
  await assert.rejects(() => runSheetCutoverJob({ environment: { SHEETS_ENABLED: "true", SHEET_CUTOVER_ENABLED: "true" }, createContext: () => Promise.reject(new Error("must_not_bootstrap")), write: () => {} }), /cutover_external_worker_required/u);
});
test("runtime errors and source contracts cannot disclose private exception text or attest Google", () => {
  assert.equal(cutoverRuntimeError(new Error("private://credentials")), "cutover_runtime_operation_failed");
  assert.equal(cutoverRuntimeError(new BadRequestException({ code: "cutover_source_headers_changed" })), "cutover_source_headers_changed");
  assert.equal(new SyntheticSheetSource().cutoverFixtureArtifact({ source: { mode: "GOOGLE", identityMode: "EXTERNAL_ID" } } as SheetConfiguration), undefined);
});
test("scheduled FAILED or BLOCKED produces a failed job, not a successful Cloud execution", async () => {
  for (const status of ["FAILED", "BLOCKED"]) {
    const messages: string[] = []; let closed = false;
    await assert.rejects(() => runSheetCutoverJob({ environment: { SHEETS_ENABLED: "true", SHEET_CUTOVER_ENABLED: "true", CRM_BACKGROUND_WORKERS: "external" },
      createContext: () => Promise.resolve({ get: (): ReturnType<JobContext["get"]> => ({ tick: (): Promise<unknown> => Promise.resolve({ runs: [{ status, code: "cutover_runtime_authority_revoked" }] }) }), close: (): Promise<void> => { closed = true; return Promise.resolve(); } }), write: (message) => messages.push(message) }),
      (error: unknown) => error instanceof Error && cutoverRuntimeError(error) === "cutover_runs_incomplete");
    assert.equal(closed, true); assert.equal(JSON.parse(messages[0]!).completed, false);
  }
});
test("OpenAPI distinguishes preparation, manifest/runtime versions and synthetic-only arm", () => {
  const base = "/lead-import/cutover/manifests/{id}/runtime";
  for (const suffix of ["", "/qualify", "/arm", "/disarm"]) assert.ok(Object.hasOwn(cutoverPaths, `${base}${suffix}`));
  assert.match(cutoverSchemas.CutoverRuntimeQualification.properties.expectedVersion.description, /manifest version, not runtime/u);
  assert.match(cutoverSchemas.CutoverRuntimeArm.properties.expectedVersion.description, /runtime version, not manifest/u);
  assert.equal(cutoverSchemas.CutoverRuntimeArm.properties.confirmed.const, true);
  assert.match(cutoverSchemas.CutoverRuntimeQualification.description, /client hash\/boolean cannot qualify Google/u);
  assert.match(cutoverSchemas.CutoverRuntimeArm.description, /SHEETS_ENABLED and SHEET_CUTOVER_ENABLED/u);
  assert.match(cutoverPaths["/lead-import/cutover/manifests/{id}/consume"].post.responses["201"].description, /nonce-isolated synthetic worker/u);
});
