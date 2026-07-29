import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "../config.mjs";
import { JiraHttpError } from "../jira-client.mjs";
import { runSync } from "../runner.mjs";

const FIXED_DATE = new Date("2026-01-15T10:30:00.000Z");

function config(overrides = {}) {
  return loadConfig({
    JIRA_PROJECT_KEY: "CRMY",
    JIRA_SYNC_ENABLED: "false",
    JIRA_SYNC_DRY_RUN: "true",
    JIRA_SYNC_ALLOWED_ACTORS: "synthetic-maintainer",
    ...overrides,
  });
}

function issue(overrides = {}) {
  return {
    key: "CRMY-900",
    status: "To Do",
    labels: ["codex-ready", "synthetic"],
    issueType: "Task",
    blocked: false,
    ...overrides,
  };
}

function branchPayload() {
  return {
    ref_type: "branch",
    ref: "feature/CRMY-900-synthetic-change",
    after: "1111111111111111111111111111111111111111",
  };
}

function pullRequestPayload(overrides = {}) {
  return {
    action: "opened",
    number: 42,
    pull_request: {
      number: 42,
      draft: true,
      title: "feat(CRMY-900): synthetic change",
      body: "Synthetic fixture.",
      created_at: "2026-01-15T10:00:00Z",
      head: {
        ref: "feature/CRMY-900-synthetic-change",
        sha: "2222222222222222222222222222222222222222",
        repo: { full_name: "example/crm-synthetic" },
      },
      base: { ref: "develop" },
      merged: false,
      ...overrides,
    },
  };
}

function baseInput(overrides = {}) {
  return {
    eventName: "create",
    payload: branchPayload(),
    config: config(),
    repository: "example/crm-synthetic",
    actor: "synthetic-maintainer",
    actorPermission: "write",
    githubActionsRunId: "123456",
    now: () => FIXED_DATE,
    issueOverride: issue(),
    ...overrides,
  };
}

function response(status, body = null) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 404 ? "Not Found" : "Synthetic response",
    headers: { get: () => null },
    json: async () => body,
  };
}

function syntheticJiraServer({ status = "To Do" } = {}) {
  const records = new Map();
  const calls = [];
  const fetchImpl = async (url, options) => {
    const method = options.method;
    calls.push({ url, method, body: options.body ?? null });
    if (method === "GET" && url.includes("?fields=")) {
      return response(200, {
        key: "CRMY-900",
        fields: {
          status: { name: status },
          labels: ["codex-ready"],
          issuetype: { name: "Task" },
          issuelinks: [],
        },
      });
    }
    if (url.includes("/properties/")) {
      const propertyKey = decodeURIComponent(url.split("/properties/")[1]);
      if (method === "GET") {
        return records.has(propertyKey)
          ? response(200, { value: records.get(propertyKey) })
          : response(404);
      }
      if (method === "PUT") {
        records.set(propertyKey, JSON.parse(options.body));
        return response(204);
      }
    }
    if (method === "POST" && url.endsWith("/transitions")) {
      return response(204);
    }
    if (method === "POST" && url.endsWith("/comment")) {
      return response(201, { id: "synthetic-comment" });
    }
    throw new Error(`Unexpected synthetic request: ${method} ${url}`);
  };
  return { fetchImpl, records, calls };
}

test("dry-run plans transition and comment without POST or PUT", async () => {
  const server = syntheticJiraServer();
  const result = await runSync(
    baseInput({
      config: config({
        JIRA_BASE_URL: "https://jira.synthetic.invalid",
        JIRA_USER_EMAIL: "automation@synthetic.invalid",
        JIRA_API_TOKEN: "synthetic-credential",
      }),
      issueOverride: undefined,
      fetchImpl: server.fetchImpl,
    }),
  );

  assert.equal(result.decision, "transition");
  assert.equal(result.mutated, false);
  assert.equal(result.commentMutated, false);
  assert.equal(result.plannedComment.jiraKey, "CRMY-900");
  assert.deepEqual(
    server.calls.map((call) => call.method),
    ["GET", "GET"],
  );
});

test("dry-run simulates persistent key absence then presence across separate runs", async () => {
  const server = syntheticJiraServer();
  const dryRunConfig = config({
    JIRA_BASE_URL: "https://jira.synthetic.invalid",
    JIRA_USER_EMAIL: "automation@synthetic.invalid",
    JIRA_API_TOKEN: "synthetic-credential",
  });
  const first = await runSync(
    baseInput({
      config: dryRunConfig,
      issueOverride: undefined,
      fetchImpl: server.fetchImpl,
      githubActionsRunId: "100001",
    }),
  );
  server.records.set(`crmynov.sync.${first.idempotencyKey}`, {
    state: "completed",
  });
  const second = await runSync(
    baseInput({
      config: dryRunConfig,
      issueOverride: undefined,
      fetchImpl: server.fetchImpl,
      githubActionsRunId: "100002",
    }),
  );

  assert.equal(second.idempotencyKey, first.idempotencyKey);
  assert.equal(second.reason, "duplicate_event");
  assert.equal(second.mutated, false);
  assert.equal(
    server.calls.some((call) => ["POST", "PUT"].includes(call.method)),
    false,
  );
});

test("persistent Jira property prevents duplicate processing across separate runs", async () => {
  const server = syntheticJiraServer();
  const activeConfig = config({
    JIRA_BASE_URL: "https://jira.synthetic.invalid",
    JIRA_USER_EMAIL: "automation@synthetic.invalid",
    JIRA_API_TOKEN: "synthetic-credential",
    JIRA_SYNC_ENABLED: "true",
    JIRA_SYNC_DRY_RUN: "false",
  });
  const first = await runSync(
    baseInput({
      config: activeConfig,
      issueOverride: undefined,
      fetchImpl: server.fetchImpl,
    }),
  );
  const second = await runSync(
    baseInput({
      config: activeConfig,
      issueOverride: undefined,
      fetchImpl: server.fetchImpl,
    }),
  );

  assert.equal(first.mutated, true);
  assert.equal(second.reason, "duplicate_event");
  assert.equal(second.mutated, false);
  assert.equal(
    server.calls.filter((call) => call.url.endsWith("/transitions")).length,
    1,
  );
  assert.equal(
    server.calls.filter((call) => call.url.endsWith("/comment")).length,
    1,
  );
  assert.equal(server.records.size, 1);
  assert.equal([...server.records.values()][0].state, "completed");
});

test("validated no-op is commented only after persistence claim", async () => {
  const server = syntheticJiraServer({ status: "In Review" });
  const result = await runSync(
    baseInput({
      eventName: "pull_request",
      payload: {
        ...pullRequestPayload({
          draft: false,
          merged: true,
          merged_at: "2026-01-15T10:20:00Z",
        }),
        action: "closed",
      },
      config: config({
        JIRA_BASE_URL: "https://jira.synthetic.invalid",
        JIRA_USER_EMAIL: "automation@synthetic.invalid",
        JIRA_API_TOKEN: "synthetic-credential",
        JIRA_SYNC_ENABLED: "true",
        JIRA_SYNC_DRY_RUN: "false",
      }),
      issueOverride: undefined,
      fetchImpl: server.fetchImpl,
    }),
  );

  assert.equal(result.decision, "no_op");
  assert.equal(result.reason, "awaiting_validated_release");
  assert.equal(
    server.calls.filter((call) => call.url.endsWith("/transitions")).length,
    0,
  );
  assert.equal(
    server.calls.filter((call) => call.url.endsWith("/comment")).length,
    1,
  );
});

test("external fork is refused before Jira access", async () => {
  let accessed = false;
  const result = await runSync(
    baseInput({
      eventName: "pull_request",
      payload: pullRequestPayload({
        head: {
          ref: "feature/CRMY-900-external",
          sha: "2222222222222222222222222222222222222222",
          repo: { full_name: "external/crm-fork" },
        },
      }),
      fetchImpl: async () => {
        accessed = true;
        throw new Error("Jira must not be accessed");
      },
    }),
  );
  assert.equal(result.reason, "external_pull_request");
  assert.equal(accessed, false);
});

test("actor absent from allowlist is refused", async () => {
  const result = await runSync(
    baseInput({ actor: "unknown-actor", actorPermission: "admin" }),
  );
  assert.equal(result.reason, "actor_not_allowed");
});

test("allowlisted actor without write permission is refused", async () => {
  const result = await runSync(baseInput({ actorPermission: "read" }));
  assert.equal(result.reason, "actor_write_permission_required");
});

test("missing Jira credentials produces sanitized plannedComment", async () => {
  const result = await runSync(
    baseInput({ issueOverride: undefined, config: config() }),
  );
  assert.equal(result.reason, "jira_read_credentials_missing");
  assert.equal(result.mutated, false);
  assert.deepEqual(result.plannedComment, {
    jiraKey: "CRMY-900",
    event: "work_branch_created",
    branch: "feature/CRMY-900-synthetic-change",
    sha: "1111111111111111111111111111111111111111",
    githubActionsRunId: "123456",
    dateUtc: "2026-01-15T10:30:00.000Z",
  });
});

test("successful release produces a dry-run completion plan", async () => {
  const result = await runSync(
    baseInput({
      eventName: "release",
      payload: {
        action: "published",
        ticketKey: "CRMY-900",
        release: {
          id: 700,
          draft: false,
          tag_name: "v0.1.0",
          published_at: "2026-01-15T10:25:00Z",
        },
        releaseCommit: "3333333333333333333333333333333333333333",
        releaseEvidence: {
          humanApproved: true,
          ciGreen: true,
          mergedToMain: true,
          tagCreated: true,
          releasePublished: true,
          listedInManifest: true,
        },
      },
      issueOverride: issue({ status: "In Review" }),
    }),
  );
  assert.equal(result.transition.id, "5");
  assert.equal(result.mutated, false);
  assert.equal(result.plannedComment.ciResult, "success");
});

test("failed release cannot produce a Done plan or comment mutation", async () => {
  const result = await runSync(
    baseInput({
      eventName: "release",
      payload: {
        action: "published",
        ticketKey: "CRMY-900",
        release: { id: 701, draft: false, tag_name: "v0.1.0" },
        releaseEvidence: {
          humanApproved: true,
          ciGreen: false,
          mergedToMain: true,
          tagCreated: true,
          releasePublished: true,
          listedInManifest: true,
        },
      },
      issueOverride: issue({ status: "In Review" }),
    }),
  );
  assert.equal(result.reason, "release_evidence_incomplete");
  assert.equal(result.mutated, false);
  assert.equal(result.commentMutated, undefined);
});

for (const status of [401, 403, 404, 429, 500, 503]) {
  test(`Jira HTTP ${status} is explicit and sanitized`, async () => {
    const fetchImpl = async () => ({
      ok: false,
      status,
      statusText: "Synthetic failure",
      headers: { get: () => (status === 429 ? "10" : null) },
      json: async () => ({ errorMessages: ["Synthetic Jira error"] }),
    });

    await assert.rejects(
      () =>
        runSync(
          baseInput({
            config: config({
              JIRA_BASE_URL: "https://jira.synthetic.invalid",
              JIRA_USER_EMAIL: "automation@synthetic.invalid",
              JIRA_API_TOKEN: "synthetic-credential",
            }),
            issueOverride: undefined,
            fetchImpl,
          }),
        ),
      (error) => {
        assert.ok(error instanceof JiraHttpError);
        assert.equal(error.status, status);
        assert.ok(!error.message.includes("synthetic-credential"));
        return true;
      },
    );
  });
}
