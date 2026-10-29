import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { classifyApprovalMode, validatePullRequestPolicy } from "../policy.mjs";
import { DELEGATED_CHECKS, grantDigest, scopeDigest } from "../delegation.mjs";

const modules = Object.freeze([
  "scripts/telephony-agent/installer-transactions.psm1",
  "scripts/telephony-agent/package-notices.psm1",
  "scripts/telephony-agent/tests/windows-fixture-guards.psm1",
]);
const protectedGrant = JSON.parse(await readFile(new URL("../../../docs/governance/codex-delegation.json", import.meta.url), "utf8"));
const sha = "a".repeat(40);

function classification(changedFiles, overrides = {}) {
  return classifyApprovalMode({
    changedFiles, defaultMode: "delegated-codex", repository: protectedGrant.repository,
    actor: "shademounir", base: "develop", trustedGrant: structuredClone(protectedGrant),
    migrationAssessment: { applicable: false }, ...overrides,
  });
}

for (const path of modules) {
  test(`delegated tooling recognizes only the reviewed module path ${path}`, () => {
    const result = classification([path]);
    assert.equal(result.effectiveApprovalMode, "delegated-codex");
    assert.deepEqual(result.reasons, ["audited-repository-tooling"]);
  });
  test(`historical automated mode stays conservative for ${path}`, () => {
    const result = classifyApprovalMode({ changedFiles: [path], defaultMode: "automated-policy" });
    assert.equal(result.effectiveApprovalMode, "manual-po");
    assert.deepEqual(result.reasons, ["ambiguous-path"]);
  });
}

test("all three module paths remain an audited delegated scope, not ordinary automatic scope", () => {
  const result = classification([...modules], { ticket: { scope: "prod" } });
  assert.deepEqual(new Set(result.reasons), new Set(["audited-repository-tooling", "ticket-sensitive-scope"]));
});

for (const path of [
  "scripts/telephony-agent/unknown.psm1", "scripts/other/installer-transactions.psm1",
  "infra/installer-transactions.psm1", ".github/package-notices.psm1",
  "scripts/telephony-agent/tests/installer-transactions.psm1",
  "scripts/telephony-agent/installer-transactions.psm1.exe",
  "scripts/telephony-agent/installer-transactions.PSM1",
  "scripts/telephony-agent/Installer-transactions.psm1",
  "scripts/telephony-agent/installer-transactions.psm1.bak",
  "scripts/telephony-agent/installer-transactions.psm1 ",
  "scripts/telephony-agent//installer-transactions.psm1",
  "scripts/telephony-agent/./installer-transactions.psm1",
  "scripts/telephony-agent/tests/../installer-transactions.psm1",
  "../scripts/telephony-agent/installer-transactions.psm1",
  "/scripts/telephony-agent/installer-transactions.psm1",
  "C:/scripts/telephony-agent/installer-transactions.psm1",
  "scripts/telephony-agent/installer-transactions.psm1\0",
]) {
  test(`unknown or malformed PowerShell module path remains refused: ${JSON.stringify(path)}`, () => {
    assert.throws(() => classification([modules[0], path]), error => error.reason === "delegation_unresolved_scope_or_migration");
  });
}

test("the existing canonical separator normalization applies without accepting traversal", () => {
  assert.equal(classification([modules[0].replaceAll("/", "\\")]).effectiveApprovalMode, "delegated-codex");
  assert.throws(() => classification(["scripts\\telephony-agent\\tests\\..\\installer-transactions.psm1"]),
    error => error.reason === "delegation_unresolved_scope_or_migration");
});

test("sensitive reasons are retained alongside the known module scope", () => {
  const result = classification([modules[0], "infra/environments/prod/main.tf", "scripts/credentials/config.json"]);
  assert(result.reasons.includes("audited-repository-tooling"));
  assert(result.reasons.includes("production"));
  assert(result.reasons.includes("terraform-bootstrap-state"));
  assert(result.reasons.includes("secret-configuration"));
  const limited = structuredClone(protectedGrant);
  limited.allowedReasons = limited.allowedReasons.filter(reason => reason !== "secret-configuration");
  assert.throws(() => classification([modules[0], "scripts/credentials/config.json"], { trustedGrant: limited }),
    error => error.reason === "delegation_scope_not_authorized");
});

test("an already-sensitive unknown module keeps its existing sensitive gate, not the new tooling recognition", () => {
  const path = "scripts/security/unknown-module.psm1";
  const original = classifyApprovalMode({ changedFiles: [path], defaultMode: "automated-policy" });
  assert.deepEqual(original.reasons, ["security-rule-exception"]);
  assert.equal(original.effectiveApprovalMode, "manual-po");
  const delegated = classification([path]);
  assert.deepEqual(delegated.reasons, original.reasons);
  const limited = structuredClone(protectedGrant);
  limited.allowedReasons = limited.allowedReasons.filter(reason => reason !== "security-rule-exception");
  assert.throws(() => classification([path], { trustedGrant: limited }), error => error.reason === "delegation_scope_not_authorized");
});

test("known modules never rescue an unknown path or unresolved migration", () => {
  for (const path of ["unknown/thing.bin", "apps/api/prisma/migrations/20261001_change/migration.sql"]) {
    assert.throws(() => classification([...modules, path]), error => error.reason === "delegation_unresolved_scope_or_migration");
  }
});

for (const [name, overrides, reason] of [
  ["missing grant", { trustedGrant: undefined }, "delegation_grant_missing_or_revoked"],
  ["foreign actor", { actor: "outside" }, "delegation_actor_not_allowed"],
  ["foreign base", { base: "unprotected" }, "delegation_base_not_allowed"],
  ["ungranted tooling reason", { trustedGrant: { ...protectedGrant, allowedReasons: [] } }, "delegation_scope_not_authorized"],
]) {
  test(`module classification preserves ${name} refusal`, () => {
    assert.throws(() => classification([...modules], overrides), error => error.reason === reason);
  });
}

function policyInput() {
  const runs = DELEGATED_CHECKS.map((name, index) => ({ name, id: index + 1, head_sha: sha, status: "completed", conclusion: "success" }));
  return {
    approvalMode: "delegated-codex", repository: protectedGrant.repository, sourceRepository: protectedGrant.repository,
    actor: "shademounir", allowedActors: ["shademounir"], branch: "fix/CRMY-183-module-classification",
    base: "develop", draft: false, labels: ["codex-delegated-approved"],
    ticket: { key: "CRMY-183", issueType: "Bug", status: "In Review", labels: ["codex-ready"] },
    changedFiles: [...modules], trustedGrant: structuredClone(protectedGrant), checkSha: sha, pullRequestNumber: 244,
    mergeable: true, branchUpToDate: true, conversationsResolved: true, autoMerge: null,
    checkRuns: runs, delegatedDecision: {
      schemaVersion: 1, executor: "Codex", decision: "approved", grantId: protectedGrant.id, grantDigest: grantDigest(protectedGrant),
      actor: "shademounir", commentId: 123, createdAt: "2026-10-01T12:00:00Z", pullRequest: 244, headSha: sha,
      scopeDigest: scopeDigest(modules), checks: runs.map(({ name, id }) => ({ name, id })),
      evidence: ["https://github.com/shademounir/CrmYnov/actions/runs/123"], reservations: ["Source scope only, no native installer acceptance."],
      rollback: "Protected source reversal without any runtime or useful-data deletion.",
      personalVisualAcceptance: false, productionDeploymentAuthorized: false,
    },
  };
}

test("the actual policy pipeline still requires the exact source decision and technical gates", () => {
  const result = validatePullRequestPolicy(policyInput());
  assert.equal(result.mode, "delegated-codex");
  assert.equal(result.delegatedApproval.humanApproved, false);
  assert.equal(result.delegatedApproval.headSha, sha);
  assert.deepEqual(result.checks, [...DELEGATED_CHECKS]);
});

for (const [name, mutate, reason] of [
  ["approval label", value => { value.labels = []; }, "delegated_label_missing"],
  ["failed check", value => { value.checkRuns[0].conclusion = "failure"; }, "delegated_check_not_successful"],
  ["stale check ID", value => { value.delegatedDecision.checks[0].id = 999; }, "delegated_check_not_examined"],
  ["wrong source SHA", value => { value.delegatedDecision.headSha = "b".repeat(40); }, "delegated_decision_sha_mismatch"],
  ["wrong source scope", value => { value.delegatedDecision.scopeDigest = "b".repeat(64); }, "delegated_decision_scope_mismatch"],
  ["unresolved conversation", value => { value.conversationsResolved = false; }, "conversations_unresolved"],
  ["native auto-merge", value => { value.autoMerge = {}; }, "delegated_native_auto_merge_forbidden"],
  ["Jira readiness", value => { value.ticket.labels = []; }, "jira_codex_ready_missing"],
  ["implicit production", value => { value.delegatedDecision.productionDeploymentAuthorized = true; }, "delegated_decision_misrepresents_acceptance_or_deployment"],
]) {
  test(`the module policy still refuses missing ${name} control`, () => {
    const value = policyInput(); mutate(value);
    assert.throws(() => validatePullRequestPolicy(value), error => error.reason === reason);
  });
}
