import { createHash } from "node:crypto";

export const DELEGATED_CODEX_MODE = "delegated-codex";
export const DELEGATED_LABEL = "codex-delegated-approved";
export const GRANT_PATH = "docs/governance/codex-delegation.json";
export const DELEGATED_CHECKS = Object.freeze([
  "lint", "type-check", "unit-tests", "integration-tests", "playwright", "build",
  "dependency-review", "secret-scan", "container-scan (api)", "container-scan (web)",
  "CodeQL", "SonarQube Quality Gate", "quality-gate", "prisma-migration-policy",
  "terraform-static", "iac-security",
]);

function refuse(reason) {
  const error = new Error(`Codex delegation refused: ${reason}.`);
  error.reason = reason;
  throw error;
}

export function grantDigest(grant) {
  return createHash("sha256").update(JSON.stringify(grant)).digest("hex");
}

export function scopeDigest(files) {
  return createHash("sha256").update(JSON.stringify([...new Set(files)].sort((a, b) => a.localeCompare(b, "en")))).digest("hex");
}

// Only callers collecting immutable GitHub evidence may supply trustedGrant.
// Never load the authority from the PR working tree or from a decision comment.
export function validateGrant(grant, { repository, actor, base, changedFiles = [], reasons = [], headGrantDigest }) {
  if (grant?.schemaVersion !== 1 || grant.status !== "active") refuse("delegation_grant_missing_or_revoked");
  if (grant.repository !== repository || grant.executor !== "Codex") refuse("delegation_grant_identity_mismatch");
  if (!grant.authenticatedActors?.includes(actor)) refuse("delegation_actor_not_allowed");
  if (!grant.allowedBases?.includes(base)) refuse("delegation_base_not_allowed");
  if (!grant.id || !grant.authority?.reference || !Number.isFinite(Date.parse(grant.authority?.decidedAt))) {
    refuse("delegation_authority_missing");
  }
  if (changedFiles.includes(GRANT_PATH) && !(base === "main" && headGrantDigest === grantDigest(grant))) {
    refuse("delegation_authority_change_requires_manual_po");
  }
  if (reasons.some((reason) => reason.startsWith("ambiguous") || reason.startsWith("prisma-"))) {
    refuse("delegation_unresolved_scope_or_migration");
  }
  if (reasons.some((reason) => !grant.allowedReasons?.includes(reason))) refuse("delegation_scope_not_authorized");
  return grant;
}

export function selectDelegatedDecision(comments, allowedActors) {
  const candidates = (comments ?? []).filter((comment) =>
    allowedActors.includes(comment.user?.login) && comment.user?.type === "User" &&
    String(comment.body).includes("<!-- codex-delegated-decision"),
  ).sort((a, b) => Number(b.id) - Number(a.id));
  if (!candidates.length) return undefined;
  const comment = candidates[0];
  const body = String(comment.body);
  const prefix = "<!-- codex-delegated-decision";
  const start = body.indexOf(prefix);
  if (body.length > 65_536 || start !== body.lastIndexOf(prefix)) refuse("delegated_decision_ambiguous");
  const end = body.indexOf("-->", start + prefix.length);
  if (end < 0) refuse("delegated_decision_invalid");
  let value;
  try { value = JSON.parse(body.slice(start + prefix.length, end).trim()); } catch { refuse("delegated_decision_invalid"); }
  // GitHub provenance overrides any identity/date supplied by the marker.
  return { ...value, actor: comment.user.login, commentId: Number(comment.id), createdAt: comment.created_at,
    updatedAt: comment.updated_at ?? comment.created_at };
}

function validateDecisionIdentity(decision, grant, headSha, pullRequestNumber, changedFiles) {
  if (decision?.schemaVersion !== 1 || decision.executor !== "Codex" || decision.decision !== "approved") {
    refuse("delegated_decision_missing_or_revoked");
  }
  if (decision.grantId !== grant.id || decision.grantDigest !== grantDigest(grant)) refuse("delegated_grant_mismatch");
  if (!grant.authenticatedActors.includes(decision.actor)) refuse("delegated_decision_actor_not_allowed");
  if (decision.headSha !== headSha || !/^[a-f0-9]{40}$/.test(headSha ?? "")) refuse("delegated_decision_sha_mismatch");
  if (decision.pullRequest !== pullRequestNumber) refuse("delegated_decision_pr_mismatch");
  if (decision.scopeDigest !== scopeDigest(changedFiles)) refuse("delegated_decision_scope_mismatch");
  if (!Number.isSafeInteger(decision.commentId) || decision.commentId <= 0) refuse("delegated_decision_not_traceable");
}

function validateDecisionEvidence(decision, grant, mergedAt) {
  const at = Date.parse(decision.updatedAt ?? decision.createdAt);
  if (!Number.isFinite(at) || at < Date.parse(grant.authority.decidedAt) ||
    (mergedAt && (!Number.isFinite(Date.parse(mergedAt)) || at > Date.parse(mergedAt)))) refuse("delegated_decision_invalid_date");
  if (decision.personalVisualAcceptance !== false || decision.productionDeploymentAuthorized !== false) {
    refuse("delegated_decision_misrepresents_acceptance_or_deployment");
  }
  if (!Array.isArray(decision.reservations) || !Array.isArray(decision.evidence) || !decision.evidence.length ||
    decision.evidence.some((entry) => typeof entry !== "string" || !entry.startsWith("https://")) ||
    typeof decision.rollback !== "string" || decision.rollback.trim().length < 20) refuse("delegated_evidence_incomplete");
}

function validateExaminedChecks(decision, requiredChecks, checkRuns, headSha) {
  if (!requiredChecks?.length) refuse("delegated_checks_missing");
  for (const name of requiredChecks) {
    const latest = (checkRuns ?? []).filter((run) => run.name === name)
      .sort((a, b) => Number(b.id) - Number(a.id))[0];
    if (latest?.status !== "completed" || latest.conclusion !== "success" || latest.head_sha !== headSha) {
      refuse("delegated_check_not_successful");
    }
    if (!decision.checks?.some((proof) => proof.name === name && proof.id === latest.id)) refuse("delegated_check_not_examined");
  }
}

export function validateDelegatedDecision({ decision, grant, repository, actor, base, changedFiles, reasons,
  headSha, pullRequestNumber, requiredChecks, checkRuns, mergedAt, headGrantDigest }) {
  validateGrant(grant, { repository, actor, base, changedFiles, reasons, headGrantDigest });
  validateDecisionIdentity(decision, grant, headSha, pullRequestNumber, changedFiles);
  validateDecisionEvidence(decision, grant, mergedAt);
  validateExaminedChecks(decision, requiredChecks, checkRuns, headSha);
  return { approvalValidated: true, humanApproved: false, executor: "Codex", grantId: grant.id,
    grantDigest: grantDigest(grant), decisionCommentId: decision.commentId, headSha,
    scopeDigest: decision.scopeDigest, reservations: decision.reservations, rollback: decision.rollback };
}
