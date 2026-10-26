// DRAFT SEMANTIC CONTRACT, PURE. No filesystem, SQL, network or native execution.
// Reviewing this source cannot grant native acceptance or authorize any mutation.
// This validates a proposed semantic contract; it authenticates no native receipt.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
export const TRUSTED_INTENT_SHA256='5a7bf55e05bd1adaf2b2805f300b119a2205e227fef594cdf96699d100d83af7';
export const PREPARATION_AUTHORITY_SHA256='02857a159e6183e1b277fd4bf375b75a19163e6f66c31b3167a312eec24d4d6b';
export const HISTORICAL_RECEIPTS=Object.freeze(['7126b8da3b6c1b246f6afb58ff503216237dfabe411b1c9119c518d8c3cab095','ecdddd6ebeb47d158d099c3b5981ab612fd08b8083da8b9fa010e4ffd52e8446']);
const H=/^[a-f0-9]{64}$/u,S=/^[a-f0-9]{40}$/u,U=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u;
function compareKeys(left,right){if(left<right){return -1;}if(left>right){return 1;}return 0;}
export function canonical(value){if(Array.isArray(value))return'['+value.map(canonical).join(',')+']';if(value&&typeof value==='object')return'{'+Object.keys(value).sort(compareKeys).map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';return JSON.stringify(value);}
export const digest=value=>createHash('sha256').update(canonical(value)).digest('hex');
export const byteHash=bytes=>createHash('sha256').update(bytes).digest('hex');
function keys(value,expected){assert(value&&typeof value==='object'&&!Array.isArray(value)&&Object.getPrototypeOf(value)===Object.prototype);assert.deepEqual(Object.keys(value).sort(compareKeys),[...expected].sort(compareKeys),'unknown or missing field');}
function time(value){assert.equal(typeof value,'string');assert(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3,6}Z$/u.test(value));const parsed=Date.parse(value);assert(Number.isFinite(parsed));assert.equal(new Date(parsed).toISOString(),value.replace(/(\.\d{3})\d{0,3}Z$/u,'$1Z'),'noncanonical calendar date');return parsed;}
function hash(value){assert(H.test(value)&&value!=='0'.repeat(64));return value;}

// This projection deliberately excludes names, emails, labels, open-load display
// and authority prose. The production wrapper below first pins the COMPLETE bytes.
export function projectBusinessIntent(intent) {
  assert.equal(intent.operation,'ONE_INITIAL_PROSPECTIVE_POOL_CONFIGURATION');assert.equal(intent.expectedVersion,0);assert.equal(intent.targetVersion,1);assert.equal(intent.automaticEnabled,true);assert.equal(intent.strategy,'CONTROLLED_RANDOM');assert.equal(intent.balanceNewEntrants,true);assert.equal(intent.singleSubmit,true);assert.equal(intent.noAutomaticRetry,true);assert.equal(intent.noHistoricalRedistribution,true);
  assert(U.test(intent.campus.id));assert.equal(intent.campus.code,'CASABLANCA');assert.equal(intent.campaign.code,'REPRISE_YNOV_MA');assert.equal(intent.campaign.existingActive,true);assert(U.test(intent.campaign.id));
  assert.equal(intent.participants.length,4);assert.equal(new Set(intent.participants.map(p=>p.id)).size,4);assert.deepEqual(intent.participants.map(p=>p.capacity),[20,90,77,57]);assert.deepEqual(intent.participants.map(p=>p.openLoad),[0,70,57,37]);
  for(const p of intent.participants)assert(U.test(p.id));assert.equal(intent.rules.length,2);
  assert.equal(intent.rules[0].scope,'GLOBAL');assert.equal(intent.rules[0].enabled,true);assert.equal(intent.rules[0].balanceNewEntrants,true);assert.equal(intent.rules[0].allCandidatesParticipate,false);
  assert.equal(intent.rules[1].scope,'CAMPAIGN');assert.equal(intent.rules[1].matchValue,intent.campaign.code);assert.equal(intent.rules[1].enabled,true);assert.equal(intent.rules[1].balanceNewEntrants,true);assert.equal(intent.rules[1].allFourCandidatesParticipate,true);
  return {campusId:intent.campus.id,campaignId:intent.campaign.id,campaignCode:intent.campaign.code,version:1,automaticEnabled:true,participants:intent.participants.map(p=>({userId:p.id,capacity:p.capacity})),rules:[{scope:'GLOBAL',enabled:true,strategy:'CONTROLLED_RANDOM',balanceNewEntrants:true,active:false},{scope:'CAMPAIGN',matchValue:intent.campaign.code,enabled:true,strategy:'CONTROLLED_RANDOM',balanceNewEntrants:true,active:true}]};
}
function validatePlan(plan) {
  keys(plan,['schemaVersion','purpose','intentReceiptSha256','preparationAuthoritySha256','expectedCreationActorSha256','creationWindow','helperSourceCommit','helperSha256','imageDigest','expectedDatabaseInstanceBindingSha256','expectedNativeEvidenceSha256','nativeEvidenceTrust','phase','priorProofSha256']);
  assert.equal(plan.schemaVersion,1);assert.equal(plan.purpose,'DRAFT_CONTROLLED_POOL_RECONCILIATION');assert.equal(plan.intentReceiptSha256,TRUSTED_INTENT_SHA256);assert.equal(plan.preparationAuthoritySha256,PREPARATION_AUTHORITY_SHA256);
  hash(plan.expectedCreationActorSha256);hash(plan.helperSha256);hash(plan.expectedDatabaseInstanceBindingSha256);hash(plan.expectedNativeEvidenceSha256);assert(S.test(plan.helperSourceCommit));assert(/^sha256:[a-f0-9]{64}$/u.test(plan.imageDigest));assert.equal(plan.nativeEvidenceTrust,'INDEPENDENT_OFFICIAL_NATIVE_VERIFIER_STILL_REQUIRED');
  assert(['PRE','POST'].includes(plan.phase));if(plan.phase==='PRE')assert.equal(plan.priorProofSha256,null);else hash(plan.priorProofSha256);
  const w=plan.creationWindow;keys(w,['notBefore','notAfter','receiptSha256s','clockSkewMs','meaning']);assert.deepEqual(w.receiptSha256s,HISTORICAL_RECEIPTS);assert.equal(w.meaning,'PROPOSED_HISTORICAL_RECEIPT_WINDOW_NOT_EXACT_SUBMISSION_TIME');
  assert(time(w.notAfter)>time(w.notBefore)&&time(w.notAfter)-time(w.notBefore)<=600000);assert(Number.isSafeInteger(w.clockSkewMs)&&w.clockSkewMs>=0&&w.clockSkewMs<=1000);
}
function checkNativeEvidence(bytes,snapshot,plan,now) {
  assert.equal(byteHash(bytes),plan.expectedNativeEvidenceSha256,'source-evidence bytes changed');const e=JSON.parse(bytes);
  keys(e,['schemaVersion','phase','project','region','database','role','databaseInstanceBindingSha256','helperSourceCommit','helperSha256','imageDigest','jobName','jobUid','executionName','nativeMetadataSha256','taskCount','taskIndex','attempt','readOnly','isolation','transactionStartedAt','transactionCompletedAt','snapshotSha256']);assert.equal(e.phase,plan.phase);
  assert.equal(e.schemaVersion,1);assert.equal(e.project,'crmynov-prod-n7x4q2');assert.equal(e.region,'europe-west1');assert.equal(e.database,'crmynov_prod');assert.equal(e.role,'crm_runtime');assert.equal(e.readOnly,'on');assert.equal(e.isolation,'repeatable read');assert.equal(e.helperSourceCommit,plan.helperSourceCommit);assert.equal(e.helperSha256,plan.helperSha256);assert.equal(e.imageDigest,plan.imageDigest);
  assert.equal(e.databaseInstanceBindingSha256,plan.expectedDatabaseInstanceBindingSha256);
  assert(/^projects\/crmynov-prod-n7x4q2\/locations\/europe-west1\/jobs\/crm-prod-pool-reconcile-[a-z0-9-]+$/u.test(e.jobName));assert.equal(typeof e.jobUid,'string');assert(e.jobUid.length>8&&e.jobUid.length<=256);assert(e.executionName.startsWith(e.jobName+'/executions/'));assert(/^[a-z0-9-]+$/u.test(e.executionName.slice((e.jobName+'/executions/').length)));
  hash(e.nativeMetadataSha256);assert.equal(e.taskCount,1);assert.equal(e.taskIndex,0);assert.equal(e.attempt,0);assert.equal(e.snapshotSha256,digest(snapshot));
  const start=time(e.transactionStartedAt),end=time(e.transactionCompletedAt);assert(end>=start&&end-start<=30000);assert(end<=now&&now-end<=300000,'fresh transaction claims required');
  // Fields/digests are checked, NOT their origin. A separately protected official
  // native verifier must authenticate this receipt; these typed bytes do not do so.
  return {evidenceSha256:plan.expectedNativeEvidenceSha256,transactionStartedAt:e.transactionStartedAt,transactionCompletedAt:e.transactionCompletedAt,jobIdentitySha256:digest([e.jobName,e.jobUid]),executionIdentitySha256:digest([e.jobUid,e.executionName]),claimsChecked:true,independentlyAuthenticated:false};
}
function verifyRules(rules,expected,actor,auditIds,window) {
  keys(rules,['automaticEnabled','rules']);assert.equal(rules.automaticEnabled,true);assert.equal(rules.rules.length,2);let previous=-Infinity;
  for(const [index,rule]of rules.rules.entries()){
    const target=expected.rules[index];keys(rule,['id','scope','strategy','enabled','balanceNewEntrants','candidates','version','cursor','updatedAt','updatedBy',...(index===1?['matchValue']:[])]);
    assert(U.test(rule.id));assert.equal(rule.id,auditIds[index]);assert.equal(rule.scope,target.scope);assert.equal(rule.strategy,'CONTROLLED_RANDOM');assert.equal(rule.enabled,true);assert.equal(rule.balanceNewEntrants,true);assert.equal(rule.version,1);assert.equal(rule.cursor,0);assert.equal(rule.updatedBy,actor);if(index===1)assert.equal(rule.matchValue,expected.campaignCode);
    const at=time(rule.updatedAt);assert(/\.\d{3}Z$/u.test(rule.updatedAt));assert(at>=time(window.notBefore)-window.clockSkewMs&&at<=time(window.notAfter));assert(at>=previous,'rule normalization order changed');previous=at;
    assert.equal(rule.candidates.length,4);for(const [position,candidate]of rule.candidates.entries()){
      keys(candidate,['userId','active','suspended','excluded','capacity','activeLeadCount']);const original=expected.participants[position];assert.equal(candidate.userId,original.userId);assert.equal(candidate.capacity,original.capacity);assert.equal(candidate.active,index===1);assert.equal(candidate.suspended,false);assert.equal(candidate.excluded,false);
      // This is the immutable saved snapshot's normalization field, NOT current
      // open workload and NOT prospective fairness counters.
      assert.equal(candidate.activeLeadCount,0);
    }
  }
}
function counterProof(rows,expected,ruleIds) {
  assert(Array.isArray(rows)&&rows.length<=8);const seen=new Set();
  return rows.map(row=>{keys(row,['campus_id','version','rule_id','user_id','assigned_count']);assert.equal(row.campus_id,expected.campusId);assert.equal(row.version,1);assert(ruleIds.includes(row.rule_id));assert(expected.participants.some(p=>p.userId===row.user_id));assert(Number.isSafeInteger(row.assigned_count)&&row.assigned_count>=0);const key=digest([row.campus_id,row.version,row.rule_id,row.user_id]);assert(!seen.has(key));seen.add(key);return {keySha256:key,count:row.assigned_count};}).sort((a,b)=>a.keySha256.localeCompare(b.keySha256,'en'));
}
function verifyReferences(snapshot,expected) {
  assert.equal(snapshot.references.length,2);const campus=snapshot.references.find(r=>r.id===expected.campusId),campaign=snapshot.references.find(r=>r.id===expected.campaignId);assert(campus&&campaign);
  for(const row of snapshot.references)keys(row,['id','kind','code','state','campaign_scope','campaign_campus_id']);
  assert.equal(campus.kind,'CAMPUS');assert.equal(campus.code,'CASABLANCA');assert.equal(campus.state,'ACTIVE');assert.equal(campus.campaign_scope,null);assert.equal(campus.campaign_campus_id,null);
  assert.equal(campaign.kind,'CAMPAIGN');assert.equal(campaign.code,expected.campaignCode);assert.equal(campaign.state,'ACTIVE');assert.equal(campaign.campaign_scope,'CAMPUS');assert.equal(campaign.campaign_campus_id,expected.campusId);
}
function verifyStoredRows(snapshot,expected) {
  assert.equal(snapshot.configuration.length,1);assert.equal(snapshot.currentPool.length,1);assert.equal(snapshot.versions.length,1,'another/missing version is not allowed');assert.equal(snapshot.audits.length,1,'creation audit missing, extra or ambiguous');
  const c=snapshot.configuration[0],p=snapshot.currentPool[0],v=snapshot.versions[0],a=snapshot.audits[0];keys(c,['campus_id','version']);keys(p,['campus_id','version','rules']);keys(v,['campus_id','version','actor_id','created_at','rules']);
  for(const row of [c,p,v]){assert.equal(row.campus_id,expected.campusId);assert.equal(row.version,1);}assert.equal(expected.version,1);assert.equal(expected.automaticEnabled,true);assert.equal(expected.rules.length,2);assert.equal(expected.participants.length,4);
  return {p,v,a};
}
function verifyCreationAudit(a,v,expected,plan) {
  keys(a,['id','campus_id','resource_type','resource_id','event_type','actor_id','actor_roles','correlation_id','idempotency_key','occurred_at','result','before_is_null','private_metadata_is_null','after']);assert.equal(a.private_metadata_is_null,true);
  assert(U.test(a.id));assert.equal(a.campus_id,expected.campusId);assert.equal(a.resource_id,expected.campusId);assert.equal(a.resource_type,'ASSIGNMENT_CONFIGURATION');assert.equal(a.event_type,'CAMPUS_ASSIGNMENT_CONFIGURED');assert.equal(a.result,'SUCCESS');assert.equal(a.idempotency_key,'campus-assignment:'+expected.campusId+':1');assert.equal(a.before_is_null,true);assert.equal(typeof a.correlation_id,'string');assert(a.correlation_id.length>0&&a.correlation_id.length<=64);
  assert(U.test(a.actor_id));assert.equal(a.actor_id,v.actor_id);assert.equal(byteHash(a.actor_id),plan.expectedCreationActorSha256,'independently pinned creation actor required');assert(Array.isArray(a.actor_roles)&&a.actor_roles.includes('SUPER_ADMIN'));assert(a.actor_roles.every(r=>typeof r==='string'&&/^[A-Z_]{2,32}$/u.test(r)));assert.equal(new Set(a.actor_roles).size,a.actor_roles.length);
  keys(a.after,['version','automaticEnabled','ruleIds','ruleCount']);assert.equal(a.after.version,1);assert.equal(a.after.automaticEnabled,true);assert.equal(a.after.ruleCount,2);assert.equal(a.after.ruleIds.length,2);assert.equal(new Set(a.after.ruleIds).size,2);
  assert.equal(v.created_at,a.occurred_at,'same-transaction DB timestamps must match');const created=time(v.created_at);assert(created>=time(plan.creationWindow.notBefore)&&created<=time(plan.creationWindow.notAfter));
  return created;
}
function verifyPriorObservation({priorProof,plan,expected,native,fixedRawSha256,sourceBindingSha256,counters}) {
  assert(priorProof);assert.equal(digest(priorProof),plan.priorProofSha256);assert.equal(priorProof.kind,'NEW_VALIDATED_PRE_OBSERVATION_NOT_HISTORIC_RAW_BASELINE');assert.equal(priorProof.intentReceiptSha256,TRUSTED_INTENT_SHA256);assert.equal(priorProof.semanticContractSha256,digest(expected));assert.equal(priorProof.fixedRawSha256,fixedRawSha256,'full fixed raw PRE/POST drift');
  assert.equal(priorProof.sourceBindingSha256,sourceBindingSha256,'sampler/source/database binding drift');
  assert.notEqual(native.jobIdentitySha256,priorProof.nativeJobIdentitySha256,'a distinct single-use POST job is required');assert.notEqual(native.executionIdentitySha256,priorProof.nativeExecutionIdentitySha256,'PRE execution cannot be reused as POST');
  assert(time(native.transactionStartedAt)>=time(priorProof.transactionCompletedAt));for(const old of priorProof.counters){const current=counters.find(c=>c.keySha256===old.keySha256);assert(current&&current.count>=old.count,'prospective counter lost/decreased');}
}
export function validateDraftPoolSnapshot({snapshot,expected,plan,nativeEvidenceBytes,now,priorProof=null}) {
  validatePlan(plan);assert(Number.isFinite(now));const tables=['configuration','currentPool','versions','audits','counters','references'];keys(snapshot,tables);for(const table of tables){assert(Array.isArray(snapshot[table]),'table must be an array');}
  verifyReferences(snapshot,expected);const {p,v,a}=verifyStoredRows(snapshot,expected),created=verifyCreationAudit(a,v,expected,plan);
  assert.deepEqual(v.rules,p.rules);verifyRules(p.rules,expected,a.actor_id,a.after.ruleIds,plan.creationWindow);for(const rule of p.rules.rules)assert(time(rule.updatedAt)>=created-plan.creationWindow.clockSkewMs);
  const native=checkNativeEvidence(nativeEvidenceBytes,snapshot,plan,now),counters=counterProof(snapshot.counters,expected,a.after.ruleIds);
  const sourceBindingSha256=digest({helperSourceCommit:plan.helperSourceCommit,helperSha256:plan.helperSha256,imageDigest:plan.imageDigest,databaseInstanceBindingSha256:plan.expectedDatabaseInstanceBindingSha256});
  const fixedRawSha256=digest({configuration:snapshot.configuration,currentPool:snapshot.currentPool,versions:snapshot.versions,audits:snapshot.audits,references:snapshot.references});
  if(plan.phase==='POST'){
    verifyPriorObservation({priorProof,plan,expected,native,fixedRawSha256,sourceBindingSha256,counters});
  } else assert.equal(priorProof,null);
  return {schemaVersion:1,status:'DRAFT_SEMANTIC_RECONCILIATION_VALIDATED',kind:plan.phase==='PRE'?'NEW_VALIDATED_PRE_OBSERVATION_NOT_HISTORIC_RAW_BASELINE':'POST_COMPARED_TO_VALIDATED_PRE',phase:plan.phase,intentReceiptSha256:TRUSTED_INTENT_SHA256,preparationAuthoritySha256:PREPARATION_AUTHORITY_SHA256,semanticContractSha256:digest(expected),fixedRawSha256,observedCurrentPoolSha256:digest(snapshot.currentPool),observedFullSnapshotSha256:digest(snapshot),auditLinkageSha256:digest(a),counterRows:counters.length,counters,transactionCompletedAt:native.transactionCompletedAt,nativeJobIdentitySha256:native.jobIdentitySha256,nativeExecutionIdentitySha256:native.executionIdentitySha256,sourceEvidenceSha256:native.evidenceSha256,sourceBindingSha256,version:1,rules:2,participantsPerRule:4,historicRawHashRecovered:false,historicalTechnicalMetadataIndependentlyAuthenticated:false,nativeSourceClaimsChecked:true,independentlyAuthenticatedNativeEvidence:false,nativeAcceptance:false,activationAuthorized:false,productionDataMutated:false,currentLoadAssumedZero:false,currentCountersAssumedZero:false,historicalLimitation:'Original full raw JSON and exact JS timestamps were not captured. Current audit/version linkage and temporal plausibility are checked, not cryptographic historical immutability. This PRE is a fresh constrained preservation observation only.'};
}
export function reconcileFromOriginalIntent({intentBytes,...input}) {
  assert.equal(byteHash(intentBytes),TRUSTED_INTENT_SHA256,'untrusted original intent bytes');
  return validateDraftPoolSnapshot({...input,expected:projectBusinessIntent(JSON.parse(intentBytes))});
}
