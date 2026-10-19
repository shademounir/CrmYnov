import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { compilePostgresProof } from "./postgres-proof-runtime.mjs";

// Exercise the real production decorator metadata, including dashboard
// dependencies reached by the treatment/list consistency proof. tsx alone
// does not emit design:paramtypes and must not be used as an API substitute.
assert(!process.env.DATABASE_URL, "qualification_must_not_inherit_database");
const repository = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
assert.equal(resolve(process.cwd()), repository, "qualification_repository_cwd_required");
const proofRoot = resolve(process.env.RUNNER_TEMP ?? tmpdir());
mkdirSync(proofRoot, { recursive: true });
const proofDirectory = mkdtempSync(join(proofRoot, "crmy172-qualification-"));
const testSource = resolve(repository, "apps/api/test/lead-qualification-postgres.test.ts");
const { sourceHashes, sourcesBefore } = compilePostgresProof({ repository, proofDirectory, testSource,
  errorPrefix: "commercial-treatment", requireCommonJs: true, includeDatabaseBindings: true, metadataInputType: "commonjs",
  metadataProgram: `require('reflect-metadata');
    const assert = require('node:assert/strict');
    const { ManagerDashboardService } = require('./compiled/src/reporting/manager-dashboard.service.js');
    const names = Reflect.getMetadata('design:paramtypes', ManagerDashboardService)?.map(type => type.name);
    assert.deepEqual(names, ['CommercialFunnelService','CommercialPerformanceService','SourceEffectivenessService','OperationalRiskService','SharedContributionService','LeadService','AuditService','ReportingPersistenceService']);
    console.log(JSON.stringify({provider:'ManagerDashboardService',constructorTypes:names}));` });
const dockerPath = process.platform === "win32" ? "C:/Program Files/Docker/Docker/resources/bin" : "/usr/bin";
execFileSync(process.execPath, ["--test", "--test-concurrency=1", join(proofDirectory, "compiled/test/lead-qualification-postgres.test.js")], {
  cwd: resolve(repository, "apps/api"), env: { ...process.env, CRMY_QUALIFICATION_POSTGRES: "true", PATH: `${dockerPath}${delimiter}${process.env.PATH ?? ""}` },
  stdio: "inherit", windowsHide: true, timeout: 240_000,
});
assert.deepEqual(sourceHashes(), sourcesBefore, "qualification_test_source_changed");
console.log(JSON.stringify({ proof: "commercial-treatment-compiled-postgres", proofDirectory, realProviders: true,
  sharedDatabaseUsed: false, sourceMutation: false }));
