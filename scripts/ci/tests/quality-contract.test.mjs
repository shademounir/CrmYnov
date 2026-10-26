import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflowUrl = new URL("../../../.github/workflows/application-quality.yml", import.meta.url);
const packageUrl = new URL("../../../package.json", import.meta.url);
const sonarUrl = new URL("../../../sonar-project.properties", import.meta.url);

test("application quality workflow is least-privileged and aggregates every gate", async () => {
  const workflow = await readFile(workflowUrl, "utf8");
  for (const job of [
    "lint", "type-check", "unit-tests", "integration-tests", "playwright", "build", "dependency-review",
    "sbom", "secret-scan", "container-scan", "trivy-iac", "codeql", "sonarcloud",
  ]) assert.match(workflow, new RegExp(`\\b${job}:`));
  assert.match(workflow, /quality-gate:/);
  assert.match(workflow, /if: always\(\)/);
  assert.match(workflow, /contents: read/);
  assert.doesNotMatch(workflow, /pull_request_target/);
  assert.doesNotMatch(workflow, /persist-credentials:\s*true/);
  assert.doesNotMatch(workflow, /terraform\s+(?:plan|apply|destroy|import)/i);
  assert.doesNotMatch(workflow, /gcloud\s/i);
});

test("Playwright uses locked synthetic dependencies and read-only failure evidence", async () => {
  const workflow = await readFile(workflowUrl, "utf8");
  const job = workflow.match(/\n  playwright:[\s\S]+?(?=\n  build:)/)?.[0] ?? "";
  assert.match(job, /needs: trusted-source/);
  assert.match(job, /npm ci --ignore-scripts/);
  assert.match(
    job,
    /npm exec --workspace=@crm\/web -- playwright install --with-deps chromium/,
  );
  assert.match(job, /npm run test:e2e:browser --workspace=@crm\/web/);
  assert.match(job, /if: failure\(\)[\s\S]+retention-days: 3/);
  assert.match(workflow, /quality-gate:[\s\S]+needs:[\s\S]+- playwright/);
  assert.doesNotMatch(job, /secrets\.|pull_request_target|contents: write|persist-credentials:\s*true/);
});

test("Sonar gate fails closed and consumes only named repository configuration", async () => {
  const workflow = await readFile(workflowUrl, "utf8");
  assert.match(workflow, /vars\.SONAR_ORGANIZATION/);
  assert.match(workflow, /vars\.SONAR_PROJECT_KEY/);
  assert.match(workflow, /secrets\.SONAR_TOKEN/);
  assert.match(workflow, /SonarCloud configuration is incomplete/);
  assert.match(workflow, /npm run test:coverage[\s\S]+test -s coverage\/lcov\.info[\s\S]+Run SonarCloud analysis/);
  assert.doesNotMatch(workflow, /continue-on-error/);
  assert.doesNotMatch(workflow, /sonar\.organization\s*=\s*[^$\s]/);
  assert.doesNotMatch(workflow, /sonar\.projectKey\s*=\s*[^$\s]/);
});

test("successful PR browser runs retain only source-bound synthetic telephony PNG evidence", async () => {
  const workflow = await readFile(workflowUrl, "utf8");
  const job = workflow.match(/\n  playwright:[\s\S]+?(?=\n  build:)/)?.[0] ?? "";
  const evidence = job.match(/      - name: Preserve synthetic telephony visual evidence[\s\S]+?(?=      - name: Upload failure traces)/)?.[0] ?? "";
  assert.match(evidence, /if: success\(\) && github\.event_name == 'pull_request'/);
  assert.match(evidence, /uses: actions\/upload-artifact@65c4c4a1ddee5b72f698fdd19549f0f0fb45cf08/);
  assert.match(evidence, /name: telephony-visual-\$\{\{ github\.event\.pull_request\.number \}\}-\$\{\{ github\.event\.pull_request\.head\.sha \}\}/);
  assert.match(evidence, /path: apps\/web\/test-results\/\*\*\/telephony-global-\*\.png\r?\n/);
  assert.match(evidence, /if-no-files-found: error/);
  assert.match(evidence, /retention-days: 3/);
  assert.doesNotMatch(evidence, /secrets\.|permissions:|continue-on-error|\.zip|\.env/);
  assert.match(job, /Upload failure traces[^\n]*\r?\n\s+if: failure\(\)/);
});

test("coverage is reproducible, fail-closed, and imported by Sonar", async () => {
  const pkg = JSON.parse(await readFile(packageUrl, "utf8"));
  const sonar = await readFile(sonarUrl, "utf8");
  assert.match(pkg.scripts["test:coverage"], /^c8 .*--reporter=lcov node scripts\/ci\/coverage-runner\.mjs$/);
  const runner = await readFile(new URL("../coverage-runner.mjs", import.meta.url), "utf8");
  assert.match(runner, /npm\(\["test"\]\)/, "canonical coverage still runs the complete official test suite");
  assert.match(runner, /await postgresProofs\(\)/, "PostgreSQL execution participates in the same native counters");
  assert.match(runner, /leadWorkflowPostgresProofs\(\)/, "Lead workflow PostgreSQL proofs participate in the same native counters");
  assert.equal(pkg.devDependencies.c8, "10.1.3");
  assert.match(sonar, /^sonar\.javascript\.lcov\.reportPaths=coverage\/lcov\.info$/m);
  assert.doesNotMatch(sonar, /container-readiness/);
});

test("CodeQL uses the only justified write permission and rejects forks before checkout", async () => {
  const workflow = await readFile(workflowUrl, "utf8");
  const codeqlJob = workflow.match(/\n  codeql:[\s\S]+?(?=\n  sonarcloud:)/)?.[0] ?? "";
  assert.match(workflow, /security-events: write/);
  assert.match(workflow, /trusted-source:[\s\S]+Refuse forks[\s\S]+codeql:[\s\S]+needs: trusted-source/);
  assert.match(codeqlJob, /persist-credentials: false/);
  assert.doesNotMatch(codeqlJob, /secrets\./);
  assert.doesNotMatch(workflow, /pull_request_target/);
});

test("root package exposes every executable quality command", async () => {
  const pkg = JSON.parse(await readFile(packageUrl, "utf8"));
  for (const name of ["lint", "type-check", "test:unit", "test:integration", "test:e2e", "build"]) {
    assert.equal(typeof pkg.scripts[name], "string", `${name} is required`);
  }
});
