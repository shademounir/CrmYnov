// SOURCE PROPOSAL ONLY. No CLI or operational capability issuer is present.
// Future R2/R4 must issue instance-bound handles inside this closure, only after
// protected authority and real transport provenance checks. Plain JSON is never admission.
import assert from 'node:assert/strict';
// Match the default UTF-16/code-unit order without locale-dependent hashes.
const codeUnitOrder=(left,right)=>{if(left<right)return -1;if(left>right)return 1;return 0;};
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import {imageJournalDigest as digest,inspectApiSheetReaderTransactionV1 as inspect,consumeApiSheetReaderTransactionV1 as consume,recordApiSheetReaderOperationV1 as recordOperation,finishApiSheetReaderTransactionV1 as finish,persistApiSheetReaderProofV1 as persistProof,inspectApiSheetReaderProofDirectoryV1 as inspectProofDirectory} from './journal.mjs';
import {validateApiSheetReaderPlanDraftV1,validateApiSheetReaderCurrentCasV1,validateApiSheetReaderServedV1} from './sheets-api-reader-contract-v1.mjs';
import {validateUnpatchedResourceClaims} from './plan.mjs';
import {imageServiceConfiguration} from './served-state.mjs';
import {validateImageInventoryPublicProjection as publicData} from './operational-cli-v2.mjs';

const API='projects/crmynov-prod-n7x4q2/locations/europe-west1/services/crm-prod-api';
const ACCOUNT='casablancaynovcampus@gmail.com',H=/^[a-f0-9]{64}$/u;
const scopes=Object.freeze({ENABLE_READER:'RC48_API_SHEETS_READER_CONFIG_ONLY_V1',DISABLE_READER:'RC48_API_SHEETS_READER_CONFIG_ROLLBACK_V1'});
const PROJECT_RIGHTS=Object.freeze(['artifactregistry.repositories.downloadArtifacts','cloudscheduler.jobs.list','iam.serviceAccounts.actAs','run.jobs.list','run.operations.get','run.revisions.get','run.services.get','run.services.update']);
const API_RIGHTS=Object.freeze(['run.services.get','run.services.update']);
const sessions=new WeakMap(),observations=new WeakMap(),closedErrors=new WeakMap();
const PORT_NAMES=['authenticate','authorize','permissions','current','preservation','patch','operation','served','close'];
const operationPrefix='projects/crmynov-prod-n7x4q2/locations/europe-west1/operations/';
function exact(value,keys){assert(value&&Object.getPrototypeOf(value)===Object.prototype);const ds=Object.getOwnPropertyDescriptors(value);assert(Reflect.ownKeys(ds).every(k=>typeof k==='string'&&Object.hasOwn(ds[k],'value')));assert.deepEqual(Object.keys(ds).toSorted(codeUnitOrder),keys.toSorted(codeUnitOrder));}
function instant(value){assert.equal(typeof value,'string');const n=Date.parse(value);assert(Number.isSafeInteger(n)&&new Date(n).toISOString()===value);return n;}
function fail(code){const error=new Error('READER_CONFIG_REFUSED');closedErrors.set(error,code);throw error;}
function checked(condition,code){if(!condition){fail(code);}}
function operationName(value){checked(typeof value==='string'&&value.startsWith(operationPrefix)&&/^[A-Za-z0-9_-]{1,256}$/u.test(value.slice(operationPrefix.length)),'READER_OPERATION_IDENTITY_REFUSED');return value;}
function validateAuthority(value,input,now){
 exact(value,['objectiveId','objectiveSha256','planSha256','sourceHead','sourceTree','scope','action','resource','account','validFrom','expiresAt']);
 const {binding,plan}=input;for(const key of ['objectiveId','objectiveSha256','planSha256','sourceHead','sourceTree','scope','resource']){assert.equal(value[key],binding[key]);}
 assert.equal(value.action,plan.action);assert.equal(value.account,ACCOUNT);const start=instant(value.validFrom),end=instant(value.expiresAt);assert(start<=now&&now<end&&end-start<=900000);return end;
}
function readHandle(session,handle,role){const row=observations.get(handle);checked(row&&row.session===session&&row.role===role,'READER_OPAQUE_OBSERVATION_REQUIRED');return row.value;}
function current(session){const now=session.clock();checked(Number.isSafeInteger(now)&&now>=session.lastAt,'READER_CLOCK_INVALID');session.lastAt=now;checked(now<session.deadline,'READER_COMMON_DEADLINE_EXCEEDED');return now;}
async function call(session,name,...args){
 const start=current(session),deadlineAt=name==='authenticate'?Math.min(session.deadline,start+15000):session.deadline,controller=new AbortController();let timer;
 const timeoutCode=name==='authenticate'?'READER_AUTH_TIMEOUT':'READER_COMMON_DEADLINE_EXCEEDED';
 const timeout=new Promise((resolve,reject)=>{timer=session.schedule(()=>{controller.abort();const error=new Error('READER_CONFIG_REFUSED');closedErrors.set(error,timeoutCode);reject(error);},deadlineAt-start);});
 try{const value=await Promise.race([Promise.resolve().then(()=>session.adapters[name](...args,{deadlineAt,signal:controller.signal,maxNativeExchangeMs:15000})),timeout]);checked(session.clock()<deadlineAt,timeoutCode);current(session);return value;}
 finally{session.cancel(timer);controller.abort();}
}
function bindingInput(input){
 exact(input,['binding','plan','before','preservation','journalDirectory','proofDirectory','forward']);publicData(input.plan);validateApiSheetReaderPlanDraftV1(input.plan,input.before);
 const {binding,plan}=input;assert.equal(binding.planSha256,digest(plan));assert.equal(binding.scope,scopes[plan.direction]);assert.equal(binding.stage,plan.stage);assert.equal(binding.resource,API);
 exact(input.preservation,['plan','webBefore','completionContext']);readerOperationalPublicProjectionV1(input.preservation);assert.equal(input.preservation.webBefore.name,API.replace('crm-prod-api','crm-prod-web'));
 inspectProofDirectory(input.proofDirectory,binding);assert.notEqual(fs.realpathSync(input.proofDirectory),fs.realpathSync(input.journalDirectory),'READER_PROOF_DIRECTORY_MUST_BE_DISTINCT');
 return input;
}
function workerIsolation(jobs,schedulers){
 for(const job of jobs){for(const container of job.template.template.containers){const rows=(container.env??[]).filter(row=>row.name==='CRM_GOOGLE_SHEETS_ENABLED');assert(rows.length<=1);if(rows.length){assert.deepEqual(rows[0],{name:'CRM_GOOGLE_SHEETS_ENABLED',value:'false'});}}}
 // The reused preservation contract currently admits only its actually reviewed
 // Scheduler set. No additional append Scheduler is invented or silently admitted.
 for(const scheduler of schedulers){if(/sheet.*append|append.*sheet/iu.test(scheduler.name)){assert.equal(scheduler.state,'PAUSED');}}
}
function readyWeb(service){
 assert.equal(service.reconciling??false,false);assert.equal(service.deleteTime,undefined);assert.equal(service.terminalCondition?.state,'CONDITION_SUCCEEDED');
 assert.equal(typeof service.latestReadyRevision,'string');const prefix=service.name+'/revisions/',ready=service.latestReadyRevision.startsWith(prefix)?service.latestReadyRevision.slice(prefix.length):service.latestReadyRevision;
 assert.match(ready,/^crm-prod-web-[a-z0-9-]+$/u);assert.equal(service.latestCreatedRevision,service.latestReadyRevision);assert.match(service.generation,/^[1-9]\d*$/u);assert.equal(service.observedGeneration,service.generation);
 assert(Array.isArray(service.trafficStatuses)&&service.trafficStatuses.length===1);const traffic=service.trafficStatuses[0];assert.equal(traffic.type,'TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST');assert.equal(traffic.percent,100);assert.equal(typeof traffic.revision,'string');assert.equal(traffic.revision.startsWith(prefix)?traffic.revision.slice(prefix.length):traffic.revision,ready);
}
function preserve(value,input,now){
 exact(value,['observedAt','web','jobs','schedulers']);publicData(value);const at=instant(value.observedAt);assert(at<=now&&now-at<600000);
 const before=input.preservation.webBefore;readyWeb(before);readyWeb(value.web);for(const key of ['name','uid','generation','observedGeneration','latestReadyRevision','latestCreatedRevision']){assert.deepEqual(value.web[key],before[key]);}
 assert.deepEqual(value.web.trafficStatuses,before.trafficStatuses);assert.deepEqual(imageServiceConfiguration(value.web),imageServiceConfiguration(before));
 validateUnpatchedResourceClaims(input.preservation.plan,{jobs:value.jobs,schedulers:value.schedulers,observedAt:value.observedAt},input.preservation.completionContext??undefined);workerIsolation(value.jobs,value.schedulers);return digest(value);
}
function permissions(value,now){
 exact(value,['project','apiResource','rows']);assert.equal(value.project,'crmynov-prod-n7x4q2');assert.equal(value.apiResource,API);publicData(value);assert(Array.isArray(value.rows)&&value.rows.length===2);
 const declared=[['PROJECT',PROJECT_RIGHTS],['API',API_RIGHTS]];
 for(let index=0;index<declared.length;index++){
  const [key,required]=declared[index],row=value.rows[index];exact(row,['key','requestStartedAt','responseReceivedAt','requested','returned']);assert.equal(row.key,key);
  const start=instant(row.requestStartedAt),end=instant(row.responseReceivedAt);assert(start<=end&&end<=now&&end-start<=15000&&now-start<600000);
  assert.deepEqual(row.requested,required);const got=row.returned;assert(Array.isArray(got)&&new Set(got).size===got.length&&got.every(name=>required.includes(name)));assert(required.every(name=>got.includes(name)));
 }
}
function rollback(input){
 if(input.plan.direction==='ENABLE_READER'){assert.equal(input.forward,null);return;}
 const f=input.forward;exact(f,['directory','binding','plan','before','finSha256']);assert.match(f.finSha256,H);assert.equal(f.plan.direction,'ENABLE_READER');validateApiSheetReaderPlanDraftV1(f.plan,f.before);
 assert.equal(f.binding.planSha256,digest(f.plan));assert.notEqual(f.directory,input.journalDirectory);assert.notEqual(f.binding.objectiveId,input.binding.objectiveId);
 const observed=inspect(f.directory,f.binding);assert.equal(observed.state,'FIN_NO_REPLAY');assert.equal(observed.rows[2].payload.details.outcome,'SUCCEEDED');
 const file=f.directory+'/'+f.binding.stage+'-3.json';assert.equal(createHash('sha256').update(fs.readFileSync(file)).digest('hex'),f.finSha256);
 const expected=imageServiceConfiguration(f.before);expected.template.containers=structuredClone(f.plan.patch.body.template.containers);assert.deepEqual(imageServiceConfiguration(input.before),expected,'READER_ROLLBACK_CONFIGURATION_DRIFT');assert.equal(input.before.uid,f.before.uid);
}
function journalState(session){try{return inspect(session.input.journalDirectory,session.input.binding).state;}catch{return 'JOURNAL_STATE_UNAVAILABLE_NO_RETRY';}}
function result(session,value){return{schemaVersion:1,kind:'READER_CONFIG_OPERATION_SEQUENCE_RESULT_V1',...value,syntheticOnly:session.syntheticOnly,nativeAcceptance:false,operationalAuthorityAcquired:false,sheetsActivated:false,automaticRetryAllowed:false};}
function releaseSession(session,output){
 try{const closing=session.adapters.close();if(closing!==undefined){void Promise.resolve(closing).catch(()=>{});throw new Error('READER_SYNCHRONOUS_TOKEN_RELEASE_REQUIRED');}}
 catch{if(output){output.tokenCloseFailed=true;}}
}
function verifiedProofRef(ref,input,proof){
 exact(ref,['path','sha256']);assert.match(ref.sha256,H);const directory=fs.realpathSync(input.proofDirectory),file=fs.realpathSync(ref.path);assert.equal(file,ref.path);assert(file.startsWith(directory+String.fromCodePoint(92))||file.startsWith(directory+'/'));
 const stat=fs.lstatSync(ref.path);assert(stat.isFile()&&!stat.isSymbolicLink()&&stat.size>0&&stat.size<=1048576);const bytes=fs.readFileSync(ref.path);assert.equal(createHash('sha256').update(bytes).digest('hex'),ref.sha256);
 const row=JSON.parse(bytes);assert.equal(row.sha256,digest(row.payload));assert.equal(row.payload.kind,'API_SHEETS_READER_CONFIG_OPERATION_PROOF_V1');assert.deepEqual(row.payload.binding,input.binding);assert.deepEqual(row.payload.proof,proof);return ref;
}
async function authenticateAndAuthorize(session){
 const {input}=session;session.phase='AUTH';const auth=readHandle(session,await call(session,'authenticate'),'AUTH');exact(auth,['account','scope']);assert.equal(auth.account,ACCOUNT);assert.equal(auth.scope,input.binding.scope);
 session.phase='AUTHORITY';let authority=readHandle(session,await call(session,'authorize'),'AUTHORITY');session.deadline=Math.min(session.deadline,validateAuthority(authority,input,current(session)));
 session.phase='PERMISSIONS';permissions(readHandle(session,await call(session,'permissions'),'PERMISSIONS'),current(session));
}
async function admission(session){
 const {input}=session;await authenticateAndAuthorize(session);
 session.phase='CURRENT_CAS';const observation=readHandle(session,await call(session,'current'),'CURRENT');validateApiSheetReaderCurrentCasV1({plan:input.plan,before:input.before,observation,now:current(session)});
 session.phase='PRESERVATION';preserve(readHandle(session,await call(session,'preservation'),'PRESERVATION'),input,current(session));
 session.phase='ROLLBACK_LINEAGE';rollback(input);
 session.phase='REVALIDATION';const authority=readHandle(session,await call(session,'authorize'),'AUTHORITY');session.deadline=Math.min(session.deadline,validateAuthority(authority,input,current(session)));
 // No metadata/GitHub wait is permitted between final CAS and mutation intent.
 const finalCas=readHandle(session,await call(session,'current'),'CURRENT');validateApiSheetReaderCurrentCasV1({plan:input.plan,before:input.before,observation:finalCas,now:current(session)});
}
async function observe(session,name){
 for(let count=0;count<200;count++){
  session.phase='OBSERVE_OPERATION';const op=readHandle(session,await call(session,'operation',name),'OPERATION');publicData(op);assert.equal(operationName(op.name),name);assert.equal(typeof op.done,'boolean');
  if(!op.done){continue;}
  let proof={scope:session.input.binding.scope,planSha256:digest(session.input.plan),operation:name,operationSha256:digest(op),outcome:op.error?'FAILED':'SUCCEEDED',syntheticOnly:session.syntheticOnly};
  if(!op.error){session.phase='SERVED';const served=readHandle(session,await call(session,'served'),'SERVED');exact(served,['service','revision','observedAt']);proof.served=validateApiSheetReaderServedV1({plan:session.input.plan,before:session.input.before,...served,now:current(session)});
   session.phase='POST_PRESERVATION';proof.preservationSha256=preserve(readHandle(session,await call(session,'preservation'),'PRESERVATION'),session.input,current(session));}
  session.phase='PERSIST_PROOF';publicData(proof);const proofReceipt=session.persistence.persistProof(session.input.journalDirectory,session.input.proofDirectory,session.input.binding,proof,current(session));verifiedProofRef(proofReceipt,session.input,proof);
  session.phase='PERSIST_FIN';const saved=session.persistence.finish(session.input.journalDirectory,session.input.binding,name,proofReceipt.sha256,proof.outcome,current(session));return result(session,{state:'FIN_NO_REPLAY',outcome:proof.outcome,receipt:saved,proofReceipt,proof});
 }
 return result(session,{state:'KNOWN_OPERATION_OBSERVE_ONLY',guard:'READER_OBSERVATION_LIMIT',operation:name});
}
export async function runApiSheetReaderOperationV1({capability}){
 const session=sessions.get(capability);checked(session?.mode==='DISPATCH','READER_OPAQUE_SESSION_REQUIRED');checked(!session.used,'READER_CAPABILITY_ALREADY_USED');session.used=true;let output;
 try{
  session.phase='INPUTS';bindingInput(session.input);checked(journalState(session)==='UNUSED','READER_MUTATION_NOT_UNUSED');await admission(session);
  session.phase='PERSIST_INTENT';session.persistence.consume(session.input.journalDirectory,session.input.binding,digest(session.input.plan.patch),current(session));
  session.phase='PATCH';const op=readHandle(session,await call(session,'patch',session.input.plan.patch),'PATCH_OPERATION');publicData(op);const name=operationName(op.name);
  session.phase='PERSIST_OPERATION';session.persistence.recordOperation(session.input.journalDirectory,session.input.binding,name,current(session));output=await observe(session,name);
 }catch(error){output=result(session,{state:'STOP',phase:session.phase,guard:closedErrors.get(error)??'READER_'+session.phase+'_REFUSED',journalState:journalState(session)});}
 finally{releaseSession(session,output);sessions.delete(capability);}
 return output;
}
export async function observeApiSheetReaderOperationV1({capability}){
 const session=sessions.get(capability);checked(session?.mode==='OBSERVE_ONLY','READER_OPAQUE_OBSERVER_REQUIRED');checked(!session.used,'READER_CAPABILITY_ALREADY_USED');session.used=true;let output;
 try{session.phase='INPUTS';bindingInput(session.input);const saved=inspect(session.input.journalDirectory,session.input.binding);checked(saved.state==='KNOWN_OPERATION_OBSERVE_ONLY','READER_KNOWN_OPERATION_REQUIRED');await authenticateAndAuthorize(session);output=await observe(session,saved.rows[1].payload.details.operation);}
 catch(error){output=result(session,{state:'STOP',phase:session.phase,guard:closedErrors.get(error)??'READER_'+session.phase+'_REFUSED',journalState:journalState(session)});}
 finally{releaseSession(session,output);sessions.delete(capability);}return output;
}
// Qualification only. It creates no operational authority and exposes no real
// capability mint. Future R2/R4 integration must live in this private closure.
export async function simulateApiSheetReaderOperationV1({syntheticOnly,input,ports,clock=Date.now,schedule=setTimeout,cancel=clearTimeout,forgedRoles=[],journalHooks={},mode='DISPATCH'}){
 assert.equal(syntheticOnly,true,'STRICT_SYNTHETIC_ONLY');exact(ports,PORT_NAMES);for(const name of PORT_NAMES){assert.equal(typeof ports[name],'function');}
 assert(['DISPATCH','OBSERVE_ONLY'].includes(mode));const start=clock();assert(Number.isSafeInteger(start)&&start>0);const session={input:structuredClone(input),clock,schedule,cancel,lastAt:start,deadline:start+900000,syntheticOnly:true,mode,used:false,phase:'INPUTS',adapters:{},persistence:{}};
 const roles={authenticate:'AUTH',authorize:'AUTHORITY',permissions:'PERMISSIONS',current:'CURRENT',preservation:'PRESERVATION',patch:'PATCH_OPERATION',operation:'OPERATION',served:'SERVED'};
 for(const [name,role] of Object.entries(roles)){session.adapters[name]=async(...args)=>{const context=args.at(-1),values=args.slice(0,-1).map(value=>structuredClone(value));const value=await ports[name](...values,context);if(forgedRoles.includes(role)){return value;}const handle=Object.freeze({});observations.set(handle,{session,role,value:structuredClone(value)});return handle;};}
 session.adapters.close=ports.close;
 for(const [name,fn] of Object.entries({consume,recordOperation,finish,persistProof})){session.persistence[name]=(...args)=>{journalHooks['before_'+name]?.();const saved=fn(...args);journalHooks['after_'+name]?.(saved);return saved;};}
 const capability=Object.freeze({});sessions.set(capability,session);return mode==='DISPATCH'?runApiSheetReaderOperationV1({capability}):observeApiSheetReaderOperationV1({capability});
}

// Additive R6 issuer IN THE SAME R5 MODULE/CLOSURE. No caller ports in the real entry.
// A separate OBSERVE_ONLY console session may read one durably registered operation.
// It never resumes/extends the original session or creates a second mutation.
import {validateImageDossierPublicProjectionV3 as readerTypedPublicV1} from './dossier-public-projection-v3.mjs';
import {readImageForwardCollectorSourceV2 as readerCollectorSourceV1} from './operational-forward-cli-v2.mjs';
import readerPathV1 from 'node:path';
function readerOperationalPublicProjectionV1(value){return readerTypedPublicV1(value,readerCollectorSourceV1);}
export const API_READER_LEGACY_NATIVE_DOMAINS_V1=Object.freeze(['general-operational-pre-native-20261030-v1','rc48-post-operational-native-20261030-v1','rc48-inventory-operational-native-20261030-v1','runtime-pre-dossiers-20261028-v1/general/single-use-journal','native-runtime-pre-session-20261028-v1/general'].map(leaf=>'C:/Crm Ynov/output/casablanca-pilot-20261022/'+leaf));
export function validateApiSheetReaderLocalDirectoriesV1(value){
  readerEntryExactV1(value,['journalDirectory','proofDirectory','outputDirectory']);const directories=Object.values(value).filter(directory=>directory!==null).map(directory=>{assert(typeof directory==='string'&&readerPathV1.isAbsolute(directory));return readerPathV1.resolve(directory);});assert.equal(new Set(directories.map(directory=>process.platform==='win32'?directory.toLowerCase():directory)).size,directories.length,'READER_DISTINCT_LOCAL_DOMAINS_REQUIRED');
  for(const directory of directories){for(const domain of API_READER_LEGACY_NATIVE_DOMAINS_V1){const relative=readerPathV1.relative(readerPathV1.resolve(domain),directory);assert(relative&& (readerPathV1.isAbsolute(relative)||relative.split(readerPathV1.sep)[0]==='..'),'READER_MUST_NOT_ALIAS_HISTORICAL_OR_OTHER_NATIVE_DOMAIN');}}
  return value;
}
function readerEntryExactV1(value,keys){publicData(value);exact(value,keys);}
function readerEntryTimeV1(value){return instant(value);}
function readerEntryReferenceV1(ref){readerEntryExactV1(ref,['path','sha256']);assert(typeof ref.path==='string'&&/^[A-Za-z]:[\\/]|^\//u.test(ref.path)&&ref.path.endsWith('.json'));assert(!/private-key|credentials|\.private\.json|\.sqlite/iu.test(ref.path));assert(H.test(ref.sha256));return ref;}
function readerLiteralV1(container,name){const rows=(container.env??[]).filter(row=>row.name===name);assert.equal(rows.length,1,'READER_CONSTRUCTION_LITERAL_REQUIRED');exact(rows[0],['name','value']);assert.equal(typeof rows[0].value,'string');return rows[0].value;}
function readerEntryRuntimeV1({dossier,readJson,now}){
  // Protected dossier refs are inputs to a LOCAL composition, not provider signatures.
  const plan=readJson(dossier.preservation.parentImagePlan),baseline=readJson(dossier.preservation.baseline),completionContext=readJson(dossier.preservation.completionContext),construction=readJson(dossier.preservation.constructionInputs),apiGet=readJson(dossier.apiBaseline);
  readerEntryExactV1(construction,['schemaVersion','kind','imageSequenceFin','apiImageFin','webImageFin','postComposition','allowlist','runtimeAllowlistPath']);
  assert.equal(construction.schemaVersion,1);assert.equal(construction.kind,'SOURCE_BOUND_API_READER_EXISTING_RUNTIME_INPUTS_V1');
  for(const key of ['imageSequenceFin','apiImageFin','webImageFin','postComposition','allowlist']){readerEntryReferenceV1(construction[key]);}
  const sequence=readJson(construction.imageSequenceFin),api=readJson(construction.apiImageFin),web=readJson(construction.webImageFin),post=readJson(construction.postComposition);
  assert(sequence.schemaVersion===2&&sequence.kind==='IMAGE-SEQUENCE-FIN'&&sequence.state==='FIN_COMPATIBLE_RUNTIME_OBSERVED_NOT_SHEETS_ACTIVE'&&sequence.stage==='COMPLETE'&&sequence.guardCode===null);
  assert(sequence.automaticMutationRetry===false&&sequence.automaticRollback===false&&sequence.sheetsActivated===false);assert.equal(sequence.planSha256,digest(plan));
  assert.deepEqual(sequence.entryCallsAttempted,{backupDispatch:1,generalEntry:1,apiDispatch:1,webDispatch:1,postEntry:1,knownOperationObservations:sequence.entryCallsAttempted.knownOperationObservations});
  assert(Number.isSafeInteger(sequence.entryCallsAttempted.knownOperationObservations)&&sequence.entryCallsAttempted.knownOperationObservations>=3);
  assert.deepEqual(sequence.postReceipt,construction.postComposition);
  assert(api.stage==='API_IMAGE'&&web.stage==='WEB_IMAGE'&&api.outcome==='SUCCEEDED'&&web.outcome==='SUCCEEDED');
  assert(api.served.kind==='api'&&web.served.kind==='web');assert(H.test(api.nativeResponseSha256)&&H.test(web.nativeResponseSha256));
  readerEntryExactV1(baseline,['schemaVersion','kind','observedAt','services','jobs','schedulers']);assert.equal(baseline.schemaVersion,1);assert.equal(baseline.kind,'SOURCE_BOUND_POST_IMAGE_READER_BASELINE_V1');readerEntryTimeV1(baseline.observedAt);
  assert.deepEqual(baseline.services.api,dossier.before);assert.equal(api.served.configurationSha256,digest(imageServiceConfiguration(dossier.before)));assert.equal(web.served.configurationSha256,digest(imageServiceConfiguration(baseline.services.web)));
  for(const [kind,proof]of [['api',api],['web',web]]){const before=baseline.services[kind],patch=plan.patches.find(row=>row.resource===before.name);assert(patch);assert.equal(proof.served.resource,before.name);assert.equal(proof.served.uid,before.uid);assert.equal(proof.served.revision,before.latestReadyRevision);assert.equal(proof.served.image,patch.body.template.containers[0].image);}assert.equal(api.served.image,dossier.plan.image);
  readyWeb(baseline.services.web);assert.equal(post.schemaVersion,2);assert.equal(post.kind,'RC48_RUNTIME_POST_COMPOSITION_V2');assert.equal(post.planSha256,digest(plan));assert.equal(post.afterImageObservedAt,sequence.afterImageObservedAt);assert.equal(post.sheetsActivated,false);assert.equal(post.preservedJobsAndSchedulersChecked,true);
  assert(post.sql?.kind==='GENERAL_POST_VERIFIED_OBSERVED_SCOPE_COMPARISON_V2'&&post.sql.sameSqlSnapshotClaimed===false&&post.sql.ledgerFinNotReplayed===true);
  assert.equal(post.roles?.kind,'OBSERVED_BFF_SESSION_ROLE_COVERAGE_V2');assert.equal(post.roles.allPlannedSessionRolesObserved,true);assert(Array.isArray(post.publicHttp)&&post.publicHttp.length===2);
  for(const kind of ['api','web']){const rows=post.publicHttp.filter(row=>{const url=new URL(row.request.url);return new RegExp('^crm-prod-'+kind+'-','u').test(url.hostname);});assert.equal(rows.length,1);const row=rows[0];assert.equal(row.kind,'SOURCE_BOUND_PUBLIC_RUNTIME_GET_V2');assert.equal(row.request.method,'GET');assert.equal(row.response.status,200);assert.equal(row.response.finalUrl,row.request.url);assert.equal(row.response.redirected,false);assert.equal(row.credentialsSent,false);}
  assert.equal(completionContext.schemaVersion,2);assert(Array.isArray(completionContext.completions));validateUnpatchedResourceClaims(plan,{jobs:baseline.jobs,schedulers:baseline.schedulers,observedAt:baseline.observedAt},completionContext);workerIsolation(baseline.jobs,baseline.schedulers);
  // Static baseline date is NOT a new freshness window. Validate the historical GET
  // at its actual recorded end; fresh R4 CAS is independently mandatory before PATCH.
  validateApiSheetReaderCurrentCasV1({plan:dossier.plan,before:dossier.before,observation:apiGet,now:readerEntryTimeV1(apiGet.responseReceivedAt)});
  const container=dossier.before.template.containers[0],allowlistPath=readerLiteralV1(container,'CRM_GOOGLE_SHEETS_ALLOWLIST_FILE');assert.equal(allowlistPath,construction.runtimeAllowlistPath);assert(/^\/[^\u0000-\u001f\u007f]*\.json$/u.test(allowlistPath)&&!allowlistPath.split('/').includes('..'));
  assert.equal(readerLiteralV1(container,'CRM_GOOGLE_SHEETS_ALLOWLIST_SHA256'),construction.allowlist.sha256);readJson(construction.allowlist);
  const mounts=(container.volumeMounts??[]).filter(row=>typeof row.mountPath==='string'&&allowlistPath.startsWith(row.mountPath.replace(/\/$/u,'')+'/'));assert.equal(mounts.length,1,'READER_EXISTING_READONLY_MOUNT_REQUIRED');
  const volumes=(dossier.before.template.volumes??[]).filter(row=>row.name===mounts[0].name);assert.equal(volumes.length,1);assert.equal(volumes[0].gcs?.readOnly,true,'READER_EXISTING_READONLY_MOUNT_REQUIRED');
  assert.equal(readerLiteralV1(container,'CRM_GOOGLE_SHEETS_AUTH_MODE'),'ADC_IMPERSONATION');const configuredPrincipal=readerLiteralV1(container,'CRM_GOOGLE_SHEETS_IMPERSONATE_SERVICE_ACCOUNT');assert(/^[a-z0-9][a-z0-9._-]*@[a-z0-9-]+\.iam\.gserviceaccount\.com$/u.test(configuredPrincipal));
  assert(!(container.env??[]).some(row=>row.name==='CRM_GOOGLE_SHEETS_CREDENTIALS_FILE'&&row.value),'READER_SECRET_PAYLOAD_NOT_READ_OR_SWITCHED');
  assert(readerEntryTimeV1(sequence.at)<=now&&readerEntryTimeV1(post.afterImageObservedAt)<=readerEntryTimeV1(sequence.at));
  return{preservation:{plan,webBefore:baseline.services.web,completionContext},coverage:{kind:'LOCAL_SOURCE_BOUND_READER_RUNTIME_INPUT_COMPOSITION_V1',imageSequenceFin:construction.imageSequenceFin,postComposition:construction.postComposition,baselineDateNotFreshnessWaiver:true,localAllowlistBytesHashMatchesConfiguredHash:true,mountMetadataReadOnly:true,deployedGcsObjectBytesAuthenticated:false,configuredTargetPrincipal:configuredPrincipal,credentialIdentityObservation:'NOT_OBSERVED',credentialIdentityNotInferredFromRuntimeOrSdkAccount:true,runtimeGooglePermissionsObserved:false,googleSourceReadVerified:false,connectorStoppedProofRequiredForThisFlag:false,appendQualificationRequiredForThisFlag:false,providerCryptographicAttestation:false}};
}
function readerAuthorityProjectionV1(authority,{input,source,originalEnd,now}){
  const a=authority.entry,r=authority.receipt;assert.equal(a.id,input.binding.objectiveId);assert.equal(r.authorityRecordSha256,input.binding.objectiveSha256);assert.equal(r.planSha256,input.binding.planSha256);assert.equal(r.driverCommit,source.commit);assert.equal(r.driverTree,source.tree);assert.equal(r.scope,input.binding.scope);assert.equal(r.action,input.plan.action);
  const expiresAt=Math.min(originalEnd,readerEntryTimeV1(r.expiresAt),readerEntryTimeV1(a.expiresAt));assert(now<expiresAt);
  return{objectiveId:a.id,objectiveSha256:r.authorityRecordSha256,planSha256:r.planSha256,sourceHead:source.commit,sourceTree:source.tree,scope:a.scope,action:r.action,resource:API,account:ACCOUNT,validFrom:new Date(Math.max(readerEntryTimeV1(a.validFrom),readerEntryTimeV1(r.verifiedAt))).toISOString(),expiresAt:new Date(expiresAt).toISOString()};
}
function readerBudgetRawManifestV1(directory){
  assert.equal(fs.realpathSync(directory),readerPathV1.resolve(directory));const names=fs.readdirSync(directory).toSorted(codeUnitOrder);assert(names.length>0&&names.length<=402&&names.every(name=>name==='BINDING.json'||/^\d{4}\.json$/u.test(name)));
  const files=names.map(name=>{const file=readerPathV1.join(directory,name),before=fs.lstatSync(file);assert(before.isFile()&&!before.isSymbolicLink()&&before.size<=16384);const bytes=fs.readFileSync(file),after=fs.lstatSync(file);assert.equal(after.size,before.size);assert.equal(after.mtimeMs,before.mtimeMs);return{name,sha256:createHash('sha256').update(bytes).digest('hex')};});return{directory,files,fileManifestSha256:digest(files)};
}
function readerClosedOriginalBudgetV1({directory,binding,prior,rawIntegrity,plan,limits}){
  assert.equal(fs.realpathSync(directory),readerPathV1.resolve(directory));assert(fs.lstatSync(directory).isDirectory()&&!fs.lstatSync(directory).isSymbolicLink());
  const files=fs.readdirSync(directory).toSorted(codeUnitOrder);assert(files.length>=4&&files.length<=402);assert(files.every(name=>name==='BINDING.json'||/^\d{4}\.json$/u.test(name)),'READER_ORIGINAL_BUDGET_MUST_BE_CLOSED');
  const hash=bytes=>createHash('sha256').update(bytes).digest('hex'),manifest=[];
  function read(name){const file=readerPathV1.join(directory,name),stat=fs.lstatSync(file);assert(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<=16384);const bytes=fs.readFileSync(file);manifest.push({name,sha256:hash(bytes)});return JSON.parse(bytes);}
  const descriptor=read('BINDING.json');exact(descriptor,['schemaVersion','kind','binding','limits','bindingSha256']);assert.equal(descriptor.schemaVersion,2);assert.equal(descriptor.kind,'IMAGE_NATIVE_SESSION_BINDING_V2');assert.deepEqual(descriptor.binding,binding);assert.deepEqual(descriptor.limits,limits);assert.equal(descriptor.bindingSha256,digest(binding));
  let previous=null,pending=null,requests=0,bytes=0,first=null,last=readerEntryTimeV1(binding.windowStart),stopped=false,stopCode=null,patches=0;const records=files.filter(name=>name!=='BINDING.json');
  for(const [index,name]of records.entries()){assert.equal(name,String(index+1).padStart(4,'0')+'.json');const row=read(name);exact(row,['payload','sha256']);assert.equal(row.sha256,digest(row.payload));const value=row.payload;assert.equal(value.bindingSha256,descriptor.bindingSha256);assert.equal(value.previousSha256,previous);assert(Number.isSafeInteger(value.at)&&value.at>=last&&!stopped);last=value.at;previous=row.sha256;
    if(value.kind==='REQUEST'){exact(value,['bindingSha256','previousSha256','at','kind','ordinal','method','resource','requestSha256','deadlineAt']);assert.equal(pending,null);assert.equal(value.ordinal,++requests);assert(requests<=200);assert(H.test(value.requestSha256)&&Number.isSafeInteger(value.deadlineAt));first??=value.at;pending=value.ordinal;if(value.method==='PATCH'){patches++;const request={method:'PATCH',url:'https://run.googleapis.com/v2/'+API+'?updateMask=template.containers',body:plan.patch.body};assert.equal(value.resource,request.url);assert.equal(value.requestSha256,digest(request));}}
    else if(value.kind==='RESPONSE'){exact(value,['bindingSha256','previousSha256','at','kind','ordinal','responseBytes']);assert.equal(value.ordinal,pending);assert(Number.isSafeInteger(value.responseBytes)&&value.responseBytes>=0);bytes+=value.responseBytes;pending=null;}
    else{exact(value,['bindingSha256','previousSha256','at','kind','code']);assert.equal(value.kind,'STOP');assert(/^[A-Z][A-Z0-9_]{0,63}$/u.test(value.code));stopped=true;stopCode=value.code;}
  }
  assert(stopped&&pending===null&&patches===1,'READER_CLOSED_ONE_PATCH_ORIGINAL_REQUIRED');for(const [key,value]of Object.entries({bindingSha256:descriptor.bindingSha256,requestsReserved:requests,totalResponseBytes:bytes,firstNativeAt:first,pendingOrdinal:null,stopped:true,stopCode,lastRecordSha256:previous})){assert.deepEqual(prior[key],value,'READER_ORIGINAL_BUDGET_PROOF_MISMATCH');}
  const observedRaw=readerBudgetRawManifestV1(directory);assert.equal(readerPathV1.resolve(rawIntegrity.directory),readerPathV1.resolve(directory));assert.equal(rawIntegrity.fileManifestSha256,digest(rawIntegrity.files));assert.deepEqual(observedRaw,rawIntegrity,'READER_ORIGINAL_RAW_BUDGET_BYTES_CHANGED');const fingerprint=digest(manifest);return{fingerprint,files:manifest,assertUnchanged(){assert.deepEqual(fs.readdirSync(directory).toSorted(codeUnitOrder),files);for(const row of manifest){assert.equal(hash(fs.readFileSync(readerPathV1.join(directory,row.name))),row.sha256,'READER_ORIGINAL_MUTATION_BUDGET_CHANGED');}}};
}
function closeReaderSequenceV1({capability,sdk,budget,oldBudget,output}){if(capability){sessions.delete(capability);}try{sdk?.close();if(budget&&!budget.inspect().stopped){budget.stop('API_READER_ENTRY_CLOSED_NO_RETRY');}oldBudget?.assertUnchanged();if(oldBudget&&output.originalMutationBudget){output.originalMutationBudget.preservedReadOnly=true;}}catch{output={...output,observedStateBeforeCleanup:output?.state,state:'STOP',secondaryGuard:'READER_LOCAL_CLEANUP_OR_ORIGINAL_BUDGET_CHANGED_NO_RETRY'};if(output.originalMutationBudget){output.originalMutationBudget.preservedReadOnly=false;}}return output;}
async function readerOfficialSequenceV1(prepared,deps,syntheticOnly){
  const {dossier,source,jiraBytes,objectiveId,journalDirectory,proofDirectory}=prepared;const {clock}=deps;let sdk,native,budget,output,original,sessionBinding,capability,session,oldBudget,permissionObservation=null,knownOperation=null,stage='INPUTS';const mode=prepared.mode??'DISPATCH';
  const sourceAndInputs=()=>{deps.assertSource(source);prepared.assertInputs();};
  try{
    sourceAndInputs();validateApiSheetReaderLocalDirectoriesV1({journalDirectory,proofDirectory,outputDirectory:null});assert(['DISPATCH','OBSERVE_ONLY'].includes(mode));assert.equal(dossier.direction,'ENABLE_READER','R6_INITIAL_READER_ENABLE_ONLY');assert.match(objectiveId,/^rc48-api-sheets-reader-config-[a-z0-9-]{8,64}$/u);deps.validateDossier(dossier,{objectiveId,source});assert.equal(deps.hash(journalDirectory),dossier.journalDirectorySha256);assert.equal(deps.hash(proofDirectory),dossier.proofDirectorySha256);
    stage='RUNTIME_PREREQUISITES';const runtime=readerEntryRuntimeV1({dossier,readJson:prepared.readJson,now:clock()});
    stage='PROTECTED_GOVERNANCE';
    original=await deps.authorize({github:deps.github,objectiveId,dossier,localSource:source,jiraBytes,action:dossier.action,clock});sourceAndInputs();
    const began=clock(),originalEnd=Math.min(readerEntryTimeV1(original.receipt.expiresAt),readerEntryTimeV1(original.entry.expiresAt),began+900000);assert(began>=readerEntryTimeV1(original.receipt.verifiedAt)&&began<originalEnd);
    sessionBinding={sessionId:'local:'+deps.uuid(),authorityRecordSha256:original.receipt.authorityRecordSha256,resourceBindingSha256:original.receipt.resourceBindingSha256,scope:dossier.scope,windowStart:new Date(began).toISOString(),windowEnd:new Date(originalEnd).toISOString(),sourceCommit:source.commit,project:'crmynov-prod-n7x4q2',region:'europe-west1'};
    deps.validateBinding(sessionBinding,{authority:original,dossier,source,now:began});
    const journalBinding={objectiveId,objectiveSha256:original.receipt.authorityRecordSha256,planSha256:digest(dossier.plan),sourceHead:source.commit,sourceTree:source.tree,scope:dossier.scope,stage:dossier.stage,resource:API};
    stage='ORIGINAL_TRANSACTION';const transaction=inspect(journalDirectory,journalBinding);assert.equal(transaction.state,mode==='DISPATCH'?'UNUSED':'KNOWN_OPERATION_OBSERVE_ONLY','READER_WRONG_ORIGINAL_TRANSACTION_STATE');const proofDirectoryState=inspectProofDirectory(proofDirectory,journalBinding);if(mode==='DISPATCH'){assert.equal(proofDirectoryState.nextOrdinal,1,'READER_DISPATCH_PROOF_DOMAIN_MUST_BE_UNUSED');}
    if(mode==='OBSERVE_ONLY'){stage='ORIGINAL_KNOWN_OPERATION';knownOperation=operationName(transaction.rows[1].payload.details.operation);readerEntryReferenceV1(prepared.priorEntryReceipt);const prior=prepared.readJson(prepared.priorEntryReceipt);assert(prior.kind==='READER_CONFIG_OPERATION_SEQUENCE_RESULT_V1'&&prior.syntheticOnly===syntheticOnly);assert.equal(prior.knownOperation,knownOperation);readerEntryReferenceV1(prior.registeredOperationReceipt);assert.equal(readerPathV1.resolve(prior.registeredOperationReceipt.path),readerPathV1.resolve(journalDirectory,dossier.stage+'-2.json'));assert.equal(createHash('sha256').update(fs.readFileSync(prior.registeredOperationReceipt.path)).digest('hex'),prior.registeredOperationReceipt.sha256);assert.notEqual(prior.sessionBinding.sessionId,sessionBinding.sessionId,'READER_OBSERVER_REQUIRES_A_DISTINCT_LOCAL_SESSION');assert.equal(prior.sessionBinding.authorityRecordSha256,journalBinding.objectiveSha256);assert.equal(prior.sessionBinding.sourceCommit,source.commit);assert.equal(prior.sessionBinding.resourceBindingSha256,sessionBinding.resourceBindingSha256);assert.equal(prior.scope,dossier.scope);assert(prior.sdkAuthentication.closed&&prior.sdkAuthentication.tokenReferencesReleased);const oldDirectory=journalDirectory+'.native-budget-'+journalBinding.objectiveSha256.slice(0,16);assert.equal(readerPathV1.resolve(prior.budgetDirectory),readerPathV1.resolve(oldDirectory));oldBudget=readerClosedOriginalBudgetV1({directory:oldDirectory,binding:prior.sessionBinding,prior:prior.nativeSessionBudget,rawIntegrity:prior.nativeBudgetRawIntegrity,plan:dossier.plan,limits:deps.limits});}else{assert.equal(prepared.priorEntryReceipt??null,null);}
    stage='PERSISTENT_BUDGET';const budgetDirectory=deps.budgetDirectory(journalDirectory,original.receipt.authorityRecordSha256,mode,knownOperation);budget=deps.createBudget({directory:budgetDirectory,binding:sessionBinding,clock});deps.requireBudget(budget,sessionBinding);
    const input={binding:journalBinding,plan:dossier.plan,before:dossier.before,preservation:runtime.preservation,journalDirectory,proofDirectory,forward:prepared.forward};
    stage='R5_INPUTS';bindingInput(input);rollback(input);
    const originalAuthority=()=>original,guard=()=>{sourceAndInputs();deps.validateBinding(sessionBinding,{authority:original,dossier,source,now:clock()});const state=deps.requireBudget(budget,sessionBinding);assert(!state.stopped&&state.remainingMs>0);};
    session={input,clock,schedule:deps.schedule,cancel:deps.cancel,lastAt:began,deadline:originalEnd,syntheticOnly,mode,used:false,phase:'INPUTS',adapters:{},persistence:{consume,recordOperation,finish,persistProof}};
    const observed=(role,value)=>{publicData(value);const handle=Object.freeze({});observations.set(handle,{session,role,value:structuredClone(value)});return handle;};
    session.adapters.authenticate=async()=>{guard();sdk=await deps.openSdk({operationContract:{schemaVersion:2,kind:'OFFICIAL_SDK_OPERATIONAL_RESOURCE_SESSION_V2',...sessionBinding,sourceTree:source.tree,googleAccount:ACCOUNT},getAuthority:originalAuthority,assertCurrent:guard,readerContext:{dossier,source,sessionBudget:budget}});assert(sdk.report().authenticationChainValidated&&!sdk.report().closed);native=await deps.createNative({binding:sessionBinding,dossier,source,journalDirectory,mode,accessToken:sdk.accessToken,getAuthority:originalAuthority,sessionBudget:budget,clock});return observed('AUTH',{account:ACCOUNT,scope:dossier.scope});};
    session.adapters.authorize=async()=>{guard();const fresh=await deps.authorize({github:deps.github,objectiveId,dossier,localSource:source,jiraBytes,action:dossier.action,clock});sourceAndInputs();assert.deepEqual(fresh.entry,original.entry);for(const key of ['actor','grantDigest','operationalCommentId','operationalMarkerSha256','operationalMarkerUpdatedAt','jiraObservedAt','driverCommit','driverTree','cataloguePr']){assert.deepEqual(fresh.receipt[key],original.receipt[key],'READER_VERIFIED_ORIGIN_CHANGED_NO_SUBSTITUTION');}
      // A shorter/different fixed evidence lease is a refusal, never a mutation of
      // t0's SDK/R4 record. A fresh t1 may not extend the original common session.
      assert(readerEntryTimeV1(fresh.receipt.expiresAt)>=originalEnd,'READER_EARLIER_FRESH_LEASE_REQUIRES_STOP');return observed('AUTHORITY',readerAuthorityProjectionV1(fresh,{input,source,originalEnd,now:clock()}));};
    session.adapters.permissions=async()=>{guard();await native.testProjectPermissions();await native.testApiPermissions();permissionObservation=native.permissionEvidence();return observed('PERMISSIONS',permissionObservation);};
    session.adapters.current=async()=>observed('CURRENT',await native.getApiCurrentObservation());
    session.adapters.preservation=async()=>{const web=await native.getWeb(),jobs=await native.collectJobs(),schedulers=await native.collectSchedulers();return observed('PRESERVATION',{observedAt:new Date(clock()).toISOString(),web,jobs,schedulers});};
    session.adapters.patch=async patch=>{assert.equal(mode,'DISPATCH','READER_OBSERVER_CANNOT_PATCH');assert.deepEqual(patch,dossier.plan.patch);return observed('PATCH_OPERATION',await native.patchReaderConfig());};
    session.adapters.operation=async name=>observed('OPERATION',await native.getKnownOperation(name));
    session.adapters.served=async()=>{const service=await native.getApi(),revision=await native.getApiReadyRevision();return observed('SERVED',{service,revision,observedAt:new Date(clock()).toISOString()});};
    session.adapters.close=()=>{sdk?.close();};capability=Object.freeze({});sessions.set(capability,session);output=mode==='DISPATCH'?await runApiSheetReaderOperationV1({capability}):await observeApiSheetReaderOperationV1({capability});
    const after=inspect(journalDirectory,journalBinding),operationFile=readerPathV1.join(journalDirectory,dossier.stage+'-2.json'),registeredOperationReceipt=after.rows.length>=2?{path:operationFile,sha256:createHash('sha256').update(fs.readFileSync(operationFile)).digest('hex')}:null;if(after.rows.length>=2){knownOperation=operationName(after.rows[1].payload.details.operation);}
    output={...output,scope:dossier.scope,entryMode:mode,runtimePrerequisiteCoverage:runtime.coverage,sessionBinding,originalAuthorityReceipt:original.receipt,budgetDirectory,originalMutationBudget:oldBudget?{fingerprint:oldBudget.fingerprint,files:oldBudget.files,preservedReadOnly:false}:null,priorEntryReceipt:prepared.priorEntryReceipt??null,knownOperation,registeredOperationReceipt,originalSessionResumedOrExtended:false,separateObserveOnlyEntryImplemented:true,knownOperationRequiresSeparatelyQualifiedReadOnlySession:output.journalState==='KNOWN_OPERATION_OBSERVE_ONLY'||output.state==='KNOWN_OPERATION_OBSERVE_ONLY'};
  }catch{output={schemaVersion:1,kind:'READER_CONFIG_OPERATIONAL_ENTRY_RESULT_V1',state:'STOP',phase:session?.phase??stage,guard:'READER_OPERATIONAL_ADMISSION_REFUSED',syntheticOnly,nativeAcceptance:false,operationalAuthorityAcquired:false,sheetsActivated:false,automaticRetryAllowed:false,originalSessionResumedOrExtended:false};}
  finally{output=closeReaderSequenceV1({capability,sdk,budget,oldBudget,output});}
  let rawBudget=null;try{if(budget&&output.budgetDirectory){rawBudget=readerBudgetRawManifestV1(output.budgetDirectory);}}catch{output={...output,state:'STOP',secondaryGuard:'READER_TERMINAL_RAW_BUDGET_RECEIPT_FAILED_NO_RETRY'};}
  return{...output,sdkAuthentication:sdk?.report()??null,nativeSessionBudget:budget?.inspect()??null,nativeBudgetRawIntegrity:rawBudget,nativePermissionObservation:permissionObservation,nativeExchangeObservations:native?.observations()??[],sdkAbsenceNotMeasuredZero:!sdk,runPosts:0,sqlQueries:0,webPatchRequests:0,jobOrSchedulerMutations:0};
}
export async function runApiSheetReaderOfficialEntryV1(input){
  readerEntryExactV1(input,['mode','objectiveId','dossierFile','jiraEvidenceFile','journalDirectory','proofDirectory','priorEntryReceipt']);assert(['DISPATCH','OBSERVE_ONLY'].includes(input.mode));
  const {readImageOperationalSourceV4,imageExternalDirectory}=await import('./local-source.mjs');
  const {readPoolPrivateFile}=await import('../pool-reconciliation/pool-operational-driver-v1.mjs');
  const {createReadOnlyGithubReader}=await import('../pool-reconciliation/pool-driver-github-v1.mjs');
  const {authorizeApiSheetReaderConfigV1,validateApiSheetReaderDossierV1,validateApiSheetReaderSessionBindingV1}=await import('./api-sheets-reader-authority-v1.mjs');
  const {createImageSessionBudget,requireImageSessionBudgetInstanceV3,IMAGE_SESSION_LIMITS_V2}=await import('./journal-budget-v2.mjs');
  const {openOfficialSdkOperationalSession}=await import('../readonly-probe/official-sdk-auth-preflight-v1.mjs');
  const {createApiSheetReaderNativeTransportV1}=await import('./operational-transport-v2.mjs');
  const {randomUUID}=await import('node:crypto');const path=await import('node:path');
  assert.equal(process.versions.node,'22.23.3');assert(!process.env.NODE_OPTIONS&&!process.env.NODE_PATH);
  const hash=bytes=>createHash('sha256').update(bytes).digest('hex'),reads=new Map(),read=(file,max=1048576)=>{const bytes=readPoolPrivateFile(file,max),resolved=path.resolve(file),pin=hash(bytes);if(reads.has(resolved)){assert.equal(reads.get(resolved),pin,'READER_PINNED_INPUT_BYTES_CHANGED');}else{reads.set(resolved,pin);}return bytes;},readJson=ref=>{readerEntryReferenceV1(ref);const bytes=read(ref.path);assert.equal(hash(bytes),ref.sha256);const value=JSON.parse(bytes);readerOperationalPublicProjectionV1(value);return value;};
  const source=readImageOperationalSourceV4(),dossierBytes=read(input.dossierFile),dossier=JSON.parse(dossierBytes);publicData(dossier);const jiraBytes=read(input.jiraEvidenceFile,65536),journalDirectory=imageExternalDirectory(input.journalDirectory),proofDirectory=imageExternalDirectory(input.proofDirectory);assert.notEqual(journalDirectory,proofDirectory);
  const prepared={mode:input.mode,priorEntryReceipt:input.priorEntryReceipt,objectiveId:input.objectiveId,dossier,source,jiraBytes,journalDirectory,proofDirectory,forward:null,readJson,assertInputs:()=>{for(const [file,pin]of reads){assert.equal(hash(readPoolPrivateFile(file)),pin,'READER_PINNED_INPUT_BYTES_CHANGED');}}};
  return readerOfficialSequenceV1(prepared,{clock:Date.now,schedule:setTimeout,cancel:clearTimeout,uuid:randomUUID,hash,limits:IMAGE_SESSION_LIMITS_V2,budgetDirectory:(directory,authoritySha,mode,operation)=>{const target=mode==='OBSERVE_ONLY'?directory+'.observe-budget-'+hash(operation):directory+'.native-budget-'+authoritySha.slice(0,16);assert(!fs.existsSync(target),'READER_NATIVE_BUDGET_ALREADY_EXISTS_NO_RESET');fs.mkdirSync(target,{mode:0o700});assert.equal(fs.realpathSync(target),path.resolve(target));return target;},createBudget:createImageSessionBudget,requireBudget:requireImageSessionBudgetInstanceV3,validateDossier:validateApiSheetReaderDossierV1,validateBinding:validateApiSheetReaderSessionBindingV1,authorize:authorizeApiSheetReaderConfigV1,openSdk:openOfficialSdkOperationalSession,createNative:createApiSheetReaderNativeTransportV1,github:createReadOnlyGithubReader(),assertSource:expected=>assert.deepEqual(readImageOperationalSourceV4(),expected)},false);
}
// Source-only qualification seam. Real entry above has no provider/clock/ports argument.
export function simulateApiSheetReaderOfficialWiringV1({syntheticOnly,prepared,dependencies}){assert.equal(syntheticOnly,true,'STRICT_SYNTHETIC_ONLY');return readerOfficialSequenceV1(prepared,dependencies,true);}
