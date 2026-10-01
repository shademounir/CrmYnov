import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyApprovalMode,
  parseAuditComment,
  parseManualPoDecision,
  selectAuditComment,
  selectManualPoDecision,
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
    changedFiles: ["apps/web/src/page.tsx"],
    mergeable: true,
    branchUpToDate: true,
    requiredChecks: ["simulate", "terraform-static", "iac-security"],
    checkRuns: successfulRuns(),
    checkSha: SHA,
  };
}

const completeChecklist = `
- [x] Revue manuelle effectuée par le Product Owner
- [x] Label \`po-approved\` ajouté manuellement par le Product Owner
- [x] Toutes les conversations sont résolues
- [x] La branche est à jour
- [x] Les contrôles obligatoires sont verts
- [x] Auto-merge désactivé
- [x] Merge exclusivement manuel
`;

function validManualPo(path = "scripts/pr-policy/policy.mjs") {
  const value = validPolicy();
  value.branch = "fix/CRMY-124-per-pr-approval-mode";
  value.ticket.key = "CRMY-124";
  value.changedFiles = [path];
  value.labels = ["po-approved"];
  value.pullRequestNumber = 42;
  value.pullRequestBody = completeChecklist;
  value.manualPoDecision = { actor: "shademounir", pullRequest: 42, headSha: SHA, commentId: 7 };
  value.autoMerge = null;
  value.autoMergeEvents = [];
  value.conversationsResolved = true;
  value.poLabelEvents = [{ actor: "shademounir", actorType: "User", id: 8 }];
  value.automationRequested = false;
  return value;
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

for (const [name, path, mode, reason] of [
  ["ordinary application PR", "apps/web/src/page.tsx", "automated-policy", "ordinary-scope"],
  ["non-sensitive documentation", "docs/architecture/overview.md", "automated-policy", "ordinary-scope"],
  ["Phase 0 bootstrap", "infra/bootstrap/phase0/main.tf", "manual-po", "terraform-bootstrap-state"],
  ["IAM", "infra/iam/bindings.tf", "manual-po", "iam-wif"],
  ["WIF", "infra/bootstrap/wif/main.tf", "manual-po", "iam-wif"],
  ["billing", "infra/billing/account.tf", "manual-po", "billing-budget"],
  ["budget", "infra/modules/budget/main.tf", "manual-po", "billing-budget"],
  ["secret", "config/secrets/runtime.yml", "manual-po", "secret-configuration"],
  ["PROD", "infra/environments/prod/main.tf", "manual-po", "production"],
  ["destructive migration", "migrations/drop-legacy.sql", "manual-po", "destructive-migration"],
  ["governance workflow", ".github/workflows/pr-policy.yml", "manual-po", "github-governance"],
  ["Terraform backend", "infra/environments/dev/backend.tf", "manual-po", "terraform-bootstrap-state"],
  ["Terraform state", "infra/state/README.md", "manual-po", "terraform-bootstrap-state"],
  ["branch protection", "config/branch-protection/develop.json", "manual-po", "security-rule-exception"],
  ["security exception", "config/security/exceptions/temporary.yml", "manual-po", "security-rule-exception"],
  ["write-capable Jira workflow", ".github/workflows/jira-sync.yml", "manual-po", "github-governance"],
  ["unknown path", "misc/unknown.bin", "manual-po", "ambiguous-path"],
]) {
  test(`${name} classifies as ${mode}`, () => {
    const result = classifyApprovalMode({ changedFiles: [path], ticket: { scope: "technical" }, defaultMode: "automated-policy" });
    assert.equal(result.effectiveApprovalMode, mode);
    assert.ok(result.reasons.includes(reason));
  });
}

test("sensitive file dominates an ordinary file", () => {
  const result = classifyApprovalMode({ changedFiles: ["apps/web/src/page.tsx", "infra/bootstrap/phase0/main.tf"], defaultMode: "automated-policy" });
  assert.equal(result.effectiveApprovalMode, "manual-po");
});

for (const path of [
  "apps/web/app/leads/[leadId]/timeline/page.tsx",
  "apps/web/app/leads/[leadId]/page.tsx",
  "apps/web/app/docs/[...slug]/page.tsx",
  "apps/web/app/docs/[[...slug]]/page.tsx",
  "apps/web/app/(admissions)/leads/page.tsx",
  "apps/web/app/@details/leads/[leadId]/page.tsx",
  "apps\\web\\app\\leads\\[leadId]\\timeline\\page.tsx",
]) {
  test(`valid Next.js application route is automated: ${path}`, () => {
    const result = classifyApprovalMode({
      changedFiles: [path],
      ticket: { scope: "application" },
      defaultMode: "automated-policy",
    });
    assert.deepEqual(result, { effectiveApprovalMode: "automated-policy", reasons: ["ordinary-scope"] });
  });
}

test("multiple ordinary application files including a dynamic route stay automated", () => {
  const result = classifyApprovalMode({
    changedFiles: [
      "apps/web/app/leads/[leadId]/timeline/page.tsx",
      "apps/web/test/lead-timeline.test.ts",
      "apps/api/src/leads/lead.controller.ts",
    ],
    ticket: { scope: "application" },
    defaultMode: "automated-policy",
  });
  assert.equal(result.effectiveApprovalMode, "automated-policy");
});

for (const [name, path] of [
  ["unclosed bracket", "apps/web/app/leads/[leadId/timeline/page.tsx"],
  ["empty dynamic parameter", "apps/web/app/leads/[]/page.tsx"],
  ["empty catch-all parameter", "apps/web/app/leads/[...]/page.tsx"],
  ["embedded traversal", "apps/web/app/leads/[../secret]/page.tsx"],
  ["parent traversal", "apps/web/app/leads/../secret/page.tsx"],
  ["POSIX absolute path", "/apps/web/app/leads/[leadId]/page.tsx"],
  ["Windows absolute path", "C:\\repo\\apps\\web\\app\\leads\\[leadId]\\page.tsx"],
  ["NUL character", "apps/web/app/leads/[leadId]/page.tsx\0.env"],
  ["dynamic route in workflow", ".github/workflows/[leadId]/build.yml"],
  ["dynamic route under infra", "infra/apps/web/app/[leadId]/main.tf"],
  ["dynamic route under secrets", "secrets/apps/web/app/[leadId]/value.txt"],
  ["unknown path", "misc/[leadId]/page.tsx"],
]) {
  test(`unsafe or out-of-scope Next.js-like path is manual: ${name}`, () => {
    const result = classifyApprovalMode({ changedFiles: [path], defaultMode: "automated-policy" });
    assert.equal(result.effectiveApprovalMode, "manual-po");
  });
}

test("a valid dynamic route mixed with GitHub governance remains manual-po", () => {
  const result = classifyApprovalMode({
    changedFiles: [
      "apps/web/app/leads/[leadId]/page.tsx",
      ".github/workflows/pr-policy.yml",
    ],
    defaultMode: "automated-policy",
  });
  assert.equal(result.effectiveApprovalMode, "manual-po");
  assert.ok(result.reasons.includes("github-governance"));
});

test("audited additive Prisma migration can use automated-policy", () => {
  const result = classifyApprovalMode({
    changedFiles: [
      "apps/api/prisma/schema.prisma",
      "apps/api/prisma/migrations/20260817_add_teams/migration.sql",
      "apps/api/prisma/migrations/20260817_add_teams/rollback.md",
    ],
    ticket: { scope: "application" },
    defaultMode: "automated-policy",
    migrationAssessment: { applicable: true, approved: true, reasons: [] },
  });
  assert.equal(result.effectiveApprovalMode, "automated-policy");
});

test("Prisma migration without conclusive audit fails closed", () => {
  const result = classifyApprovalMode({
    changedFiles: ["apps/api/prisma/migrations/unknown/migration.sql"],
    defaultMode: "automated-policy",
    migrationAssessment: { applicable: true, approved: false, reasons: ["migration_sql_ambiguous"] },
  });
  assert.equal(result.effectiveApprovalMode, "manual-po");
  assert.ok(result.reasons.includes("prisma-migration_sql_ambiguous"));
});

test("additive migration mixed with sensitive infrastructure remains manual-po", () => {
  const result = classifyApprovalMode({
    changedFiles: ["apps/api/prisma/migrations/20260817_add_teams/migration.sql", "infra/bootstrap/main.tf"],
    defaultMode: "automated-policy",
    migrationAssessment: { applicable: true, approved: true, reasons: [] },
  });
  assert.equal(result.effectiveApprovalMode, "manual-po");
  assert.ok(result.reasons.includes("terraform-bootstrap-state"));
});

test("empty diff fails closed to manual-po", () => {
  assert.equal(classifyApprovalMode({ changedFiles: [], defaultMode: "automated-policy" }).effectiveApprovalMode, "manual-po");
});

test("manual-po accepts complete SHA-bound human evidence", () => {
  const result = validatePullRequestPolicy(validManualPo());
  assert.equal(result.effectiveApprovalMode, "manual-po");
  assert.equal(result.approvalValidated, true);
});

for (const [name, mutate, reason] of [
  ["missing po-approved", (value) => { value.labels = []; }, "po_approved_label_missing"],
  ["policy-approved present", (value) => { value.labels.push("policy-approved"); }, "policy_approved_forbidden_in_manual_po"],
  ["incomplete checklist", (value) => { value.pullRequestBody = value.pullRequestBody.replace("- [x] Merge exclusivement manuel", "- [ ] Merge exclusivement manuel"); }, "po_checklist_incomplete"],
  ["wrong attestation SHA", (value) => { value.manualPoDecision.headSha = "b".repeat(40); }, "manual_po_decision_sha_mismatch"],
  ["auto-merge configured", (value) => { value.autoMerge = {}; }, "auto_merge_was_configured"],
  ["auto-merge timeline event", (value) => { value.autoMergeEvents = [{ event: "auto_merge_enabled" }]; }, "auto_merge_event_detected"],
  ["fork", (value) => { value.sourceRepository = "external/fork"; }, "external_fork_not_allowed"],
  ["unauthorized actor", (value) => { value.actor = "external"; }, "actor_not_allowed"],
  ["automation attempt", (value) => { value.automationRequested = true; }, "manual_po_automation_attempted"],
  ["untraceable PO label", (value) => { value.poLabelEvents = []; }, "po_approved_not_manually_traceable"],
  ["unresolved conversation", (value) => { value.conversationsResolved = false; }, "conversations_unresolved"],
  ["Draft PR", (value) => { value.draft = true; }, "manual_po_pull_request_is_draft"],
]) {
  test(`manual-po refuses ${name}`, () => {
    const value = validManualPo();
    mutate(value);
    assert.throws(() => validatePullRequestPolicy(value), (error) => error.reason === reason);
  });
}

test("manual-po marker is bound to PR, SHA and allowlisted human", () => {
  const marker = `<!-- manual-po-decision {"schemaVersion":1,"decision":"approved","pullRequest":42,"headSha":"${SHA}"} -->`;
  assert.equal(parseManualPoDecision(marker).decision, "approved");
  const result = selectManualPoDecision([{ id: 7, body: marker, user: { login: "shademounir", type: "User" } }], {
    pullRequestNumber: 42, headSha: SHA, allowedActors: ["shademounir"],
  });
  assert.equal(result.actor, "shademounir");
});

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
