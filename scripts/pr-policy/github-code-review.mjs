// GitHub code-review workflow only. Never changes tool safety or access policy.
import assert from 'node:assert/strict';

export const GITHUB_CODE_REVIEW_POLICY_PATH = 'docs/governance/github-code-review-policy.json';

// Callers must obtain this document from the actual protected base, not the PR
// working tree, a comment, an environment flag, or a mutable local override.
export function validateProtectedCodeReviewPolicy(value, repository) {
  assert.equal(value?.schemaVersion, 1, 'PROTECTED_CODE_REVIEW_POLICY_REQUIRED');
  assert.equal(value.repository, repository, 'CODE_REVIEW_POLICY_REPOSITORY');
  assert.equal(value.status, 'active', 'CODE_REVIEW_POLICY_INACTIVE');
  assert.equal(value.codexGitHubReviewRequired, false, 'CODE_REVIEW_POLICY_NOT_LIFTED');
  assert.equal(value.automaticCodeReviewRequests, false);
  assert.equal(value.manualCodeReviewRequests, false);
  assert.equal(value.otherTechnicalChecksMandatory, true, 'OTHER_CHECKS_MUST_REMAIN');
  assert.equal(value.knownFindingsMustBeResolved, true, 'KNOWN_FINDINGS_MUST_REMAIN');
  assert.equal(value.authority?.kind, 'EXPLICIT_OWNER_DECISION');
  assert.equal(typeof value.authority.reference, 'string');
  assert(value.authority.reference.length > 20);
  assert(/^[a-f0-9]{64}$/u.test(value.authority.documentSha256 ?? ''));
  return Object.freeze(structuredClone(value));
}

// Informational observation, never an approval or a substitute for actual
// unresolved-thread/change-request/technical-check and delegated-decision gates.
// A missing, Running, stale or malformed optional bot summary cannot grant or
// withhold merge authority on its own. Preserve the real state, never fake green.
export function observeOptionalCodexReview(comments, head) {
  assert(/^[a-f0-9]{40}$/u.test(head));
  const rows = (comments ?? []).filter(comment =>
    comment.user?.login === 'chatgpt-codex-connector[bot]' &&
    comment.user.type === 'Bot' &&
    comment.performed_via_github_app?.slug === 'chatgpt-codex-connector' &&
    typeof comment.body === 'string' &&
    comment.body.includes('<!-- codex-review-state:v1 '),
  ).sort((left, right) => Number(right.id) - Number(left.id));
  const selected = rows[0];
  if (!selected) return {required: false, commentId: null, status: 'absent', headMatches: false, approvalClaimed: false};
  let state;
  try {
    const marker = selected.body.match(/<!-- codex-review-state:v1 (.*?) -->/u);
    state = marker ? JSON.parse(marker[1]).code_review : null;
  } catch {
    state = null;
  }
  return {
    required: false,
    commentId: selected.id,
    status: typeof state?.status === 'string' ? state.status : 'unparseable',
    commitSha: typeof state?.commit_sha === 'string' ? state.commit_sha : null,
    headMatches: state?.commit_sha === head,
    hasAnyFindings: state?.has_any_findings ?? null,
    hasUnresolvedFindings: state?.has_unresolved_findings ?? null,
    approvalClaimed: false,
  };
}
