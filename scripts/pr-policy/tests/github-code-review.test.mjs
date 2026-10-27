import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {validateProtectedCodeReviewPolicy, observeOptionalCodexReview} from '../github-code-review.mjs';

const repository = 'shademounir/CrmYnov';
const policy = JSON.parse(fs.readFileSync(new URL('../../../docs/governance/github-code-review-policy.json', import.meta.url)));
const head = 'a'.repeat(40);
function comment(state, id = 101) {
  return {id, user: {login: 'chatgpt-codex-connector[bot]', type: 'Bot'},
    performed_via_github_app: {slug: 'chatgpt-codex-connector'},
    body: '<!-- codex-review-state:v1 ' + JSON.stringify({code_review: state}) + ' -->'};
}

test('owner policy lifts only GitHub code review; other checks and known defects remain mandatory', () => {
  const result = validateProtectedCodeReviewPolicy(policy, repository);
  assert.equal(result.codexGitHubReviewRequired, false);
  assert.equal(result.otherTechnicalChecksMandatory, true);
  assert.equal(result.knownFindingsMustBeResolved, true);
  assert(Object.isFrozen(result));
});

for (const [name, change] of [
  ['missing policy', () => undefined],
  ['foreign repository', p => ({...p, repository: 'other/repo'})],
  ['revoked policy', p => ({...p, status: 'revoked'})],
  ['mandatory review still present', p => ({...p, codexGitHubReviewRequired: true})],
  ['other checks disabled', p => ({...p, otherTechnicalChecksMandatory: false})],
  ['known findings ignored', p => ({...p, knownFindingsMustBeResolved: false})],
  ['authority absent', p => ({...p, authority: null})],
]) test('protected policy refuses ' + name, () => {
  assert.throws(() => validateProtectedCodeReviewPolicy(change(structuredClone(policy)), repository));
});

for (const status of ['running', 'completed', 'failed', 'cancelled']) {
  test('optional real bot status ' + status + ' is observed without inventing approval', () => {
    const result = observeOptionalCodexReview([comment({commit_sha: head, status,
      has_any_findings: true, has_unresolved_findings: true})], head);
    assert.equal(result.status, status);
    assert.equal(result.headMatches, true);
    assert.equal(result.required, false);
    assert.equal(result.approvalClaimed, false);
    assert.equal(result.hasAnyFindings, true);
    assert.equal(result.hasUnresolvedFindings, true);
  });
}

test('absent, stale or malformed optional review cannot impersonate a favourable review', () => {
  assert.equal(observeOptionalCodexReview([], head).status, 'absent');
  const stale = observeOptionalCodexReview([comment({commit_sha: 'b'.repeat(40), status: 'completed'})], head);
  assert.equal(stale.headMatches, false);
  assert.equal(stale.approvalClaimed, false);
  const malformed = comment({}); malformed.body = '<!-- codex-review-state:v1 invalid -->';
  assert.equal(observeOptionalCodexReview([malformed], head).status, 'unparseable');
});

test('only authenticated integration summaries are observations; latest real summary wins', () => {
  const fake = comment({commit_sha: head, status: 'completed'}, 999); fake.user.login = 'other';
  const old = comment({commit_sha: head, status: 'completed'}, 1);
  const current = comment({commit_sha: head, status: 'running'}, 2);
  assert.equal(observeOptionalCodexReview([fake, old, current], head).status, 'running');
  assert.equal(observeOptionalCodexReview([fake], head).status, 'absent');
});
