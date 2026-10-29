// One additional prospective invocation, never a retry/recovery of old UNKNOWN.
// No CLI, implicit auth, collector, new job, SQL, CREATE, or old journal open.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {byteHash,digest} from './controlled-pool-contract-v1.mjs';
import {BINDING,CONSUMER_PINS,PROSPECTIVE_DRIVER_INPUTS,authorizeProspectiveGeneralPre,validateProspectiveAuthorityRecord,validateProspectiveDossier,dataFields} from './general-prospective-pre-authority-v1.mjs';
import {composeProspectiveGeneralPermissionBaseline} from '../runtime-image-only/prospective-permissions.mjs';
import {compareCapturedGeneral} from './captured-readonly-semantics-v1.mjs';
import {createReadOnlyNativeTransport} from './pool-native-transaction-v2.mjs';
import {boundedJson} from './pool-native-transaction-v1.mjs';
import {assertAuthorityCurrent} from '../readonly-probe/probe-driver-authority-v1.mjs';
import {createOfficialAccessToken} from '../readonly-probe/rc47-probe-official-auth-v1.mjs';
import {fixedToolEnvironment} from '../readonly-probe/probe-driver-github-v1.mjs';
import {createReadOnlyGithubReader} from './pool-driver-github-v1.mjs';
import {POOL_OFFICIAL_GIT,readPoolPrivateFile} from './pool-operational-driver-v1.mjs';
import {validateReadOnlyNativeJob,readOnlyOutputReadRequests,verifyReadOnlyOutputClaims,readOnlyTaskNetworkRequest} from './pool-native-output-v1.mjs';
import {NATIVE_OPERATION_PATTERN,diagnosticOf,diagnosticContext,sanitizedDiagnostic} from './readonly-native-diagnostics-v1.mjs';

const API='https://run.googleapis.com/v2/',LOG='https://logging.googleapis.com/v2/entries:list';
const UUID=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/u;
const epoch=()=>Math.floor(performance.timeOrigin+performance.now());
const alphabetical=(left,right)=>left.localeCompare(right,'en');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function canonicalDirectory(directory){
  assert(path.isAbsolute(directory));assert.equal(fs.realpathSync(directory),path.resolve(directory));
  assert(fs.lstatSync(directory).isDirectory()&&!fs.lstatSync(directory).isSymbolicLink());return directory;
}
function durableNew(file,value){
  const fd=fs.openSync(file,'wx',0o600);
  try{fs.writeFileSync(fd,JSON.stringify(value,null,2)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
}
// The permanent exclusive claim refuses restarts even when preflight failed.
// No existing journal, CREATE record, reset, initialization or copied journal.
export function openProspectiveEvidenceStore({directory,capabilityId,authorityRecordSha256}){
  canonicalDirectory(directory);assert(UUID.test(capabilityId));assert(/^[a-f0-9]{64}$/u.test(authorityRecordSha256));
  const prefix=path.join(directory,'prospective-'+capabilityId+'-');let next=0;
  durableNew(prefix+'CLAIM.json',{schemaVersion:1,kind:'PERMANENT_PROSPECTIVE_SINGLE_SESSION_CLAIM',capabilityId,authorityRecordSha256,canRetry:false});
  return Object.freeze({
    append(kind,value){assert(/^[A-Z][A-Z0-9-]{0,63}$/u.test(kind));const file=prefix+String(next++).padStart(4,'0')+'-'+kind+'.json';
      durableNew(file,{schemaVersion:1,kind,capabilityId,authorityRecordSha256,...value,canRetry:false});return{path:file,sha256:byteHash(fs.readFileSync(file))};},
  });
}
function emptyPreflight(job,objective,uid){
  validateReadOnlyNativeJob(job,objective);assert.equal(job.uid,uid,'EXACT_JOB_UID_REQUIRED');
  // An omitted proto3 counter is zero, NOT a historical no-effect conclusion.
  const count=Object.hasOwn(job,'executionCount')?job.executionCount:0;assert(Number.isSafeInteger(count)&&count===0,'PROSPECTIVE_REQUIRES_NATIVE_COUNTER_ZERO');
  assert(job.latestCreatedExecution===undefined||(job.latestCreatedExecution!==null&&Object.getPrototypeOf(job.latestCreatedExecution)===Object.prototype&&Reflect.ownKeys(job.latestCreatedExecution).length===0),'PROSPECTIVE_REQUIRES_NO_LATEST_EXECUTION');
  assert(typeof job.etag==='string'&&job.etag.length>0&&job.etag.length<=256,'NATIVE_ETAG_REQUIRED');return job;
}
function safeOperation(name,knownCreateOperation){assert(NATIVE_OPERATION_PATTERN.test(name??'')&&name!==knownCreateOperation,'NEW_RUN_OPERATION_REQUIRED');return name;}
function newExecution(operation,job){
  assert.equal(operation.done,true,'COMPLETED_NEW_OPERATION_REQUIRED');assert.equal(operation.error,undefined,'NEW_OPERATION_FAILED');
  const prefix=job+'/executions/',name=operation.response?.name;assert(typeof name==='string'&&name.startsWith(prefix)&&/^[a-z0-9-]+$/u.test(name.slice(prefix.length)),'NEW_EXECUTION_SCOPE');
  assert(typeof operation.response.uid==='string'&&operation.response.uid.length>8&&operation.response.uid.length<=256,'NEW_EXECUTION_UID_REQUIRED');return{name,uid:operation.response.uid};
}
function coherentOperation(operation,reference){
  assert.equal(operation.name,reference);assert(operation.done===undefined||typeof operation.done==='boolean','OPERATION_DONE_TYPE');
  if(operation.done!==true){assert(operation.error===undefined&&operation.response===undefined,'PENDING_OPERATION_PAYLOAD_AMBIGUOUS');}
  return operation;
}
export function createProspectiveSessionBudget({binding,assertCurrent,save,fetchImpl=fetch,clock=epoch,leaseRemainingMs=()=>900000}){
  let started=null,last=null,requests=0,nativeRequestsInvoked=0,bytes=0,runPosts=0,runBoundaryAttempts=0,closed=false;const pages=new Map(),operations=new Set(),executions=new Set();
  const check=()=>{assert(!closed,'PROSPECTIVE_SESSION_CLOSED');const now=clock();assert(Number.isSafeInteger(now)&&(last===null||now>=last),'MONOTONIC_CLOCK_REQUIRED');last=now;
    assert(started===null||now-started<900000,'PROSPECTIVE_SESSION_DEADLINE');assertCurrent();return now;};
  function logRequestAllowed(init){
    assert.equal(init.method,'POST');const body=JSON.parse(init.body);assert.deepEqual(body.resourceNames,['projects/'+binding.project]);
    assert.equal(body.pageSize,2);assert.equal(body.orderBy,'timestamp asc');assert.deepEqual(Object.keys(body).sort(alphabetical),['filter','orderBy','pageSize','resourceNames']);
    assert(binding.logRequest&&executions.size===1,'NEW_EXECUTION_LOG_REQUEST_NOT_BOUND');assert.deepEqual(body,binding.logRequest.body,'EXACT_NEW_EXECUTION_LOG_REQUEST');
  }
  function runRequestAllowed(u,init){
    assert.equal(init.method,'POST');assert.equal(u.search,'');const body=JSON.parse(init.body);
    assert.deepEqual(Object.keys(body),['etag']);assert(typeof body.etag==='string'&&body.etag===binding.expectedEtag,'EXACT_PREFLIGHT_ETAG');
    assert.equal(runBoundaryAttempts,0,'ONLY_ONE_PROSPECTIVE_POST');runBoundaryAttempts++;
  }
  function inventoryRequestAllowed(u){
    assert.equal(u.searchParams.get('pageSize'),'100');assert.equal(u.searchParams.get('showDeleted'),'true');
    assert([...u.searchParams.keys()].every(k=>['pageSize','showDeleted','pageToken'].includes(k)));
    const n=(pages.get(u.pathname)??0)+1;assert(n<=20,'COLLECTION_PAGE_BOUND');pages.set(u.pathname,n);
  }
  function metadataRequestAllowed(u,init,jobPath){
    assert.equal(init.method??'GET','GET');assert.equal(init.body,undefined);
    const full=u.pathname.slice(4),isJob=u.pathname===jobPath,isList=u.pathname===jobPath+'/executions';
    const isOperation=operations.has(full),isExecution=executions.has(full),isTasks=full.endsWith('/tasks')&&executions.has(full.slice(0,-6));
    assert(isJob||isList||isOperation||isExecution||isTasks,'DISCOVERED_EXACT_RESOURCE_REQUIRED');
    if(isList)inventoryRequestAllowed(u);
    else if(isTasks)assert.equal(u.href,readOnlyTaskUrl(binding.objective,full.slice(0,-6)));
    else assert.equal(u.search,'');
  }
  function requestAllowed(url,init){
    const method=init.method??'GET',u=new URL(url),jobPath='/v2/'+binding.job;
    assert(['GET','POST'].includes(method)&&init.redirect==='error','PROSPECTIVE_HTTP_BOUNDARY');assert.equal(u.protocol,'https:');assert(!u.username&&!u.password&&!u.hash);
    if(url===LOG)return logRequestAllowed(init);
    assert.equal(u.hostname,'run.googleapis.com');assert.equal(u.port,'');
    if(u.pathname===jobPath+':run')return runRequestAllowed(u,init);
    return metadataRequestAllowed(u,init,jobPath);
  }
  async function countedResponse(response,abortController,finish,assertRequest){
    assert.equal(response.redirected,false,'REDIRECT_REFUSED');assert(response.body,'RESPONSE_BODY_REQUIRED');
    const reader=response.body.getReader();let size=0,chunks=0;
    const body=new ReadableStream({async pull(controller){
      try{assertRequest();const part=await abortableRead(reader,abortController.signal);
        if(!part.done){size+=part.value.byteLength;bytes+=part.value.byteLength;assert(size<=1048576&&bytes<=20971520&&chunks++<4096,'RESPONSE_VOLUME_BOUND');}
        assertRequest();if(part.done){finish();controller.close();reader.releaseLock();return;}controller.enqueue(part.value);
      }catch(error){finish();controller.error(error);await reader.cancel();}},async cancel(){finish();await reader.cancel();}});
    return new Response(body,{status:response.status,headers:response.headers});
  }
  return Object.freeze({
    fetch:async(url,init)=>{const now=check();requestAllowed(url,init);assert(requests<200,'REQUEST_COUNT_BOUND');requests++;
      save('NATIVE-READ-INTENT',{request:requests,method:init.method??'GET',resourceSha256:byteHash(url),bodySha256:byteHash(init.body??'')});
      if(started===null)started=now;
      const remaining=Math.min(15000,900000-(clock()-started),leaseRemainingMs());assert(Number.isFinite(remaining)&&remaining>0,'NATIVE_REMAINING_TIME_EXHAUSTED');
      const controller=new AbortController(),requestDeadline=clock()+remaining;let timer,externalAbort;
      const finish=()=>{clearTimeout(timer);init.signal?.removeEventListener('abort',externalAbort);};
      const assertRequest=()=>{check();assert(clock()<requestDeadline&&leaseRemainingMs()>0&&!controller.signal.aborted,'NATIVE_READ_DEADLINE');};
      const deadline=new Promise((resolve,reject)=>{externalAbort=()=>{controller.abort();reject(new Error('NATIVE_READ_DEADLINE'));};timer=setTimeout(externalAbort,remaining);});
      if(init.signal?.aborted)externalAbort();else init.signal?.addEventListener('abort',externalAbort,{once:true});
      try{
        const signal=init.signal?AbortSignal.any([init.signal,controller.signal]):controller.signal;
        assertRequest();nativeRequestsInvoked++;if(init.method==='POST'&&url.endsWith(':run'))runPosts++;
        const response=await Promise.race([fetchImpl(url,{...init,signal}),deadline]);assertRequest();
        return await countedResponse(response,controller,finish,assertRequest);
      }catch(error){finish();controller.abort();throw error;}},
    check,
    discoverOperation:name=>{safeOperation(name,binding.knownCreateOperation);operations.add(name);},
    discoverExecution:name=>{const prefix=binding.job+'/executions/';assert(name.startsWith(prefix)&&/^[a-z0-9-]+$/u.test(name.slice(prefix.length)));executions.add(name);},
    close(){closed=true;return{firstNativeAt:started===null?null:new Date(started).toISOString(),requests,nativeRequestsInvoked,responseBytes:bytes,runPosts,runBoundaryAttempts,canRetry:false};},
  });
}
const readOnlyTaskUrl=(objective,name)=>readOnlyTaskNetworkRequest(objective,name).url;
async function abortableRead(reader,signal){
  assert(!signal.aborted,'NATIVE_READ_DEADLINE');let onAbort;
  try{return await Promise.race([reader.read(),new Promise((resolve,reject)=>{onAbort=()=>reject(new Error('NATIVE_READ_DEADLINE'));signal.addEventListener('abort',onAbort,{once:true});})]);}
  finally{signal.removeEventListener('abort',onAbort);}
}
async function readEncryptedOutput({request,accessToken,budget,store}){
  const controller=new AbortController();let timer;
  try{return await Promise.race([(async()=>{
    const token=await accessToken({signal:controller.signal});assert(!controller.signal.aborted);assert(typeof token==='string'&&token.length&&!/\s/u.test(token),'TOKEN_INVALID');
    const response=await budget.fetch(request.url,{method:'POST',redirect:'error',signal:controller.signal,headers:{authorization:'Bearer '+token,accept:'application/json','content-type':'application/json'},body:JSON.stringify(request.body)});
    const result=await boundedJson(response);assert.equal(result.status,200);store.append('ENCRYPTED-OUTPUT-RESPONSE',{responseSha256:digest(result.value)});return result.value;
  })(),new Promise((resolve,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('OUTPUT_READ_DEADLINE'));},15000);})]);}
  finally{clearTimeout(timer);}
}
function failureDiagnostic(error,objective,started,clock){
  return diagnosticOf(error)??sanitizedDiagnostic(diagnosticContext({objectiveId:BINDING.objectiveId,objectiveSha256:objective.objectiveSha256,stage:'RUN'}),
    {phase:'VALIDATION',reason:'VALIDATION_REFUSED',startedMs:started,endedMs:Math.max(started,clock()),transportInvoked:null});
}
const protocolCodes=new Set(['EXACT_JOB_UID_REQUIRED','PROSPECTIVE_REQUIRES_NATIVE_COUNTER_ZERO','PROSPECTIVE_REQUIRES_NO_LATEST_EXECUTION',
  'NATIVE_ETAG_REQUIRED','PREFLIGHT_ETAG_DRIFT','OPERATION_REFERENCE_SINGLE_WRITE','NEW_RUN_OPERATION_REQUIRED',
  'COMPLETED_NEW_OPERATION_REQUIRED','NEW_OPERATION_FAILED','NEW_EXECUTION_SCOPE','NEW_EXECUTION_UID_REQUIRED',
  'OPERATION_DONE_TYPE','PENDING_OPERATION_PAYLOAD_AMBIGUOUS','NATIVE_COUNTER_DELTA_EXACTLY_ONE','NATIVE_EXECUTION_UID_BINDING',
  'PROSPECTIVE_EXECUTION_CREATION_REQUIRED','UNAMBIGUOUS_OUTPUT_PAGE_REQUIRED','ONE_UNAMBIGUOUS_OUTPUT',
  'OUTPUT_READ_FRESHNESS_WINDOW_EXHAUSTED','CONSUMER_WITHIN_UNCHANGED_FRESHNESS','NATIVE_READ_DEADLINE',
  'LOG_POLL_REQUEST_BOUND','OPERATION_POLL_REQUEST_BOUND',
  'PROSPECTIVE_SESSION_CLOSED','MONOTONIC_CLOCK_REQUIRED','PROSPECTIVE_SESSION_DEADLINE','RESPONSE_VOLUME_BOUND',
  'REQUEST_COUNT_BOUND','COLLECTION_PAGE_BOUND','NATIVE_REMAINING_TIME_EXHAUSTED']);
export function protocolFailureCode(error){
  const descriptor=error&&typeof error==='object'?Object.getOwnPropertyDescriptor(error,'message'):undefined;
  const text=descriptor&&Object.hasOwn(descriptor,'value')&&typeof descriptor.value==='string'?descriptor.value:'';
  const first=text.split(/\r?\n/u)[0];
  for(const code of protocolCodes)if(first===code)return code;
  return'PROSPECTIVE_VALIDATION_REFUSED';
}
export function validateProspectiveConsumerInputs(inputs){
  dataFields(inputs,['historicalBaselineBytes','cutoverIndexBytes','evidence']);dataFields(inputs.evidence,['configuration','decision','currentComparison']);
  assert(Buffer.isBuffer(inputs.cutoverIndexBytes)&&inputs.cutoverIndexBytes.length<=1048576);
  assert.equal(byteHash(inputs.cutoverIndexBytes),CONSUMER_PINS.cutoverIndexSha256,'CUTOVER_EVIDENCE_INDEX_BYTES');
  validateConsumerIndex(JSON.parse(inputs.cutoverIndexBytes));
  assert(Buffer.isBuffer(inputs.historicalBaselineBytes)&&inputs.historicalBaselineBytes.length<=1048576);
  assert.equal(byteHash(inputs.historicalBaselineBytes),CONSUMER_PINS.baselineSha256,'HISTORICAL_BASELINE_BYTES');
  for(const name of ['configuration','decision','currentComparison']){
    assert(Buffer.isBuffer(inputs.evidence[name])&&inputs.evidence[name].length<=1048576);
    assert.equal(byteHash(inputs.evidence[name]),CONSUMER_PINS[name+'Sha256'],'PROSPECTIVE_CONSUMER_EVIDENCE_BYTES');
  }
  return inputs;
}
export function validateConsumerIndex(index){
  assert.equal(index.kind,'CRM_PROD_CUTOVER_REUSABLE_EVIDENCE_INDEX_V1');
  for(const key of ['globalPreSufficient','commonSqlSnapshot','productionDeploymentAuthorized','sheetsActivationAuthorized'])assert.equal(index[key],false);
  assert(Array.isArray(index.references)&&index.references.length===19,'EXACT_REUSABLE_EVIDENCE_INDEX');
  assert.deepEqual(index.globalImagePreparationRequiredFamilies,['POOL','LEDGER','GENERAL','PERMISSIONS','JOB_INVENTORY','RECOVERABILITY','ROLLBACK']);
  assert(Array.isArray(index.stillMissingBeforeRuntime)&&Array.isArray(index.stillMissingAfterCompatibleRuntimeBeforeSheetsOn));return index;
}
const semanticCodes=new Set(['PERMISSIONS_CHANGED','MAIL_SETTINGS_CHANGED','MAIL_MEMBERSHIPS_CHANGED','EXACT_49_MANAGER_GRANTS',
  'ONLY_ONE_ADDITIONAL_CONFIGURATION','EXACT_ONE_MANAGER_CONFIGURATION','MANAGER_IDENTITY_CHANGED','ONLY_EXPLICITLY_REQUALIFIED_GRANTS',
  'ALL_HISTORICAL_PERMISSION_ROWS_MUST_REMAIN_IDENTICAL','NO_MANAGER_GLOBAL_GRANT','PROTECTED_OPEN_LEAD','GENERAL_CAPTURE_BYTES',
  'MAIL_ROSTER_MEMBERS','GENERAL_SCOPE','SNAPSHOT_BOUND']);
export function semanticFailureCode(error){const first=typeof error?.message==='string'?error.message.split(/\r?\n/u)[0]:'';return semanticCodes.has(first)?first:'GENERAL_SEMANTIC_VALIDATION_REFUSED';}
export function comparisonAge(observation,now){assert(Number.isSafeInteger(now));const age=now-Date.parse(observation.transactionCompletedAt);return{comparisonAt:new Date(now).toISOString(),comparisonAgeMs:Number.isFinite(age)?age:null,freshAtComparison:Number.isFinite(age)&&age>=0&&age<=300000};}
export function buildProspectiveCutoverDossier({comparison,observation,index,timing}){
  validateConsumerIndex(index);
  return{indexSha256:CONSUMER_PINS.cutoverIndexSha256,newGeneralComparison:comparison,
    transactionCompletedAt:observation.transactionCompletedAt,...timing,
    reusableEvidence:index.references,stillMissingBeforeRuntime:index.stillMissingBeforeRuntime,
    stillMissingAfterCompatibleRuntimeBeforeSheetsOn:index.stillMissingAfterCompatibleRuntimeBeforeSheetsOn,
    requiredGlobalFamilies:index.globalImagePreparationRequiredFamilies,
    additionalCurrentBlocker:comparison.semanticAccepted?null:comparison.failureCode,globalPreSufficient:false,
    commonSqlSnapshot:false,productionDeploymentAuthorized:false,sheetsActivationAuthorized:false};
}
function generalComparison(observation,inputs){
  const {baselineSha256,cutoverIndexSha256,...bindings}=CONSUMER_PINS;
  const composed=composeProspectiveGeneralPermissionBaseline({historicalBaseline:JSON.parse(inputs.historicalBaselineBytes),
    observedPermissions:observation.snapshot.permissions,evidence:inputs.evidence,bindings});
  return{...compareCapturedGeneral({observation,baseline:composed.baseline}),semanticAccepted:true,
    prospectivePermissionInterpretation:composed.interpretation,historicalBaselineSha256:baselineSha256,cutoverIndexSha256};
}
export function consumeVerifiedGeneral(checked,inputs,store){
  validateProspectiveConsumerInputs(inputs);const {baselineSha256,cutoverIndexSha256}=CONSUMER_PINS;
  const observation=checked.output.observation,initial=comparisonAge(observation,Date.now());let comparison;
  if(!initial.freshAtComparison)comparison={status:'GENERAL_SEMANTIC_REFUSED',semanticAccepted:false,failureCode:'CURRENT_GENERAL_STALE'};
  else{try{comparison=generalComparison(observation,inputs);}catch(error){comparison={status:'GENERAL_SEMANTIC_REFUSED',semanticAccepted:false,failureCode:semanticFailureCode(error)};}}
  const timing=comparisonAge(observation,Date.now());
  if(!timing.freshAtComparison)comparison={status:'GENERAL_SEMANTIC_REFUSED',semanticAccepted:false,failureCode:'CURRENT_GENERAL_STALE'};
  const result={...comparison,...timing,historicalBaselineSha256:baselineSha256,cutoverIndexSha256,originalRunState:'UNKNOWN',oldLedgerReplayed:false,
    currentFreshnessAsserted:false,freshnessMs:300000,globalPreProved:false};
  store.append(comparison.semanticAccepted?'GENERAL-SEMANTIC-FIN':'GENERAL-SEMANTIC-REFUSED',{comparison:result});
  const index=JSON.parse(inputs.cutoverIndexBytes);
  store.append('CONCRETE-CUTOVER-DOSSIER',buildProspectiveCutoverDossier({comparison:result,observation,index,timing}));
  const after=comparisonAge(observation,Date.now());if(!after.freshAtComparison)store.append('COMPARISON-EXPIRED-AFTER-PERSISTENCE',{...after,currentFreshnessAsserted:false});
  return result;
}
async function awaitEncryptedOutput(input,attempt=0){
  const {objective,execution,accessToken,budget,store,binding,clock,pause}=input;
  assert(Number.isSafeInteger(attempt)&&attempt>=0&&attempt<200,'LOG_POLL_REQUEST_BOUND');
  budget.check();assert(clock()-Date.parse(execution.startTime)<300000,'OUTPUT_READ_FRESHNESS_WINDOW_EXHAUSTED');
  const request=readOnlyOutputReadRequests(objective,execution.name,clock())[2];binding.logRequest=request;
  const logs=await readEncryptedOutput({request,accessToken,budget,store});
  assert(logs.nextPageToken===undefined||logs.nextPageToken==='','UNAMBIGUOUS_OUTPUT_PAGE_REQUIRED');
  const rows=logs.entries===undefined?[]:logs.entries;assert(Array.isArray(rows)&&rows.length<=1,'ONE_UNAMBIGUOUS_OUTPUT');
  if(rows.length===1){return logs;}
  // Only a successful empty read polls ingestion lag, never a refused request.
  await pause(1000);
  return awaitEncryptedOutput(input,attempt+1);
}
async function observeNewOperationUntilDone(input,attempt=0){
  const {operation,reference,native,budget,pause}=input;
  if(operation.done===true){return operation;}
  assert(Number.isSafeInteger(attempt)&&attempt>=0&&attempt<200,'OPERATION_POLL_REQUEST_BOUND');
  budget.check();await pause(1000);budget.check();
  const next=coherentOperation(await native.operation(reference),reference);
  return observeNewOperationUntilDone({...input,operation:next},attempt+1);
}
// Injectable protocol is tested with synthetic transport/keys. It is NOT an
// authority source and never reports cryptographic/native acceptance itself.
export async function executeProspectiveGeneralPreProtocol({dossier,binding,store,native,refreshAuthority,budget,accessToken,readPrivateKey,consume,clock=Date.now,pause=delay}){
  const began=clock(),objective=dossier.objective;let consumed=false,operationPersisted=false,verified=false,reference=null;
  try{
    await refreshAuthority();budget.check();
    const first=emptyPreflight(await native.getJob(binding.job),objective,binding.uid);
    await native.listExecutions(binding.job);
    await refreshAuthority();budget.check();
    const last=emptyPreflight(await native.getJob(binding.job),objective,binding.uid);assert.equal(last.etag,first.etag,'PREFLIGHT_ETAG_DRIFT');
    await native.listExecutions(binding.job);binding.expectedEtag=last.etag;budget.check();
    const intentAt=clock();store.append('PROSPECTIVE-RUN-INTENT',{job:binding.job,uid:binding.uid,objectiveSha256:objective.objectiveSha256,
      at:new Date(intentAt).toISOString(),nativeExecutionCountBefore:0,oldRunState:'UNKNOWN',oldJournalUnmodified:true});consumed=true;
    const persistReference=(name,responseSha256)=>{
      assert.equal(reference,null,'OPERATION_REFERENCE_SINGLE_WRITE');reference=safeOperation(name,binding.knownCreateOperation);
      store.append('NEW-RUN-OPERATION',{operation:reference,responseSha256});operationPersisted=true;budget.discoverOperation(reference);
    };
    let operation=await native.run(binding.job,last.etag,{onOperationReference:persistReference});
    if(!reference){persistReference(operation.name,digest(operation));}
    coherentOperation(operation,reference);
    operation=await observeNewOperationUntilDone({operation,reference,native,budget,pause});
    const target=newExecution(operation,binding.job);budget.discoverExecution(target.name);
    const job=await native.getJob(binding.job);validateReadOnlyNativeJob(job,objective);assert.equal(job.uid,binding.uid);assert.equal(job.executionCount,1,'NATIVE_COUNTER_DELTA_EXACTLY_ONE');
    const execution=await native.execution(target.name,binding.job);assert.equal(execution.uid,target.uid,'NATIVE_EXECUTION_UID_BINDING');
    assert(Date.parse(execution.createTime)>=intentAt-1000,'PROSPECTIVE_EXECUTION_CREATION_REQUIRED');
    const taskNetwork=await native.taskNetwork(objective,target.name);
    const logs=await awaitEncryptedOutput({objective,execution,accessToken,budget,store,binding,clock,pause});
    const privateKeyPem=await readPrivateKey();
    const checked=verifyReadOnlyOutputClaims({job,execution,logs,bundle:dossier.bundle,objective,privateKeyPem,now:clock(),taskNetwork});verified=true;
    store.append('VERIFIED-NEW-ENCRYPTED-OUTPUT',{operation:reference,execution:target.name,jobUid:job.uid,metadataSha256:checked.metadataSha256,
      sealedOutputSha256:checked.sealedOutputSha256,encryptedRecord:logs.entries[0].jsonPayload,
      transactionCompletedAt:checked.output.observation.transactionCompletedAt,originalRunState:'UNKNOWN',freshnessMs:300000});
    budget.check();const consumedResult=await consume(checked);
    const at=clock(),completed=Date.parse(checked.output.observation.transactionCompletedAt);
    assert(at>=completed&&at-completed<=300000,'CONSUMER_WITHIN_UNCHANGED_FRESHNESS');
    const summary={state:consumedResult?.semanticAccepted===false?'FRESH_GENERAL_OBSERVED_SEMANTIC_REFUSED':'FRESH_PROSPECTIVE_GENERAL_PRE_OBSERVED',operation:reference,execution:target.name,jobUid:job.uid,
      metadataSha256:checked.metadataSha256,sealedOutputSha256:checked.sealedOutputSha256,consumerResultSha256:digest(consumedResult),
      transactionCompletedAt:checked.output.observation.transactionCompletedAt,consumedAt:new Date(at).toISOString(),freshnessMs:300000,
      originalRunState:'UNKNOWN',originalCanRetry:false,canRetry:false,nativeAcceptance:false,globalPreProved:false,deploymentAuthorized:false,sheetsActivated:false};
    store.append('PROSPECTIVE-PRE-FIN',summary);return summary;
  }catch(error){
    const result={state:consumed?'PROSPECTIVE_CAPABILITY_CONSUMED_INCOMPLETE':'PROSPECTIVE_PREFLIGHT_REFUSED',
      operation:operationPersisted?reference:null,operationReferencePersistence:operationPersisted?'PERSISTED':'NOT_ESTABLISHED',
      outputVerified:verified,originalRunState:'UNKNOWN',originalCanRetry:false,canRetry:false,nativeAcceptance:false,globalPreProved:false,
      diagnostic:failureDiagnostic(error,objective,began,clock)};
    result.failureCode=protocolFailureCode(error);
    try{store.append('PROSPECTIVE-SESSION-STOP',result);}catch{result.evidencePersistenceFailed=true;}
    return result;
  }
}
function sourceObservation(root,record){
  assert.equal(fs.realpathSync(root),path.resolve(root));assert(!Object.keys(process.env).some(k=>/^GIT_/iu.test(k)),'AMBIENT_GIT_OVERRIDE');
  assert.equal(fs.realpathSync(POOL_OFFICIAL_GIT),path.win32.normalize(POOL_OFFICIAL_GIT));
  const git=args=>execFileSync(POOL_OFFICIAL_GIT,['-C',root,...args],{encoding:'utf8',windowsHide:true,timeout:15000,maxBuffer:1048576,env:fixedToolEnvironment(process.env)}).trim();
  assert.equal(git(['status','--porcelain','--untracked-files=all']),'','CLEAN_PROTECTED_CHECKOUT_REQUIRED');
  return{commit:git(['rev-parse','HEAD']),tree:git(['rev-parse','HEAD^{tree}']),head:record.source.head,pr:record.source.pr,clean:true,
    files:PROSPECTIVE_DRIVER_INPUTS.map(relative=>({path:relative,sha256:byteHash(readPoolPrivateFile(path.join(root,relative)))}))};
}
function historicalGuard(files){
  assert(Array.isArray(files)&&files.length===2,'ORIGINAL_AND_SNAPSHOT_REQUIRED');
  assert.equal(new Set(files.map(f=>path.resolve(f.path))).size,2,'DISTINCT_HISTORICAL_FILES_REQUIRED');
  const exact=['C:/Crm Ynov/output/casablanca-pilot-20261022/runtime-pre-dossiers-20261028-v1/general/single-use-journal/pool-native-transactions.sqlite',
    'C:/Crm Ynov/output/casablanca-pilot-20261022/native-runtime-pre-session-20261028-v1/general/RUN-1-JOURNAL-SNAPSHOT.sqlite'];
  assert.deepEqual(files.map(f=>path.resolve(f.path)).sort(alphabetical),exact.map(p=>path.resolve(p)).sort(alphabetical),'EXACT_HISTORICAL_FILES_REQUIRED');
  for(const file of files){assert(path.isAbsolute(file.path));assert.equal(file.sha256,BINDING.journalSha256);
    assert.equal(byteHash(readPoolPrivateFile(file.path)),BINDING.journalSha256,'HISTORICAL_BYTES_CHANGED');}
}
function reusableEvidenceGuard(inputs){
  const index=JSON.parse(inputs.cutoverIndexBytes);
  for(const file of [...index.references,...index.protectedConsumerModules])assert.equal(byteHash(readPoolPrivateFile(file.path)),file.sha256,'REUSABLE_EVIDENCE_BYTES_CHANGED');
}
// The actual callable path constructs the real governance/native/auth adapters.
// It cannot be invoked by importing the module; there is deliberately no CLI.
export async function runProspectiveGeneralPre({root,record,dossierBytes,jiraBytes,evidenceDirectory,historicalFiles,readPrivateKey,consumerInputs}){
  const clock=Date.now,monotonicClock=epoch,github=createReadOnlyGithubReader();
  assert.equal(process.versions.node,'22.23.3');assert(!process.env.NODE_OPTIONS&&!process.env.NODE_PATH);
  validateProspectiveAuthorityRecord(record,clock());const dossier=validateProspectiveDossier(dossierBytes);
  canonicalDirectory(evidenceDirectory);assert.equal(path.resolve(evidenceDirectory),path.resolve(BINDING.evidenceDirectory),'ONE_CAPABILITY_ONE_DIRECTORY');
  assert.equal(byteHash(evidenceDirectory),record.directorySha256,'CAPABILITY_DIRECTORY_BINDING');
  validateProspectiveConsumerInputs(consumerInputs);reusableEvidenceGuard(consumerInputs);assert.equal(typeof readPrivateKey,'function');
  historicalGuard(historicalFiles);const local=sourceObservation(root,record);assert.deepEqual(local,{...record.source,clean:true});
  let authority;
  const sourceBytes=()=>{for(const file of local.files)assert.equal(byteHash(readPoolPrivateFile(path.join(root,file.path))),file.sha256,'LOCAL_SOURCE_DRIFT');};
  const guard=()=>{validateProspectiveAuthorityRecord(record,clock());assert.equal(digest(record),authority.receipt.authorityRecordSha256,'AUTHORITY_RECORD_DRIFT');
    assert.equal(byteHash(jiraBytes),authority.receipt.jiraObservationSha256,'JIRA_INPUT_DRIFT');assert.equal(byteHash(dossierBytes),BINDING.dossierSha256,'DOSSIER_INPUT_DRIFT');
    assert.equal(byteHash(readPoolPrivateFile('C:/Crm Ynov/output/casablanca-pilot-20261022/general-prospective-pre-authority-20261029-v1/HUMAN-AUTHORITY.json')),BINDING.humanAuthorityReceiptSha256,'HUMAN_AUTHORITY_BYTES_CHANGED');
    historicalGuard(historicalFiles);sourceBytes();validateProspectiveConsumerInputs(consumerInputs);reusableEvidenceGuard(consumerInputs);assertAuthorityCurrent(authority,clock());};
  authority=await authorizeProspectiveGeneralPre({github,record,jiraBytes,localSource:sourceObservation(root,record),clock});guard();
  // One protected lease acquisition, BEFORE GCP. Never renew it after session
  // start: a shorter grant/Jira/lease expiry stops even when 900s remain.
  const refreshAuthority=async()=>{guard();return authority;};
  const store=openProspectiveEvidenceStore({directory:evidenceDirectory,capabilityId:record.capabilityId,authorityRecordSha256:digest(record)});
  store.append('CUTOVER-REUSABLE-EVIDENCE-INDEX',{index:JSON.parse(consumerInputs.cutoverIndexBytes),indexSha256:CONSUMER_PINS.cutoverIndexSha256});
  const binding={...BINDING,objective:dossier.objective,wallNow:clock};
  const budget=createProspectiveSessionBudget({binding,assertCurrent:guard,save:(kind,value)=>store.append(kind,value),clock:monotonicClock,
    leaseRemainingMs:()=>Date.parse(authority.receipt.expiresAt)-clock()});
  const accessToken=createOfficialAccessToken({account:'casablancaynovcampus@gmail.com',gcloudPath:'C:/Program Files (x86)/Google/Cloud SDK/google-cloud-sdk/lib/gcloud.py',pythonPath:'C:/Program Files (x86)/Google/Cloud SDK/google-cloud-sdk/platform/bundledpython/python.exe'});
  const native=createReadOnlyNativeTransport({purpose:BINDING.purpose,accessToken,getAuthority:()=>authority,fetchImpl:budget.fetch,clock,
    diagnostic:{objectiveId:BINDING.objectiveId,objectiveSha256:BINDING.objectiveSha256,stage:'RUN'},saveDiagnostic:value=>store.append('NATIVE-DIAGNOSTIC',{diagnostic:value})});
  const consume=checked=>consumeVerifiedGeneral(checked,consumerInputs,store);
  try{return await executeProspectiveGeneralPreProtocol({dossier,binding,store,native,refreshAuthority,budget,accessToken,readPrivateKey,consume,clock});}
  finally{const stats=budget.close();historicalGuard(historicalFiles);store.append('SESSION-FIN',{...stats,originalRunState:'UNKNOWN',oldJournalUnmodified:true,jobsCreate:0,ledgerReplayed:false,deployment:false,sheetsActivation:false});}
}
