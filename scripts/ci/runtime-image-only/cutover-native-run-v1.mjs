// A one-use RUN dispatch for either newly governed phase. This module never
// treats a Jira read as a run capability, and never retries an ambiguous POST.
// Historical GENERAL/POST executors and their journals are not opened here.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {byteHash, digest} from '../pool-reconciliation/controlled-pool-contract-v1.mjs';
import {validateReadOnlyObjective, validateReadOnlyNativeJob} from '../pool-reconciliation/pool-native-output-v1.mjs';
import {runCutoverNativePhaseBoundaryV1} from './cutover-native-phase-boundary-v1.mjs';

const operationName = /^projects\/crmynov-prod-n7x4q2\/locations\/europe-west1\/operations\/[A-Za-z0-9_-]+$/u;

function durable(file, value) {
  const bytes = Buffer.from(JSON.stringify(value, null, 2) + '\n');
  const fd = fs.openSync(file, 'wx', 0o600);
  try {
    for (let offset = 0; offset < bytes.length;) {
      const count = fs.writeSync(fd, bytes, offset, bytes.length - offset);
      assert(count > 0, 'CUTOVER_RUN_DURABLE_WRITE'); offset += count;
    }
    fs.fsyncSync(fd);
  } finally { fs.closeSync(fd); }
  return {path: file, sha256: byteHash(bytes)};
}

export function openCutoverNativeRunJournalV1(directory) {
  assert(path.isAbsolute(directory) && fs.realpathSync(directory) === path.resolve(directory), 'CUTOVER_RUN_CANONICAL_JOURNAL');
  assert(fs.lstatSync(directory).isDirectory() && !fs.lstatSync(directory).isSymbolicLink(), 'CUTOVER_RUN_JOURNAL_TYPE');
  assert.deepEqual(fs.readdirSync(directory), [], 'CUTOVER_RUN_JOURNAL_MUST_BE_VIRGIN');
  let claimed = false, intent = false, operation = false;
  const file = name => path.join(directory, name + '.json');
  return Object.freeze({
    claimExists() { return claimed || fs.existsSync(file('CLAIM')); },
    arm(value) {
      assert(!claimed && !fs.existsSync(file('CLAIM')), 'CUTOVER_RUN_ALREADY_CLAIMED');
      assert.equal(value.canRetry, false);
      durable(file('CLAIM'), {schemaVersion: 1, kind: 'CUTOVER_NATIVE_RUN_CLAIM_V1', ...value});
      claimed = true;
    },
    intent(value) {
      assert(claimed && !intent, 'CUTOVER_RUN_INTENT_ORDER');
      durable(file('RUN-INTENT'), {schemaVersion: 1, kind: 'CUTOVER_NATIVE_RUN_INTENT_V1', ...value, canRetry: false});
      intent = true;
    },
    operation(name, responseSha256) {
      assert(intent && !operation && operationName.test(name), 'CUTOVER_RUN_OPERATION_ORDER');
      durable(file('RUN-OPERATION'), {schemaVersion: 1, kind: 'CUTOVER_NATIVE_RUN_OPERATION_V1', name, responseSha256, canRetry: false});
      operation = true;
    },
    stop(value) {
      if (!claimed) return;
      if (fs.existsSync(file('RUN-STOP'))) return;
      durable(file('RUN-STOP'), {schemaVersion: 1, kind: 'CUTOVER_NATIVE_RUN_STOP_V1', ...value, canRetry: false});
    },
  });
}

function noPriorExecution(job) {
  assert.equal(job.executionCount ?? 0, 0, 'CUTOVER_RUN_EXISTING_EXECUTION_REFUSED');
  const latest = job.latestCreatedExecution;
  assert(latest === undefined || (latest && Object.getPrototypeOf(latest) === Object.prototype &&
    Reflect.ownKeys(latest).length === 0), 'CUTOVER_RUN_LATEST_EXECUTION_REFUSED');
}

// The injected native object is the existing bounded Cloud Run transport in
// production, and a fixed fake in tests. No result here is a verified SQL PRE
// or POST: later native output and semantic comparison remain separate.
export async function executeCutoverNativeRunV1({phase, entry, dossier, jiraBytes, humanScopeBytes, actor, grantSha256,
  authorize, native, journal, clock = Date.now}) {
  assert(entry && dossier && dossier.objective && native && journal, 'CUTOVER_RUN_INPUTS_REQUIRED');
  validateReadOnlyObjective(dossier.objective);
  assert.equal(entry.phase, phase, 'CUTOVER_RUN_PHASE_CROSSED');
  assert.equal(entry.scope, dossier.objective.purpose, 'CUTOVER_RUN_PURPOSE_CROSSED');
  assert.equal(entry.job, dossier.objective.jobName, 'CUTOVER_RUN_JOB_CROSSED');
  assert.equal(typeof native.getJob, 'function'); assert.equal(typeof native.listExecutions, 'function');
  assert.equal(typeof native.run, 'function');
  let armed = false, operationPersisted = false;
  try {
    return await runCutoverNativePhaseBoundaryV1({phase, objectiveId: entry.id,
      resourceBindingSha256: entry.resourceBindingSha256, jiraBytes, humanScopeBytes, actor,
      grantSha256, clock, authorize, claimExists: () => journal.claimExists(),
      async preflight() {
        const first = await native.getJob(entry.job);
        validateReadOnlyNativeJob(first, dossier.objective);
        assert.equal(first.uid, entry.uid, 'CUTOVER_RUN_UID_CROSSED'); noPriorExecution(first);
        await native.listExecutions(entry.job);
        const last = await native.getJob(entry.job);
        validateReadOnlyNativeJob(last, dossier.objective);
        assert.equal(last.uid, entry.uid, 'CUTOVER_RUN_UID_DRIFT'); noPriorExecution(last);
        assert.equal(last.etag, first.etag, 'CUTOVER_RUN_ETAG_DRIFT');
        await native.listExecutions(entry.job);
        assert(typeof last.etag === 'string' && last.etag.length > 0 && last.etag.length <= 256, 'CUTOVER_RUN_ETAG_REQUIRED');
        return {etag: last.etag};
      },
      arm(value) {
        const {preflight, ...claim} = value;
        journal.arm(claim); armed = true;
        journal.intent({phase, objectiveId: entry.id, job: entry.job, uid: entry.uid,
          etagSha256: byteHash(preflight.etag),
          at: new Date(clock()).toISOString(), authorityRecordSha256: value.authorityRecordSha256});
      },
      async transport({preflight}) {
        const persist = (name, responseSha256) => {
          journal.operation(name, responseSha256); operationPersisted = true;
        };
        const response = await native.run(entry.job, preflight.etag, {onOperationReference: persist});
        if (!operationPersisted) {
          assert(operationName.test(response?.name ?? ''), 'CUTOVER_RUN_OPERATION_REFERENCE_REQUIRED');
          persist(response.name, digest(response));
        }
        return {state: 'CUTOVER_NATIVE_RUN_OPERATION_KNOWN_V1', phase, operation: response.name,
          operationReferencePersisted: true, nativeOutputVerified: false, semanticComparisonVerified: false,
          sheetsActivated: false, canRetry: false};
      },
    });
  } catch (error) {
    if (armed) journal.stop({phase, objectiveId: entry.id,
      state: operationPersisted ? 'OPERATION_REFERENCE_PERSISTED_OBSERVATION_REQUIRED' : 'RUN_OUTCOME_UNKNOWN_NO_RETRY',
      diagnostic: 'CUTOVER_NATIVE_RUN_STOPPED', nativeOutputVerified: false, sheetsActivated: false});
    throw error;
  }
}
