import assert from "node:assert/strict";
import test from "node:test";
import {
  fetchSoloOwnerApprovalEvidence,
  parseManualPoDecision,
  selectManualPoDecision,
  validateReleaseApproval,
  validateSoloOwnerApproval,
} from "../approval.mjs";

const HEAD_SHA = "b6ef8ac49da851162c7b4601df34d4f7aad3cae0";

function validManualEvidence() {
  return {
    approvalMode: "manual-po",
    allowedActors: ["shademounir"],
    repository: { allow_auto_merge: true },
    pullRequest: {
      number: 42,
      draft: false,
      base: { ref: "main" },
      head: { ref: "release/v1.0.0", sha: HEAD_SHA },
      merged: true,
      merged_at: "2026-08-11T12:00:00Z",
      user: { login: "shademounir" },
      merged_by: { login: "shademounir" },
      labels: [{ name: "po-approved" }],
      auto_merge: null,
    },
    manualPoDecision: {
      decision: "approved",
      pullRequest: 42,
      headSha: HEAD_SHA,
      actor: "shademounir",
      commentId: 1234,
      createdAt: "2026-08-11T11:00:00Z",
    },
    autoMergeEvents: [],
  };
}

test("manual-po accepts PR-specific manual evidence when repository auto-merge is enabled", () => {
  assert.deepEqual(validateSoloOwnerApproval(validManualEvidence()), {
    approvalMode: "manual-po",
    productOwnerLabel: "po-approved",
    author: "shademounir",
    mergedBy: "shademounir",
    manuallyMerged: true,
    humanApproved: true,
    approvalValidated: true,
    productOwnerDecision: {
      source: "github_issue_comment",
      actor: "shademounir",
      commentId: 1234,
      createdAt: "2026-08-11T11:00:00Z",
      pullRequest: 42,
      headSha: HEAD_SHA,
    },
  });
});

function validAutomatedEvidence() {
  const value = validManualEvidence();
  value.approvalMode = "automated-policy";
  value.releaseProfile = "gate-1";
  value.pullRequest.labels = [{ name: "policy-approved" }];
  value.pullRequest.auto_merge = { enabled_by: { login: "shademounir" } };
  value.policyCheckRuns = [{
    id: 1,
    name: "pr-policy",
    status: "completed",
    conclusion: "success",
    head_sha: HEAD_SHA,
  }];
  return value;
}

test("automated-policy accepts an allowlisted technical Gate release", () => {
  assert.deepEqual(validateReleaseApproval(validAutomatedEvidence()), {
    approvalMode: "automated-policy",
    policyLabel: "policy-approved",
    author: "shademounir",
    mergedBy: "shademounir",
    mergeMethod: "native_auto_merge",
    approvalValidated: true,
  });
});

for (const [name, mutate, reason] of [
  ["missing policy label", (value) => { value.pullRequest.labels = []; }, "policy_approved_label_missing"],
  ["po-approved label", (value) => { value.pullRequest.labels.push({ name: "po-approved" }); }, "po_approved_forbidden_in_automated_policy"],
  ["PROD/application profile", (value) => { value.releaseProfile = "application"; }, "automated_policy_prod_forbidden"],
  ["non-release branch", (value) => { value.pullRequest.head.ref = "feature/CRMY-114-test"; }, "release_branch_not_allowed"],
  ["missing pr-policy check", (value) => { value.policyCheckRuns = []; }, "pr_policy_check_missing"],
  ["pending pr-policy check", (value) => { value.policyCheckRuns[0].status = "in_progress"; }, "pr_policy_check_pending"],
  ["failed pr-policy check", (value) => { value.policyCheckRuns[0].conclusion = "failure"; }, "pr_policy_check_failed"],
]) {
  test(`automated-policy refuses ${name}`, () => {
    const value = validAutomatedEvidence();
    mutate(value);
    assert.throws(
      () => validateReleaseApproval(value),
      (error) => error.reason === reason,
    );
  });
}

for (const [name, mutate, reason] of [
  ["legacy solo-owner mode", (value) => { value.approvalMode = "solo-owner"; }, "approval_mode_not_supported"],
  ["Draft release PR", (value) => { value.pullRequest.draft = true; }, "release_pr_is_draft"],
  ["release PR not targeting main", (value) => { value.pullRequest.base.ref = "develop"; }, "release_pr_base_not_main"],
  ["unmerged release PR", (value) => { value.pullRequest.merged = false; }, "release_pr_not_merged"],
  ["missing po-approved label", (value) => { value.pullRequest.labels = []; }, "po_approved_label_missing"],
  ["policy-approved substitution", (value) => { value.pullRequest.labels.push({ name: "policy-approved" }); }, "policy_approved_forbidden_in_manual_po"],
  ["unauthorized author", (value) => { value.pullRequest.user.login = "external-user"; }, "release_pr_author_not_allowed"],
  ["unauthorized merger", (value) => { value.pullRequest.merged_by.login = "external-user"; }, "release_pr_merger_not_allowed"],
  ["PR auto-merge configured", (value) => { value.pullRequest.auto_merge = { enabled_by: { login: "shademounir" } }; }, "auto_merge_was_configured"],
  ["auto-merge timeline event", (value) => { value.autoMergeEvents = [{ event: "auto_merge_enabled", id: 1 }]; }, "auto_merge_event_detected"],
  ["missing PO decision", (value) => { value.manualPoDecision = undefined; }, "manual_po_decision_missing"],
  ["revoked PO decision", (value) => { value.manualPoDecision.decision = "revoked"; }, "manual_po_decision_not_approved"],
  ["decision for another PR", (value) => { value.manualPoDecision.pullRequest = 41; }, "manual_po_decision_pr_mismatch"],
  ["decision for another SHA", (value) => { value.manualPoDecision.headSha = "a".repeat(40); }, "manual_po_decision_sha_mismatch"],
  ["decision from unauthorized actor", (value) => { value.manualPoDecision.actor = "external-user"; }, "manual_po_decision_actor_not_allowed"],
  ["decision without comment id", (value) => { value.manualPoDecision.commentId = undefined; }, "manual_po_decision_not_traceable"],
  ["decision after merge", (value) => { value.manualPoDecision.createdAt = "2026-08-11T12:00:01Z"; }, "manual_po_decision_invalid_date"],
]) {
  test(`manual-po refuses ${name}`, () => {
    const value = validManualEvidence();
    mutate(value);
    assert.throws(
      () => validateReleaseApproval(value),
      (error) => error.reason === reason,
    );
  });
}

test("manual-po decision marker is parsed and bound to GitHub comment evidence", () => {
  const body = `<!-- manual-po-decision {"schemaVersion":1,"decision":"approved","pullRequest":42,"headSha":"${HEAD_SHA}"} -->`;
  assert.deepEqual(parseManualPoDecision(body), {
    schemaVersion: 1,
    decision: "approved",
    pullRequest: 42,
    headSha: HEAD_SHA,
  });
  assert.deepEqual(selectManualPoDecision([{
    id: 1234,
    body,
    created_at: "2026-08-11T11:00:00Z",
    user: { login: "shademounir" },
  }], { pullRequestNumber: 42, headSha: HEAD_SHA }), {
    decision: "approved",
    pullRequest: 42,
    headSha: HEAD_SHA,
    actor: "shademounir",
    commentId: 1234,
    createdAt: "2026-08-11T11:00:00Z",
    expectedPullRequest: 42,
    expectedHeadSha: HEAD_SHA,
  });
});

test("the latest manual-po marker controls the decision", () => {
  const approved = `<!-- manual-po-decision {"schemaVersion":1,"decision":"approved","pullRequest":42,"headSha":"${HEAD_SHA}"} -->`;
  const revoked = `<!-- manual-po-decision {"schemaVersion":1,"decision":"revoked","pullRequest":42,"headSha":"${HEAD_SHA}"} -->`;
  const result = selectManualPoDecision([
    { id: 10, body: approved, created_at: "2026-08-11T10:00:00Z", user: { login: "shademounir" } },
    { id: 11, body: revoked, created_at: "2026-08-11T11:00:00Z", user: { login: "shademounir" } },
  ], { pullRequestNumber: 42, headSha: HEAD_SHA });
  assert.equal(result.decision, "revoked");
  assert.equal(result.commentId, 11);
});

test("GitHub evidence reads the PO decision and auto-merge timeline without mutation", async () => {
  const marker = `<!-- manual-po-decision {"schemaVersion":1,"decision":"approved","pullRequest":42,"headSha":"${HEAD_SHA}"} -->`;
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    let body;
    if (url.endsWith("/pulls/42")) {
      body = { number: 42, head: { sha: HEAD_SHA } };
    } else if (url.endsWith("/repos/shademounir/CrmYnov")) {
      body = { allow_auto_merge: true };
    } else if (url.includes("/check-runs")) {
      body = { check_runs: [] };
    } else if (url.includes("/comments?")) {
      body = [{
        id: 1234,
        body: marker,
        created_at: "2026-08-11T11:00:00Z",
        user: { login: "shademounir" },
      }];
    } else if (url.includes("/timeline?")) {
      body = [{ event: "labeled", id: 1 }];
    } else {
      throw new Error(`Unexpected URL: ${url}`);
    }
    return { ok: true, status: 200, json: async () => body };
  };

  const evidence = await fetchSoloOwnerApprovalEvidence({
    repositoryName: "shademounir/CrmYnov",
    pullRequestNumber: 42,
    token: "synthetic-token",
    fetchImpl,
  });
  assert.equal(evidence.repository.allow_auto_merge, true);
  assert.equal(evidence.manualPoDecision.commentId, 1234);
  assert.deepEqual(evidence.autoMergeEvents, []);
  assert.ok(calls.every(({ options }) => options.method === undefined));
});
