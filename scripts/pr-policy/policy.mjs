import { MIGRATION_SQL, ROLLBACK_DOC } from "./migration-policy.mjs";

const AUTOMATED_POLICY_MODE = "automated-policy";
const MANUAL_PO_MODE = "manual-po";
const POLICY_LABEL = "policy-approved";
const PO_LABEL = "po-approved";
const VALID_TICKET_STATUSES = new Set(["To Do", "In Progress", "In Review"]);

const SENSITIVE_RULES = Object.freeze([
  ["github-governance", /^(?:\.github\/(?:workflows|CODEOWNERS|pull_request_template)|docs\/(?:governance|security)|scripts\/pr-policy)(?:\/|\.|$)/i],
  ["iam-wif", /(?:^|\/)(?:iam|wif|workload-identity|identity-federation)(?:\/|\.|-|$)/i],
  ["billing-budget", /(?:^|\/)(?:billing|budgets?)(?:\/|\.|-|$)/i],
  ["secret-configuration", /(?:^|\/)(?:secrets?|credentials?)(?:\/|\.|-|$)|(?:^|\/)\.env(?:\.|$)/i],
  ["terraform-bootstrap-state", /^(?:infra\/bootstrap|infra\/.*(?:backend|state)|scripts\/terraform-|.*\.(?:tf|tfvars))(?:\/|\.|-|$)/i],
  ["production", /(?:^|\/)(?:prod|production)(?:\/|\.|-|$)/i],
  ["destructive-migration", /(?:^|\/)(?:migrations?|data-migrations?)(?:\/|\.|-|$)/i],
  ["security-rule-exception", /(?:^|\/)(?:security|exceptions?|polic(?:y|ies)|branch-protection|rulesets?)(?:\/|\.|-|$)/i],
  ["write-capable-workflow", /^\.github\/workflows\/.*(?:write|deploy|release|publish|apply|destroy|sync|mutation)/i],
]);

const ORDINARY_RULES = Object.freeze([
  /^(?:apps|packages|libs)\/[A-Za-z0-9_.\/-]+$/,
  /^docs\/(?!governance(?:\/|$)|security(?:\/|$)|risks?(?:\/|$))[A-Za-z0-9_.\/-]+\.md$/i,
  /^(?:README|CONTRIBUTING|LICENSE)(?:\.[A-Za-z0-9]+)?$/i,
  /^(?:test|tests)\/[A-Za-z0-9_.\/-]+$/,
]);

const PO_CHECKLIST = Object.freeze([
  "Revue manuelle effectuée par le Product Owner",
  "Label `po-approved` ajouté manuellement par le Product Owner",
  "Toutes les conversations sont résolues",
  "La branche est à jour",
  "Les contrôles obligatoires sont verts",
  "Auto-merge désactivé",
  "Merge exclusivement manuel",
]);

function refuse(reason, details = {}) {
  const error = new Error(`Pull request policy refused: ${reason}.`);
  error.reason = reason;
  error.details = details;
  throw error;
}

function actors(value) {
  return [...new Set((Array.isArray(value) ? value : String(value ?? "").split(","))
    .map((entry) => String(entry).trim())
    .filter(Boolean))];
}

function labelNames(labels) {
  return (Array.isArray(labels) ? labels : []).map((label) =>
    typeof label === "string" ? label : label?.name,
  );
}

function branchPolicy(branch, base) {
  const work = /^(feature|fix)\/(CRMY-\d+)-[a-z0-9][a-z0-9-]*$/.exec(branch);
  if (work) {
    if (base !== "develop") refuse("work_branch_base_not_develop");
    return { kind: work[1], ticketKey: work[2] };
  }
  if (/^release\/v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(branch)) {
    if (base !== "main") refuse("release_branch_base_not_main");
    return { kind: "release", ticketKey: undefined };
  }
  refuse("branch_name_not_allowed");
}

function migrationReasons(migrationAssessment) {
  if (migrationAssessment?.applicable === true && migrationAssessment.approved === true) return [];
  const failures = migrationAssessment?.reasons?.length
    ? migrationAssessment.reasons
    : ["migration_static_audit_missing"];
  return failures.map((failure) => `prisma-${failure}`);
}

function reasonsForPath(path, manifestProfile, migrationAssessment) {
  if (path === "release-manifest.json" && manifestProfile === "gate-1") return [];
  if (MIGRATION_SQL.test(path) || ROLLBACK_DOC.test(path)) return migrationReasons(migrationAssessment);
  const sensitive = SENSITIVE_RULES
    .filter(([, pattern]) => pattern.test(path))
    .map(([reason]) => reason);
  if (sensitive.length) return sensitive;
  return ORDINARY_RULES.some((pattern) => pattern.test(path)) ? [] : ["ambiguous-path"];
}

export function classifyApprovalMode({ changedFiles = [], ticket, manifestProfile, defaultMode, migrationAssessment }) {
  if (![AUTOMATED_POLICY_MODE, MANUAL_PO_MODE].includes(defaultMode)) {
    refuse("default_approval_mode_invalid");
  }
  if (!Array.isArray(changedFiles) || changedFiles.length === 0) {
    return { effectiveApprovalMode: MANUAL_PO_MODE, reasons: ["ambiguous-empty-diff"] };
  }
  const reasons = new Set();
  if (ticket?.scope === "prod" || ticket?.scope === MANUAL_PO_MODE) reasons.add("ticket-sensitive-scope");
  if (manifestProfile === "application") reasons.add("application-release");
  for (const file of changedFiles) {
    for (const reason of reasonsForPath(String(file ?? ""), manifestProfile, migrationAssessment)) reasons.add(reason);
  }
  if (reasons.size > 0 || defaultMode === MANUAL_PO_MODE) {
    return {
      effectiveApprovalMode: MANUAL_PO_MODE,
      reasons: reasons.size ? [...reasons].sort((left, right) => left.localeCompare(right)) : ["default-manual-po"],
    };
  }
  return { effectiveApprovalMode: AUTOMATED_POLICY_MODE, reasons: ["ordinary-scope"] };
}

function validateChecks(required, runs, expectedSha) {
  const latest = new Map();
  for (const run of runs ?? []) {
    if (run.name === "pr-policy") continue;
    if (!latest.has(run.name) || Number(run.id ?? 0) >= Number(latest.get(run.name)?.id ?? 0)) latest.set(run.name, run);
  }
  const missing = [], pending = [], failed = [], wrongSha = [];
  for (const name of required) {
    const run = latest.get(name);
    if (!run) missing.push(name);
    else if (run.status !== "completed") pending.push(name);
    else if (run.conclusion !== "success") failed.push(name);
    else if (run.head_sha !== expectedSha) wrongSha.push(name);
  }
  if (missing.length) refuse("required_check_missing", { missing });
  if (pending.length) refuse("required_check_pending", { pending });
  if (failed.length) refuse("required_check_failed", { failed });
  if (wrongSha.length) refuse("required_check_wrong_sha", { wrongSha });
}

function validateTicket(ticket, branchResult) {
  if (!ticket?.key) refuse("jira_ticket_missing");
  if (branchResult.ticketKey && ticket.key !== branchResult.ticketKey) refuse("jira_ticket_branch_mismatch");
  if (ticket.issueType === "Epic") refuse("jira_epic_not_allowed");
  if (!labelNames(ticket.labels).includes("codex-ready")) refuse("jira_codex_ready_missing");
  if (ticket.blocked === true || labelNames(ticket.labels).includes("blocked")) refuse("jira_ticket_blocked");
  if (!VALID_TICKET_STATUSES.has(ticket.status)) refuse("jira_status_not_compatible");
}

export function parseManualPoDecision(body) {
  const match = /<!-- manual-po-decision\s*([\s\S]*?)\s*-->/.exec(String(body ?? ""));
  if (!match) return undefined;
  try {
    const value = JSON.parse(match[1]);
    return value?.schemaVersion === 1 ? value : undefined;
  } catch {
    return undefined;
  }
}

export function selectManualPoDecision(comments, { pullRequestNumber, headSha, allowedActors }) {
  const allowlist = actors(allowedActors);
  const candidates = (comments ?? [])
    .map((comment) => ({ comment, decision: parseManualPoDecision(comment.body) }))
    .filter(({ comment, decision }) =>
      decision && comment.user?.type === "User" && allowlist.includes(comment.user?.login),
    )
    .sort((left, right) => Number(right.comment.id) - Number(left.comment.id));
  if (!candidates.length) refuse("manual_po_decision_missing");
  const { comment, decision } = candidates[0];
  if (decision.decision !== "approved") refuse("manual_po_decision_not_approved");
  if (decision.pullRequest !== pullRequestNumber) refuse("manual_po_decision_pr_mismatch");
  if (decision.headSha !== headSha) refuse("manual_po_decision_sha_mismatch");
  return { actor: comment.user.login, commentId: Number(comment.id), headSha, pullRequest: pullRequestNumber };
}

export function validatePoChecklist(body) {
  const missing = PO_CHECKLIST.filter((item) => {
    const escaped = item.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return !new RegExp(`^\\s*- \\[x\\] ${escaped}\\.?\\s*$`, "im").test(String(body ?? ""));
  });
  if (missing.length) refuse("po_checklist_incomplete", { missingCount: missing.length });
}

export function validatePullRequestPolicy({
  approvalMode: defaultMode,
  repository, sourceRepository, actor, allowedActors, branch, base, draft, labels,
  ticket, changedFiles = [], manifestProfile, mergeable, branchUpToDate,
  migrationAssessment,
  requiredChecks = [], checkRuns = [], checkSha, pullRequestNumber, pullRequestBody,
  manualPoDecision, autoMerge, autoMergeEvents = [], conversationsResolved,
  poLabelEvents = [], automationRequested = false,
}) {
  if (!repository || sourceRepository !== repository) refuse("external_fork_not_allowed");
  const allowlist = actors(allowedActors);
  if (!allowlist.includes(actor)) refuse("actor_not_allowed");
  const branchResult = branchPolicy(branch, base);
  validateTicket(ticket, branchResult);
  const classification = classifyApprovalMode({ changedFiles, ticket, manifestProfile, defaultMode, migrationAssessment });
  const names = labelNames(labels);

  if (classification.effectiveApprovalMode === AUTOMATED_POLICY_MODE) {
    if (names.includes(PO_LABEL)) refuse("po_approved_reserved_for_manual_scope");
    if (!names.includes(POLICY_LABEL)) refuse("policy_approved_label_missing");
    if (draft !== false) refuse("pull_request_is_draft");
    if (branchResult.kind === "release" && manifestProfile !== "gate-1") refuse("release_gate_profile_required");
  } else {
    if (!names.includes(PO_LABEL)) refuse("po_approved_label_missing");
    if (names.includes(POLICY_LABEL)) refuse("policy_approved_forbidden_in_manual_po");
    if (draft !== false) refuse("manual_po_pull_request_is_draft");
    validatePoChecklist(pullRequestBody);
    if (!manualPoDecision) refuse("manual_po_decision_missing");
    if (manualPoDecision.headSha !== checkSha) refuse("manual_po_decision_sha_mismatch");
    if (manualPoDecision.pullRequest !== pullRequestNumber) refuse("manual_po_decision_pr_mismatch");
    if (!allowlist.includes(manualPoDecision.actor)) refuse("manual_po_decision_actor_not_allowed");
    if (autoMerge !== null) refuse("auto_merge_was_configured");
    if (autoMergeEvents.length) refuse("auto_merge_event_detected");
    if (automationRequested) refuse("manual_po_automation_attempted");
    if (
      poLabelEvents.length !== 1 ||
      poLabelEvents[0]?.actorType !== "User" ||
      !allowlist.includes(poLabelEvents[0]?.actor)
    ) refuse("po_approved_not_manually_traceable");
    if (conversationsResolved !== true) refuse("conversations_unresolved");
  }

  const manifests = changedFiles.filter((file) => file.endsWith("release-manifest.json"));
  if (manifests.length > 1 || manifests.some((file) => file !== "release-manifest.json")) refuse("release_manifest_collision");
  if (mergeable !== true) refuse("pull_request_conflict");
  if (branchUpToDate !== true) refuse("branch_not_up_to_date");
  validateChecks(requiredChecks, checkRuns, checkSha);

  return {
    mode: classification.effectiveApprovalMode,
    effectiveApprovalMode: classification.effectiveApprovalMode,
    classificationReasons: classification.reasons,
    actor, branch, base, branchKind: branchResult.kind, ticketKey: ticket.key,
    checks: [...requiredChecks], mergeable: true, branchUpToDate: true,
    approvalValidated: true,
  };
}

export function parseAuditComment(body) {
  const match = /<!-- codex-policy-audit\s*([\s\S]*?)\s*-->/.exec(String(body ?? ""));
  if (!match) return undefined;
  try {
    const value = JSON.parse(match[1]);
    return value?.schemaVersion === 1 ? value : undefined;
  } catch { return undefined; }
}

export function selectAuditComment(comments, { headSha, allowedActors }) {
  const allowlist = actors(allowedActors);
  const candidates = (comments ?? [])
    .map((comment) => ({ comment, audit: parseAuditComment(comment.body) }))
    .filter(({ comment, audit }) => audit && audit.headSha === headSha && audit.verifiedBy === comment.user?.login && allowlist.includes(comment.user?.login))
    .sort((left, right) => Number(right.comment.id) - Number(left.comment.id));
  if (!candidates.length) refuse("jira_audit_comment_missing");
  return candidates[0].audit;
}

export { AUTOMATED_POLICY_MODE, MANUAL_PO_MODE, POLICY_LABEL, PO_LABEL, SENSITIVE_RULES };
