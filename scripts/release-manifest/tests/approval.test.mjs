import assert from "node:assert/strict";
import test from "node:test";
import { validateSoloOwnerApproval } from "../approval.mjs";

function validEvidence() {
  return {
    approvalMode: "solo-owner",
    allowedActors: ["shademounir"],
    repository: { allow_auto_merge: false },
    releaseCommit: "b6ef8ac49da851162c7b4601df34d4f7aad3cae0",
    releasePublishedAt: "2026-08-11T12:00:00Z",
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
    repositoryAutoMerge: {
      source: "github_api",
      state: "disabled",
    },
  });
});

function validAttestationEvidence() {
  const value = validEvidence();
  value.repository = {};
  value.repositoryAutoMergeAttestation = {
    state: "disabled",
    actor: "shademounir",
    sha: value.releaseCommit,
    at: "2026-08-11T11:00:00Z",
  };
  return value;
}

test("solo-owner accepts a recent SHA-bound Product Owner attestation when API evidence is unavailable", () => {
  const result = validateSoloOwnerApproval(validAttestationEvidence());
  assert.deepEqual(result.repositoryAutoMerge, {
    source: "po_attestation",
    state: "disabled",
    actor: "shademounir",
    sha: "b6ef8ac49da851162c7b4601df34d4f7aad3cae0",
    at: "2026-08-11T11:00:00Z",
  });
});

test("repository API enabled cannot be overridden by an attestation", () => {
  const value = validAttestationEvidence();
  value.repository.allow_auto_merge = true;
  assert.throws(
    () => validateSoloOwnerApproval(value),
    (error) => error.reason === "repository_auto_merge_enabled",
  );
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
    "repository_auto_merge_enabled",
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

for (const [name, mutate, reason] of [
  [
    "unavailable repository state without attestation",
    (value) => {
      value.repositoryAutoMergeAttestation = undefined;
    },
    "repository_auto_merge_state_unavailable",
  ],
  [
    "partial attestation",
    (value) => {
      delete value.repositoryAutoMergeAttestation.at;
    },
    "repository_auto_merge_attestation_incomplete",
  ],
  [
    "null repository API state with no attestation",
    (value) => {
      value.repository.allow_auto_merge = null;
      value.repositoryAutoMergeAttestation = undefined;
    },
    "repository_auto_merge_state_unavailable",
  ],
  [
    "attestation with a non-disabled state",
    (value) => {
      value.repositoryAutoMergeAttestation.state = "enabled";
    },
    "repository_auto_merge_state_unavailable",
  ],
  [
    "attestation from an unauthorized actor",
    (value) => {
      value.repositoryAutoMergeAttestation.actor = "external-user";
    },
    "repository_auto_merge_attestation_actor_not_allowed",
  ],
  [
    "attestation for another commit",
    (value) => {
      value.repositoryAutoMergeAttestation.sha = "a".repeat(40);
    },
    "repository_auto_merge_attestation_sha_mismatch",
  ],
  [
    "attestation with an invalid date",
    (value) => {
      value.repositoryAutoMergeAttestation.at = "not-a-date";
    },
    "repository_auto_merge_attestation_invalid_date",
  ],
  [
    "attestation with an impossible UTC calendar date",
    (value) => {
      value.repositoryAutoMergeAttestation.at = "2026-02-30T11:00:00Z";
    },
    "repository_auto_merge_attestation_invalid_date",
  ],
  [
    "attestation dated after release publication",
    (value) => {
      value.repositoryAutoMergeAttestation.at = "2026-08-11T12:00:01Z";
    },
    "repository_auto_merge_attestation_invalid_date",
  ],
  [
    "attestation exactly 24 hours old",
    (value) => {
      value.repositoryAutoMergeAttestation.at = "2026-08-10T12:00:00Z";
    },
    "repository_auto_merge_attestation_expired",
  ],
]) {
  test(`solo-owner refuses ${name}`, () => {
    const value = validAttestationEvidence();
    mutate(value);
    assert.throws(
      () => validateSoloOwnerApproval(value),
      (error) => error.reason === reason,
    );
  });
}
