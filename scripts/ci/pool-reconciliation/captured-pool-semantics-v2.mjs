// Rechecks an already captured pool output under the corrected V2 semantic contract.
// This never turns the original refused phase into SUCCESS, calls a provider, or
// supplies a past clock to a native verifier. Caller MUST verify actual immutable
// checkpoint hashes/protected sources; typed fixtures alone authenticate no origin.
import assert from 'node:assert/strict';
import {digest,byteHash,TRUSTED_INTENT_SHA256,PREPARATION_AUTHORITY_SHA256} from './controlled-pool-contract-v1.mjs';
import {reconcileCapturedPoolFromOriginalIntentV2} from './controlled-pool-captured-contract-v2.mjs';
import {validateReadOnlyNativeExecution,readOnlyPurposeConfiguration} from './pool-native-output-v1.mjs';
import {validatePoolRuntimeBundle} from './pool-runtime-entry-v1.mjs';
import {openSealedReadOnlyOutput,validateReadOnlyOutputContext,OUTPUT_LIMIT} from './pool-sealed-output-v1.mjs';
const PURPOSE='POOL_RECONCILIATION_READ_ONLY_V1',MAIN='8253024ea35cee6be5636cc6b10a88ae7e177377';
function time(value){assert.equal(typeof value,'string');const n=Date.parse(value);assert(Number.isFinite(n),'RECORDED_CAPTURE_TIME');return n;}
function body(record){time(record.at);const {at,...value}=record;return value;}
function limitations(){return {originalOutputPhaseAccepted:false,providerCryptographicSignatureAsserted:false,currentFreshnessAsserted:false,fullProductionPreservation:false,nativeAcceptance:false,activationAuthorized:false};}
function same(a,b,reason){assert.equal(digest(a),digest(b),reason);}
export function validateCapturedPoolRefusalMetadata(capture){
  const {hostResult:host,dossier,reads,driverCommit,failureCode,objectiveId}=capture;
  assert.match(driverCommit,/^[a-f0-9]{40}$/u);assert.match(objectiveId,/^rc48-pool-(?:pre|post)-[a-z0-9-]+$/u);
  assert.equal(host.mode,'read-output');assert.equal(host.kind,'pool');assert.equal(host.objectiveId,objectiveId);
  assert.equal(host.exitCode,1,'KNOWN_REFUSED_ORIGINAL_PHASE_REQUIRED');assert.equal(host.error,null);assert.equal(host.result,null);assert.equal(failureCode,'POOL_OPERATIONAL_GUARD');
  assert.equal(dossier.objective.purpose,PURPOSE);assert.equal(dossier.objective.main,MAIN);assert.equal(dossier.bundle.request.purpose,PURPOSE);
  same(host.journalEvents.map(e=>[e.stage,e.state]),[['CREATE','INTENT'],['CREATE','OPERATION'],['CREATE','RECONCILED'],['RUN','INTENT'],['RUN','OPERATION'],['RUN','RECONCILED']],'SIX_KNOWN_FIN_EVENTS_REQUIRED');
  assert(host.journalEvents.every(e=>e.job===dossier.objective.jobName&&e.objectiveSha256===dossier.objective.objectiveSha256),'JOURNAL_OBJECTIVE_BINDING');
  const saved=host.journalEvents.at(-1),capturedAt=time(host.at),job=body(reads.job),execution=body(reads.execution),logs=body(reads.logs),taskNetwork=reads.taskNetwork===undefined?undefined:body(reads.taskNetwork);
  same(Object.keys(reads).toSorted((a,b)=>a.localeCompare(b,'en')),['execution','job','logs',...(taskNetwork===undefined?[]:['taskNetwork'])],'EXACT_CAPTURED_READ_SET');
  validateReadOnlyNativeExecution(job,execution,dossier.objective,taskNetwork);assert.equal(job.uid,saved.uid);assert.equal(execution.name,saved.execution);assert.equal(job.name,saved.job);
  assert(capturedAt>=time(execution.completionTime)&&capturedAt-time(execution.completionTime)<=300000,'ORIGINAL_CAPTURE_OUTSIDE_FIN_BOUND');
  const readTimes=Object.values(reads).map(r=>time(r.at));assert(readTimes.every(t=>t>=time(execution.completionTime)&&t<=capturedAt),'ORIGINAL_READ_TIME_BINDING');assert(capturedAt-Math.max(...readTimes)<=10000,'ORIGINAL_RESULT_TIME_BINDING');
  const binding=validatePoolRuntimeBundle(dossier.bundle);assert.equal(binding.sourceSha256,dossier.objective.sourceSha256);assert.equal(binding.publicKeySha256,dossier.objective.publicKeySha256);assert.equal(dossier.bundle.databaseBindingSha256,dossier.objective.databaseBindingSha256);
  assert.equal('projects/crmynov-prod-n7x4q2/locations/europe-west1/jobs/'+dossier.bundle.jobName,dossier.objective.jobName,'CAPTURED_BUNDLE_JOB_BINDING');
  assert.equal(logs.nextPageToken??'','');assert(Array.isArray(logs.entries));assert.equal(logs.entries.length,1,'ONE_CAPTURED_LOG_RECORD');const entry=logs.entries[0];
  assert.equal(entry.resource.type,'cloud_run_job');assert.equal(entry.resource.labels.project_id,'crmynov-prod-n7x4q2');assert.equal(entry.resource.labels.location,'europe-west1');assert.equal(entry.resource.labels.job_name,job.name.split('/').at(-1));
  assert.equal(entry.logName,'projects/crmynov-prod-n7x4q2/logs/run.googleapis.com%2Fstdout');assert.equal(entry.labels['run.googleapis.com/execution_name'],execution.name.split('/').at(-1));assert.equal(entry.labels['run.googleapis.com/task_index'],'0');assert.equal(entry.labels['run.googleapis.com/task_attempt'],'0');assert.equal(typeof entry.insertId,'string');assert(entry.insertId.length>0&&entry.insertId.length<=256);assert.equal(entry.textPayload,undefined);
  assert(time(entry.timestamp)>=time(execution.startTime)-1000&&time(entry.timestamp)<=time(execution.completionTime)+1000,'CAPTURED_LOG_TIME');
  const context={purpose:PURPOSE,phase:dossier.bundle.request.phase,job:job.name,execution:execution.name,sourceSha256:binding.sourceSha256,nonce:dossier.bundle.nonce},record=entry.jsonPayload;validateReadOnlyOutputContext(context);assert.equal(record.schemaVersion,1);assert.equal(record.kind,readOnlyPurposeConfiguration(PURPOSE).kind);assert.equal(record.keySha256,dossier.objective.publicKeySha256);same(record.context,context,'CAPTURED_CONTEXT_BINDING');assert(Buffer.byteLength(JSON.stringify(record))<=OUTPUT_LIMIT);
  return {job,execution,logs,taskNetwork,record,context,capturedAt:host.at,logTimestamp:entry.timestamp,metadataSha256:digest({job,execution,logs,...(taskNetwork===undefined?{}:{taskNetwork})}),sealedOutputSha256:digest(record)};
}
export function openCapturedPoolObservationV2(capture,loadPrivateKey){
  const checked=validateCapturedPoolRefusalMetadata(capture);assert.equal(typeof loadPrivateKey,'function','EXPLICIT_LOCAL_KEY_CAPABILITY_REQUIRED');const output=openSealedReadOnlyOutput(checked.record,{privateKeyPem:loadPrivateKey(),context:checked.context}),objective=capture.dossier.objective;
  assert.equal(output.schemaVersion,1);assert.equal(output.sourceSha256,objective.sourceSha256);assert.equal(output.databaseBindingSha256,objective.databaseBindingSha256);same(output.runtime,{job:checked.job.name,execution:checked.execution.name,taskIndex:0,attempt:0},'CAPTURED_RUNTIME_BINDING');
  const observation=output.observation;assert.equal(observation.schemaVersion,1);assert.equal(observation.purpose,PURPOSE);assert.equal(observation.phase,capture.dossier.bundle.request.phase);assert.equal(observation.queryContractSha256,readOnlyPurposeConfiguration(PURPOSE).queryHash);same(observation.identity,{database:'crmynov_prod',role:'crm_runtime',readOnly:'on',isolation:'repeatable read'},'CAPTURED_IDENTITY');
  assert.equal(observation.sourceClaimsOnly,true);for(const k of ['nativeEvidenceAuthenticated','historicalRawHashRecovered','fullProductionPreflight','migrationLedgerObserved','activationAuthorized'])assert.equal(observation[k],false);
  assert(Buffer.byteLength(JSON.stringify(observation.snapshot))<=524288);const start=time(observation.transactionStartedAt),end=time(observation.transactionCompletedAt),captured=time(checked.capturedAt);assert(start>=time(checked.execution.startTime)-1000);assert(end>=start&&end-start<=25000);assert(end<=time(checked.logTimestamp)+1000);assert(captured>=end&&captured-end<=300000,'ORIGINAL_TRANSACTION_CAPTURE_NOT_FRESH');
  return {observation,checked,recordedCapture:{capturedAt:checked.capturedAt,transactionStartedAt:observation.transactionStartedAt,transactionCompletedAt:observation.transactionCompletedAt,captureAgeMs:captured-end,freshAtRecordedCapture:true,currentFreshnessAsserted:false},...limitations()};
}
export function reconcileCorrectedCapturedPoolV2({capture,loadPrivateKey,intentBytes,independentInputBytes,priorProof=null}){
  assert.equal(byteHash(intentBytes),TRUSTED_INTENT_SHA256,'PINNED_ORIGINAL_INTENT_REQUIRED');
  assert.equal(byteHash(independentInputBytes),'7873b65dae9efaa82dee931531db07d40e4fe7870f94022c343d1edbe89ab4ca','PINNED_INDEPENDENT_INPUTS_REQUIRED');
  const inputs=JSON.parse(independentInputBytes);assert.equal(inputs.trustedIntentSha256,TRUSTED_INTENT_SHA256);assert.equal(inputs.actor.identityNotLearnedFromPoolAudit,true);assert.equal(inputs.actor.mismatchWithFutureAuditMustRefuse,true);assert.equal(inputs.originalRawHistoricalHashRecovered,false);
  const opened=openCapturedPoolObservationV2(capture,loadPrivateKey),{observation:o,checked}=opened,{dossier}=capture;
  // Hashes of both independent inputs MUST also be pinned by the qualified host/caller.
  const e={schemaVersion:1,phase:o.phase,project:'crmynov-prod-n7x4q2',region:'europe-west1',database:'crmynov_prod',role:'crm_runtime',databaseInstanceBindingSha256:dossier.objective.databaseBindingSha256,helperSourceCommit:capture.driverCommit,helperSha256:dossier.objective.sourceSha256,imageDigest:dossier.objective.image.split('@')[1],jobName:checked.job.name,jobUid:checked.job.uid,executionName:checked.execution.name,nativeMetadataSha256:checked.metadataSha256,taskCount:1,taskIndex:0,attempt:0,readOnly:'on',isolation:'repeatable read',transactionStartedAt:o.transactionStartedAt,transactionCompletedAt:o.transactionCompletedAt,snapshotSha256:digest(o.snapshot)},nativeEvidenceBytes=Buffer.from(JSON.stringify(e)),window=inputs.proposedCreationWindow;
  const plan={schemaVersion:1,purpose:'CAPTURED_CONTROLLED_POOL_RECONCILIATION_V2',intentReceiptSha256:TRUSTED_INTENT_SHA256,preparationAuthoritySha256:PREPARATION_AUTHORITY_SHA256,expectedCreationActorSha256:inputs.actor.expectedCreationActorSha256,creationWindow:{notBefore:window.notBefore,notAfter:window.notAfter,receiptSha256s:window.receiptSha256s,clockSkewMs:window.clockSkewMs,meaning:window.meaning},helperSourceCommit:capture.driverCommit,helperSha256:dossier.objective.sourceSha256,imageDigest:e.imageDigest,expectedDatabaseInstanceBindingSha256:dossier.objective.databaseBindingSha256,expectedNativeEvidenceSha256:byteHash(nativeEvidenceBytes),nativeEvidenceTrust:'PINNED_CAPTURE_METADATA_SOURCE_CHECKS_REQUIRED',phase:o.phase,priorProofSha256:o.phase==='PRE'?null:digest(priorProof)};
  const proof=reconcileCapturedPoolFromOriginalIntentV2({intentBytes,snapshot:o.snapshot,plan,nativeEvidenceBytes,recordedCaptureAt:opened.recordedCapture.capturedAt,priorProof});
  return {schemaVersion:1,status:'CAPTURED_POOL_RECHECKED_UNDER_CORRECTED_V2_CONTRACT_NOT_ORIGINAL_PHASE_SUCCESS',validationContractVersion:2,proof,proofSha256:digest(proof),recordedCapture:opened.recordedCapture,originalOutputPhaseExitCode:1,sourceOutput:{metadataSha256:checked.metadataSha256,sealedOutputSha256:checked.sealedOutputSha256,collectorDriverCommit:capture.driverCommit,objectiveId:capture.objectiveId},historicalRawPoolHashRecovered:false,...limitations()};
}
