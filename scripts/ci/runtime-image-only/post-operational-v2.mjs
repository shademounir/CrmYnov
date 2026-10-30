// Additive, distinct GENERAL POST execution port. Historical PRE/UNKNOWN,
// Ledger FIN, the 38-input driver and its seven entries remain unchanged.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {POOL_DRIVER_INPUTS,readPoolPrivateFile} from '../pool-reconciliation/pool-operational-driver-v1.mjs';
import {READONLY_RUNTIME_FILES,validateLocalReadOnlyDossier} from '../pool-reconciliation/pool-job-dossier-v1.mjs';
import {QUERY_CONTRACT_SHA256,QUERIES} from '../pool-reconciliation/general-preservation-read-only-collector-v1.mjs';
import {POOL_IMAGE,validateReadOnlyNativeJob,validateReadOnlyNativeExecution,readOnlyOutputReadRequests} from '../pool-reconciliation/pool-native-output-v1.mjs';
import {createReadOnlyNativeTransport,dispatchReadOnlyOnce,openReadOnlyTransactionJournal,observeReadOnlyOperation} from '../pool-reconciliation/pool-native-transaction-v2.mjs';
import {createReadOnlyOutputReader} from '../pool-reconciliation/pool-output-reader-v1.mjs';
import {diagnosticOf,projectDiagnostic} from '../pool-reconciliation/readonly-native-diagnostics-v1.mjs';
import {createGeneralOperationalBudgetV3,validateHistoricalReadOnlyEntriesV3,retainGeneralNativeResponsesV3} from '../pool-reconciliation/general-operational-pre-v3.mjs';
import {createReadOnlyGithubReader} from '../pool-reconciliation/pool-driver-github-v1.mjs';
import {validateNativeJiraReadObservation} from '../pool-reconciliation/general-prospective-pre-authority-v1.mjs';
import {githubFile,assertAuthorityCurrent} from '../readonly-probe/probe-driver-authority-v1.mjs';
import {GRANT_PATH,grantDigest,validateGrant} from '../../pr-policy/delegation.mjs';
import {GITHUB_CODE_REVIEW_POLICY_PATH,validateProtectedCodeReviewPolicy} from '../../pr-policy/github-code-review.mjs';
import {approvedMerge,verifySource} from './protected-gates.mjs';
import {READONLY_CATALOGUE_PATH_V2,validateImageCatalogueReviewV2,resolveImageCatalogueReviewV2} from './catalogue-origin-v2.mjs';
import {IMAGE_OPERATIONAL_DRIVER_INPUTS_V2,readImageOperationalSource,imageExternalDirectory} from './local-source.mjs';
import {OPERATIONAL_HUMAN_SHA256} from './late-binding-v2.mjs';
import {imageJournalDigest as digest} from './journal.mjs';
import {validateImageInventoryPublicProjection} from './operational-cli-v2.mjs';
import {validatePlannedImageServedState} from './plan-mode.mjs';
const H=/^[a-f0-9]{64}$/u,S=/^[a-f0-9]{40}$/u,UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u;
const PROJECT='crmynov-prod-n7x4q2',REGION='europe-west1',PARENT='projects/'+PROJECT+'/locations/'+REGION,RUN='https://run.googleapis.com/v2/',LOG='https://logging.googleapis.com/v2/entries:list';
const PURPOSE='GENERAL_PRESERVATION_READ_ONLY_V1',MAIN='8253024ea35cee6be5636cc6b10a88ae7e177377',REPO='shademounir/CrmYnov',GH='/repos/'+REPO+'/';
const ACTIONS=Object.freeze(['VERIFY','CREATE','OBSERVE_CREATE','RUN','OBSERVE_RUN','READ_OUTPUT','READ_METADATA','TEST_PERMISSIONS']);
export const IMAGE_POST_PROJECT_PERMISSIONS_V2=Object.freeze(['iam.serviceAccounts.actAs','logging.logEntries.list','run.executions.get','run.executions.list','run.jobs.create','run.jobs.get','run.jobs.list','run.jobs.run','run.operations.get','run.tasks.list']);
export const IMAGE_POST_JOB_PERMISSIONS_V2=Object.freeze(['run.executions.list','run.jobs.get','run.jobs.run']);
const MARKER='<!-- codex-image-post-readonly-authorization:v2';
const sha=value=>createHash('sha256').update(value).digest('hex');
const ordering=(a,b)=>a.localeCompare(b,'en');
function exact(value,keys){assert(value&&Object.getPrototypeOf(value)===Object.prototype);const d=Object.getOwnPropertyDescriptors(value);assert(Reflect.ownKeys(d).every(k=>typeof k==='string'&&Object.hasOwn(d[k],'value')));assert.deepEqual(Object.keys(d).sort(ordering),[...keys].sort(ordering));}
function time(value){assert.equal(typeof value,'string');const n=Date.parse(value);assert(Number.isSafeInteger(n)&&new Date(n).toISOString()===value);return n;}
function modulePath(file){return file.startsWith('../readonly-probe/')?'scripts/ci/readonly-probe/'+file.slice('../readonly-probe/'.length):'scripts/ci/pool-reconciliation/'+file;}
export function validateImagePostDossierV2(dossier,readSource){
  validateLocalReadOnlyDossier(dossier,readSource);assert.equal(dossier.objective.purpose,PURPOSE);assert.equal(dossier.bundle.request.phase,'POST');assert.equal(dossier.bundle.request.queryContractSha256,QUERY_CONTRACT_SHA256);
  assert.equal(Object.keys(QUERIES).length+1,13,'POST_REUSES_EXACT_13_SELECTS');assert.equal(dossier.objective.image,POOL_IMAGE);assert.equal(dossier.objective.serviceAccount,'crm-prod-api@'+PROJECT+'.iam.gserviceaccount.com');
  assert.match(dossier.objective.jobName,new RegExp('^'+PARENT+'/jobs/crm-prod-preservation-post-[a-z0-9-]+$','u'));assert(!dossier.objective.jobName.includes('-pre-'));return dossier;
}
export function validateImagePostEntryV2(entry,{objectiveId,dossier,source,action,now,readSource}){
  exact(entry,['schemaVersion','id','status','scope','phase','businessMutation','ticket','actions','validFrom','expiresAt','dossierSha256','humanAuthorityReceiptSha256','journalDirectorySha256','googleAccount','driver','objectiveReview','release','post']);
  assert.equal(entry.schemaVersion,2);assert.equal(entry.id,objectiveId);assert.match(objectiveId,/^rc48-general-post-[a-z0-9-]{8,63}$/u);assert.equal(entry.status,'approved');assert.equal(entry.scope,PURPOSE);assert.equal(entry.phase,'POST');assert.equal(entry.businessMutation,false);assert.equal(entry.ticket,'CRMY-63');
  assert.deepEqual([...entry.actions].sort(ordering),[...ACTIONS].sort(ordering));assert(ACTIONS.includes(action));assert.equal(entry.googleAccount,'casablancaynovcampus@gmail.com');assert.equal(entry.humanAuthorityReceiptSha256,OPERATIONAL_HUMAN_SHA256);assert(H.test(entry.journalDirectorySha256));
  validateImagePostDossierV2(dossier,readSource);assert.equal(entry.dossierSha256,digest(dossier));
  assert(source?.clean&&source.commit===entry.driver.mergeCommit&&source.tree===entry.driver.tree);assert.deepEqual(entry.driver.files,source.files,'POST_EXACT_OPERATIONAL_SOURCE_CLOSURE');
  const names=source.files.map(f=>f.path);assert(POOL_DRIVER_INPUTS.every(p=>names.includes(p)));assert(IMAGE_OPERATIONAL_DRIVER_INPUTS_V2.every(p=>names.includes(p)),'POST_FULL_S01_SOURCE_REQUIRED');
  for(const [name,file]of Object.entries(READONLY_RUNTIME_FILES)){const rows=source.files.filter(f=>f.path===modulePath(file));assert.equal(rows.length,1);assert.equal(rows[0].sha256,sha(dossier.bundle.modules[name].source));}
  validateImageCatalogueReviewV2(entry.objectiveReview,READONLY_CATALOGUE_PATH_V2);assert.equal(entry.release.pr,243);assert.equal(entry.release.mergeCommit,MAIN);assert.equal(entry.release.tag,'v0.1.0-rc.48');assert.equal(entry.release.releaseId,424492409);
  assert.deepEqual(entry.post,{job:dossier.objective.jobName,purpose:PURPOSE,queryContractSha256:QUERY_CONTRACT_SHA256,sourceSha256:dossier.objective.sourceSha256,bundleSha256:dossier.objective.bundleSha256,image:POOL_IMAGE,role:'crm_runtime',selectCount:13,createBeforePre:true,runOnlyAfterImages:true,maximumCreatePosts:1,maximumRunPosts:1});
  const start=time(entry.validFrom),end=time(entry.expiresAt);assert(end>start&&end-start<=86400000&&Number.isSafeInteger(now)&&start<=now&&now<end);return entry;
}
export function validateImagePostCatalogueV2(catalogue,objectiveId){
  validateHistoricalReadOnlyEntriesV3(catalogue);assert.equal(catalogue.entries.length,8,'POST_IS_THE_SINGLE_ADDITIVE_EIGHTH_ENTRY');const entry=catalogue.entries[7];assert.equal(entry.id,objectiveId);assert.equal(entry.schemaVersion,2);return entry;
}
function postMarker(comments,{entry,dossier,source,grant,actor,jiraBytes,action,now}){
  const rows=comments.filter(c=>grant.authenticatedActors.includes(c.user?.login)&&c.user?.type==='User'&&typeof c.body==='string'&&c.body.includes(MARKER)).sort((a,b)=>b.id-a.id);assert(rows.length,'FRESH_POST_MARKER_REQUIRED');
  const comment=rows[0],start=comment.body.indexOf(MARKER),end=comment.body.indexOf('-->',start+MARKER.length);assert(comment.body.length<=65536&&start===comment.body.lastIndexOf(MARKER)&&end>start);const m=JSON.parse(comment.body.slice(start+MARKER.length,end).trim());
  exact(m,['schemaVersion','executor','objectiveId','catalogEntrySha256','dossierSha256','driverCommit','grantDigest','humanAuthorityReceiptSha256','phase','job','actions','jiraEvidenceVersion','jiraObservationSha256','expiresAt','businessMutation','runtimeImageMutation','maximumCreatePosts','maximumRunPosts']);
  assert.equal(m.schemaVersion,2);assert.equal(m.executor,'Codex');assert.equal(m.objectiveId,entry.id);assert.equal(m.catalogEntrySha256,digest(entry));assert.equal(m.dossierSha256,digest(dossier));assert.equal(m.driverCommit,source.commit);assert.equal(m.grantDigest,grantDigest(grant));assert.equal(m.humanAuthorityReceiptSha256,OPERATIONAL_HUMAN_SHA256);assert.equal(m.phase,'POST');assert.equal(m.job,dossier.objective.jobName);
  assert(Array.isArray(m.actions)&&m.actions.includes(action)&&m.actions.every(a=>ACTIONS.includes(a)));assert.equal(m.businessMutation,false);assert.equal(m.runtimeImageMutation,false);assert.equal(m.maximumCreatePosts,1);assert.equal(m.maximumRunPosts,1);assert.equal(m.jiraEvidenceVersion,1);
  const issued=Date.parse(comment.updated_at??comment.created_at),expires=time(m.expiresAt);assert(Number.isSafeInteger(issued)&&issued<=now&&now-issued<600000&&now<expires&&expires-issued<=600000);
  const jira=validateNativeJiraReadObservation(jiraBytes,{expectedSha256:m.jiraObservationSha256,actor,grantSha256:grantDigest(grant),now});return{commentId:comment.id,markerSha256:sha(comment.body),actions:[...m.actions],jira,expiresAt:Math.min(expires,time(entry.expiresAt),Date.parse(jira.observedAt)+600000)};
}
async function releasedImage(github,entry,authorization){
  const branch=await github.get(GH+'branches/main');assert(branch.protected&&branch.commit.sha===MAIN);await approvedMerge(github,entry.release,{...authorization,base:'main'});
  const release=await github.get(GH+'releases/tags/v0.1.0-rc.48');assert.equal(release.id,424492409);assert.equal(release.draft,false);assert.equal(release.prerelease,true);
  const tag=await github.get(GH+'git/ref/tags/v0.1.0-rc.48');assert.equal(tag.object.type,'commit');assert.equal(tag.object.sha,MAIN);
  const post=await github.get(GH+'actions/runs/'+entry.release.postPublishRun);assert.equal(post.head_sha,MAIN);assert.equal(post.event,'release');assert.equal(post.path,'.github/workflows/release-publish.yml');assert.equal(post.status,'completed');assert.equal(post.conclusion,'success');
}
export async function authorizeImagePostReadOnlyV2({github,objectiveId,dossier,localSource:source,jiraBytes,action,readSource,clock=Date.now}){
  const began=clock();assert(Number.isSafeInteger(began)&&ACTIONS.includes(action));const user=await github.get('/user');assert.equal(user.type,'User');const actor=user.login;
  const branch=await github.get(GH+'branches/develop'),revision=branch.commit.sha;assert(branch.protected&&S.test(revision));const protection=await github.get(GH+'branches/develop/protection');assert(protection.enforce_admins.enabled&&protection.required_status_checks.strict&&protection.required_conversation_resolution.enabled);assert(protection.required_status_checks.contexts.includes('pr-policy'));assert(!protection.allow_force_pushes.enabled&&!protection.allow_deletions.enabled);
  const grant=JSON.parse(await githubFile(github,GRANT_PATH,revision));validateGrant(grant,{repository:REPO,actor,base:'develop',reasons:['production','audited-repository-tooling']});assert.equal(grant.id,'crm-ynov-po-delegation-20261001');const policy=await githubFile(github,GITHUB_CODE_REVIEW_POLICY_PATH,revision);validateProtectedCodeReviewPolicy(JSON.parse(policy),REPO);
  const catalogue=JSON.parse(await githubFile(github,READONLY_CATALOGUE_PATH_V2,revision)),entry=validateImagePostCatalogueV2(catalogue,objectiveId);validateImagePostEntryV2(entry,{objectiveId,dossier,source,action,now:began,readSource});await verifySource(github,source,entry);
  const reference=await resolveImageCatalogueReviewV2(github,{descriptor:entry.objectiveReview,revision,expectedPath:READONLY_CATALOGUE_PATH_V2});
  const [driver,objective]=await Promise.all([approvedMerge(github,entry.driver,{grant,actor,base:'develop'}),approvedMerge(github,reference,{grant,actor,base:'develop'})]);assert(objective.files.some(f=>f.filename===READONLY_CATALOGUE_PATH_V2));
  const published=JSON.parse(await githubFile(github,READONLY_CATALOGUE_PATH_V2,reference.mergeCommit));assert.equal(digest(validateImagePostCatalogueV2(published,objectiveId)),digest(entry));
  for(const commit of [source.commit,reference.mergeCommit]){const relation=await github.get(GH+'compare/'+commit+'...'+revision);assert.equal(relation.merge_base_commit.sha,commit);assert(['ahead','identical'].includes(relation.status));}
  await releasedImage(github,entry,{grant,actor});const now=clock();assert(now>=began&&now-began<60000);validateImagePostEntryV2(entry,{objectiveId,dossier,source,action,now,readSource});const marker=postMarker(objective.comments,{entry,dossier,source,grant,actor,jiraBytes,action,now});assert.equal((await github.get(GH+'branches/develop')).commit.sha,revision);
  const authority={entry:{...structuredClone(entry),objectiveId,authorityRecordSha256:digest(entry)},receipt:{schemaVersion:2,executor:'Codex',actor,scope:PURPOSE,phase:'POST',objectiveId,authorityRecordSha256:digest(entry),catalogEntrySha256:digest(entry),catalogueSha256:digest(catalogue),catalogRevision:revision,dossierSha256:digest(dossier),driverCommit:source.commit,driverPr:driver.pull.number,objectivePr:reference.pr,grantDigest:grantDigest(grant),jiraObservedAt:marker.jira.observedAt,jiraObservationSha256:sha(jiraBytes),operationalCommentId:marker.commentId,operationalMarkerSha256:marker.markerSha256,authorizedActions:marker.actions,verifiedAt:new Date(now).toISOString(),expiresAt:new Date(marker.expiresAt).toISOString(),businessMutationAuthorized:false,runtimeImageMutationAuthorized:false,gitHubCodeReviewRequired:false,codeReviewPolicySha256:sha(policy)}};
  assertAuthorityCurrent(authority,clock());return Object.freeze(authority);
}
export function imagePostResourceBindingsV2(authority,dossier){
  assert.equal(authority.entry.scope,PURPOSE);assert.equal(authority.entry.phase,'POST');assert.equal(authority.receipt.dossierSha256,digest(dossier));
  return{schemaVersion:2,kind:'POST_PRESERVATION_RESOURCE_BINDING_V2',project:PROJECT,region:REGION,objectiveId:authority.entry.objectiveId,job:dossier.objective.jobName,
    dossierSha256:digest(dossier),sourceSha256:dossier.objective.sourceSha256,bundleSha256:dossier.objective.bundleSha256,image:POOL_IMAGE,role:'crm_runtime',selectCount:13};
}
export function makeImagePostSdkSessionV2({authority,dossier,binding,commonSessionBindingSha256,budgetState,preparationPhase,now}){
  assert(['POST_RESOURCE_PREPARATION','POST_EXECUTION'].includes(preparationPhase));assertAuthorityCurrent(authority,now);assert.equal(authority.entry.phase,'POST');
  assert(authority.receipt.authorizedActions.includes(preparationPhase==='POST_RESOURCE_PREPARATION'?'CREATE':'RUN'));
  assert(H.test(commonSessionBindingSha256));assert.equal(commonSessionBindingSha256,budgetState.bindingSha256);assert(!budgetState.stopped&&budgetState.remainingMs>0);
  const resources=imagePostResourceBindingsV2(authority,dossier),resourceBindingSha256=digest(resources);assert.equal(binding.scope,'POST_PRESERVATION_READ_ONLY_V2');assert.equal(binding.authorityRecordSha256,authority.receipt.authorityRecordSha256);assert.equal(binding.resourceBindingSha256,resourceBindingSha256);assert.equal(binding.sourceCommit,authority.receipt.driverCommit);
  assert.equal(digest(binding),commonSessionBindingSha256,'CREATE_POST_SESSION_MUST_NOT_REUSE_IMAGE_OR_N02_BINDING');assert(time(authority.entry.validFrom)<=time(binding.windowStart)&&time(binding.windowEnd)<=time(authority.entry.expiresAt));
  const entry={schemaVersion:2,scope:binding.scope,project:PROJECT,region:REGION,googleAccount:'casablancaynovcampus@gmail.com',driver:structuredClone(authority.entry.driver),authorityRecordSha256:authority.receipt.authorityRecordSha256,resourceBindingSha256,
    resourceBindings:resources,preparationMode:'POST_PRESERVATION_V2',preparationPhase,commonSessionBindingSha256,actions:['CREATE_POST_JOB','RUN_POST_JOB','READ_POST_OUTPUT','READ_METADATA','TEST_PERMISSIONS','OBSERVE_OPERATION'],validFrom:authority.entry.validFrom,expiresAt:authority.entry.expiresAt};
  const receipt={...structuredClone(authority.receipt),scope:binding.scope,resourceBindingSha256,commonSessionBindingSha256};
  return{authority:{entry,receipt},operationContract:{schemaVersion:2,kind:'OFFICIAL_SDK_OPERATIONAL_RESOURCE_SESSION_V2',...structuredClone(binding),sourceTree:entry.driver.tree,googleAccount:entry.googleAccount,preparationPhase,commonSessionBindingSha256}};
}
function durablePublic(file,value){validateImageInventoryPublicProjection(value);const bytes=Buffer.from(JSON.stringify(value,null,2)+'\n'),fd=fs.openSync(file,'wx',0o600);try{let offset=0;while(offset<bytes.length){const n=fs.writeSync(fd,bytes,offset,bytes.length-offset);assert(n>0);offset+=n;}fs.fsyncSync(fd);}finally{fs.closeSync(fd);}return{path:file,sha256:sha(fs.readFileSync(file))};}
function checkedJournal({directory,initialize,dossier,entry,openJournal}){
  const pin=path.join(directory,'POST-OBJECTIVE-BINDING.json'),value={schemaVersion:2,kind:'DISTINCT_POST_JOURNAL_BINDING_V2',job:dossier.objective.jobName,objectiveSha256:dossier.objective.objectiveSha256,dossierSha256:digest(dossier),authorityRecordSha256:entry.authorityRecordSha256};
  if(initialize){assert.equal(fs.readdirSync(directory).length,0,'POST_REQUIRES_NEW_EMPTY_JOURNAL');durablePublic(pin,value);}else{assert(fs.existsSync(pin),'ONLY_A_BOUND_POST_JOURNAL_MAY_BE_OPENED');assert.deepEqual(JSON.parse(readPoolPrivateFile(pin,65536)),value);}
  return openJournal({directory,objective:dossier.objective,initialize});
}
function publicPostDiagnostic(error,stage){
  const descriptor=Object.getOwnPropertyDescriptor(error??{},'message'),message=descriptor&&Object.hasOwn(descriptor,'value')?descriptor.value:null;
  const closed=['POST_SESSION_BOUNDARY_REFUSED','POST_NATIVE_DEADLINE','POST_NATIVE_HTTP_REFUSED','POST_NATIVE_BODY_BOUND','POST_SOURCE_CHANGED','POST_RUN_CAPABILITY_ALREADY_CONSUMED','POST_IMAGES_REQUIRED_BEFORE_RUN','POST_PERMISSION_TEST_MISSING','POST_NATIVE_DISPATCH_REFUSED'];
  const diagnostic=error instanceof PostDispatchRefusal?projectDiagnostic(error.nativeDiagnostic):diagnosticOf(error);
  return{stage,guardCode:closed.includes(message)?message:'POST_OPERATIONAL_V2_GUARD_REFUSED',...(diagnostic?{nativeDiagnostic:diagnostic}:{}),canRetry:false};
}
class PostDispatchRefusal extends Error{constructor(result){super('POST_NATIVE_DISPATCH_REFUSED');Object.defineProperty(this,'nativeDiagnostic',{value:projectDiagnostic(result.diagnostic)});}}
function requirePostDispatch(result){if(result.state!=='OPERATION'||result.diagnosticAvailable===true||result.operationReferencePersistence==='FAILED'){throw new PostDispatchRefusal(result);}return result;}
function assertSharedPostBudget(sharedBudget,commonSessionBindingSha256){const state=sharedBudget.inspect();assert.equal(state.bindingSha256,commonSessionBindingSha256,'POST_SESSION_BOUNDARY_REFUSED');assert(!state.stopped&&state.remainingMs>0&&state.remainingRequests>0&&state.remainingResponseBytes>0,'POST_SESSION_BOUNDARY_REFUSED');return state;}
async function readPostBody(response,{deadline,controller,clock,check,onBytes,remainingResponseBytes}){
  assert.equal(response.redirected,false);assert(/^application\/json(?:\s*;|$)/iu.test(response.headers.get('content-type')??''));assert(response.body);const reader=response.body.getReader(),chunks=[];let bytes=0;
  try{while(true){check();assert(clock()<deadline&&!controller.signal.aborted,'POST_NATIVE_DEADLINE');const part=await reader.read();check();assert(clock()<deadline&&!controller.signal.aborted,'POST_NATIVE_DEADLINE');if(part.done){break;}bytes+=part.value.byteLength;onBytes(bytes);assert(bytes<=1048576&&bytes<=remainingResponseBytes(),'POST_NATIVE_BODY_BOUND');chunks.push(part.value);}}finally{try{await reader.cancel();}finally{reader.releaseLock();}}
  return{bytes:Buffer.concat(chunks,bytes),size:bytes};
}
// The CREATE route uses only this exact job, identity-only parent inventory,
// and the one durably discovered CREATE operation. No arbitrary job GET/RUN.
export function createImagePostCreateBudgetV2({dossier,journal,sharedBudget,commonSessionBindingSha256,getAuthority,assertCurrent,fetchImpl=fetch,clock=Date.now}){
  const job=dossier.objective.jobName,jobPath='/v2/'+job,parentPath='/v2/'+PARENT+'/jobs',pages=new Map();
  function allowed(url,init){
    const u=new URL(url),method=init.method??'GET';assert.equal(u.username+u.password+u.hash,'');assert.equal(init.redirect,'error');assert(['GET','POST'].includes(method));
    const a=getAuthority();assert.equal(a.entry.scope,PURPOSE);assert.equal(a.entry.phase,'POST');
    if(url==='https://cloudresourcemanager.googleapis.com/v1/projects/'+PROJECT+':testIamPermissions'){assert.equal(method,'POST');assert.deepEqual(JSON.parse(init.body),{permissions:[...IMAGE_POST_PROJECT_PERMISSIONS_V2]});assert(a.receipt.authorizedActions.includes('TEST_PERMISSIONS'));return;}
    assert.equal(u.origin,'https://run.googleapis.com');
    if(u.pathname===jobPath+':testIamPermissions'){assert.equal(method,'POST');assert.equal(u.search,'');assert.deepEqual(JSON.parse(init.body),{permissions:[...IMAGE_POST_JOB_PERMISSIONS_V2]});assert(a.receipt.authorizedActions.includes('TEST_PERMISSIONS'));return;}
    if(method==='POST'){assert(a.receipt.authorizedActions.includes('CREATE'));assert.equal(u.pathname,parentPath);assert.equal(u.search,'?'+new URLSearchParams({jobId:job.split('/').at(-1)}));assert.deepEqual(JSON.parse(init.body),dossier.job);assert.equal(journal.inspect('CREATE')?.state,'INTENT','POST_CREATE_INTENT_REQUIRED');return;}
    assert(a.receipt.authorizedActions.includes('READ_METADATA'));
    assert.equal(init.body,undefined);if(u.pathname===jobPath){assert.equal(u.search,'');return;}
    if(u.pathname===parentPath){const q=u.searchParams;assert.deepEqual([...q.keys()].sort(ordering),['fields','pageSize','showDeleted',...(q.has('pageToken')?['pageToken']:[])].sort(ordering));assert.equal(q.get('fields'),'jobs(name,uid,deleteTime),nextPageToken');assert.equal(q.get('pageSize'),'100');assert.equal(q.get('showDeleted'),'true');const n=(pages.get(u.pathname)??0)+1;assert(n<=20);pages.set(u.pathname,n);return;}
    if(u.pathname===jobPath+'/executions'){assert([...u.searchParams.keys()].every(k=>['pageSize','showDeleted','pageToken'].includes(k)));assert.equal(u.searchParams.get('pageSize'),'100');assert.equal(u.searchParams.get('showDeleted'),'true');return;}
    assert(u.pathname.startsWith('/v2/'+PARENT+'/operations/'));assert.match(u.pathname.slice(('/v2/'+PARENT+'/operations/').length),/^[A-Za-z0-9_-]{1,256}$/u);const known=journal.inspect('CREATE');assert.equal(known?.operation,u.pathname.slice(4));assert.equal(u.search,'');assert.equal(known?.state==='OPERATION'||known?.state==='RECONCILED',true);
  }
  return async(url,init)=>{
    let ticket,readBytes=0,recorded=false,timer;const controller=new AbortController();const abort=()=>controller.abort();init.signal?.addEventListener('abort',abort,{once:true});
    try{
      assertCurrent();allowed(url,init);assertSharedPostBudget(sharedBudget,commonSessionBindingSha256);const request={method:init.method??'GET',url,...(init.body===undefined?{}:{body:JSON.parse(init.body)})};ticket=sharedBudget.reserveRequest({method:request.method,resource:url,requestSha256:digest(request)});
      const deadline=Math.min(ticket.deadlineAt,Date.parse(getAuthority().receipt.expiresAt));assert(clock()<deadline,'POST_NATIVE_DEADLINE');
      const work=(async()=>{const response=await fetchImpl(url,{...init,signal:controller.signal}),result=await readPostBody(response,{deadline,controller,clock,check:assertCurrent,onBytes:n=>{readBytes=n;},remainingResponseBytes:()=>sharedBudget.inspect().remainingResponseBytes});sharedBudget.recordResponse(ticket,{responseBytes:readBytes});recorded=true;assert([200,404].includes(response.status),'POST_NATIVE_HTTP_REFUSED');return new Response(result.bytes,{status:response.status,headers:response.headers});})();
      return await Promise.race([work,new Promise((resolve,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('POST_NATIVE_DEADLINE'));},deadline-clock());})]);
    }catch(error){controller.abort();if(ticket&&!recorded){try{sharedBudget.recordResponse(ticket,{responseBytes:readBytes});}catch{/* Unknown/pending state is terminal. */}}try{sharedBudget.stop('POST_CREATE_NATIVE_STOP');}catch{/* Never retry persistence. */}throw error;}
    finally{clearTimeout(timer);init.signal?.removeEventListener('abort',abort);}
  };
}
export function validateImagePostServedContextV2(context,source,now){
  exact(context,['plan','candidate','baseline','imageAuthority','api','web']);const a=context.imageAuthority;assertAuthorityCurrent(a,now);assert.equal(a.entry.preparationMode,'LATE_BOUND_V2');assert.equal(a.entry.preparationPhase,'FORWARD_FINAL');assert.equal(a.entry.planSha256,digest(context.plan));assert.equal(a.receipt.driverCommit,source.commit);
  const times=[];for(const kind of ['api','web']){const value=context[kind];exact(value,['service','revision','observedAt']);validatePlannedImageServedState({plan:context.plan,candidate:context.candidate,baseline:context.baseline,kind,...value},now);const at=time(value.observedAt);assert(at<=now&&now-at<300000);times.push(at);}
  return{schemaVersion:2,kind:'SOURCE_BOUND_SERVED_IMAGES_POST_READY_V2',driverCommit:source.commit,imagePlanSha256:digest(context.plan),afterImageObservedAt:new Date(Math.max(...times)).toISOString(),imageObservationsSha256:digest({api:context.api,web:context.web}),authorityRecordSha256:a.receipt.authorityRecordSha256};
}
const privatePosts=new WeakMap();
export async function withVerifiedImagePostV2(capability,consumer){const value=privatePosts.get(capability);assert(value,'OPAQUE_POST_CAPABILITY_REQUIRED');assert.equal(typeof consumer,'function');privatePosts.delete(capability);try{return await consumer(value);}finally{value.checked=undefined;}}
export function releaseVerifiedImagePostV2(capability){const value=privatePosts.get(capability);if(value){privatePosts.delete(capability);value.checked=undefined;}}
const postAuthorities=new WeakMap();
function cachedPostAuthority(capability,{objectiveId,dossier,jiraBytes,journalDirectory,phase,action,clock=Date.now,readSource=readImageOperationalSource,allowSynthetic=false}){
  const value=postAuthorities.get(capability);assert(value&&(allowSynthetic||!value.syntheticOnly),'OPAQUE_REAL_POST_AUTHORITY_REQUIRED');assert.equal(value.phase,phase);assert.equal(value.objectiveId,objectiveId);assert.equal(value.journalDirectory,journalDirectory);assert.equal(value.dossierSha256,digest(dossier));assert.equal(value.jiraSha256,sha(jiraBytes));assert.deepEqual(readSource(),value.source,'POST_SOURCE_CHANGED');
  const now=clock();assertAuthorityCurrent(value.authority,now);assert(value.authority.receipt.authorizedActions.includes(action));validateNativeJiraReadObservation(value.jiraBytes,{expectedSha256:value.jiraSha256,actor:value.authority.receipt.actor,grantSha256:value.authority.receipt.grantDigest,now});return structuredClone(value.authority);
}
export async function acquireImagePostAuthorityV2({objectiveId,dossier,jiraBytes,journalDirectory,preparationPhase}){
  assert(['POST_RESOURCE_PREPARATION','POST_EXECUTION'].includes(preparationPhase));const source=readImageOperationalSource(),directory=imageExternalDirectory(journalDirectory),runtimeReader=file=>readPoolPrivateFile(path.resolve(import.meta.dirname,'../pool-reconciliation',file));
  const action=preparationPhase==='POST_RESOURCE_PREPARATION'?'CREATE':'RUN',authority=await authorizeImagePostReadOnlyV2({github:createReadOnlyGithubReader(),objectiveId,dossier,localSource:source,jiraBytes,action,readSource:runtimeReader});
  assert.equal(sha(directory),authority.entry.journalDirectorySha256);assert.deepEqual(readImageOperationalSource(),source);const required=action==='CREATE'?['CREATE','OBSERVE_CREATE','READ_METADATA','TEST_PERMISSIONS']:['RUN','OBSERVE_RUN','READ_OUTPUT','READ_METADATA','TEST_PERMISSIONS'];assert(required.every(a=>authority.receipt.authorizedActions.includes(a)));
  const capability=Object.freeze({kind:'PRIVATE_REAL_POST_AUTHORITY_CAPABILITY_V2',nativeAuthority:false});postAuthorities.set(capability,{phase:preparationPhase,objectiveId,journalDirectory:directory,dossierSha256:digest(dossier),jiraSha256:sha(jiraBytes),jiraBytes:Buffer.from(jiraBytes),source,authority});return{authorityCapability:capability,authority:structuredClone(authority),source:structuredClone(source)};
}
export function releaseImagePostAuthorityV2(capability){const value=postAuthorities.get(capability);if(value){postAuthorities.delete(capability);value.jiraBytes=undefined;}}
export function simulateImagePostAuthorityCacheV2({syntheticOnly,authority,source,objectiveId,dossier,jiraBytes,journalDirectory,phase}){assert.equal(syntheticOnly,true);const capability=Object.freeze({kind:'SYNTHETIC_PRIVATE_POST_AUTHORITY_CAPABILITY_V2',nativeAuthority:false});postAuthorities.set(capability,{syntheticOnly:true,phase,objectiveId,journalDirectory,dossierSha256:digest(dossier),jiraSha256:sha(jiraBytes),jiraBytes:Buffer.from(jiraBytes),source:structuredClone(source),authority:structuredClone(authority)});return capability;}
export function simulateCheckImagePostAuthorityCacheV2({syntheticOnly,capability,...input}){assert.equal(syntheticOnly,true);return{authority:cachedPostAuthority(capability,{...input,allowSynthetic:true}),syntheticOnly:true,nativeAuthority:false};}
function postBindingFile(directory){return path.join(directory,'POST-RUN-CAPABILITY.json');}
function validatePostRuntimeContract(contract,{authority,dossier,source,sharedBudget,phase}){
  assert(['POST_RESOURCE_PREPARATION','POST_EXECUTION'].includes(phase));
  exact(contract,['schemaVersion','kind','preparationPhase','objectiveId','authorityRecordSha256','dossierSha256','resourceBindingSha256','commonSessionBindingSha256','sourceCommit','sourceTree']);
  assert.equal(contract.schemaVersion,2);assert.equal(contract.kind,'POST_OPERATIONAL_RUNTIME_CONTRACT_V2');assert.equal(contract.preparationPhase,phase);assert.equal(contract.objectiveId,authority.entry.objectiveId);assert.equal(contract.authorityRecordSha256,authority.receipt.authorityRecordSha256);assert.equal(contract.dossierSha256,digest(dossier));assert.equal(contract.resourceBindingSha256,digest(imagePostResourceBindingsV2(authority,dossier)));assert.equal(contract.sourceCommit,source.commit);assert.equal(contract.sourceTree,source.tree);assert(H.test(contract.commonSessionBindingSha256));assertSharedPostBudget(sharedBudget,contract.commonSessionBindingSha256);return contract;
}
export function makeImagePostRuntimeContractV2({authority,dossier,source,sharedBudget,preparationPhase}){
  const result={schemaVersion:2,kind:'POST_OPERATIONAL_RUNTIME_CONTRACT_V2',preparationPhase,objectiveId:authority.entry.objectiveId,authorityRecordSha256:authority.receipt.authorityRecordSha256,dossierSha256:digest(dossier),resourceBindingSha256:digest(imagePostResourceBindingsV2(authority,dossier)),commonSessionBindingSha256:sharedBudget.inspect().bindingSha256,sourceCommit:source.commit,sourceTree:source.tree};
  return validatePostRuntimeContract(result,{authority,dossier,source,sharedBudget,phase:preparationPhase});
}
function completionFromPost({objectiveId,entrySha256,objectiveOriginSha256,dossier,claim,job,execution,taskNetwork,operation,observedAt}){
  validateReadOnlyNativeJob(job,dossier.objective);assert.equal(job.executionCount,1);assert.equal(job.uid,claim.uid);validateReadOnlyNativeExecution(job,execution,dossier.objective,taskNetwork??undefined);
  assert.equal(operation.done,true);assert.equal(operation.error,undefined);assert.equal(operation.response?.name,execution.name);assert.equal(operation.response?.uid,execution.uid);
  assert(Date.parse(execution.createTime)>=Date.parse(claim.at)-1000);assert(Date.parse(execution.startTime)>=Date.parse(claim.afterImageObservedAt));
  return{objectiveId,authorityRecordSha256:entrySha256,objectiveOriginSha256,job,execution,taskNetwork:taskNetwork??null,operation:{name:operation.name,done:true,response:{name:operation.response.name,uid:operation.response.uid}},authority:claim.authority,observedAt};
}
async function openPostPort(input,deps){
  const {mode,objectiveId,dossier,jiraBytes,journalDirectory,initialize,sharedBudget,runtimeContract,save,assertSessionCurrent}=input;
  assert(['PREPARE_POST_RESOURCE','EXECUTE_POST'].includes(mode));assert.equal(initialize,mode==='PREPARE_POST_RESOURCE');for(const fn of [input.accessToken,save,assertSessionCurrent]){assert.equal(typeof fn,'function');}
  const target=structuredClone(dossier),source=deps.readSource();validateImagePostDossierV2(target,deps.readRuntimeSource);let authority,closed=false,tokenProvider=input.accessToken,journal,images;
  const phase=mode==='PREPARE_POST_RESOURCE'?'POST_RESOURCE_PREPARATION':'POST_EXECUTION';let activeStage;
  const guard=()=>{assert(!closed);assertSessionCurrent();assertAuthorityCurrent(authority,deps.clock());assert.deepEqual(deps.readSource(),source,'POST_SOURCE_CHANGED');assert.equal(authority.entry.phase,'POST');assertSharedPostBudget(sharedBudget,runtimeContract.commonSessionBindingSha256);};
  async function fresh(action){assert(!closed);const a=await deps.authorize({objectiveId,dossier:target,jiraBytes,localSource:source,readSource:deps.readRuntimeSource,action,clock:deps.clock});assert.equal(a.receipt.authorityRecordSha256,runtimeContract.authorityRecordSha256);assert(a.receipt.authorizedActions.includes(action));authority=a;guard();return a;}
  await fresh(mode==='PREPARE_POST_RESOURCE'?'CREATE':'RUN');validatePostRuntimeContract(runtimeContract,{authority,dossier:target,source,sharedBudget,phase});assert.equal(sha(journalDirectory),authority.entry.journalDirectorySha256);
  let savedOrdinal=0;const keep=async(name,value)=>{validateImageInventoryPublicProjection(value);return save('POST-'+String(savedOrdinal++).padStart(4,'0')+'-'+name,value);};
  const rawJournal=deps.openPostJournal({directory:journalDirectory,initialize,dossier:target,entry:authority.entry,openJournal:deps.openJournal});
  journal=Object.freeze({inspect:rawJournal.inspect,close:rawJournal.close,append(stage,payload){
    if(stage==='RUN'&&payload.state==='INTENT'){
      guard();assert(images,'POST_IMAGES_REQUIRED_BEFORE_RUN');const ready=validateImagePostServedContextV2(images,source,deps.clock());assert(!deps.runClaimExists(postBindingFile(journalDirectory)),'POST_RUN_CAPABILITY_ALREADY_CONSUMED');
      deps.writeRunClaim(postBindingFile(journalDirectory),{schemaVersion:2,kind:'PERMANENT_POST_SINGLE_RUN_CAPABILITY_V2',job:target.objective.jobName,objectiveSha256:target.objective.objectiveSha256,authorityRecordSha256:authority.receipt.authorityRecordSha256,commonSessionBindingSha256:runtimeContract.commonSessionBindingSha256,
        at:payload.at,uid:payload.uid,etag:payload.etag,afterImageObservedAt:ready.afterImageObservedAt,imageReadinessSha256:digest(ready),authority:{validFrom:authority.entry.validFrom,expiresAt:authority.receipt.expiresAt},canRetry:false});
    }
    return rawJournal.append(stage,payload);
  }});
  const createFetch=createImagePostCreateBudgetV2({dossier:target,journal,sharedBudget,commonSessionBindingSha256:runtimeContract.commonSessionBindingSha256,getAuthority:()=>authority,assertCurrent:guard,fetchImpl:deps.fetchImpl,clock:deps.clock});
  let outputBudget,runBinding;const fetchForPhase=(url,init)=>outputBudget?outputBudget.fetch(url,init):createFetch(url,init);
  const rawNative=createReadOnlyNativeTransport({purpose:PURPOSE,accessToken:async options=>{guard();return tokenProvider(options);},getAuthority:()=>authority,fetchImpl:fetchForPhase,clock:deps.clock,diagnostic:{objectiveId,objectiveSha256:target.objective.objectiveSha256,stage:mode==='PREPARE_POST_RESOURCE'?'CREATE':'RUN'},saveDiagnostic:d=>keep('POST-NATIVE-DIAGNOSTIC',{diagnostic:d})});
  const capture=retainGeneralNativeResponsesV3(rawNative,deps.clock),native={...capture.native,async run(name,etag,options){assert(runBinding);runBinding.expectedEtag=etag;return capture.native.run(name,etag,options);},async operation(name){const value=await capture.native.operation(name);if(outputBudget&&value.done===true&&!value.error){outputBudget.discoverExecution(value.response?.name);}return value;}};
  function configureRunBudget(){
    const created=journal.inspect('CREATE');assert.equal(created?.state,'RECONCILED');assert(UUID.test(created.uid));runBinding={project:PROJECT,region:REGION,job:target.objective.jobName,uid:created.uid,objective:target.objective,knownCreateOperation:created.operation,wallNow:deps.clock};
    outputBudget=createGeneralOperationalBudgetV3({binding:runBinding,sharedBudget,assertCurrent:guard,save:keep,fetchImpl:deps.fetchImpl,clock:deps.clock,leaseRemainingMs:()=>Date.parse(authority.receipt.expiresAt)-deps.clock()});
    const run=journal.inspect('RUN');if(run?.operation){outputBudget.discoverOperation(run.operation);}if(run?.execution){outputBudget.discoverExecution(run.execution);}
  }
  async function permissionTests(requireJob){
    await fresh('TEST_PERMISSIONS');const specs=[{url:'https://cloudresourcemanager.googleapis.com/v1/projects/'+PROJECT+':testIamPermissions',permissions:IMAGE_POST_PROJECT_PERMISSIONS_V2},...(requireJob?[{url:RUN+target.objective.jobName+':testIamPermissions',permissions:IMAGE_POST_JOB_PERMISSIONS_V2}]:[])];
    for(const spec of specs){guard();let token=await tokenProvider();assert(typeof token==='string'&&token.length>0&&token.length<=8192&&!/\s/u.test(token));let response;try{response=await createFetch(spec.url,{method:'POST',redirect:'error',headers:{authorization:'Bearer '+token,accept:'application/json','content-type':'application/json'},body:JSON.stringify({permissions:[...spec.permissions]})});}finally{token=undefined;}
      const value=await response.json();assert.deepEqual(Object.keys(value).sort(ordering),Object.hasOwn(value,'permissions')?['permissions']:[]);const returned=value.permissions??[];const proof={schemaVersion:2,kind:'POST_NATIVE_PERMISSION_OBSERVATION_V2',request:{method:'POST',url:spec.url,permissions:[...spec.permissions]},observedAt:new Date(deps.clock()).toISOString(),returned,missing:spec.permissions.filter(p=>!returned.includes(p)),conditionsOnOtherResourcesNotProved:true,iamModified:false};
      await keep('POST-PERMISSIONS-'+(spec.url.includes('cloudresourcemanager')?'PROJECT':'JOB'),proof);assert(Array.isArray(returned)&&returned.length===spec.permissions.length&&new Set(returned).size===returned.length&&returned.every(p=>spec.permissions.includes(p)),'POST_PERMISSION_TEST_MISSING');}
  }
  async function observe(stage){await fresh(stage==='CREATE'?'OBSERVE_CREATE':'OBSERVE_RUN');if(stage==='RUN'&&!outputBudget){configureRunBudget();}const result=await observeReadOnlyOperation({objective:target.objective,stage,transport:native,journal});if(result.state==='FAILED'){throw new Error('POST_NATIVE_OPERATION_FAILED');}return result;}
  async function untilReconciled(stage){for(let index=0;index<200;index++){guard();const result=await observe(stage);if(result.state==='RECONCILED'){return result;}assert.equal(result.state,'PENDING');await deps.pause(1000);}throw new Error('POST_OBSERVATION_BOUND');}
  async function checkedOutput(privateKeyFile){
    await fresh('READ_OUTPUT');if(!outputBudget){configureRunBudget();}const run=journal.inspect('RUN');assert.equal(run?.state,'RECONCILED');const operation=await native.operation(run.operation);assert(operation.done&&!operation.error&&operation.response?.name===run.execution);
    const temporary=new Map();const readFetch=async(url,init)=>{if(url===LOG){const body=JSON.parse(init.body),end=body.filter.match(/timestamp<="([^"\r\n]+)"$/u)?.[1];assert(end&&Date.parse(end)<=deps.clock()&&deps.clock()-Date.parse(end)<15000);const expected=readOnlyOutputReadRequests(target.objective,run.execution,Date.parse(end))[2];assert.deepEqual(body,expected.body);runBinding.logRequest=expected;}return outputBudget.fetch(url,init);};
    const reader=createReadOnlyOutputReader({accessToken:async options=>{guard();return tokenProvider(options);},getAuthority:()=>authority,fetchImpl:readFetch});let privateKeyPem;
    try{
      privateKeyPem=deps.readPrivateKey(privateKeyFile);const checked=await reader({dossier:target,execution:run.execution,privateKeyPem,clock:deps.clock,save:async(name,value)=>{temporary.set(name,structuredClone(value));}});
      const capturedAt=new Date(deps.clock()).toISOString(),claim=deps.readRunClaim(postBindingFile(journalDirectory));assert.equal(claim.authorityRecordSha256,authority.receipt.authorityRecordSha256);assert.equal(claim.commonSessionBindingSha256,runtimeContract.commonSessionBindingSha256);assert(Date.parse(checked.output.observation.transactionStartedAt)>=Date.parse(claim.afterImageObservedAt));
      const job=checked.job,execution=checked.execution,taskNetwork=temporary.get('NATIVE-OUTPUT-3-RESULT')??capture.retained().taskNetwork??null;
      const objectiveOriginRef=images.candidate.readOnlyPostJob.objectiveOrigin,origin=deps.readPublicReference(objectiveOriginRef);exact(origin,['entry','catalogRevision']);assert.equal(digest(origin.entry),authority.receipt.authorityRecordSha256);assert(S.test(origin.catalogRevision));
      const completion=completionFromPost({objectiveId,entrySha256:authority.receipt.authorityRecordSha256,objectiveOriginSha256:objectiveOriginRef.sha256,dossier:target,claim,job,execution,taskNetwork,operation,observedAt:capturedAt});
      const logs=temporary.get('NATIVE-OUTPUT-2-RESULT'),proof={schemaVersion:2,kind:'VERIFIED_DISTINCT_GENERAL_POST_OUTPUT_V2',objectiveId,authorityRecordSha256:authority.receipt.authorityRecordSha256,dossierSha256:digest(target),jobUid:job.uid,execution:execution.name,operation:operation.name,
        sourceSha256:target.objective.sourceSha256,bundleSha256:target.objective.bundleSha256,metadataSha256:checked.metadataSha256,sealedOutputSha256:checked.sealedOutputSha256,encryptedRecord:logs.entries[0].jsonPayload,nativeLogsResponseSha256:digest(logs),transactionStartedAt:checked.output.observation.transactionStartedAt,transactionCompletedAt:checked.output.observation.transactionCompletedAt,capturedAt,
        afterImageObservedAt:claim.afterImageObservedAt,objectiveOriginRef,completionContext:{schemaVersion:2,completions:[completion]},sameSnapshotAsPre:false,globalPreservationProved:false,activationAuthorized:false};
      const sourceProofRef=await keep('POST-OUTPUT-native-FIN',proof),capability=Object.freeze({kind:'PRIVATE_VERIFIED_POST_CAPABILITY_V2',nativeAuthority:false});privatePosts.set(capability,{checked,capturedAt,sourceProofRef});
      return{state:'FIN_POST_PRESERVATION_OUTPUT_VERIFIED_V2',sourceProofRef,completionContext:proof.completionContext,privatePostCapability:capability,afterImageObservedAt:claim.afterImageObservedAt,outputVerified:true,semanticAndHttpQualificationStillRequired:true,canRetry:false};
    }finally{privateKeyPem=undefined;temporary.clear();}
  }
  async function boundedAction(stage,handler){activeStage=stage;try{guard();return await handler();}catch(error){try{sharedBudget.stop('POST_OPERATIONAL_STOP');}catch{/* No retry. */}const result={state:'POST_OPERATIONAL_STOP_V2',phase,diagnostic:publicPostDiagnostic(error,activeStage),canRetry:false};await keep('POST-STOP',result);return result;}}
  return Object.freeze({
    inspect:stage=>journal.inspect(stage),
    observeUnusedResource:()=>boundedAction('POST_UNUSED_RESOURCE',async()=>{assert.equal(mode,'EXECUTE_POST');assert.equal(journal.inspect('RUN'),null);assert(!deps.runClaimExists(postBindingFile(journalDirectory)),'POST_RUN_CAPABILITY_ALREADY_CONSUMED');await fresh('READ_METADATA');const created=journal.inspect('CREATE');assert.equal(created?.state,'RECONCILED');const start=deps.clock(),job=await native.getJob(target.objective.jobName),end=deps.clock();validateReadOnlyNativeJob(job,target.objective);assert.equal(job.uid,created.uid);assert.equal(job.executionCount??0,0);assert.equal(job.latestCreatedExecution,undefined);const observation={schemaVersion:2,kind:'NATIVE_GCP_JSON_GET_OBSERVATION_V2',requestStartedAt:new Date(start).toISOString(),responseReceivedAt:new Date(end).toISOString(),request:{method:'GET',url:RUN+target.objective.jobName},response:{status:200,finalUrl:RUN+target.objective.jobName,redirected:false,bodySha256:digest(job),hashMeaning:'CANONICAL_PARSED_JSON_NOT_WIRE_BYTES',projection:job}},ref=await keep('POST-UNUSED-RESOURCE-native-GET',observation);return{state:'FIN_POST_UNUSED_RESOURCE_OBSERVED_V2',jobObservation:ref,uid:job.uid,authorityRecordSha256:authority.receipt.authorityRecordSha256,runInvocations:0,claimCreated:false,canRetry:false};}),
    prepareResource:()=>boundedAction('POST_CREATE',async()=>{assert.equal(mode,'PREPARE_POST_RESOURCE');activeStage='POST_CREATE_PERMISSIONS';await permissionTests(false);activeStage='POST_CREATE_DISPATCH';requirePostDispatch(await dispatchReadOnlyOnce({dossier:target,stage:'CREATE',authorizeFresh:()=>fresh('CREATE'),transport:native,journal,clock:deps.clock}));activeStage='POST_CREATE_OBSERVATION';await untilReconciled('CREATE');await fresh('READ_METADATA');const started=deps.clock(),job=await native.getJob(target.objective.jobName),ended=deps.clock();validateReadOnlyNativeJob(job,target.objective);assert.equal(job.uid,journal.inspect('CREATE').uid);assert.equal(job.executionCount??0,0);assert.equal(job.latestCreatedExecution,undefined);const origin={entry:Object.fromEntries(Object.entries(authority.entry).filter(([key])=>!['authorityRecordSha256','objectiveId'].includes(key))),catalogRevision:authority.receipt.catalogRevision},objectiveOrigin=await keep('POST-PROTECTED-OBJECTIVE-ORIGIN',origin);
      const jobObservation=await keep('POST-JOB-native-GET',{schemaVersion:2,kind:'NATIVE_GCP_JSON_GET_OBSERVATION_V2',requestStartedAt:new Date(started).toISOString(),responseReceivedAt:new Date(ended).toISOString(),request:{method:'GET',url:RUN+target.objective.jobName},response:{status:200,finalUrl:RUN+target.objective.jobName,redirected:false,bodySha256:digest(job),hashMeaning:'CANONICAL_PARSED_JSON_NOT_WIRE_BYTES',projection:job}});return{state:'FIN_POST_RESOURCE_READY_UNUSED_V2',postJob:{dossier:target,uid:job.uid,objectiveId,authorityRecordSha256:authority.receipt.authorityRecordSha256,objectiveOrigin,jobObservation},createOperation:journal.inspect('CREATE').operation,canRetry:false,runInvocations:0};}),
    executePost:({imageContext,privateKeyFile})=>boundedAction('POST_RUN',async()=>{assert.equal(mode,'EXECUTE_POST');assert(!deps.runClaimExists(postBindingFile(journalDirectory)),'POST_RUN_CAPABILITY_ALREADY_CONSUMED');images=structuredClone(imageContext);validateImagePostServedContextV2(images,source,deps.clock());const row=images.candidate.readOnlyPostJob;assert(row&&row.objectiveId===objectiveId&&row.dossier.objective.jobName===target.objective.jobName);assert.equal(row.authorityRecordSha256,authority.receipt.authorityRecordSha256);const origin=deps.readPublicReference(row.objectiveOrigin);exact(origin,['entry','catalogRevision']);assert.equal(digest(origin.entry),authority.receipt.authorityRecordSha256);activeStage='POST_RUN_PERMISSIONS';await permissionTests(true);configureRunBudget();activeStage='POST_RUN_DISPATCH';const result=requirePostDispatch(await dispatchReadOnlyOnce({dossier:target,stage:'RUN',authorizeFresh:()=>fresh('RUN'),transport:native,journal,clock:deps.clock}));outputBudget.discoverOperation(result.operation);activeStage='POST_RUN_OBSERVATION';await untilReconciled('RUN');outputBudget.discoverExecution(journal.inspect('RUN').execution);activeStage='POST_OUTPUT_READ_AND_VERIFY';return checkedOutput(privateKeyFile);}),
    close(){closed=true;tokenProvider=undefined;journal.close();},
  });
}
export async function openImagePostOperationalV2(input){
  exact(input,['mode','objectiveId','dossier','jiraBytes','journalDirectory','initialize','authorityCapability','sharedBudget','runtimeContract','accessToken','save','assertSessionCurrent']);assert(postAuthorities.has(input.authorityCapability)&&!postAuthorities.get(input.authorityCapability).syntheticOnly,'OPAQUE_REAL_POST_AUTHORITY_REQUIRED');assert.equal(process.versions.node,'22.23.3');assert(!process.env.NODE_OPTIONS&&!process.env.NODE_PATH);const directory=imageExternalDirectory(input.journalDirectory);assert.equal(directory,input.journalDirectory);
  const phase=input.mode==='PREPARE_POST_RESOURCE'?'POST_RESOURCE_PREPARATION':'POST_EXECUTION';return openPostPort(input,{readSource:readImageOperationalSource,readRuntimeSource:file=>readPoolPrivateFile(path.resolve(import.meta.dirname,'../pool-reconciliation',file)),authorize:args=>cachedPostAuthority(input.authorityCapability,{objectiveId:args.objectiveId,dossier:args.dossier,jiraBytes:args.jiraBytes,action:args.action,journalDirectory:directory,phase}),clock:Date.now,fetchImpl:fetch,openPostJournal:checkedJournal,openJournal:openReadOnlyTransactionJournal,runClaimExists:fs.existsSync,writeRunClaim:durablePublic,readRunClaim:file=>JSON.parse(readPoolPrivateFile(file,65536)),readPublicReference:ref=>{exact(ref,['path','sha256']);assert(H.test(ref.sha256));const bytes=readPoolPrivateFile(ref.path);assert.equal(sha(bytes),ref.sha256);const value=JSON.parse(bytes);validateImageInventoryPublicProjection(value);return value;},readPrivateKey:file=>readPoolPrivateFile(file,16384).toString('utf8'),pause:ms=>new Promise(resolve=>setTimeout(resolve,ms))});
}
export async function simulateImagePostOperationalV2({syntheticOnly,input,dependencies}){assert.equal(syntheticOnly,true);return openPostPort(input,dependencies);}
export async function prepareImagePostResourceV2(input){const port=await openImagePostOperationalV2({...input,mode:'PREPARE_POST_RESOURCE',initialize:true});try{return await port.prepareResource();}finally{port.close();}}
export async function runImagePostReadOnlyV2({imageContext,privateKeyFile,...input}){const port=await openImagePostOperationalV2({...input,mode:'EXECUTE_POST',initialize:false});try{return await port.executePost({imageContext,privateKeyFile});}finally{port.close();}}
export async function observeImagePostUnusedResourceV2(input){const port=await openImagePostOperationalV2({...input,mode:'EXECUTE_POST',initialize:false});try{return await port.observeUnusedResource();}finally{port.close();}}
