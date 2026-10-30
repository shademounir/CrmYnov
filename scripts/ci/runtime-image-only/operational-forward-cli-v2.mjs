// The short SQL PRE window is not spent recollecting GitHub governance. This
// cache keeps only a previously verified lease; it cannot issue or renew one.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {assertAuthorityCurrent} from '../readonly-probe/probe-driver-authority-v1.mjs';
import {validateImageObjective,authorizeImageOnlyDriver} from './authority.mjs';
import {validateImageMarkerV2} from './late-binding-v2.mjs';
import {imageJournalDigest as digest} from './journal.mjs';
import {createImageSessionBudget} from './journal.mjs';
import {readPoolPrivateFile} from '../pool-reconciliation/pool-operational-driver-v1.mjs';
import {createReadOnlyGithubReader} from '../pool-reconciliation/pool-driver-github-v1.mjs';
import {openOfficialSdkOperationalSession} from '../readonly-probe/official-sdk-auth-preflight-v1.mjs';
import {readImageOperationalSource,imageExternalDirectory} from './local-source.mjs';
import {validateImageInventoryPublicProjection} from './operational-cli-v2.mjs';
import {imagePublicRefV2,OPERATIONAL_HUMAN_SHA256} from './late-binding-v2.mjs';
import {acquireImagePostAuthorityV2,releaseImagePostAuthorityV2,imagePostResourceBindingsV2,makeImagePostSdkSessionV2,makeImagePostRuntimeContractV2,prepareImagePostResourceV2} from './post-operational-v2.mjs';
import {runImagePostReadOnlyV2,withVerifiedImagePostV2,releaseVerifiedImagePostV2} from './post-operational-v2.mjs';
import {runGeneralOperationalPreV3,releaseVerifiedGeneralPreV3} from '../pool-reconciliation/general-operational-pre-v3.mjs';
import {validateProspectiveConsumerInputs} from '../pool-reconciliation/general-prospective-pre-session-v1.mjs';
import {validateImagePreparationV2,validateImageIndependentEvidenceV2,bindImageLivePostReadinessV2} from './preparation-v2.mjs';
import {createImageOnlyExecutor} from './executor.mjs';
import {createImageOperationalTransport} from './transport.mjs';
import {runImageForwardSequenceV2} from './operational-forward-sequence-v2.mjs';
import {compareImagePostUsingPrivateGeneralV2} from './post-preservation-v2.mjs';
import {validateImagePostBffSessionObservationV2} from './post-readiness-v2.mjs';
import {READONLY_RUNTIME_FILES} from '../pool-reconciliation/pool-job-dossier-v1.mjs';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const H=/^[a-f0-9]{64}$/u;
const fields=['objectiveId','authorityRecordSha256','resourceBindingSha256','preparationPhase'];
const actions=['READ_METADATA','TEST_PERMISSIONS','CREATE_BACKUP','PATCH_API','PATCH_WEB','OBSERVE_OPERATION'];
export function makeImageForwardLocalLeaseV2({authority,dossier,plan,candidate,baseline,source,jiraBytes,assertSource}){
  assert.equal(typeof assertSource,'function');assert(Buffer.isBuffer(jiraBytes));
  const initial=structuredClone(authority),raw=structuredClone(initial.entry);
  assert.equal(initial.receipt.schemaVersion,2);assert.equal(raw.schemaVersion,2);
  for(const field of fields){delete raw[field];}
  assert.equal(raw.scope,'RC48_SERVICE_IMAGE_ONLY_V1');
  assert.equal(digest(raw),initial.receipt.catalogEntrySha256,'LOCAL_LEASE_REQUIRES_EXACT_VERIFIED_CATALOGUE_ENTRY');
  assert.equal(initial.receipt.authorityRecordSha256,digest(raw));
  assert.equal(initial.receipt.resourceBindingSha256,digest(raw.resourceBindings));
  const comment=initial.operationalMarkerObservation;
  assert(comment&&H.test(initial.receipt.operationalMarkerSha256));
  assert.equal(hash(Buffer.from(comment.body,'utf8')),initial.receipt.operationalMarkerSha256);
  assert.equal(comment.updated_at,initial.receipt.operationalMarkerUpdatedAt);
  assert.equal(digest(comment),initial.receipt.operationalMarkerObservationSha256);
  assert.equal(comment.id,initial.receipt.operationalCommentId);
  assert.equal(comment.user.login,initial.receipt.actor);
  const jiraHash=hash(jiraBytes),oldestVerified=Date.parse(initial.receipt.verifiedAt);
  assert(Number.isSafeInteger(oldestVerified));
  return Object.freeze({
    current(action,preparationPhase,now){
      assertSource(source);assert.equal(hash(jiraBytes),jiraHash);assert(actions.includes(action));
      assert(initial.receipt.authorizedActions.includes(action),'ACTION_OUTSIDE_VERIFIED_OPERATIONAL_MARKER');
      assert(initial.receipt.allowedPreparationPhases.includes(preparationPhase),'PHASE_OUTSIDE_VERIFIED_OPERATIONAL_MARKER');
      assertAuthorityCurrent(initial,now);assert(now>=oldestVerified);
      validateImageObjective(raw,{id:raw.id,dossier,plan,candidate,baseline,source,action,preparationPhase,now});
      const marker=validateImageMarkerV2([comment],{actors:[initial.receipt.actor],entry:raw,dossier,plan,source,jiraBytes,
        actor:initial.receipt.actor,action,preparationPhase,now},initial.receipt.grantDigest,hash);
      assert.equal(marker.commentId,initial.receipt.operationalCommentId);
      assert.equal(marker.markerSha256,initial.receipt.operationalMarkerSha256);
      // Do not replace verifiedAt with now or extend any observed expiry.
      const expiresAt=new Date(Math.min(Date.parse(initial.receipt.expiresAt),marker.expiresAt)).toISOString();
      const result={entry:{...structuredClone(raw),objectiveId:raw.id,authorityRecordSha256:digest(raw),
        resourceBindingSha256:digest(raw.resourceBindings),preparationPhase},
      receipt:{...structuredClone(initial.receipt),preparationPhase,expiresAt},
      operationalMarkerObservation:structuredClone(comment)};
      assertAuthorityCurrent(result,now);return Object.freeze(result);
    },
    originalReceipt:()=>structuredClone(initial.receipt),
  });
}

export function makeImageForwardPreparationV2({phase,objectiveId,dossier,plan,source,postReadiness,general,now,expiresAt}){
  assert(['BACKUP_READY','FORWARD_FINAL'].includes(phase));assert(Number.isSafeInteger(now));
  assert.equal(general===null,phase==='BACKUP_READY');
  return {schemaVersion:2,kind:'RC48_LATE_BOUND_IMAGE_PREPARATION_V2',preparationPhase:phase,objectiveId,
    staticDossierSha256:digest(dossier),planSha256:digest(plan),preparationRulesSha256:dossier.preparationRulesSha256,
    humanAuthorityReceiptSha256:dossier.humanAuthorityReceiptSha256,
    source:{commit:source.commit,tree:source.tree,inputManifestSha256:digest(source.files)},
    qualifiedAt:new Date(now).toISOString(),expiresAt,general,postReadiness};
}

export function parseImagePostPreparationArgumentsV2(args){
  const allowed=['--objective-id','--dossier','--jira-evidence','--session-binding','--journal-dir','--output-dir'];
  assert(Array.isArray(args)&&args[0]==='post-create-v2'&&args.length===13,'EXPLICIT_POST_RESOURCE_PREPARATION_REQUIRED');const result={};
  for(let i=1;i<args.length;i+=2){const key=args[i],value=args[i+1];assert(allowed.includes(key)&&!Object.hasOwn(result,key));assert(typeof value==='string'&&value.length>0&&value.length<=4096&&!/[\u0000-\u001f\u007f]/u.test(value));result[key]=value;}
  assert.match(result['--objective-id'],/^rc48-general-post-[a-z0-9-]{8,63}$/u);
  for(const key of allowed.filter(key=>key!=='--objective-id')){assert(path.isAbsolute(result[key]));}return result;
}
function exact(value,keys){assert(value&&Object.getPrototypeOf(value)===Object.prototype);assert(Object.values(Object.getOwnPropertyDescriptors(value)).every(d=>Object.hasOwn(d,'value')));assert.deepEqual(Object.keys(value).sort(),[...keys].sort());}
function publicJson(file,max=1048576){const bytes=readPoolPrivateFile(file,max),value=JSON.parse(bytes);validateImageInventoryPublicProjection(value);return value;}
function verifiedPublicBytes(ref){imagePublicRefV2(ref);const bytes=readPoolPrivateFile(ref.path,1048576);assert.equal(hash(bytes),ref.sha256,'FORWARD_INPUT_BYTES_CHANGED');validateImageInventoryPublicProjection(JSON.parse(bytes));return bytes;}
export function readImageForwardPublicReferenceV2(ref){return JSON.parse(verifiedPublicBytes(ref));}
function publicSaver(output){let ordinal=0;return(name,value)=>{
  assert(/^[A-Z][A-Z0-9-]{0,95}$/u.test(name));validateImageInventoryPublicProjection(value);
  const bytes=Buffer.from(JSON.stringify(value,null,2)+'\n'),file=path.join(output,String(ordinal++).padStart(4,'0')+'-'+name+'.json'),fd=fs.openSync(file,'wx',0o600);
  try{let offset=0;while(offset<bytes.length){const n=fs.writeSync(fd,bytes,offset,bytes.length-offset);assert(n>0);offset+=n;}fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  return{path:file,sha256:hash(fs.readFileSync(file))};
};}
function fixedSourceGuard(source){assert.deepEqual(readImageOperationalSource(),source,'FORWARD_PROTECTED_SOURCE_CHANGED');}
export function readImageForwardCollectorSourceV2(file){assert(Object.values(READONLY_RUNTIME_FILES).includes(file),'FORWARD_COLLECTOR_SOURCE_OUTSIDE_FIXED_MODULES');return readPoolPrivateFile(path.resolve(import.meta.dirname,'../pool-reconciliation',file));}
function cleanupEntry(result,{sdk,budget,postAuthority,postResult,generalResult,stopCode}){
  let refused=false;for(const release of [()=>releaseVerifiedImagePostV2(postResult?.privatePostCapability),()=>releaseVerifiedGeneralPreV3(generalResult?.privatePreCapability),()=>{if(postAuthority){releaseImagePostAuthorityV2(postAuthority.authorityCapability);}},()=>sdk?.close(),()=>{if(budget&&!budget.inspect().stopped){budget.stop(stopCode);}}]){try{release();}catch{refused=true;}}
  if(refused){return{...result,observedStateBeforeCleanup:result?.state,state:'OPERATIONAL_ENTRY_STOPPED_LOCAL_CLEANUP_INCOMPLETE',secondaryGuard:'LOCAL_CLEANUP_FAILED_NO_RETRY',canRetry:false};}return result;
}
function entryTerminal(result,{sdk,budget,save,name}){
  let publicResult;try{publicResult={...result};if(sdk){publicResult.sdkAuthentication=sdk.report();}if(budget){publicResult.nativeSession=budget.inspect();}validateImageInventoryPublicProjection(publicResult);}catch{publicResult={schemaVersion:2,kind:'EXPURGATED_OPERATIONAL_ENTRY_TERMINAL_REFUSED_V2',state:'STOPPED_TERMINAL_PROJECTION_NOT_PUBLIC',guardCode:'LOCAL_TERMINAL_PROJECTION_FAILED_NO_RETRY',canRetry:false};}
  if(!save){return publicResult;}try{return{...publicResult,entryReceipt:save(name,publicResult)};}catch{return{...publicResult,receiptPersistence:'FAILED_NO_RETRY',secondaryGuard:publicResult.secondaryGuard??'LOCAL_TERMINAL_PERSISTENCE_FAILED_NO_RETRY',canRetry:false};}
}
function validateSessionBinding(binding,authority,source,scope,resources){
  exact(binding,['sessionId','authorityRecordSha256','resourceBindingSha256','scope','windowStart','windowEnd','sourceCommit','project','region']);
  assert.match(binding.sessionId,/^local:[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u);
  assert.equal(binding.scope,scope);assert.equal(binding.authorityRecordSha256,authority.receipt.authorityRecordSha256);
  assert.equal(binding.resourceBindingSha256,digest(resources));assert.equal(binding.sourceCommit,source.commit);
  assert.equal(binding.project,'crmynov-prod-n7x4q2');assert.equal(binding.region,'europe-west1');
  const start=Date.parse(binding.windowStart),end=Date.parse(binding.windowEnd);assert(Number.isSafeInteger(start)&&Number.isSafeInteger(end)&&end>start&&end-start<=900000);
  assert.equal(new Date(start).toISOString(),binding.windowStart);assert.equal(new Date(end).toISOString(),binding.windowEnd);
  assert(Date.parse(authority.entry.validFrom)<=start&&end<=Date.parse(authority.entry.expiresAt));assert(start<=Date.now()&&Date.now()<end);
}
// Preparation creates only the separately reviewed POST resource. It never
// executes that resource, invokes PRE, patches a service or opens a private key.
export async function runImagePostResourcePreparationV2(args){
  let stage='POST_CREATE_INPUTS',sdk,budget,acquired,save,result;
  try{
    assert.equal(process.versions.node,'22.23.3');assert(!process.env.NODE_OPTIONS&&!process.env.NODE_PATH);
    const o=parseImagePostPreparationArgumentsV2(args),source=readImageOperationalSource(),dossier=publicJson(o['--dossier']);
    const jiraBytes=readPoolPrivateFile(o['--jira-evidence'],65536),binding=publicJson(o['--session-binding']);
    const directory=imageExternalDirectory(o['--journal-dir']),output=imageExternalDirectory(o['--output-dir']);assert.notEqual(directory,output);
    assert.equal(fs.readdirSync(directory).length,0,'POST_CREATE_REQUIRES_NEW_EMPTY_JOURNAL');assert.equal(fs.readdirSync(output).length,0,'POST_CREATE_REQUIRES_NEW_EMPTY_OUTPUT');save=publicSaver(output);
    stage='POST_CREATE_GOVERNANCE';acquired=await acquireImagePostAuthorityV2({objectiveId:o['--objective-id'],dossier,jiraBytes,journalDirectory:directory,preparationPhase:'POST_RESOURCE_PREPARATION'});
    assert.deepEqual(acquired.source,source);fixedSourceGuard(source);
    const resources=imagePostResourceBindingsV2(acquired.authority,dossier);validateSessionBinding(binding,acquired.authority,source,'POST_PRESERVATION_READ_ONLY_V2',resources);
    // Its location is derived from the protected objective's journal directory;
    // callers cannot replace a stopped budget with a fresh arbitrary directory.
    const budgetDirectory=directory+'-native-session';assert(!fs.existsSync(budgetDirectory),'POST_CREATE_SESSION_ALREADY_ENTERED');fs.mkdirSync(budgetDirectory);
    budget=createImageSessionBudget({directory:imageExternalDirectory(budgetDirectory),binding});
    const projected=makeImagePostSdkSessionV2({authority:acquired.authority,dossier,binding,commonSessionBindingSha256:digest(binding),budgetState:budget.inspect(),preparationPhase:'POST_RESOURCE_PREPARATION',now:Date.now()});
    const guard=()=>{fixedSourceGuard(source);assertAuthorityCurrent(acquired.authority,Date.now());const current=budget.inspect();assert(!current.stopped&&current.remainingMs>0);};
    save('POST-CREATE-ENTRY-START',{schemaVersion:2,kind:'POST_RESOURCE_PREPARATION_ENTRY_START_V2',objectiveId:o['--objective-id'],source,binding,resources,at:new Date().toISOString(),runCapabilityCreated:false,runPosts:0});
    stage='POST_CREATE_AUTHENTICATION';sdk=await openOfficialSdkOperationalSession({operationContract:projected.operationContract,getAuthority:()=>projected.authority,assertCurrent:guard});assert.equal(sdk.report().authenticationChainValidated,true,'POST_CREATE_SDK_AUTHENTICATION_REFUSED');
    stage='POST_CREATE_NATIVE';const runtimeContract=makeImagePostRuntimeContractV2({authority:acquired.authority,dossier,source,sharedBudget:budget,preparationPhase:'POST_RESOURCE_PREPARATION'});
    result=await prepareImagePostResourceV2({objectiveId:o['--objective-id'],dossier,jiraBytes,journalDirectory:directory,authorityCapability:acquired.authorityCapability,sharedBudget:budget,runtimeContract,accessToken:sdk.accessToken,save,assertSessionCurrent:guard});
    assert.equal(result.state,'FIN_POST_RESOURCE_READY_UNUSED_V2');
    const origin={schemaVersion:1,kind:'PROTECTED_POST_READONLY_OBJECTIVE_ORIGIN_V1',objectiveId:o['--objective-id'],dossierSha256:digest(dossier),objectiveSha256:dossier.objective.objectiveSha256,
      sourceSha256:dossier.objective.sourceSha256,catalogueSha256:acquired.authority.receipt.catalogueSha256,driverCommit:source.commit,driverInputManifestSha256:digest(source.files)};
    assert(H.test(origin.catalogueSha256));const recipeOrigin=save('POST-RECIPE-PROTECTED-ORIGIN',origin);
    result={...result,recipeOrigin,source,humanAuthorityReceiptSha256:OPERATIONAL_HUMAN_SHA256,runtimeChanged:false,sheetsActivated:false};
  }catch{result={schemaVersion:2,kind:'POST_RESOURCE_PREPARATION_STOP_V2',state:'POST_RESOURCE_PREPARATION_STOPPED_NO_AUTOMATIC_RETRY',guardStage:stage,runPosts:0,runCapabilityCreated:false,runtimeChanged:false,sheetsActivated:false,canRetry:false};}
  finally{
    result=cleanupEntry(result,{sdk,budget,postAuthority:acquired,stopCode:result?.state==='FIN_POST_RESOURCE_READY_UNUSED_V2'?'POST_RESOURCE_PREPARATION_FIN':'POST_RESOURCE_PREPARATION_STOP'});
  }
  return entryTerminal(result,{sdk,budget,save,name:result.state==='FIN_POST_RESOURCE_READY_UNUSED_V2'?'POST-RESOURCE-PREPARATION-FIN':'POST-RESOURCE-PREPARATION-STOP'});
}

export function parseImageForwardArgumentsV2(args){
  const keys=['--input','--jira-evidence','--journal-dir','--output-dir'];assert(Array.isArray(args)&&args[0]==='forward-v2'&&args.length===9,'EXPLICIT_FORWARD_V2_REQUIRED');const result={};
  for(let i=1;i<args.length;i+=2){assert(keys.includes(args[i])&&!Object.hasOwn(result,args[i]));const value=args[i+1];assert(typeof value==='string'&&path.isAbsolute(value)&&value.length<=4096&&!/[\u0000-\u001f\u007f]/u.test(value));result[args[i]]=value;}return result;
}
function forwardInputs(value){
  exact(value,['schemaVersion','kind','objectiveId','dossier','plan','candidate','baseline','postReadiness','sessionBinding','general','post','roleObservationsFile']);
  assert.equal(value.schemaVersion,2);assert.equal(value.kind,'RC48_FORWARD_OPERATIONAL_INPUT_V2');assert.match(value.objectiveId,/^rc48-image-only-[a-z0-9-]{8,80}$/u);
  const loaded={};for(const key of ['dossier','plan','candidate','baseline','postReadiness','sessionBinding']){loaded[key]=readImageForwardPublicReferenceV2(value[key]);}
  exact(value.general,['record','dossier','privateKeyFile','consumerReferences']);exact(value.post,['objectiveId','dossier','privateKeyFile','journalDirectory']);
  const refs=value.general.consumerReferences;exact(refs,['historicalBaseline','cutoverIndex','configuration','decision','currentComparison']);
  const verified=Object.fromEntries(Object.entries(refs).map(([key,ref])=>[key,verifiedPublicBytes(ref)]));
  const consumerInputs={historicalBaselineBytes:verified.historicalBaseline,cutoverIndexBytes:verified.cutoverIndex,evidence:{}};
  for(const key of ['configuration','decision','currentComparison']){consumerInputs.evidence[key]=verified[key];}
  validateProspectiveConsumerInputs(consumerInputs);
  for(const file of [value.general.privateKeyFile,value.post.privateKeyFile,value.post.journalDirectory,value.roleObservationsFile]){assert(typeof file==='string'&&path.isAbsolute(file)&&file.length<=4096&&!/[\u0000-\u001f\u007f]/u.test(file));}
  value=structuredClone(value);value.post.journalDirectory=imageExternalDirectory(value.post.journalDirectory);
  assert.match(value.post.objectiveId,/^rc48-general-post-[a-z0-9-]{8,63}$/u);
  return{...loaded,descriptor:value,generalRecord:readImageForwardPublicReferenceV2(value.general.record),generalDossierBytes:verifiedPublicBytes(value.general.dossier),postDossier:readImageForwardPublicReferenceV2(value.post.dossier),consumerInputs};
}
function projectionSource(source){return{commit:source.commit,tree:source.tree,inputManifestSha256:digest(source.files)};}
function publicHttpProjection(kind,body){
  if(kind==='api'){const p=JSON.parse(body);assert.equal(p.service,'api');assert.equal(p.status,'ok');assert.equal(p.database,'ready');return{service:p.service,status:p.status,database:p.database};}
  assert(/<html(?:\s|>)/iu.test(body));const paths=[...new Set([...body.matchAll(/(?:src|href)=["'](\/_next\/[^"'<>]+)["']/gu)].map(match=>match[1]))];assert(paths.length>0&&paths.length<=100);assert(paths.every(value=>/^\/_next\/static\/[A-Za-z0-9._~/%@+-]+$/u.test(value)),'ONLY_PUBLIC_STATIC_ASSET_PATHS');return{documentKind:'HTML',assetPaths:paths};
}
async function publicImageGet(kind,url,{budget,guard,save},{fetchImpl=fetch,clock=Date.now}={}){
  assert(['api','web'].includes(kind));guard();const started=clock(),request={method:'GET',url},ticket=budget.reserveRequest({method:'GET',resource:url,requestSha256:digest(request)}),controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),ticket.remainingMs);let size=0,recorded=false,accountingAttempted=false,reader;
  try{
    const response=await fetchImpl(url,{method:'GET',redirect:'error',credentials:'omit',signal:controller.signal,headers:{accept:kind==='api'?'application/json':'text/html'}});
    assert.equal(response.url,url);assert.equal(response.redirected,false);const chunks=[];reader=response.body.getReader();
    for(;;){const part=await reader.read();if(part.done){break;}size+=part.value.byteLength;assert(size<=1048576&&size<=budget.inspect().remainingResponseBytes,'POST_PUBLIC_HTTP_VOLUME_BOUND');chunks.push(part.value);}
    accountingAttempted=true;budget.recordResponse(ticket,{responseBytes:size});recorded=true;
    save('POST-PUBLIC-HTTP-STATUS',{schemaVersion:2,kind:'EXPURGATED_POST_PUBLIC_HTTP_STATUS_V2',request,status:response.status,requestStartedAt:new Date(started).toISOString(),responseReceivedAt:new Date(clock()).toISOString(),responseBytes:size,semanticAcceptance:false,credentialsSent:false,sessionBindingSha256:budget.inspect().bindingSha256});
    assert.equal(response.status,200,'POST_PUBLIC_HTTP_STATUS_REFUSED');
    const type=response.headers.get('content-type')??'';assert(kind==='api'?/^application\/json(?:;|$)/iu.test(type):/^text\/html(?:;|$)/iu.test(type));
    const bytes=Buffer.concat(chunks),projection=publicHttpProjection(kind,bytes.toString('utf8'));guard();
    return{schemaVersion:2,kind:'SOURCE_BOUND_PUBLIC_RUNTIME_GET_V2',requestStartedAt:new Date(started).toISOString(),responseReceivedAt:new Date(clock()).toISOString(),request,
      response:{status:200,finalUrl:url,redirected:false,bodySha256:hash(bytes),hashMeaning:'DECODED_FETCH_RESPONSE_BODY_NOT_WIRE_BYTES',projection},credentialsSent:false,sessionBindingSha256:budget.inspect().bindingSha256};
  }finally{clearTimeout(timer);controller.abort();if(reader){try{await reader.cancel();}catch{/* Do not expose a stream's raw failure. */}reader.releaseLock();}if(!recorded){try{if(!accountingAttempted){accountingAttempted=true;budget.recordResponse(ticket,{responseBytes:size});}}finally{budget.stop('POST_PUBLIC_HTTP_STOP');}}}
}
export async function simulateImageForwardPublicHttpV2({syntheticOnly,kind,url,budget,guard,save,fetchImpl,clock}){
  assert.equal(syntheticOnly,true);assert.equal(typeof fetchImpl,'function');assert.equal(typeof clock,'function');
  const result=await publicImageGet(kind,url,{budget,guard,save:(name,value)=>save(name,{...value,syntheticOnly:true,nativeAuthority:false})},{fetchImpl,clock});return{...result,syntheticOnly:true,nativeAuthority:false};
}
async function browserRoles({file,readiness,afterImageObservedAt,planSha256,budget,guard,save}){
  const last=Math.min(Date.now()+120000,budget.inspect().deadlineAt-1000);save('POST-BROWSER-ROLE-OBSERVATIONS-REQUIRED',{schemaVersion:2,kind:'POST_BROWSER_ROLE_OBSERVATIONS_REQUIRED_V2',path:file,afterImageObservedAt,planSha256,roles:readiness.recipe.actors.map(a=>({key:a.key,role:a.role,campusId:a.campusId})),deadlineAt:new Date(last).toISOString(),observationsNotYetQualified:true});
  while(!fs.existsSync(file)&&Date.now()<last){guard();await new Promise(resolve=>setTimeout(resolve,1000));}
  assert(fs.existsSync(file),'POST_BROWSER_ROLE_OBSERVATIONS_NOT_AVAILABLE');const packet=publicJson(file);exact(packet,['schemaVersion','kind','planSha256','afterImageObservedAt','records']);assert.equal(packet.schemaVersion,2);assert.equal(packet.kind,'POST_BROWSER_ROLE_OBSERVATIONS_V2');assert.equal(packet.planSha256,planSha256);assert.equal(packet.afterImageObservedAt,afterImageObservedAt);assert.equal(packet.records.length,readiness.recipe.actors.length);
  const results=readiness.recipe.actors.map(actor=>{const rows=packet.records.filter(row=>row.actorKey===actor.key);assert.equal(rows.length,1);exact(rows[0],['actorKey','record']);return validateImagePostBffSessionObservationV2(rows[0].record,{readiness,actorKey:actor.key,afterImageObservedAt,now:Date.now()});});
  assert.equal(new Set(results.map(row=>row.professionalEmailSha256)).size,results.length,'POST_DISTINCT_ROLE_IDENTITIES_REQUIRED');return results;
}
function watchedTransport(transport,observed){return Object.freeze({...transport,
  async getService(kind){const value=await transport.getService(kind);observed[kind]={...observed[kind],service:structuredClone(value)};return value;},
  async getRevision(kind,name){const value=await transport.getRevision(kind,name);observed[kind]={...observed[kind],revision:structuredClone(value),observedAt:new Date().toISOString()};return value;},
});}
function emptyOutputAndBudget(directory,output,binding,applicationOrigins){
  assert.equal(fs.readdirSync(directory).length,0,'FORWARD_REQUIRES_NEW_EMPTY_IMAGE_JOURNAL');assert.equal(fs.readdirSync(output).length,0,'FORWARD_REQUIRES_NEW_EMPTY_OUTPUT');
  const budgetDirectory=directory+'-native-session';assert(!fs.existsSync(budgetDirectory),'FORWARD_NATIVE_SESSION_ALREADY_ENTERED');fs.mkdirSync(budgetDirectory);
  return createImageSessionBudget({directory:imageExternalDirectory(budgetDirectory),binding,applicationOrigins});
}
function publicPreparation(x,source,phase,general,expiry){return makeImageForwardPreparationV2({phase,objectiveId:x.descriptor.objectiveId,dossier:x.dossier,plan:x.plan,source,postReadiness:x.liveReadinessRef??x.descriptor.postReadiness,general,now:Date.now(),expiresAt:expiry});}
// One closed adapter over the existing executor, GENERAL and separate POST.
// JSON contains only pinned inputs/paths, never callbacks or alternate tools.
export async function runImageForwardOperationalV2(args){
  let stage='FORWARD_INPUTS',sdk,budget,postAuthority,postResult,generalResult,save,result;
  try{
    assert.equal(process.versions.node,'22.23.3');assert(!process.env.NODE_OPTIONS&&!process.env.NODE_PATH);
    const options=parseImageForwardArgumentsV2(args),source=readImageOperationalSource(),x=forwardInputs(publicJson(options['--input']));
    const directory=imageExternalDirectory(options['--journal-dir']),output=imageExternalDirectory(options['--output-dir']),jiraBytes=readPoolPrivateFile(options['--jira-evidence'],65536),github=createReadOnlyGithubReader();assert.notEqual(directory,output);assert.equal(fs.readdirSync(output).length,0,'FORWARD_REQUIRES_NEW_EMPTY_OUTPUT');save=publicSaver(output);
    readImageForwardPublicReferenceV2(x.descriptor.general.dossier);
    assert.equal(digest(x.generalRecord),x.dossier.pendingGeneral.prospectiveAuthoritySha256);
    assert.equal(digest(x.postDossier),digest(x.candidate.readOnlyPostJob.dossier));
    stage='FORWARD_GOVERNANCE';const authority=await authorizeImageOnlyDriver({github,objectiveId:x.descriptor.objectiveId,dossier:x.dossier,plan:x.plan,candidate:x.candidate,baseline:x.baseline,localSource:source,jiraBytes,action:'READ_METADATA',preparationPhase:'BACKUP_READY',readEvidence:readPoolPrivateFile});
    assert.equal(authority.entry.journalDirectorySha256,hash(directory));
    const lease=makeImageForwardLocalLeaseV2({authority,dossier:x.dossier,plan:x.plan,candidate:x.candidate,baseline:x.baseline,source,jiraBytes,assertSource:fixedSourceGuard});
    postAuthority=await acquireImagePostAuthorityV2({objectiveId:x.descriptor.post.objectiveId,dossier:x.postDossier,jiraBytes,journalDirectory:x.descriptor.post.journalDirectory,preparationPhase:'POST_EXECUTION'});assert.deepEqual(postAuthority.source,source);
    const binding=x.sessionBinding;validateSessionBinding(binding,authority,source,'RC48_SERVICE_IMAGE_ONLY_V1',authority.entry.resourceBindings);
    let phase='BACKUP_READY',currentAuthority=lease.current('READ_METADATA',phase,Date.now()),preparation,completionContext,backupFin;
    const expiry=new Date(Math.min(Date.parse(authority.receipt.expiresAt),Date.parse(postAuthority.authority.receipt.expiresAt),Date.parse(binding.windowEnd))).toISOString();
    preparation=publicPreparation(x,source,phase,null,expiry);
    const qualify=(a,now)=>validateImagePreparationV2({bytes:Buffer.from(JSON.stringify(preparation)),entry:a.entry,dossier:x.dossier,plan:x.plan,baseline:x.baseline,source,readEvidence:readPoolPrivateFile,readSource:readImageForwardCollectorSourceV2,journalDirectory:directory,action:preparation.preparationPhase==='BACKUP_READY'?'CREATE_BACKUP':'PATCH_API',now});
    validateImageIndependentEvidenceV2(x.dossier,{plan:x.plan,baseline:x.baseline,source,readEvidence:readPoolPrivateFile,now:Date.now()});
    bindImageLivePostReadinessV2(x.postReadiness,x.dossier.postReadiness,readPoolPrivateFile);
    budget=emptyOutputAndBudget(directory,output,binding,[x.postReadiness.recipe.apiOrigin,x.postReadiness.recipe.webOrigin]);
    const guard=()=>{fixedSourceGuard(source);lease.current('READ_METADATA',phase,Date.now());assertAuthorityCurrent(postAuthority.authority,Date.now());const s=budget.inspect();assert(!s.stopped&&s.remainingMs>0);};
    save('FORWARD-ENTRY-START',{schemaVersion:2,kind:'SOURCE_BOUND_FORWARD_ENTRY_START_V2',objectiveId:x.descriptor.objectiveId,source,binding,dossierSha256:digest(x.dossier),planSha256:digest(x.plan),at:new Date().toISOString(),runCapabilityNotYetArmed:true});
    stage='FORWARD_AUTHENTICATION';sdk=await openOfficialSdkOperationalSession({operationContract:{schemaVersion:2,kind:'OFFICIAL_SDK_OPERATIONAL_RESOURCE_SESSION_V2',...binding,sourceTree:source.tree,googleAccount:'casablancaynovcampus@gmail.com'},getAuthority:()=>lease.current('READ_METADATA','BACKUP_READY',Date.now()),assertCurrent:guard});assert.equal(sdk.report().authenticationChainValidated,true,'FORWARD_SDK_AUTHENTICATION_REFUSED');
    const observed={},native=createImageOperationalTransport({binding,plan:x.plan,accessToken:sdk.accessToken,getAuthority:()=>currentAuthority,sessionBudget:budget}),transport=watchedTransport(native,observed);
    const executor=createImageOnlyExecutor({plan:x.plan,candidate:x.candidate,baseline:x.baseline,source,dossier:x.dossier,objectiveId:x.descriptor.objectiveId,journalDirectory:directory,transport,
      authorizeFresh:async action=>{currentAuthority=lease.current(action,phase,Date.now());return currentAuthority;},qualifyPreparation:qualify,saveReceipt:async(stageName,value)=>save(stageName+'-NATIVE-FIN',value),getCompletionContext:()=>completionContext});
    const adapter={
      assertLocalState:async()=>guard(),
      prepareBackupReady:async()=>{currentAuthority=lease.current('TEST_PERMISSIONS',phase,Date.now());await transport.testProjectPermissions();await transport.testServicePermissions('api');await transport.testServicePermissions('web');await transport.testJobPermissions();transport.assertGeneralPermissionsReady();
        const {observeImagePostUnusedResourceV2}=await import('./post-operational-v2.mjs');
        const runtimeContract=makeImagePostRuntimeContractV2({authority:postAuthority.authority,dossier:x.postDossier,source,sharedBudget:budget,preparationPhase:'POST_EXECUTION'});
        const fresh=await observeImagePostUnusedResourceV2({objectiveId:x.descriptor.post.objectiveId,dossier:x.postDossier,jiraBytes,journalDirectory:x.descriptor.post.journalDirectory,authorityCapability:postAuthority.authorityCapability,sharedBudget:budget,runtimeContract,accessToken:sdk.accessToken,save,assertSessionCurrent:guard});
        assert.equal(fresh.state,'FIN_POST_UNUSED_RESOURCE_OBSERVED_V2');assert.equal(fresh.uid,x.candidate.readOnlyPostJob.uid);
        const jobRead=readImageForwardPublicReferenceV2(fresh.jobObservation);
        const live={...x.postReadiness,preparedAt:new Date().toISOString(),expiresAt:new Date(Math.min(Date.parse(expiry),Date.parse(jobRead.requestStartedAt)+600000)).toISOString(),postJobObservationRef:fresh.jobObservation};delete live.staticPostContractSha256;
        x.postReadiness=bindImageLivePostReadinessV2(live,x.dossier.postReadiness,readPoolPrivateFile);x.liveReadinessRef=save('POST-LIVE-READY-BINDING',x.postReadiness);preparation=publicPreparation(x,source,phase,null,expiry);return qualify(currentAuthority,Date.now());},
      runGeneral:async value=>{
        backupFin=value.backupFin;generalResult=await runGeneralOperationalPreV3({root:path.resolve(import.meta.dirname,'../../..'),record:x.generalRecord,humanAuthorityBytes:readPoolPrivateFile('C:/Crm Ynov/output/casablanca-pilot-20261022/crm-operational-continuation-20261030-v1/HUMAN-ADDITIVE-OPERATIONAL-AUTHORITY.json'),dossierBytes:x.generalDossierBytes,jiraBytes,consumerInputs:x.consumerInputs,evidenceDirectory:x.generalRecord.evidenceDirectory,sharedBudget:budget,accessToken:sdk.accessToken,permissionEvidence:()=>transport.permissionEvidence(),
          verifyCutoverReady:({recordSha256})=>{guard();qualify(currentAuthority,Date.now());return{schemaVersion:3,kind:'SOURCE_BOUND_IMAGE_GENERAL_PRE_READY_V3',generalAuthorityRecordSha256:recordSha256,imageAuthorityRecordSha256:authority.receipt.authorityRecordSha256,staticDossierSha256:digest(x.dossier),imagePlanSha256:digest(x.plan),backupFin:backupFin.backup,postReadinessSha256:x.liveReadinessRef.sha256,verifiedAt:new Date().toISOString(),expiresAt:expiry,commonSessionBindingSha256:digest(binding)};},
          readPrivateKey:()=>readPoolPrivateFile(x.descriptor.general.privateKeyFile,16384).toString('utf8')});return generalResult;
      },
      qualifyFinal:async value=>{assert.equal(value.state,'FRESH_PROSPECTIVE_GENERAL_PRE_OBSERVED');completionContext=value.completionContext;const next=publicPreparation(x,source,'FORWARD_FINAL',value.sourceProofRef,expiry),nextAuthority=lease.current('PATCH_API','FORWARD_FINAL',Date.now());const previous=preparation;preparation=next;try{const checked=qualify(nextAuthority,Date.now());phase='FORWARD_FINAL';currentAuthority=nextAuthority;return checked;}catch(error){preparation=previous;throw error;}},
      runPost:async({webFin,afterImageObservedAt})=>{
        const webProof=readImageForwardPublicReferenceV2(webFin.nativeReceipt);
        const apiAt=webProof.relatedServed.api.observedAt,webAt=webProof.served.observedAt;
        assert.equal(new Date(Math.max(Date.parse(apiAt),Date.parse(webAt))).toISOString(),webFin.servedObservedAt);
        const imageContext={plan:x.plan,candidate:x.candidate,baseline:x.baseline,imageAuthority:lease.current('READ_METADATA',phase,Date.now()),api:{...observed.api,observedAt:apiAt},web:{...observed.web,observedAt:webAt}};
        const runtimeContract=makeImagePostRuntimeContractV2({authority:postAuthority.authority,dossier:x.postDossier,source,sharedBudget:budget,preparationPhase:'POST_EXECUTION'});
        postResult=await runImagePostReadOnlyV2({objectiveId:x.descriptor.post.objectiveId,dossier:x.postDossier,jiraBytes,journalDirectory:x.descriptor.post.journalDirectory,authorityCapability:postAuthority.authorityCapability,sharedBudget:budget,runtimeContract,accessToken:sdk.accessToken,save,assertSessionCurrent:guard,imageContext,privateKeyFile:x.descriptor.post.privateKeyFile});
        assert.equal(postResult.afterImageObservedAt,afterImageObservedAt);return postResult;
      },
      verifyPost:async({afterImageObservedAt})=>{
        const sql=await withVerifiedImagePostV2(postResult.privatePostCapability,({checked,capturedAt})=>compareImagePostUsingPrivateGeneralV2({privatePreCapability:generalResult.privatePreCapability,postChecked:checked,consumerInputs:x.consumerInputs,expectedGeneralAuthorityRecordSha256:x.dossier.pendingGeneral.prospectiveAuthoritySha256,postCapturedAt:capturedAt,afterImageObservedAt,now:Date.now()}));
        const publicHttp=[];for(const [kind,url]of [['api',x.postReadiness.recipe.apiOrigin+'/health/ready'],['web',x.postReadiness.recipe.webOrigin+'/']]){publicHttp.push(await publicImageGet(kind,url,{budget,guard,save}));}
        const roles=await browserRoles({file:x.descriptor.roleObservationsFile,readiness:x.postReadiness,afterImageObservedAt,planSha256:digest(x.plan),budget,guard,save});
        const postJobs=await transport.collectJobs(),postSchedulers=await transport.collectSchedulers();
        const postCompletion={schemaVersion:2,completions:[...completionContext.completions,...postResult.completionContext.completions]};
        const {validateUnpatchedResourceClaims}=await import('./plan.mjs');validateUnpatchedResourceClaims(x.plan,{jobs:postJobs,schedulers:postSchedulers,observedAt:new Date().toISOString()},postCompletion);
        const receipt=save('RUNTIME-POST-COMPOSITION-FIN',{schemaVersion:2,kind:'RC48_RUNTIME_POST_COMPOSITION_V2',planSha256:digest(x.plan),afterImageObservedAt,sql,publicHttp,roles,preservedJobsAndSchedulersChecked:true,otherFivePreparationFamiliesRemainDistinct:true,authenticatedSessionRoleScopeOnly:true,endpointPermissionMatrixQualified:false,visualWorkflowQualified:false,rolesUiAcceptance:false,fullPortfolioCoverage:false,sheetsActivated:false});
        return{schemaVersion:2,kind:'RC48_IMAGE_POST_SOURCE_CHECKED_V2',planSha256:digest(x.plan),afterImageObservedAt,sqlPreservationClaimsChecked:true,httpRoleClaimsChecked:true,sheetsActivated:false,receipt};
      },
      releasePost:async()=>{releaseVerifiedImagePostV2(postResult?.privatePostCapability);releaseVerifiedGeneralPreV3(generalResult?.privatePreCapability);},
      saveReceipt:async(name,value)=>save(name,value),
    };
    stage='FORWARD_SEQUENCE';result=await runImageForwardSequenceV2({objectiveId:x.descriptor.objectiveId,planSha256:digest(x.plan),staticDossierSha256:digest(x.dossier),source:projectionSource(source),sessionBindingSha256:digest(binding),sdkSession:sdk,sharedBudget:budget,executor,adapter});
  }catch{result={schemaVersion:2,kind:'RC48_FORWARD_ENTRY_STOP_V2',state:'FORWARD_ENTRY_STOPPED_NO_AUTOMATIC_RETRY',guardStage:stage,runReplayAuthorized:false,sheetsActivated:false,canRetry:false};}
  finally{
    result=cleanupEntry(result,{sdk,budget,postAuthority,postResult,generalResult,stopCode:'FORWARD_ENTRY_CLOSED'});
  }
  return entryTerminal(result,{sdk,budget,save,name:'FORWARD-ENTRY-FIN'});
}
