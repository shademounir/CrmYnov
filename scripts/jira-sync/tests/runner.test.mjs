import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "../config.mjs";
import { JiraHttpError } from "../jira-client.mjs";
import { runSync } from "../runner.mjs";

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
  };
}

function pullRequestPayload(overrides = {}) {
  return {
    action: "opened",
    pull_request: {
      draft: true,
      title: "feat(CRMY-900): synthetic change",
      body: "Synthetic fixture.",
      head: {
        ref: "feature/CRMY-900-synthetic-change",
        repo: { full_name: "example/crm-synthetic" },
      },
      base: { ref: "develop" },
      merged: false,
      ...overrides,
    },
  };
}

test("dry-run plans a transition without any POST mutation", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, method: options.method });
    return {
      ok: true,
      status: 200,
      json: async () => ({
        key: "CRMY-900",
        fields: {
          status: { name: "To Do" },
          labels: ["codex-ready"],
          issuetype: { name: "Task" },
          issuelinks: [],
        },
      }),
    };
  };
  const result = await runSync({
    eventName: "create",
    payload: branchPayload(),
    config: config({
      JIRA_BASE_URL: "https://jira.synthetic.invalid",
      JIRA_USER_EMAIL: "automation@synthetic.invalid",
      JIRA_API_TOKEN: "synthetic-credential",
    }),
    repository: "example/crm-synthetic",
    actor: "synthetic-maintainer",
    deliveryId: "delivery-1",
    fetchImpl,
  });

  assert.equal(result.decision, "transition");
  assert.equal(result.mutated, false);
  assert.deepEqual(calls.map((call) => call.method), ["GET"]);
});

test("duplicate delivery is idempotent", async () => {
  const store = new Set();
  const input = {
    eventName: "create",
    payload: branchPayload(),
    config: config(),
    repository: "example/crm-synthetic",
    actor: "synthetic-maintainer",
    deliveryId: "same-delivery",
    issueOverride: issue(),
    idempotencyStore: store,
  };
  const first = await runSync(input);
  const second = await runSync(input);
  assert.equal(first.decision, "transition");
  assert.equal(second.reason, "duplicate_event");
  assert.equal(second.mutated, false);
});

test("external fork is refused before Jira access", async () => {
  const result = await runSync({
    eventName: "pull_request",
    payload: pullRequestPayload({
      head: {
        ref: "feature/CRMY-900-external",
        repo: { full_name: "external/crm-fork" },
      },
    }),
    config: config(),
    repository: "example/crm-synthetic",
    actor: "synthetic-maintainer",
    deliveryId: "fork-delivery",
    issueOverride: issue(),
  });
  assert.equal(result.reason, "external_pull_request");
});

test("unauthorized actor is refused before Jira access", async () => {
  const result = await runSync({
    eventName: "create",
    payload: branchPayload(),
    config: config(),
    repository: "example/crm-synthetic",
    actor: "unknown-actor",
    deliveryId: "actor-delivery",
    issueOverride: issue(),
  });
  assert.equal(result.reason, "actor_not_allowed");
});

test("missing Jira credentials produces a safe no-op", async () => {
  const result = await runSync({
    eventName: "create",
    payload: branchPayload(),
    config: config(),
    repository: "example/crm-synthetic",
    actor: "synthetic-maintainer",
    deliveryId: "no-credentials",
  });
  assert.equal(result.reason, "jira_read_credentials_missing");
  assert.equal(result.mutated, false);
});

test("successful release produces a dry-run completion plan", async () => {
  const result = await runSync({
    eventName: "release",
    payload: {
      action: "published",
      ticketKey: "CRMY-900",
      release: { draft: false, tag_name: "v0.1.0" },
      releaseEvidence: {
        humanApproved: true,
        ciGreen: true,
        mergedToMain: true,
        tagCreated: true,
        releasePublished: true,
        listedInManifest: true,
      },
    },
    config: config(),
    repository: "example/crm-synthetic",
    actor: "synthetic-maintainer",
    deliveryId: "release-success",
    issueOverride: issue({ status: "In Review" }),
  });
  assert.equal(result.transition.id, "5");
  assert.equal(result.mutated, false);
});

test("failed release cannot produce a Done plan", async () => {
  const result = await runSync({
    eventName: "release",
    payload: {
      action: "published",
      ticketKey: "CRMY-900",
      release: { draft: false, tag_name: "v0.1.0" },
      releaseEvidence: {
        humanApproved: true,
        ciGreen: false,
        mergedToMain: true,
        tagCreated: true,
        releasePublished: true,
        listedInManifest: true,
      },
    },
    config: config(),
    repository: "example/crm-synthetic",
    actor: "synthetic-maintainer",
    deliveryId: "release-failure",
    issueOverride: issue({ status: "In Review" }),
  });
  assert.equal(result.reason, "release_evidence_incomplete");
  assert.equal(result.mutated, false);
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
        runSync({
          eventName: "create",
          payload: branchPayload(),
          config: config({
            JIRA_BASE_URL: "https://jira.synthetic.invalid",
            JIRA_USER_EMAIL: "automation@synthetic.invalid",
            JIRA_API_TOKEN: "synthetic-credential",
          }),
          repository: "example/crm-synthetic",
          actor: "synthetic-maintainer",
          deliveryId: `http-${status}`,
          fetchImpl,
        }),
      (error) => {
        assert.ok(error instanceof JiraHttpError);
        assert.equal(error.status, status);
        assert.ok(!error.message.includes("synthetic-credential"));
        return true;
      },
    );
  });
}
