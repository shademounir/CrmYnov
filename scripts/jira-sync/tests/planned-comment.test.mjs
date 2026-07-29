import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPlannedComment,
  plannedCommentToAdf,
} from "../planned-comment.mjs";

const ALLOWED_KEYS = [
  "branch",
  "ciResult",
  "dateUtc",
  "event",
  "githubActionsRunId",
  "jiraKey",
  "pullRequestNumber",
  "pullRequestUrl",
  "releaseVersion",
  "sha",
].sort();

test("plannedComment contains only approved structured fields", () => {
  const comment = buildPlannedComment({
    issueKey: "CRMY-900",
    intent: "pr_ready",
    repository: "example/crm-synthetic",
    githubActionsRunId: "123456",
    now: () => new Date("2026-01-15T10:30:00Z"),
    payload: {
      action: "ready_for_review",
      number: 42,
      actor: { email: "ignored@synthetic.invalid" },
      pull_request: {
        number: 42,
        title: "Untrusted free text",
        body: ["gh", "p_abcdefghijklmnopqrstuvwxyz"].join(""),
        html_url: "https://malicious.invalid/untrusted",
        created_at: "2026-01-15T10:00:00Z",
        head: {
          ref: "feature/CRMY-900-synthetic-change",
          sha: "2222222222222222222222222222222222222222",
        },
      },
    },
  });

  assert.deepEqual(Object.keys(comment).sort(), [
    "branch",
    "dateUtc",
    "event",
    "githubActionsRunId",
    "jiraKey",
    "pullRequestNumber",
    "pullRequestUrl",
    "sha",
  ]);
  assert.ok(Object.keys(comment).every((key) => ALLOWED_KEYS.includes(key)));
  assert.equal(
    comment.pullRequestUrl,
    "https://github.com/example/crm-synthetic/pull/42",
  );
});

test("plannedComment excludes token, email, payload and free-form content", () => {
  const comment = buildPlannedComment({
    issueKey: "CRMY-900",
    intent: "pr_draft",
    repository: "example/crm-synthetic",
    githubActionsRunId: "123456",
    payload: {
      action: "opened",
      number: 42,
      token: "synthetic-secret-value",
      email: "ignored@synthetic.invalid",
      pull_request: {
        number: 42,
        title: "free-form title must not be copied",
        body: "free-form body must not be copied",
        head: {
          ref: "feature/CRMY-900-synthetic-change",
          sha: "2222222222222222222222222222222222222222",
        },
      },
    },
    now: () => new Date("2026-01-15T10:30:00Z"),
  });
  const serialized = JSON.stringify(comment);
  for (const forbidden of [
    "synthetic-secret-value",
    "ignored@synthetic.invalid",
    "free-form title",
    "free-form body",
  ]) {
    assert.equal(serialized.includes(forbidden), false);
  }
});

test("plannedComment converts to deterministic Jira ADF", () => {
  const comment = {
    jiraKey: "CRMY-900",
    event: "work_branch_created",
    dateUtc: "2026-01-15T10:30:00.000Z",
  };
  const adf = plannedCommentToAdf(comment);
  assert.equal(adf.type, "doc");
  assert.equal(adf.content[0].type, "codeBlock");
  assert.deepEqual(
    JSON.parse(adf.content[0].content[0].text),
    comment,
  );
});

for (const intent of [
  "work_branch_created",
  "pr_draft",
  "pr_ready",
  "changes_requested",
  "merged_develop",
  "pr_closed_unmerged",
  "release_published",
]) {
  test(`plannedComment is generated for ${intent}`, () => {
    const comment = buildPlannedComment({
      issueKey: "CRMY-900",
      intent,
      repository: "example/crm-synthetic",
      githubActionsRunId: "123456",
      payload: {
        ref: "feature/CRMY-900-synthetic-change",
        release: { tag_name: "v0.1.0" },
      },
      now: () => new Date("2026-01-15T10:30:00Z"),
    });
    assert.equal(comment.event, intent);
    assert.equal(comment.jiraKey, "CRMY-900");
  });
}
