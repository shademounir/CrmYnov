// Shared refusal boundary for the new, distinct GENERAL PRE and POST entrypoints.
// It does not acquire authority, tokens, claims, or a transport. Production
// callers must bind those operations to their protected phase-specific modules.
import assert from 'node:assert/strict';
import {byteHash} from '../pool-reconciliation/controlled-pool-contract-v1.mjs';
import {validateOperationalJiraComposedReadinessV1} from './cutover-jira-readiness-v1.mjs';

const phases = Object.freeze({GENERAL_PRE: 'GENERAL_PRE_READINESS', POST: 'POST_READINESS'});
const sha = /^[a-f0-9]{64}$/u;
const objective = Object.freeze({
  GENERAL_PRE: /^rc48-general-operational-pre-v4-[a-z0-9-]{8,63}$/u,
  POST: /^rc48-general-post-[a-z0-9-]{8,63}$/u,
});

function ownAuthority(value, phase, expected, now) {
  assert(value && Object.getPrototypeOf(value) === Object.prototype, 'NATIVE_PHASE_AUTHORITY_OBJECT');
  assert.equal(value.phase, phase, 'NATIVE_PHASE_AUTHORITY_CROSSED');
  assert.equal(value.objectiveId, expected.objectiveId, 'NATIVE_PHASE_OBJECTIVE_CROSSED');
  assert(objective[phase].test(value.objectiveId), 'NATIVE_PHASE_OBJECTIVE_FORMAT');
  assert.equal(value.resourceBindingSha256, expected.resourceBindingSha256, 'NATIVE_PHASE_RESOURCE_CROSSED');
  assert.equal(value.jiraObservationSha256, expected.jiraObservationSha256, 'NATIVE_PHASE_JIRA_CROSSED');
  if (value.receipt !== undefined) {
    assert.equal(value.receipt.actor, expected.actor, 'NATIVE_PHASE_ACTOR_CROSSED');
    assert.equal(value.receipt.grantDigest, expected.grantSha256, 'NATIVE_PHASE_GRANT_CROSSED');
  }
  assert(sha.test(value.authorityRecordSha256), 'NATIVE_PHASE_AUTHORITY_RECORD_REQUIRED');
  assert.equal(value.runAuthorized, true, 'NATIVE_PHASE_RUN_AUTHORITY_REQUIRED');
  assert.equal(value.businessMutationAuthorized, false, 'NATIVE_PHASE_BUSINESS_MUTATION_REFUSED');
  assert.equal(value.maximumRunPosts, 1, 'NATIVE_PHASE_SINGLE_RUN_REQUIRED');
  assert.deepEqual(value.actions, ['RUN'], 'NATIVE_PHASE_RUN_ACTION_REQUIRED');
  assert(Number.isSafeInteger(value.markerCommentId) && value.markerCommentId > 0, 'NATIVE_PHASE_OFFICIAL_MARKER_REQUIRED');
  const start = Date.parse(value.validFrom), end = Date.parse(value.expiresAt);
  assert(Number.isSafeInteger(start) && Number.isSafeInteger(end) && start <= now && now < end && end > start, 'NATIVE_PHASE_AUTHORITY_EXPIRED');
  return value;
}

function inputShape(input) {
  assert(input && Object.getPrototypeOf(input) === Object.prototype, 'NATIVE_PHASE_INPUTS');
  const {phase, objectiveId, resourceBindingSha256, jiraBytes, humanScopeBytes,
    actor, grantSha256, clock, authorize, claimExists, preflight, arm, transport} = input;
  assert(Object.hasOwn(phases, phase), 'NATIVE_PHASE_UNRECOGNIZED');
  assert(objective[phase].test(objectiveId), 'NATIVE_PHASE_OBJECTIVE_FORMAT');
  assert(sha.test(resourceBindingSha256) && sha.test(grantSha256), 'NATIVE_PHASE_HASH_REQUIRED');
  assert(Buffer.isBuffer(jiraBytes) && Buffer.isBuffer(humanScopeBytes), 'NATIVE_PHASE_JIRA_BYTES_REQUIRED');
  assert(typeof actor === 'string' && actor.length > 0, 'NATIVE_PHASE_ACTOR_REQUIRED');
  for (const fn of [clock, authorize, claimExists, preflight, arm, transport]) assert.equal(typeof fn, 'function', 'NATIVE_PHASE_FIXED_OPERATION_REQUIRED');
  return {phase, objectiveId, resourceBindingSha256, jiraBytes, humanScopeBytes, actor, grantSha256, clock, authorize, claimExists, preflight, arm, transport};
}

// The ordering is deliberate: composed Jira readiness is checked independently,
// then an independently issued RUN authority is fetched and checked, and only
// then may bounded read-only preflight run. Revalidate every short lease after
// preflight and arm a durable one-use claim immediately before the native POST.
export async function runCutoverNativePhaseBoundaryV1(raw) {
  const input = inputShape(raw), first = input.clock();
  assert(Number.isSafeInteger(first), 'NATIVE_PHASE_CLOCK');
  const jiraObservationSha256 = byteHash(input.jiraBytes);
  const expected = {objectiveId: input.objectiveId, resourceBindingSha256: input.resourceBindingSha256, jiraObservationSha256,
    actor: input.actor, grantSha256: input.grantSha256};
  const verifyJira = now => validateOperationalJiraComposedReadinessV1({
    jiraBytes: input.jiraBytes, expectedSha256: jiraObservationSha256, actor: input.actor,
    grantSha256: input.grantSha256, now, scope: phases[input.phase], humanScopeBytes: input.humanScopeBytes,
  });
  verifyJira(first);
  assert.equal(await input.claimExists(input.phase, input.objectiveId), false, 'NATIVE_PHASE_ALREADY_CONSUMED');
  const authority = ownAuthority(await input.authorize(input.phase, input.objectiveId), input.phase, expected, input.clock());
  verifyJira(input.clock());
  assert.equal(await input.claimExists(input.phase, input.objectiveId), false, 'NATIVE_PHASE_ALREADY_CONSUMED');
  ownAuthority(authority, input.phase, expected, input.clock());
  const preflight = await input.preflight({phase: input.phase, objectiveId: input.objectiveId, authority});
  verifyJira(input.clock());
  assert.equal(await input.claimExists(input.phase, input.objectiveId), false, 'NATIVE_PHASE_ALREADY_CONSUMED');
  ownAuthority(authority, input.phase, expected, input.clock());
  await input.arm({phase: input.phase, objectiveId: input.objectiveId,
    authorityRecordSha256: authority.authorityRecordSha256,
    markerCommentId: authority.markerCommentId, jiraObservationSha256, canRetry: false, preflight});
  return input.transport({phase: input.phase, objectiveId: input.objectiveId, authority, preflight});
}
