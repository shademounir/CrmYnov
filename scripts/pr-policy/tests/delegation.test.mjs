import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { DELEGATED_CHECKS, GRANT_PATH, grantDigest, scopeDigest, selectDelegatedDecision } from "../delegation.mjs";
import { validatePullRequestPolicy } from "../policy.mjs";
import { validateReleaseApproval } from "../../release-manifest/approval.mjs";

const grant = JSON.parse(await readFile(new URL("../../../docs/governance/codex-delegation.json", import.meta.url), "utf8"));
const sha = "a".repeat(40);
function input() {
  const files = ["apps/web/app/(shell)/layout.tsx"];
  const runs = DELEGATED_CHECKS.map((name, index) => ({ name, id: index + 1, head_sha: sha, status: "completed", conclusion: "success" }));
  return {
    approvalMode: "delegated-codex", repository: grant.repository, sourceRepository: grant.repository,
    actor: "shademounir", allowedActors: ["shademounir"], branch: "feature/CRMY-174-delegated-governance",
    base: "develop", draft: false, labels: ["codex-delegated-approved"],
    ticket: { key: "CRMY-174", issueType: "Task", status: "In Progress", labels: ["codex-ready"] },
    changedFiles: files, trustedGrant: structuredClone(grant), checkSha: sha, pullRequestNumber: 42,
    mergeable: true, branchUpToDate: true, conversationsResolved: true, autoMerge: null,
    checkRuns: runs, delegatedDecision: {
      schemaVersion: 1, executor: "Codex", decision: "approved", grantId: grant.id, grantDigest: grantDigest(grant),
      actor: "shademounir", commentId: 123, createdAt: "2026-10-01T12:00:00Z", pullRequest: 42, headSha: sha,
      scopeDigest: scopeDigest(files), checks: runs.map(({ name, id }) => ({ name, id })),
      evidence: ["https://github.com/shademounir/CrmYnov/actions/runs/123"], reservations: ["Avis esthétique personnel distinct"],
      rollback: "Revert protégé du commit publié, sans suppression de données.",
      personalVisualAcceptance: false, productionDeploymentAuthorized: false,
    },
  };
}

test("delegation accepts exact SHA and evidence without human checklist or marker", () => {
  const result = validatePullRequestPolicy(input());
  assert.equal(result.mode, "delegated-codex");
  assert.equal(result.delegatedApproval.humanApproved, false);
  assert.equal(result.delegatedApproval.executor, "Codex");
  assert.deepEqual(result.checks, [...DELEGATED_CHECKS]);
});

for (const [name, mutate, reason] of [
  ["missing protected grant", (v) => { delete v.trustedGrant; }, "delegation_grant_missing_or_revoked"],
  ["revoked protected grant", (v) => { v.trustedGrant.status = "revoked"; }, "delegation_grant_missing_or_revoked"],
  ["self-authorizing PR", (v) => { v.changedFiles.push(GRANT_PATH); }, "delegation_authority_change_requires_manual_po"],
  ["unknown path", (v) => { v.changedFiles.push("unknown/thing.bin"); }, "delegation_unresolved_scope_or_migration"],
  ["traversal", (v) => { v.changedFiles.push("scripts/../credentials.json"); }, "delegation_unresolved_scope_or_migration"],
  ["revoked decision", (v) => { v.delegatedDecision.decision = "revoked"; }, "delegated_decision_missing_or_revoked"],
  ["changed grant", (v) => { v.delegatedDecision.grantDigest = "b".repeat(64); }, "delegated_grant_mismatch"],
  ["wrong SHA", (v) => { v.delegatedDecision.headSha = "b".repeat(40); }, "delegated_decision_sha_mismatch"],
  ["wrong PR", (v) => { v.delegatedDecision.pullRequest = 41; }, "delegated_decision_pr_mismatch"],
  ["wrong scope", (v) => { v.delegatedDecision.scopeDigest = "b".repeat(64); }, "delegated_decision_scope_mismatch"],
  ["missing provenance", (v) => { delete v.delegatedDecision.commentId; }, "delegated_decision_not_traceable"],
  ["missing rollback", (v) => { v.delegatedDecision.rollback = ""; }, "delegated_evidence_incomplete"],
  ["false aesthetic acceptance", (v) => { v.delegatedDecision.personalVisualAcceptance = true; }, "delegated_decision_misrepresents_acceptance_or_deployment"],
  ["implicit PROD", (v) => { v.delegatedDecision.productionDeploymentAuthorized = true; }, "delegated_decision_misrepresents_acceptance_or_deployment"],
  ["missing CI", (v) => { v.checkRuns = []; }, "delegated_check_not_successful"],
  ["failed CI", (v) => { v.checkRuns[0].conclusion = "failure"; }, "delegated_check_not_successful"],
  ["old check proof", (v) => { v.delegatedDecision.checks[0].id = 456; }, "delegated_check_not_examined"],
  ["unresolved migration", (v) => { v.changedFiles = ["apps/api/prisma/migrations/20261001_change/migration.sql"]; }, "delegation_unresolved_scope_or_migration"],
  ["human label", (v) => { v.labels.push("po-approved"); }, "delegated_human_or_policy_label_forbidden"],
  ["human marker", (v) => { v.manualPoDecision = {}; }, "delegated_human_decision_forbidden"],
  ["native auto merge", (v) => { v.autoMerge = {}; }, "delegated_native_auto_merge_forbidden"],
  ["unresolved conversations", (v) => { v.conversationsResolved = false; }, "conversations_unresolved"],
  ["draft", (v) => { v.draft = true; }, "delegated_pull_request_is_draft"],
  ["Jira readiness", (v) => { v.ticket.labels = []; }, "jira_codex_ready_missing"],
  ["Jira dependency", (v) => { v.ticket.blocked = true; }, "jira_ticket_blocked"],
  ["branch stale", (v) => { v.branchUpToDate = false; }, "branch_not_up_to_date"],
]) test(`delegation refuses ${name}`, () => {
  const value = input(); mutate(value);
  assert.throws(() => validatePullRequestPolicy(value), (error) => error.reason === reason);
});

test("latest authorized marker wins, including revocation; caller cannot spoof actor/date", () => {
  const make = (id, decision) => ({ id, user: { type: "User", login: "shademounir" }, created_at: "2026-10-01T12:00:00Z",
    body: `<!-- codex-delegated-decision ${JSON.stringify({ schemaVersion: 1, decision, actor: "fake", createdAt: "fake" })} -->` });
  const result = selectDelegatedDecision([make(1, "approved"), make(2, "revoked")], ["shademounir"]);
  assert.equal(result.decision, "revoked"); assert.equal(result.actor, "shademounir"); assert.equal(result.createdAt, "2026-10-01T12:00:00Z");
  const invalid = make(3, "approved"); invalid.body = "<!-- codex-delegated-decision invalid -->";
  assert.throws(() => selectDelegatedDecision([make(1, "approved"), invalid], ["shademounir"]));
  assert.equal(selectDelegatedDecision([make(1, "approved")], ["another"]), undefined);
});

function releaseInput() {
  const value = input();
  const runs = [...value.checkRuns, { name: "pr-policy", id: 500, head_sha: sha, status: "completed", conclusion: "success" }];
  return { approvalMode: value.approvalMode, allowedActors: value.allowedActors, repository: {}, trustedGrant: value.trustedGrant,
    delegatedDecision: value.delegatedDecision, changedFiles: value.changedFiles, releaseProfile: "application", policyCheckRuns: runs,
    pullRequest: { number: 42, draft: false, base: { ref: "main", repo: { full_name: grant.repository } },
      head: { ref: "release/v0.1.0-rc.1", sha }, merged: true, merged_at: "2026-10-01T13:00:00Z",
      user: { login: "shademounir" }, merged_by: { login: "shademounir" }, labels: [{ name: "codex-delegated-approved" }], auto_merge: null } };
}
test("application release keeps approvalValidated distinct from humanApproved", () => {
  const result = validateReleaseApproval(releaseInput());
  assert.equal(result.approvalValidated, true); assert.equal(result.humanApproved, false);
});
test("release refuses decision after merge and missing policy success", () => {
  const late = releaseInput(); late.delegatedDecision.createdAt = "2026-10-01T14:00:00Z";
  assert.throws(() => validateReleaseApproval(late), (error) => error.reason === "delegated_decision_invalid_date");
  const noPolicy = releaseInput(); noPolicy.policyCheckRuns.pop();
  assert.throws(() => validateReleaseApproval(noPolicy), (error) => error.reason === "pr_policy_check_failed");
  const edited = releaseInput(); edited.delegatedDecision.updatedAt = "2026-10-01T14:00:00Z";
  assert.throws(() => validateReleaseApproval(edited), (error) => error.reason === "delegated_decision_invalid_date");
});

test("collectors use protected authority and main gates, not a self-authorizing checkout", async () => {
  const cli = await readFile(new URL("../cli.mjs", import.meta.url), "utf8");
  assert.match(cli, /trustedSha.*pull\.base\.ref/s);
  assert.match(cli, /merge-base.*--is-ancestor/);
  assert.match(cli, /\$\{trustedSha\}:\$\{GRANT_PATH\}/);
  assert.match(cli, /fetchAllCheckRuns/);
  for (const name of ["application-quality", "prisma-migration-policy"]) {
    const workflow = await readFile(new URL(`../../../.github/workflows/${name}.yml`, import.meta.url), "utf8");
    assert.match(workflow, /- develop\s+- main/);
    assert.doesNotMatch(workflow, /pull_request_target/);
  }
});
test("main may promote only the authority identical to protected develop; work PR cannot replace it", () => {
  const value = input(); value.base = "main"; value.branch = "release/v0.1.0-rc.1";
  value.changedFiles.push(GRANT_PATH); value.delegatedDecision.scopeDigest = scopeDigest(value.changedFiles);
  value.headGrantDigest = grantDigest(grant);
  assert.equal(validatePullRequestPolicy(value).mode, "delegated-codex");
  value.headGrantDigest = "b".repeat(64);
  assert.throws(() => validatePullRequestPolicy(value), (error) => error.reason === "delegation_authority_change_requires_manual_po");
});
