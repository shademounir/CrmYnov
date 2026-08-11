import assert from "node:assert/strict";
import test from "node:test";
import {
  parseAuditComment,
  selectAuditComment,
  validatePullRequestPolicy,
} from "../policy.mjs";

const SHA = "a".repeat(40);

function successfulRuns(names = ["simulate", "terraform-static", "iac-security"]) {
  return names.map((name, index) => ({
    id: index + 1,
    name,
    status: "completed",
    conclusion: "success",
    head_sha: SHA,
  }));
}

function validPolicy() {
  return {
    approvalMode: "automated-policy",
    repository: "shademounir/CrmYnov",
    sourceRepository: "shademounir/CrmYnov",
    actor: "shademounir",
    allowedActors: ["shademounir"],
    branch: "feature/CRMY-113-automated-pr-governance",
    base: "develop",
    draft: false,
    labels: ["policy-approved"],
    ticket: {
      key: "CRMY-113",
      issueType: "Task",
      status: "In Progress",
      labels: ["codex-ready", "security"],
      blocked: false,
      scope: "technical",
    },
    changedFiles: ["scripts/pr-policy/policy.mjs"],
    mergeable: true,
    branchUpToDate: true,
    requiredChecks: ["simulate", "terraform-static", "iac-security"],
    checkRuns: successfulRuns(),
    checkSha: SHA,
  };
}

test("feature to develop is accepted", () => {
  assert.equal(validatePullRequestPolicy(validPolicy()).branchKind, "feature");
});

test("fix to develop is accepted", () => {
  const value = validPolicy();
  value.branch = "fix/CRMY-113-policy-regression";
  assert.equal(validatePullRequestPolicy(value).branchKind, "fix");
});

test("technical Gate release to main is accepted", () => {
  const value = validPolicy();
  value.branch = "release/v0.1.0-gate.2";
  value.base = "main";
  value.manifestProfile = "gate-1";
  value.changedFiles = ["release-manifest.json"];
  value.requiredChecks = ["unit-tests", "terraform-static", "iac-security", "secret-scan"];
  value.checkRuns = successfulRuns(value.requiredChecks);
  assert.equal(validatePullRequestPolicy(value).branchKind, "release");
});

for (const [name, mutate, reason] of [
  ["wrong base", (value) => { value.base = "main"; }, "work_branch_base_not_develop"],
  ["fork", (value) => { value.sourceRepository = "external/fork"; }, "external_fork_not_allowed"],
  ["unauthorized actor", (value) => { value.actor = "external"; }, "actor_not_allowed"],
  ["missing Jira ticket", (value) => { value.ticket = {}; }, "jira_ticket_missing"],
  ["Epic", (value) => { value.ticket.issueType = "Epic"; }, "jira_epic_not_allowed"],
  ["blocked ticket", (value) => { value.ticket.blocked = true; }, "jira_ticket_blocked"],
  ["missing codex-ready", (value) => { value.ticket.labels = []; }, "jira_codex_ready_missing"],
  ["Draft PR", (value) => { value.draft = true; }, "pull_request_is_draft"],
  ["missing policy-approved", (value) => { value.labels = []; }, "policy_approved_label_missing"],
  ["po-approved in automated mode", (value) => { value.labels.push("po-approved"); }, "po_approved_reserved_for_manual_scope"],
  ["PROD scope", (value) => { value.ticket.scope = "prod"; }, "manual_po_scope_required"],
  ["IAM file", (value) => { value.changedFiles = ["infra/bootstrap/foundation/iam.tf"]; }, "manual_po_scope_required"],
  ["billing file", (value) => { value.changedFiles = ["infra/billing/account.tf"]; }, "manual_po_scope_required"],
  ["secret file", (value) => { value.changedFiles = ["infra/secrets/manager.tf"]; }, "manual_po_scope_required"],
  ["Terraform apply workflow", (value) => { value.changedFiles = [".github/workflows/terraform-apply.yml"]; }, "manual_po_scope_required"],
  ["missing check", (value) => { value.checkRuns = value.checkRuns.slice(1); }, "required_check_missing"],
  ["pending check", (value) => { value.checkRuns[0].status = "in_progress"; }, "required_check_pending"],
  ["failed check", (value) => { value.checkRuns[0].conclusion = "failure"; }, "required_check_failed"],
  ["branch behind", (value) => { value.branchUpToDate = false; }, "branch_not_up_to_date"],
  ["merge conflict", (value) => { value.mergeable = false; }, "pull_request_conflict"],
]) {
  test(`${name} is refused`, () => {
    const value = validPolicy();
    mutate(value);
    assert.throws(
      () => validatePullRequestPolicy(value),
      (error) => error.reason === reason,
    );
  });
}

test("validation is idempotent", () => {
  const value = validPolicy();
  assert.deepEqual(validatePullRequestPolicy(value), validatePullRequestPolicy(value));
});

test("audit comment is accepted only from allowlisted author on exact SHA", () => {
  const audit = {
    schemaVersion: 1,
    headSha: SHA,
    verifiedBy: "shademounir",
    ticket: validPolicy().ticket,
  };
  const body = `<!-- codex-policy-audit\n${JSON.stringify(audit)}\n-->`;
  assert.deepEqual(parseAuditComment(body), audit);
  assert.deepEqual(
    selectAuditComment(
      [{ id: 1, body, user: { login: "shademounir" } }],
      { headSha: SHA, allowedActors: ["shademounir"] },
    ),
    audit,
  );
});
