// Admit only the two explicitly pinned, completed PRE collectors. The original
// thirteen job identities stay mandatory; no create/run/update capability here.
import assert from 'node:assert/strict';
import {READONLY_RUNTIME_FILES,validateLocalReadOnlyDossier} from '../pool-reconciliation/pool-job-dossier-v1.mjs';
import {validateReadOnlyNativeJob,validateReadOnlyNativeExecution} from '../pool-reconciliation/pool-native-output-v1.mjs';
const purposes=new Set(['GENERAL_PRESERVATION_READ_ONLY_V1','SCHEMA_LEDGER_READ_ONLY_V1']),H=/^[a-f0-9]{64}$/u,U=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u,alphabetical=(a,b)=>a.localeCompare(b,'en');
function exact(value,keys){assert(value&&Object.getPrototypeOf(value)===Object.prototype);assert.deepEqual(Object.keys(value).sort(alphabetical),[...keys].sort(alphabetical));}
export function validateImagePreparationJobs(candidate){
  if(candidate.readOnlyPreparationVersion===2){return validateImagePreparationJobsV2(candidate);}
  assert.equal(candidate.readOnlyPreparationVersion,undefined,'EXPLICIT_PREPARATION_JOB_VERSION_REQUIRED');assert.equal(candidate.readOnlyPostJob,undefined,'POST_JOB_REQUIRES_EXPLICIT_V2');
  const rows=candidate.readOnlyPreparationJobs;if(rows===undefined){return [];}
  assert(Array.isArray(rows)&&rows.length===2,'EXPLICIT_GENERAL_AND_LEDGER_PAIR_REQUIRED');
  const names=new Set(),ids=new Set();
  for(const row of rows){
    exact(row,['objectiveId','catalogEntrySha256','dossier','uid','execution']);assert.equal(typeof row.objectiveId,'string');assert.match(row.objectiveId,/^rc48-[a-z0-9-]{8,75}$/u);assert(!ids.has(row.objectiveId));ids.add(row.objectiveId);assert(H.test(row.catalogEntrySha256));assert(U.test(row.uid));
    const d=row.dossier;assert(purposes.has(d?.objective?.purpose),'ONLY_GENERAL_AND_LEDGER_PRE');assert.equal(d.bundle?.request?.phase,'PRE');assert(!names.has(d.objective.jobName));names.add(d.objective.jobName);
    // Rebuild from the already source-hash-bound inline modules. Protected
    // catalogue/source lineage is independently checked by the authority port.
    validateLocalReadOnlyDossier(d,file=>{const name=Object.keys(READONLY_RUNTIME_FILES).find(k=>READONLY_RUNTIME_FILES[k]===file);assert(name);return Buffer.from(d.bundle.modules[name].source,'utf8');});
    const prefix=d.objective.jobName+'/executions/',leaf=d.objective.jobName.split('/').at(-1);assert.equal(typeof row.execution,'string');assert(row.execution.startsWith(prefix+leaf+'-'));assert.match(row.execution.slice(prefix.length),/^[a-z0-9-]+$/u);
  }
  assert.deepEqual(rows.map(r=>r.dossier.objective.purpose).sort(alphabetical),[...purposes].sort(alphabetical),'ONE_OF_EACH_PRE_PURPOSE');return rows;
}
export function validatePreparedReadOnlyJob(job,row,observedAt,completionContext){
  if(row.schemaVersion===2||row.postAdmissionVersion===2){return validatePreparedReadOnlyJobV2(job,row,observedAt,completionContext);}
  validateReadOnlyNativeJob(job,row.dossier.objective);assert.equal(job.uid,row.uid,'PREPARATION_JOB_UID');
  assert.equal(job.executionCount,1,'SINGLE_COMPLETED_PRE_EXECUTION_REQUIRED');assert.match(job.generation,/^[1-9]\d*$/u);assert.equal(job.observedGeneration,job.generation);assert.equal(job.terminalCondition?.state,'CONDITION_SUCCEEDED');
  const latest=job.latestCreatedExecution;assert(latest);assert.equal(latest.deleteTime,undefined);assert(latest.name===row.execution||latest.name===row.execution.split('/').at(-1));assert.equal(latest.completionStatus,'EXECUTION_SUCCEEDED');
  const completed=Date.parse(latest.completionTime),observed=Date.parse(observedAt);assert(Number.isFinite(completed)&&Number.isFinite(observed)&&completed<=observed,'COMPLETED_PRE_BEFORE_BASELINE');return true;
}
function iso(value){assert.equal(typeof value,'string');assert(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z$/u.test(value),'UTC_REAL_OBSERVATION_TIME_REQUIRED');const n=Date.parse(value);assert(Number.isSafeInteger(n)&&new Date(n).toISOString().slice(0,19)===value.slice(0,19),'REAL_OBSERVATION_TIME_REQUIRED');return n;}
function ref(value){exact(value,['path','sha256']);assert.equal(typeof value.path,'string');assert(/^(?:[A-Za-z]:[\\/]|\/)/u.test(value.path)&&value.path.endsWith('.json')&&!/private-key|credentials|\.private\.json/iu.test(value.path));assert(H.test(value.sha256));}
function rebuilt(d){validateLocalReadOnlyDossier(d,file=>{const name=Object.keys(READONLY_RUNTIME_FILES).find(k=>READONLY_RUNTIME_FILES[k]===file);assert(name);return Buffer.from(d.bundle.modules[name].source,'utf8');});}
function identity(row){assert.equal(typeof row.objectiveId,'string');assert.match(row.objectiveId,/^rc48-[a-z0-9-]{8,75}$/u);assert(U.test(row.uid));rebuilt(row.dossier);}
function executionName(name,dossier){const prefix=dossier.objective.jobName+'/executions/',leaf=dossier.objective.jobName.split('/').at(-1);assert.equal(typeof name,'string');assert(name.startsWith(prefix+leaf+'-'));assert.match(name.slice(prefix.length),/^[a-z0-9-]+$/u);}
export function validateImagePreparationJobsV2(candidate){
  assert.equal(candidate.readOnlyPreparationVersion,2);const rows=candidate.readOnlyPreparationJobs;assert(Array.isArray(rows)&&rows.length===2,'EXPLICIT_V2_GENERAL_AND_LEDGER_PAIR_REQUIRED');
  for(const row of rows){exact(row,['schemaVersion','objectiveId','catalogEntrySha256','dossier','uid','admission']);assert.equal(row.schemaVersion,2);assert(H.test(row.catalogEntrySha256));identity(row);assert.equal(row.dossier.bundle.request.phase,'PRE');
    const a=row.admission,purpose=row.dossier.objective.purpose;
    if(purpose==='GENERAL_PRESERVATION_READ_ONLY_V1'){exact(a,['kind','authorityRecordSha256']);assert.equal(a.kind,'PROSPECTIVE_GENERAL_0_TO_1');assert(H.test(a.authorityRecordSha256));}
    else{assert.equal(purpose,'SCHEMA_LEDGER_READ_ONLY_V1');exact(a,['kind','execution','startedAt','completedAt','authorityObservation']);assert.equal(a.kind,'HISTORICAL_LEDGER_FIN');executionName(a.execution,row.dossier);assert(iso(a.startedAt)<=iso(a.completedAt));ref(a.authorityObservation);}
  }
  assert.deepEqual(rows.map(r=>r.dossier.objective.purpose).sort(alphabetical),[...purposes].sort(alphabetical),'ONE_OF_EACH_PRE_PURPOSE');assert.equal(new Set(rows.map(r=>r.dossier.objective.jobName)).size,2);assert.equal(new Set(rows.map(r=>r.objectiveId)).size,2);
  if(candidate.readOnlyPostJob===undefined){return rows;}
  const post=candidate.readOnlyPostJob;exact(post,['dossier','uid','objectiveId','authorityRecordSha256','objectiveOrigin','jobObservation']);identity(post);assert(H.test(post.authorityRecordSha256),'EXISTING_POST_AUTHORITY_RECORD_PIN_REQUIRED');ref(post.objectiveOrigin);ref(post.jobObservation);
  assert.equal(post.dossier.objective.purpose,'GENERAL_PRESERVATION_READ_ONLY_V1');assert.equal(post.dossier.bundle.request.phase,'POST');assert(!post.dossier.objective.jobName.split('/').at(-1).includes('-pre-'),'POST_MUST_NOT_REUSE_PRE_JOB');
  assert(!rows.some(r=>r.objectiveId===post.objectiveId||r.dossier.objective.jobName===post.dossier.objective.jobName||r.uid===post.uid),'DISTINCT_UNUSED_POST_JOB_REQUIRED');
  return[...rows,{...structuredClone(post),postAdmissionVersion:2}];
}
function stableReady(job){assert.match(job.generation,/^[1-9]\d*$/u);assert.equal(job.observedGeneration,job.generation);assert.equal(job.terminalCondition?.state,'CONDITION_SUCCEEDED');assert.equal(job.deleteTime,undefined);}
function completionFor(context,row){
  if(context===undefined){return undefined;}
  exact(context,['schemaVersion','completions']);assert.equal(context.schemaVersion,2);assert(Array.isArray(context.completions)&&context.completions.length<=2);
  const ids=context.completions.map(c=>c.objectiveId);assert.equal(new Set(ids).size,ids.length,'DUPLICATE_COLLECTOR_COMPLETION');const found=context.completions.filter(c=>c.objectiveId===row.objectiveId);assert(found.length<=1);return found[0];
}
export function validateImageCollectorCompletionV2(job,row,completion,observedAt){
  exact(completion,['objectiveId','authorityRecordSha256','job','execution','taskNetwork','operation','authority','observedAt',...(row.postAdmissionVersion===2?['objectiveOriginSha256']:[])]);assert.equal(completion.objectiveId,row.objectiveId);assert(H.test(completion.authorityRecordSha256));
  if(row.schemaVersion===2){assert.equal(completion.authorityRecordSha256,row.admission.authorityRecordSha256,'EXACT_NEW_GENERAL_AUTHORITY_REQUIRED');}
  else{assert.equal(row.postAdmissionVersion,2);assert.equal(completion.objectiveOriginSha256,row.objectiveOrigin.sha256,'EXACT_DISTINCT_POST_ORIGIN_REQUIRED');assert.equal(completion.authorityRecordSha256,row.authorityRecordSha256,'EXACT_DISTINCT_POST_AUTHORITY_REQUIRED');}
  exact(completion.authority,['validFrom','expiresAt']);const start=iso(completion.execution.startTime),fin=iso(completion.execution.completionTime),observed=iso(completion.observedAt),outer=iso(observedAt);
  assert(iso(completion.authority.validFrom)<=start&&start<iso(completion.authority.expiresAt)&&fin<=observed&&observed<=outer,'COLLECTOR_AUTHORITY_AT_REAL_EXECUTION_REQUIRED');
  assert.deepEqual(completion.job,job,'COMPLETION_MUST_MATCH_FRESH_NATIVE_JOB');assert.equal(job.uid,row.uid);validateReadOnlyNativeExecution(job,completion.execution,row.dossier.objective,completion.taskNetwork??undefined);
  const operation=completion.operation;assert(operation&&Object.getPrototypeOf(operation)===Object.prototype);assert.equal(typeof operation.name,'string');assert(operation.name.startsWith(row.dossier.objective.jobName.split('/jobs/')[0]+'/operations/')&&/\/operations\/[a-zA-Z0-9_-]{1,256}$/u.test(operation.name),'ACTUAL_COLLECTOR_OPERATION_REQUIRED');assert.equal(operation.done,true);assert.equal(operation.error,undefined);assert.equal(operation.response?.name,completion.execution.name,'OPERATION_MUST_RETURN_EXACT_EXECUTION_NOT_SAME_UUID_SUFFIX');assert.equal(typeof operation.response.uid,'string');assert(operation.response.uid.length>8&&operation.response.uid.length<=256&&!/[\r\n]/u.test(operation.response.uid),'ACTUAL_EXECUTION_UID_REQUIRED');assert.equal(operation.response.uid,completion.execution.uid,'OPERATION_EXECUTION_UID_MISMATCH');
  return{claimsChecked:true,nativeOriginAuthenticated:false,nativeAcceptance:false,execution:completion.execution.name,completedAt:completion.execution.completionTime};
}
function validatePreparedReadOnlyJobV2(job,row,observedAt,completionContext){
  validateReadOnlyNativeJob(job,row.dossier.objective);assert.equal(job.uid,row.uid,'PREPARATION_JOB_UID');stableReady(job);iso(observedAt);
  if(row.admission?.kind==='HISTORICAL_LEDGER_FIN'){
    assert.equal(job.executionCount,1,'HISTORICAL_LEDGER_MUST_NOT_BE_REPLAYED');const latest=job.latestCreatedExecution;assert(latest&&(latest.name===row.admission.execution||latest.name===row.admission.execution.split('/').at(-1)));assert.equal(latest.completionStatus,'EXECUTION_SUCCEEDED');assert.equal(latest.deleteTime,undefined);assert.equal(latest.completionTime,row.admission.completedAt);assert(iso(row.admission.completedAt)<=iso(observedAt));return true;
  }
  const completed=completionFor(completionContext,row);
  if(completed){validateImageCollectorCompletionV2(job,row,completed,observedAt);return true;}
  assert.equal(job.executionCount??0,0,'PROSPECTIVE_COLLECTOR_REQUIRES_BOUND_COMPLETION_NOT_COUNT_TWO');assert.equal(job.latestCreatedExecution,undefined,'UNUSED_PROSPECTIVE_COLLECTOR_REQUIRED');return true;
}
