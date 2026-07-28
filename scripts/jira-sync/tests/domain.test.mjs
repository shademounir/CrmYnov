import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateTransition,
  INTENT,
  normalizeGithubEvent,
  STATUS,
  TRANSITION,
} from "../domain.mjs";

const eligibleIssue = {
  key: "CRMY-900",
  status: STATUS.TODO,
  labels: ["codex-ready", "synthetic"],
  issueType: "Task",
  blocked: false,
};

test("valid work branch plans To Do to In Progress", () => {
  const event = normalizeGithubEvent(
    "create",
    { ref_type: "branch", ref: "feature/CRMY-900-synthetic-change" },
    "CRMY",
  );
  const result = evaluateTransition({
    intent: event.intent,
    issue: eligibleIssue,
  });
  assert.equal(event.issueKey, "CRMY-900");
  assert.equal(result.transition.id, TRANSITION.START.id);
});

test("invalid work branch cannot select a Jira ticket", () => {
  const event = normalizeGithubEvent(
    "create",
    { ref_type: "branch", ref: "feature/no-ticket" },
    "CRMY",
  );
  assert.equal(event.issueKey, null);
});

test("ready PR cannot skip directly from To Do to In Review", () => {
  const result = evaluateTransition({
    intent: INTENT.PR_READY,
    issue: eligibleIssue,
  });
  assert.deepEqual(
    { decision: result.decision, reason: result.reason },
    { decision: "denied", reason: "review_cannot_skip_work_start" },
  );
});

test("ready PR moves only In Progress to In Review", () => {
  const result = evaluateTransition({
    intent: INTENT.PR_READY,
    issue: { ...eligibleIssue, status: STATUS.IN_PROGRESS },
  });
  assert.equal(result.transition.id, TRANSITION.SUBMIT_REVIEW.id);
});

test("PR converted back to draft returns In Review to In Progress", () => {
  const result = evaluateTransition({
    intent: INTENT.PR_DRAFT,
    issue: { ...eligibleIssue, status: STATUS.IN_REVIEW },
  });
  assert.equal(result.transition.id, TRANSITION.RESUME.id);
});

test("changes requested moves only In Review to In Progress", () => {
  const result = evaluateTransition({
    intent: INTENT.CHANGES_REQUESTED,
    issue: { ...eligibleIssue, status: STATUS.IN_REVIEW },
  });
  assert.equal(result.transition.id, TRANSITION.RESUME.id);
});

test("merge into develop remains In Review", () => {
  const result = evaluateTransition({
    intent: INTENT.MERGED_DEVELOP,
    issue: { ...eligibleIssue, status: STATUS.IN_REVIEW },
  });
  assert.deepEqual(
    { decision: result.decision, reason: result.reason },
    { decision: "no_op", reason: "awaiting_validated_release" },
  );
});

test("closed unmerged PR never moves to Done", () => {
  const result = evaluateTransition({
    intent: INTENT.PR_CLOSED_UNMERGED,
    issue: { ...eligibleIssue, status: STATUS.IN_REVIEW },
  });
  assert.equal(result.decision, "no_op");
  assert.equal(result.transition, null);
});

test("validated release is the only normal path to Done", () => {
  const result = evaluateTransition({
    intent: INTENT.RELEASE_PUBLISHED,
    issue: { ...eligibleIssue, status: STATUS.IN_REVIEW },
    releaseEvidence: {
      humanApproved: true,
      ciGreen: true,
      mergedToMain: true,
      tagCreated: true,
      releasePublished: true,
      listedInManifest: true,
    },
  });
  assert.equal(result.transition.id, TRANSITION.COMPLETE.id);
});

test("incomplete release evidence is denied", () => {
  const result = evaluateTransition({
    intent: INTENT.RELEASE_PUBLISHED,
    issue: { ...eligibleIssue, status: STATUS.IN_REVIEW },
    releaseEvidence: {
      humanApproved: true,
      ciGreen: false,
      mergedToMain: true,
      tagCreated: true,
      releasePublished: true,
      listedInManifest: true,
    },
  });
  assert.equal(result.reason, "release_evidence_incomplete");
});

test("release cannot skip directly from In Progress to Done", () => {
  const result = evaluateTransition({
    intent: INTENT.RELEASE_PUBLISHED,
    issue: { ...eligibleIssue, status: STATUS.IN_PROGRESS },
    releaseEvidence: {
      humanApproved: true,
      ciGreen: true,
      mergedToMain: true,
      tagCreated: true,
      releasePublished: true,
      listedInManifest: true,
    },
  });
  assert.equal(result.reason, "release_completion_requires_in_review");
});

test("Epic can never transition automatically to Done", () => {
  const result = evaluateTransition({
    intent: INTENT.RELEASE_PUBLISHED,
    issue: {
      ...eligibleIssue,
      issueType: "Epic",
      status: STATUS.IN_REVIEW,
    },
    releaseEvidence: {
      humanApproved: true,
      ciGreen: true,
      mergedToMain: true,
      tagCreated: true,
      releasePublished: true,
      listedInManifest: true,
    },
  });
  assert.equal(result.reason, "epic_done_forbidden");
});

test("ticket without codex-ready is denied", () => {
  const result = evaluateTransition({
    intent: INTENT.WORK_BRANCH_CREATED,
    issue: { ...eligibleIssue, labels: ["synthetic"] },
  });
  assert.equal(result.reason, "missing_codex_ready");
});

test("blocked ticket is denied", () => {
  const result = evaluateTransition({
    intent: INTENT.WORK_BRANCH_CREATED,
    issue: { ...eligibleIssue, blocked: true },
  });
  assert.equal(result.reason, "issue_blocked");
});
