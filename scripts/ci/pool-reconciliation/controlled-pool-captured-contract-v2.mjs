// Pure V2 comparison for an already authenticated, immutable captured observation.
// Shared intent/canonical rules are imported unchanged from V1; V1 bytes stay intact.
// No provider, filesystem, SQL, receipt-origin authentication or mutation capability.
import assert from 'node:assert/strict';
import {projectBusinessIntent,canonical,digest,byteHash,TRUSTED_INTENT_SHA256,PREPARATION_AUTHORITY_SHA256,HISTORICAL_RECEIPTS} from './controlled-pool-contract-v1.mjs';
export {projectBusinessIntent,canonical,digest,byteHash,TRUSTED_INTENT_SHA256,PREPARATION_AUTHORITY_SHA256,HISTORICAL_RECEIPTS};
const HEX64=/^[a-f0-9]{64}$/u;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u;
const PRE_KIND='CAPTURED_PRE_VALIDATED_UNDER_CONTRACT_V2_NOT_HISTORICAL_BASELINE';
function shape(value,names) {
  assert(value && Object.getPrototypeOf(value)===Object.prototype,'plain observation object required');
  const ordered=items=>items.toSorted((a,b)=>a.localeCompare(b,'en'));
  assert.deepEqual(ordered(Object.keys(value)),ordered(names.split(' ')),'unknown or missing field');
}
function fields(actual,expected) {
  for (const [name,value] of Object.entries(expected)) {
    assert.deepEqual(actual[name],value,name);
  }
}
function fingerprint(value) {
  assert(typeof value==='string' && HEX64.test(value) && value!=='0'.repeat(64),'nonzero SHA256 required');
}
function instant(value) {
  assert(typeof value==='string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3,6}Z$/u.test(value),'canonical ISO instant required');
  const number=Date.parse(value);
  assert(Number.isFinite(number),'finite instant required');
  assert.equal(new Date(number).toISOString(),value.replace(/(\.\d{3})\d{0,3}Z$/u,'$1Z'),'noncanonical calendar date');
  return number;
}
function planContract(plan) {
  shape(plan,'schemaVersion purpose intentReceiptSha256 preparationAuthoritySha256 expectedCreationActorSha256 creationWindow helperSourceCommit helperSha256 imageDigest expectedDatabaseInstanceBindingSha256 expectedNativeEvidenceSha256 nativeEvidenceTrust phase priorProofSha256');
  fields(plan,{schemaVersion:1,purpose:'CAPTURED_CONTROLLED_POOL_RECONCILIATION_V2',intentReceiptSha256:TRUSTED_INTENT_SHA256,preparationAuthoritySha256:PREPARATION_AUTHORITY_SHA256,nativeEvidenceTrust:'PINNED_CAPTURE_METADATA_SOURCE_CHECKS_REQUIRED'});
  for (const key of ['expectedCreationActorSha256','helperSha256','expectedDatabaseInstanceBindingSha256','expectedNativeEvidenceSha256']) {
    fingerprint(plan[key]);
  }
  assert.match(plan.helperSourceCommit,/^[a-f0-9]{40}$/u);
  assert.match(plan.imageDigest,/^sha256:[a-f0-9]{64}$/u);
  assert(['PRE','POST'].includes(plan.phase));
  if (plan.phase==='PRE') {
    assert.equal(plan.priorProofSha256,null);
  } else {
    fingerprint(plan.priorProofSha256);
  }
  const window=plan.creationWindow;
  shape(window,'notBefore notAfter receiptSha256s clockSkewMs meaning');
  fields(window,{receiptSha256s:HISTORICAL_RECEIPTS,meaning:'PROPOSED_HISTORICAL_RECEIPT_WINDOW_NOT_EXACT_SUBMISSION_TIME'});
  const duration=instant(window.notAfter)-instant(window.notBefore);
  assert(duration>0 && duration<=600000);
  assert(Number.isSafeInteger(window.clockSkewMs) && window.clockSkewMs>=0 && window.clockSkewMs<=1000);
}
function recordedEvidence(bytes,snapshot,plan,recordedCaptureAt) {
  assert.equal(byteHash(bytes),plan.expectedNativeEvidenceSha256,'source-evidence bytes changed');
  const evidence=JSON.parse(bytes);
  shape(evidence,'schemaVersion phase project region database role databaseInstanceBindingSha256 helperSourceCommit helperSha256 imageDigest jobName jobUid executionName nativeMetadataSha256 taskCount taskIndex attempt readOnly isolation transactionStartedAt transactionCompletedAt snapshotSha256');
  fields(evidence,{
    schemaVersion:1,phase:plan.phase,project:'crmynov-prod-n7x4q2',region:'europe-west1',
    database:'crmynov_prod',role:'crm_runtime',readOnly:'on',isolation:'repeatable read',
    databaseInstanceBindingSha256:plan.expectedDatabaseInstanceBindingSha256,
    helperSourceCommit:plan.helperSourceCommit,helperSha256:plan.helperSha256,
    imageDigest:plan.imageDigest,taskCount:1,taskIndex:0,attempt:0,snapshotSha256:digest(snapshot),
  });
  assert.match(evidence.jobName,/^projects\/crmynov-prod-n7x4q2\/locations\/europe-west1\/jobs\/crm-prod-pool-reconcile-[a-z0-9-]+$/u);
  assert(typeof evidence.jobUid==='string' && evidence.jobUid.length>8 && evidence.jobUid.length<=256);
  const prefix=evidence.jobName+'/executions/';
  assert(evidence.executionName.startsWith(prefix));
  assert.match(evidence.executionName.slice(prefix.length),/^[a-z0-9-]+$/u);
  fingerprint(evidence.nativeMetadataSha256);
  const start=instant(evidence.transactionStartedAt),end=instant(evidence.transactionCompletedAt),captured=instant(recordedCaptureAt);
  assert(end>=start && end-start<=30000);
  assert(captured>=end && captured-end<=300000,'fresh transaction claims at the actual recorded capture required');
  return {
    evidenceSha256:plan.expectedNativeEvidenceSha256,
    transactionStartedAt:evidence.transactionStartedAt,transactionCompletedAt:evidence.transactionCompletedAt,
    jobIdentitySha256:digest([evidence.jobName,evidence.jobUid]),
    executionIdentitySha256:digest([evidence.jobUid,evidence.executionName]),
    claimsChecked:true,independentlyAuthenticated:false,
  };
}
function referenceRows(rows,expected) {
  const desired=[
    {id:expected.campusId,kind:'CAMPUS',code:'CASABLANCA',state:'ACTIVE',campaign_scope:'GLOBAL',campaign_campus_id:null},
    {id:expected.campaignId,kind:'CAMPAIGN',code:expected.campaignCode,state:'ACTIVE',campaign_scope:'CAMPUS',campaign_campus_id:expected.campusId},
  ];
  assert.equal(rows.length,desired.length);
  for (const reference of desired) {
    assert.deepEqual(rows.find(row=>row.id===reference.id),reference);
  }
}
function creationRows(snapshot,expected,plan) {
  fields(expected,{version:1,automaticEnabled:true});
  assert.equal(expected.rules.length,2);
  assert.equal(expected.participants.length,4);
  assert.deepEqual(snapshot.configuration,[{campus_id:expected.campusId,version:1}]);
  for (const table of ['currentPool','versions','audits']) {
    assert.equal(snapshot[table].length,1,'single original saved version and audit required');
  }
  const pool=snapshot.currentPool[0],version=snapshot.versions[0],audit=snapshot.audits[0];
  shape(pool,'campus_id version rules');
  shape(version,'campus_id version actor_id created_at rules');
  fields(pool,{campus_id:expected.campusId,version:1});
  fields(version,{campus_id:expected.campusId,version:1,rules:pool.rules});
  assert.match(audit.id,UUID);
  assert.match(audit.actor_id,UUID);
  assert.equal(audit.actor_id,version.actor_id);
  assert.equal(byteHash(audit.actor_id),plan.expectedCreationActorSha256,'independently pinned creation actor required');
  assert(Array.isArray(audit.actor_roles) && audit.actor_roles.includes('SUPER_ADMIN'));
  assert(audit.actor_roles.every(role=>typeof role==='string' && /^[A-Z_]{2,32}$/u.test(role)));
  assert.equal(new Set(audit.actor_roles).size,audit.actor_roles.length);
  assert(typeof audit.correlation_id==='string' && audit.correlation_id.length>0 && audit.correlation_id.length<=64);
  assert.deepEqual(audit,{
    id:audit.id,campus_id:expected.campusId,resource_type:'ASSIGNMENT_CONFIGURATION',
    resource_id:expected.campusId,event_type:'CAMPUS_ASSIGNMENT_CONFIGURED',
    actor_id:version.actor_id,actor_roles:audit.actor_roles,correlation_id:audit.correlation_id,
    idempotency_key:'campus-assignment:'+expected.campusId+':1',occurred_at:audit.occurred_at,
    result:'SUCCESS',before_is_null:true,private_metadata_is_null:true,after:audit.after,
  });
  shape(audit.after,'version automaticEnabled ruleIds ruleCount');
  fields(audit.after,{version:1,automaticEnabled:true,ruleCount:2});
  assert.equal(audit.after.ruleIds.length,2);
  assert.equal(new Set(audit.after.ruleIds).size,2);
  const lower=instant(plan.creationWindow.notBefore),upper=instant(plan.creationWindow.notAfter);
  const created=instant(version.created_at),audited=instant(audit.occurred_at);
  assert(created>=lower && created<=upper && audited>=lower && audited<=upper);
  assert(audited>=created && audited-created<=plan.creationWindow.clockSkewMs,'creation timestamps outside independently pinned skew');
  const saved=pool.rules;
  shape(saved,'automaticEnabled rules');
  assert.equal(saved.automaticEnabled,true);
  assert.equal(saved.rules.length,2);
  let previous=-Infinity;
  for (const [position,rule] of saved.rules.entries()) {
    const target=expected.rules[position],at=instant(rule.updatedAt);
    assert.match(rule.id,UUID);
    assert.match(rule.updatedAt,/\.\d{3}Z$/u);
    assert(at>=lower-plan.creationWindow.clockSkewMs && at<=upper);
    assert(at>=created-plan.creationWindow.clockSkewMs && at>=previous,'rule normalization order changed');
    previous=at;
    const candidates=expected.participants.map(person=>({
      userId:person.userId,capacity:person.capacity,active:position===1,
      suspended:false,excluded:false,activeLeadCount:0,
    }));
    const exact={
      id:audit.after.ruleIds[position],scope:target.scope,strategy:'CONTROLLED_RANDOM',
      enabled:true,balanceNewEntrants:true,candidates,version:1,cursor:0,
      updatedAt:rule.updatedAt,updatedBy:audit.actor_id,
    };
    if (position===1) {
      exact.matchValue=expected.campaignCode;
    }
    assert.deepEqual(rule,exact);
  }
  return {audit,ruleIds:audit.after.ruleIds};
}
function prospectiveCounters(rows,expected,ruleIds) {
  assert(rows.length<=8);
  const unique=new Set();
  const counters=[];
  for (const row of rows) {
    shape(row,'campus_id version rule_id user_id assigned_count');
    fields(row,{campus_id:expected.campusId,version:1});
    assert(ruleIds.includes(row.rule_id) && expected.participants.some(p=>p.userId===row.user_id));
    assert(Number.isSafeInteger(row.assigned_count) && row.assigned_count>=0);
    const keySha256=digest([row.campus_id,row.version,row.rule_id,row.user_id]);
    assert(!unique.has(keySha256));
    unique.add(keySha256);
    counters.push({keySha256,count:row.assigned_count});
  }
  return counters.toSorted((a,b)=>a.keySha256.localeCompare(b.keySha256,'en'));
}
function priorObservation(previous,plan,expected,native,fixedRawSha256,sourceBindingSha256,counters) {
  assert(previous);
  assert.equal(digest(previous),plan.priorProofSha256);
  fields(previous,{
    kind:PRE_KIND,intentReceiptSha256:TRUSTED_INTENT_SHA256,semanticContractSha256:digest(expected),
  });
  assert.equal(previous.sourceBindingSha256,sourceBindingSha256,'sampler/source/database binding drift');
  assert.equal(previous.fixedRawSha256,fixedRawSha256,'full fixed raw PRE/POST drift');
  assert.notEqual(native.jobIdentitySha256,previous.nativeJobIdentitySha256,'a distinct single-use POST job is required');
  assert.notEqual(native.executionIdentitySha256,previous.nativeExecutionIdentitySha256,'PRE execution cannot be reused as POST');
  assert(instant(native.transactionStartedAt)>=instant(previous.transactionCompletedAt));
  for (const old of previous.counters) {
    const observed=counters.find(row=>row.keySha256===old.keySha256);
    assert(observed && observed.count>=old.count,'prospective counter lost/decreased');
  }
}
export function validateCapturedPoolSnapshotV2({snapshot,expected,plan,nativeEvidenceBytes,recordedCaptureAt,priorProof=null}) {
  planContract(plan);
  instant(recordedCaptureAt);
  shape(snapshot,'configuration currentPool versions audits counters references');
  assert(Object.values(snapshot).every(Array.isArray),'table must be an array');
  referenceRows(snapshot.references,expected);
  const {audit,ruleIds}=creationRows(snapshot,expected,plan);
  const counters=prospectiveCounters(snapshot.counters,expected,ruleIds);
  const native=recordedEvidence(nativeEvidenceBytes,snapshot,plan,recordedCaptureAt);
  const sourceBindingSha256=digest({
    helperSourceCommit:plan.helperSourceCommit,helperSha256:plan.helperSha256,
    imageDigest:plan.imageDigest,databaseInstanceBindingSha256:plan.expectedDatabaseInstanceBindingSha256,
  });
  const fixedRawSha256=digest(Object.fromEntries(
    ['configuration','currentPool','versions','audits','references'].map(name=>[name,snapshot[name]]),
  ));
  if (plan.phase==='POST') {
    priorObservation(priorProof,plan,expected,native,fixedRawSha256,sourceBindingSha256,counters);
  } else {
    assert.equal(priorProof,null);
  }
  return {
    schemaVersion:1,status:'CAPTURED_POOL_SEMANTICS_V2_MATCHED_NOT_ACTIVATION',validationContractVersion:2,
    recordedCaptureAt,currentFreshnessAsserted:false,kind:plan.phase==='PRE'?PRE_KIND:'POST_COMPARED_TO_CAPTURED_PRE_V2',
    phase:plan.phase,intentReceiptSha256:TRUSTED_INTENT_SHA256,preparationAuthoritySha256:PREPARATION_AUTHORITY_SHA256,
    semanticContractSha256:digest(expected),fixedRawSha256,
    observedCurrentPoolSha256:digest(snapshot.currentPool),observedFullSnapshotSha256:digest(snapshot),
    auditLinkageSha256:digest(audit),counterRows:counters.length,counters,
    transactionCompletedAt:native.transactionCompletedAt,nativeJobIdentitySha256:native.jobIdentitySha256,
    nativeExecutionIdentitySha256:native.executionIdentitySha256,sourceEvidenceSha256:native.evidenceSha256,
    sourceBindingSha256,version:1,rules:2,participantsPerRule:4,
    historicRawHashRecovered:false,historicalTechnicalMetadataIndependentlyAuthenticated:false,
    nativeSourceClaimsChecked:true,independentlyAuthenticatedNativeEvidence:false,nativeAcceptance:false,
    activationAuthorized:false,productionDataMutated:false,currentLoadAssumedZero:false,currentCountersAssumedZero:false,
    historicalLimitation:'Original full raw JSON and exact JS timestamps were not captured. Current audit/version linkage and temporal plausibility are checked, not cryptographic historical immutability. This PRE is a fresh constrained preservation observation only.',
  };
}
export function reconcileCapturedPoolFromOriginalIntentV2({intentBytes,...input}) {
  assert.equal(byteHash(intentBytes),TRUSTED_INTENT_SHA256,'untrusted original intent bytes');
  return validateCapturedPoolSnapshotV2({...input,expected:projectBusinessIntent(JSON.parse(intentBytes))});
}
