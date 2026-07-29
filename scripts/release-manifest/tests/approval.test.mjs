import assert from "node:assert/strict";
import test from "node:test";
import { validateSoloOwnerApproval } from "../approval.mjs";

function validEvidence() {
  return {
    approvalMode: "solo-owner",
    allowedActors: ["shademounir"],
    repository: { allow_auto_merge: false },
    pullRequest: {
      draft: false,
      base: { ref: "main" },
      merged: true,
      merged_at: "2026-07-29T12:00:00Z",
      user: { login: "shademounir" },
      merged_by: { login: "shademounir" },
      labels: [{ name: "po-approved" }],
      auto_merge: null,
    },
  };
}

test("solo-owner accepts explicit manual Product Owner evidence", () => {
  assert.deepEqual(validateSoloOwnerApproval(validEvidence()), {
    approvalMode: "solo-owner",
    productOwnerLabel: "po-approved",
    author: "shademounir",
    mergedBy: "shademounir",
    manuallyMerged: true,
    humanApproved: true,
  });
});

for (const [name, mutate, reason] of [
  [
    "unsupported approval mode",
    (value) => {
      value.approvalMode = "independent-reviewer";
    },
    "approval_mode_not_supported",
  ],
  [
    "Draft release PR",
    (value) => {
      value.pullRequest.draft = true;
    },
    "release_pr_is_draft",
  ],
  [
    "release PR not targeting main",
    (value) => {
      value.pullRequest.base.ref = "develop";
    },
    "release_pr_base_not_main",
  ],
  [
    "unmerged release PR",
    (value) => {
      value.pullRequest.merged = false;
    },
    "release_pr_not_merged",
  ],
  [
    "missing po-approved label",
    (value) => {
      value.pullRequest.labels = [];
    },
    "po_approved_label_missing",
  ],
  [
    "unauthorized author",
    (value) => {
      value.pullRequest.user.login = "external-user";
    },
    "release_pr_author_not_allowed",
  ],
  [
    "unauthorized merger",
    (value) => {
      value.pullRequest.merged_by.login = "external-user";
    },
    "release_pr_merger_not_allowed",
  ],
  [
    "PR auto-merge configured",
    (value) => {
      value.pullRequest.auto_merge = { enabled_by: { login: "shademounir" } };
    },
    "auto_merge_was_configured",
  ],
  [
    "repository auto-merge enabled",
    (value) => {
      value.repository.allow_auto_merge = true;
    },
    "repository_auto_merge_not_disabled",
  ],
]) {
  test(`solo-owner refuses ${name}`, () => {
    const value = validEvidence();
    mutate(value);
    assert.throws(
      () => validateSoloOwnerApproval(value),
      (error) => error.reason === reason,
    );
  });
}
