import assert from "node:assert/strict";
import test from "node:test";
import {
  fetchAllCheckRuns,
  parseRequiredChecks,
  validateRequiredChecks,
} from "../checks.mjs";

const REQUIRED = [
  "unit-tests",
  "lint",
  "type-check",
  "build",
  "CodeQL",
  "dependency-review",
  "secret-scan",
  "IaC-scan",
  "container-scan",
  "SonarQube Quality Gate",
];

function successful(name, id = 1) {
  return {
    id,
    name,
    status: "completed",
    conclusion: "success",
    head_sha: "1111111111111111111111111111111111111111",
  };
}

test("empty required check variable is refused", () => {
  assert.throws(() => parseRequiredChecks("  , "), /explicit list/);
});

test("missing required check is refused", () => {
  assert.throws(
    () => validateRequiredChecks(REQUIRED, REQUIRED.slice(1).map(successful)),
    (error) => error.details.missing.includes("unit-tests"),
  );
});

test("failed required check is refused", () => {
  const runs = REQUIRED.map(successful);
  runs[0] = { ...runs[0], conclusion: "failure" };
  assert.throws(
    () => validateRequiredChecks(REQUIRED, runs),
    (error) => error.details.unsuccessful.includes("unit-tests"),
  );
});

test("cancelled required check is refused", () => {
  const runs = REQUIRED.map(successful);
  runs[0] = { ...runs[0], conclusion: "cancelled" };
  assert.throws(
    () => validateRequiredChecks(REQUIRED, runs),
    (error) => error.details.unsuccessful.includes("unit-tests"),
  );
});

test("pending required check is refused", () => {
  const runs = REQUIRED.map(successful);
  runs[0] = { ...runs[0], status: "in_progress", conclusion: null };
  assert.throws(
    () => validateRequiredChecks(REQUIRED, runs),
    (error) => error.details.incomplete.includes("unit-tests"),
  );
});

test("required check attached to a different SHA is refused", () => {
  const runs = REQUIRED.map(successful);
  runs[0] = {
    ...runs[0],
    head_sha: "2222222222222222222222222222222222222222",
  };
  assert.throws(
    () =>
      validateRequiredChecks(REQUIRED, runs, {
        expectedSha: "1111111111111111111111111111111111111111",
      }),
    (error) => error.details.wrongSha.includes("unit-tests"),
  );
});

test("all required successful checks are accepted", () => {
  const result = validateRequiredChecks(REQUIRED, REQUIRED.map(successful));
  assert.equal(result.successful, REQUIRED.length);
});

test("additional successful or failed check is non-blocking", () => {
  const result = validateRequiredChecks(REQUIRED, [
    ...REQUIRED.map(successful),
    { id: 200, name: "optional-check", status: "completed", conclusion: "failure" },
  ]);
  assert.equal(result.additionalChecks, 1);
});

test("check-runs pagination retrieves more than 30 and all following pages", async () => {
  const firstPage = Array.from({ length: 100 }, (_, index) =>
    successful(`check-${index + 1}`, index + 1),
  );
  const secondPage = Array.from({ length: 35 }, (_, index) =>
    successful(`check-${index + 101}`, index + 101),
  );
  const requestedUrls = [];
  const fetchImpl = async (url) => {
    requestedUrls.push(url);
    const page = Number(new URL(url).searchParams.get("page"));
    return {
      ok: true,
      status: 200,
      json: async () => ({
        total_count: 135,
        check_runs: page === 1 ? firstPage : secondPage,
      }),
    };
  };

  const runs = await fetchAllCheckRuns({
    repository: "example/crm-synthetic",
    commitSha: "1111111111111111111111111111111111111111",
    token: "synthetic-read-token",
    fetchImpl,
  });
  assert.equal(runs.length, 135);
  assert.equal(requestedUrls.length, 2);
  assert.ok(requestedUrls.every((url) => url.includes("per_page=100")));
});

test("incomplete pagination is refused", async () => {
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      total_count: 150,
      check_runs: [successful("only-one")],
    }),
  });
  await assert.rejects(
    () =>
      fetchAllCheckRuns({
        repository: "example/crm-synthetic",
        commitSha: "1111111111111111111111111111111111111111",
        token: "synthetic-read-token",
        fetchImpl,
      }),
    /pagination is incomplete/,
  );
});
