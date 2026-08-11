const AUTOMATED_POLICY_MODE = "automated-policy";
const MANUAL_PO_MODE = "manual-po";
const POLICY_LABEL = "policy-approved";
const PO_LABEL = "po-approved";
const VALID_TICKET_STATUSES = new Set(["To Do", "In Progress", "In Review"]);

const SENSITIVE_PATHS = [
  /^infra\/environments\/prod(?:\/|$)/i,
  /^infra\/.*(?:iam|billing|secret)/i,
  /^\.github\/workflows\/.*(?:prod|apply|destroy|iam|billing|secret)/i,
  /(?:^|\/)(?:secrets?|billing|iam|migrations?)(?:\/|$)/i,
  /(?:^|\/)(?:terraform-)?(?:apply|destroy)(?:\.|\/|$)/i,
];

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

function sensitiveFiles(files) {
  return files.filter((file) => SENSITIVE_PATHS.some((pattern) => pattern.test(file)));
}

function validateChecks(required, runs, expectedSha) {
  const latest = new Map();
  for (const run of runs ?? []) {
    if (run.name === "pr-policy") continue;
    if (!latest.has(run.name) || Number(run.id ?? 0) >= Number(latest.get(run.name)?.id ?? 0)) {
      latest.set(run.name, run);
    }
  }
  const missing = [];
  const pending = [];
  const failed = [];
  const wrongSha = [];
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

export function validatePullRequestPolicy({
  approvalMode,
  repository,
  sourceRepository,
  actor,
  allowedActors,
  branch,
  base,
  draft,
  labels,
  ticket,
  changedFiles = [],
  manifestProfile,
  mergeable,
  branchUpToDate,
  requiredChecks = [],
  checkRuns = [],
  checkSha,
}) {
  if (approvalMode !== AUTOMATED_POLICY_MODE) refuse("approval_mode_not_automated_policy");
  if (!repository || sourceRepository !== repository) refuse("external_fork_not_allowed");
  const allowlist = actors(allowedActors);
  if (!allowlist.includes(actor)) refuse("actor_not_allowed");

  const branchResult = branchPolicy(branch, base);
  const names = labelNames(labels);
  if (names.includes(PO_LABEL)) refuse("po_approved_reserved_for_manual_scope");
  if (!names.includes(POLICY_LABEL)) refuse("policy_approved_label_missing");
  if (draft !== false) refuse("pull_request_is_draft");

  if (!ticket?.key) refuse("jira_ticket_missing");
  if (branchResult.ticketKey && ticket.key !== branchResult.ticketKey) {
    refuse("jira_ticket_branch_mismatch");
  }
  if (ticket.issueType === "Epic") refuse("jira_epic_not_allowed");
  if (!labelNames(ticket.labels).includes("codex-ready")) {
    refuse("jira_codex_ready_missing");
  }
  if (ticket.blocked === true || labelNames(ticket.labels).includes("blocked")) {
    refuse("jira_ticket_blocked");
  }
  if (!VALID_TICKET_STATUSES.has(ticket.status)) refuse("jira_status_not_compatible");

  const protectedFiles = sensitiveFiles(changedFiles);
  if (
    ticket.scope === "prod" ||
    ticket.scope === MANUAL_PO_MODE ||
    manifestProfile === "application" ||
    protectedFiles.length > 0
  ) {
    refuse("manual_po_scope_required", { protectedFiles });
  }
  if (branchResult.kind === "release" && manifestProfile !== "gate-1") {
    refuse("release_gate_profile_required");
  }

  const manifests = changedFiles.filter((file) => file.endsWith("release-manifest.json"));
  if (manifests.length > 1 || manifests.some((file) => file !== "release-manifest.json")) {
    refuse("release_manifest_collision");
  }
  if (mergeable !== true) refuse("pull_request_conflict");
  if (branchUpToDate !== true) refuse("branch_not_up_to_date");
  validateChecks(requiredChecks, checkRuns, checkSha);

  return {
    mode: AUTOMATED_POLICY_MODE,
    policyLabel: POLICY_LABEL,
    actor,
    branch,
    base,
    branchKind: branchResult.kind,
    ticketKey: ticket.key,
    checks: [...requiredChecks],
    sensitiveFiles: 0,
    mergeable: true,
    branchUpToDate: true,
  };
}

export function parseAuditComment(body) {
  const match = /<!-- codex-policy-audit\s*([\s\S]*?)\s*-->/.exec(String(body ?? ""));
  if (!match) return undefined;
  try {
    const value = JSON.parse(match[1]);
    return value?.schemaVersion === 1 ? value : undefined;
  } catch {
    return undefined;
  }
}

export function selectAuditComment(comments, { headSha, allowedActors }) {
  const allowlist = actors(allowedActors);
  const candidates = (comments ?? [])
    .map((comment) => ({ comment, audit: parseAuditComment(comment.body) }))
    .filter(({ comment, audit }) =>
      audit &&
      audit.headSha === headSha &&
      audit.verifiedBy === comment.user?.login &&
      allowlist.includes(comment.user?.login),
    )
    .sort((left, right) => Number(right.comment.id) - Number(left.comment.id));
  if (candidates.length === 0) refuse("jira_audit_comment_missing");
  return candidates[0].audit;
}

export {
  AUTOMATED_POLICY_MODE,
  MANUAL_PO_MODE,
  POLICY_LABEL,
  PO_LABEL,
  sensitiveFiles,
};
