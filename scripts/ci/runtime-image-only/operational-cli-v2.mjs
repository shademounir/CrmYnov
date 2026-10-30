// Explicit READ_ONLY_INVENTORY route. No default objective, plan, RUN claim,
// database query, mutation endpoint or alternate authentication framework.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readPoolPrivateFile} from '../pool-reconciliation/pool-operational-driver-v1.mjs';
import {createReadOnlyGithubReader} from '../pool-reconciliation/pool-driver-github-v1.mjs';
import {assertAuthorityCurrent} from '../readonly-probe/probe-driver-authority-v1.mjs';
import {openOfficialSdkOperationalSession} from '../readonly-probe/official-sdk-auth-preflight-v1.mjs';
import {authorizeImageInventory} from './authority.mjs';
import * as localSource from './local-source.mjs';
import {createImageSessionBudget,imageJournalDigest as digest} from './journal.mjs';
import {createImageOperationalTransport} from './transport.mjs';
import {OPERATIONAL_HUMAN_SHA256,IMAGE_OPERATIONAL_RESOURCES_V2} from './late-binding-v2.mjs';
const OPTIONS=['--objective-id','--inventory-dossier','--jira-evidence','--session-binding','--journal-dir','--output-dir'];
const BINDING_FIELDS=['sessionId','authorityRecordSha256','resourceBindingSha256','scope','windowStart','windowEnd','sourceCommit','project','region'];
const REFUSALS=new Set(['N02_INPUTS_REFUSED','N02_SOURCE_REFUSED','N02_GOVERNANCE_REFUSED','N02_AUTHENTICATION_REFUSED','N02_NATIVE_INVENTORY_REFUSED','N02_REVALIDATION_REFUSED','N02_PUBLIC_PROJECTION_REFUSED','N02_PERSISTENCE_REFUSED','N02_CLEANUP_REFUSED']);
const HASH=/^[a-f0-9]{64}$/u;
const byteHash=bytes=>createHash('sha256').update(bytes).digest('hex');
class InventoryRefusal extends Error{constructor(code){super(code);Object.defineProperty(this,'code',{value:code});}}
function refuse(code){throw new InventoryRefusal(code);}
function exact(value,keys){assert(value&&Object.getPrototypeOf(value)===Object.prototype);const d=Object.getOwnPropertyDescriptors(value);assert(Reflect.ownKeys(d).every(k=>typeof k==='string'&&Object.hasOwn(d[k],'value')));assert.deepEqual(Object.keys(d).sort(),[...keys].sort());}
function iso(value){assert.equal(typeof value,'string');const time=Date.parse(value);assert(Number.isSafeInteger(time)&&new Date(time).toISOString()===value);return time;}
export function parseImageInventoryArguments(args){
  try{
    assert(Array.isArray(args)&&args[0]==='inventory-v2'&&args.length===1+OPTIONS.length*2);const options={};
    for(let i=1;i<args.length;i+=2){const key=args[i],value=args[i+1];assert(OPTIONS.includes(key)&&!Object.hasOwn(options,key));assert.equal(typeof value,'string');assert(value.length>0&&value.length<=4096&&!/[\u0000-\u001f\u007f]/u.test(value));options[key]=value;}
    for(const key of OPTIONS){assert(options[key]);}assert.match(options['--objective-id'],/^rc48-image-only-inventory-[a-z0-9-]{8,64}$/u);
    for(const key of OPTIONS.filter(k=>k!=='--objective-id')){assert(path.isAbsolute(options[key]));}return options;
  }catch{refuse('N02_INPUTS_REFUSED');}
}
export function validateImageInventoryDirectoryState(journalNames,outputNames){
  try{assert(Array.isArray(journalNames)&&journalNames.length===0,'N02_REQUIRES_NEW_EMPTY_CONSULTATION_JOURNAL');assert(Array.isArray(outputNames));assert(!outputNames.some(name=>['N02-STOP.json','N02-INVENTORY-native-FIN.json'].includes(name)));return true;}catch{refuse('N02_INPUTS_REFUSED');}
}
function secretRef(value){exact(value,['secret','version']);assert.equal(typeof value.secret,'string');assert.match(value.secret,/^(?:projects\/[a-z0-9-]+\/secrets\/)?[A-Za-z0-9_-]{1,255}$/u);assert.equal(typeof value.version,'string');assert.match(value.version,/^(?:latest|[1-9]\d{0,19})$/u);}
function publicObject(value){assert(value&&Object.getPrototypeOf(value)===Object.prototype);const d=Object.getOwnPropertyDescriptors(value);assert(Reflect.ownKeys(d).every(k=>typeof k==='string'&&Object.hasOwn(d[k],'value')));return value;}
function nonempty(value){return value!==null&&value!==undefined&&value!=='';}
const SECRET_KEY=/^(?:token|access[_-]?token|refresh[_-]?token|id[_-]?token|client[_-]?secret|password|passwd|rootPassword|private[_-]?key|credentials?|authorization|proxy[_-]?authorization|cookies?|api[_-]?key|stdout|stderr|rawPayload)$/iu;
const SECRET_ENV=/(?:^|_)(?:PASSWORD|PASSWD|SECRET|TOKEN|PRIVATE_KEY|API_KEY|CREDENTIALS?|DATABASE_URL|CONNECTION_STRING)(?:_|$)/iu;
function safeString(value){
  assert(!/-----BEGIN (?:[A-Z ]* )?PRIVATE KEY-----/u.test(value));assert(!/\bBearer\s+[A-Za-z0-9._~+\/-]+(?=$|[\s,;])/iu.test(value));
  assert(!/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\b/u.test(value));
  for(const match of value.matchAll(/[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s<>"']+/gu)){
    let url;try{url=new URL(match[0]);}catch{continue;}assert(!url.username&&!url.password);
    for(const params of [url.searchParams,new URLSearchParams(url.hash.slice(1))]){for(const key of params.keys()){assert(!/^(?:access_token|refresh_token|id_token|client_secret|password|passwd|api_key)$/iu.test(key));}}
  }
}
function publicEnvironmentEntry(value){
  assert.equal(typeof value.name,'string');assert(value.name.length<=256);assert(Object.keys(value).every(k=>['name','value','valueSource'].includes(k)));
  assert(!(Object.hasOwn(value,'value')&&Object.hasOwn(value,'valueSource')));
  if(Object.hasOwn(value,'value')){assert.equal(typeof value.value,'string');}
  if(Object.hasOwn(value,'valueSource')){exact(value.valueSource,['secretKeyRef']);secretRef(value.valueSource.secretKeyRef);}
  assert(!(SECRET_ENV.test(value.name)&&Object.hasOwn(value,'value')&&nonempty(value.value)));
}
function publicFileMode(value){assert(Number.isSafeInteger(value)&&value>=0&&value<=511);}
function publicVolumeSecret(value,walk,depth){
  publicObject(value);assert.equal(typeof value.secret,'string');assert(Object.keys(value).every(k=>['secret','items','defaultMode'].includes(k)));
  assert.match(value.secret,/^(?:projects\/[a-z0-9-]+\/secrets\/)?[A-Za-z0-9_-]{1,255}$/u);
  if(value.defaultMode!==undefined){publicFileMode(value.defaultMode);}
  if(value.items===undefined){return;}assert(Array.isArray(value.items));
  for(const item of value.items){
    publicObject(item);assert(Object.keys(item).every(k=>['version','path','mode'].includes(k)));assert.equal(typeof item.version,'string');assert.match(item.version,/^(?:latest|[1-9]\d{0,19})$/u);assert.equal(typeof item.path,'string');
    if(item.mode!==undefined){publicFileMode(item.mode);}walk(item,depth+1,'secretVolumeItem');
  }
}
function publicIdentityConfiguration(key,value,walk,depth){
  publicObject(value);assert(Object.keys(value).every(k=>['serviceAccountEmail',key==='oidcToken'?'audience':'scope'].includes(k)));assert.equal(typeof value.serviceAccountEmail,'string');walk(value,depth+1,'identityConfiguration');
}
function publicMember(key,value,walk,depth){
  assert(!['__proto__','constructor','prototype'].includes(key));
  if(key==='secretKeyRef'){secretRef(value);safeString(value.secret);return;}
  if(key==='secret'){publicVolumeSecret(value,walk,depth);return;}
  if(key==='oidcToken'||key==='oauthToken'){publicIdentityConfiguration(key,value,walk,depth);return;}
  assert(!SECRET_KEY.test(key)||!nonempty(value));
  if(key==='env'){assert(Array.isArray(value));for(const entry of value){walk(entry,depth+1,'envEntry');}return;}
  walk(value,depth+1,key);
}
// Public metadata is validated before any public receipt is opened. Native
// Secret Manager references and Scheduler identity configuration are not token
// payloads. No raw failed response or SDK stdout/stderr is accepted here.
export function validateImageInventoryPublicProjection(value){
  let nodes=0;const active=new Set();
  function walk(current,depth=0,parent=''){
    assert(++nodes<=200000&&depth<=64);if(current===null||typeof current==='boolean'){return;}
    if(typeof current==='string'){safeString(current);return;}if(typeof current==='number'){assert(Number.isFinite(current));return;}
    assert(current&&typeof current==='object'&&!active.has(current));active.add(current);
    try{
      if(Array.isArray(current)){const descriptors=Object.getOwnPropertyDescriptors(current);assert(Reflect.ownKeys(descriptors).every(k=>typeof k==='string'&&(k==='length'||/^(?:0|[1-9]\d*)$/u.test(k))&&Object.hasOwn(descriptors[k],'value')));for(const item of current){walk(item,depth+1,parent);}return;}
      assert(Object.getPrototypeOf(current)===Object.prototype);const descriptors=Object.getOwnPropertyDescriptors(current);
      assert(Reflect.ownKeys(descriptors).every(k=>typeof k==='string'&&Object.hasOwn(descriptors[k],'value')));
      if(parent==='envEntry'){publicEnvironmentEntry(current);}
      for(const [key,descriptor]of Object.entries(descriptors)){publicMember(key,descriptor.value,walk,depth);}
    }finally{active.delete(current);}
  }
  try{walk(value);assert(Buffer.byteLength(JSON.stringify(value))<=20971520);return value;}catch{refuse('N02_PUBLIC_PROJECTION_REFUSED');}
}
export function validateImageInventoryInputs({objectiveId,dossier,binding,source,authority,journalDirectory}){
  exact(dossier,['schemaVersion','kind','objectiveId','humanAuthorityReceiptSha256','source','resourceBindings','journalDirectorySha256']);
  assert.equal(dossier.schemaVersion,2);assert.equal(dossier.kind,'RC48_NATIVE_INVENTORY_DOSSIER_V2');assert.equal(dossier.objectiveId,objectiveId);assert.equal(dossier.humanAuthorityReceiptSha256,OPERATIONAL_HUMAN_SHA256);
  exact(dossier.source,['commit','tree']);assert.deepEqual(dossier.source,{commit:source.commit,tree:source.tree});assert.deepEqual(dossier.resourceBindings,IMAGE_OPERATIONAL_RESOURCES_V2);
  assert.equal(dossier.journalDirectorySha256,byteHash(journalDirectory));assert.equal(dossier.journalDirectorySha256,authority.entry.journalDirectorySha256);
  exact(binding,BINDING_FIELDS);assert.match(binding.sessionId,/^local:[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u);assert.equal(binding.scope,'READ_ONLY_INVENTORY');
  assert.equal(binding.project,'crmynov-prod-n7x4q2');assert.equal(binding.region,'europe-west1');assert.equal(binding.sourceCommit,source.commit);
  assert.equal(binding.authorityRecordSha256,authority.entry.authorityRecordSha256);assert.equal(binding.resourceBindingSha256,digest(IMAGE_OPERATIONAL_RESOURCES_V2));
  assert(HASH.test(binding.authorityRecordSha256));const start=iso(binding.windowStart),end=iso(binding.windowEnd);assert(end>start&&end-start<=900000);assert(iso(authority.entry.validFrom)<=start&&end<=iso(authority.entry.expiresAt));
  assert.equal(authority.entry.objectiveId,objectiveId);assert.equal(authority.entry.scope,'READ_ONLY_INVENTORY');assert.deepEqual(authority.entry.resourceBindings,dossier.resourceBindings);return true;
}
function operationContract(binding,source){return{schemaVersion:2,kind:'OFFICIAL_SDK_OPERATIONAL_RESOURCE_SESSION_V2',...binding,sourceTree:source.tree,googleAccount:'casablancaynovcampus@gmail.com'};}
function sameAuthority(before,after){for(const key of ['authorityRecordSha256','resourceBindingSha256','scope','project','region','objectiveId']){assert.equal(after.entry[key],before.entry[key]);}assert.equal(after.receipt.authorityRevision,before.receipt.authorityRevision);assert.equal(after.receipt.operationalCommentId,before.receipt.operationalCommentId);assert(HASH.test(before.receipt.operationalMarkerSha256));assert.equal(after.receipt.operationalMarkerSha256,before.receipt.operationalMarkerSha256);assert.equal(after.receipt.operationalMarkerUpdatedAt,before.receipt.operationalMarkerUpdatedAt);assert.deepEqual(after.entry.driver,before.entry.driver);}
async function composedAuthority(steps){
  const permissions=await steps.authorize('TEST_PERMISSIONS'),read=await steps.authorize('READ_METADATA');sameAuthority(permissions,read);
  const result=structuredClone(read);result.receipt.expiresAt=new Date(Math.min(iso(permissions.receipt.expiresAt),iso(read.receipt.expiresAt))).toISOString();return result;
}
function revisionLeaf(kind,service){const prefix=service.name+'/revisions/';assert.equal(typeof service.latestReadyRevision,'string');const leaf=service.latestReadyRevision.startsWith(prefix)?service.latestReadyRevision.slice(prefix.length):service.latestReadyRevision;assert(leaf.startsWith('crm-prod-'+kind+'-'));assert.match(leaf,/^[A-Za-z0-9_-]{1,256}$/u);return leaf;}
async function inventory(transport){
  await transport.testProjectPermissions();await transport.testServicePermissions('api');await transport.testServicePermissions('web');await transport.testJobPermissions();transport.assertGeneralPermissionsReady();
  const services={api:await transport.getService('api'),web:await transport.getService('web')};
  const revisions={api:await transport.getRevision('api',revisionLeaf('api',services.api)),web:await transport.getRevision('web',revisionLeaf('web',services.web))};
  const jobs=await transport.collectJobs(),schedulers=await transport.collectSchedulers(),sqlInstance=await transport.getSqlInstance(),backups=await transport.collectBackups();
  const general={job:await transport.getJob(),executions:await transport.collectExecutions()};return{services,revisions,jobs,schedulers,sqlInstance,backups,general};
}
async function persistInventory(steps,name,value){try{return await steps.persist(name,value);}catch{refuse('N02_PERSISTENCE_REFUSED');}}
async function performInventory(steps){
  let stage='N02_INPUTS_REFUSED',sdk,transport,budget,source,authority,data,finalAuthority;let failure=null;
  try{
    steps.validateInputs();stage='N02_SOURCE_REFUSED';source=steps.readSource();stage='N02_GOVERNANCE_REFUSED';authority=await composedAuthority(steps);
    stage='N02_INPUTS_REFUSED';validateImageInventoryInputs({...steps.inputs,source,authority});validateImageInventoryPublicProjection(source);validateImageInventoryPublicProjection(steps.inputs.binding);
    stage='N02_SOURCE_REFUSED';steps.assertSource(source);stage='N02_AUTHENTICATION_REFUSED';
    sdk=await steps.openSdk(operationContract(steps.inputs.binding,source),authority,source);assert.equal(sdk.report().authenticationChainValidated,true);
    stage='N02_NATIVE_INVENTORY_REFUSED';budget=steps.openBudget();transport=steps.openTransport(sdk.accessToken,authority,budget);data=await inventory(transport);
    stage='N02_REVALIDATION_REFUSED';steps.assertSource(source);finalAuthority=await composedAuthority(steps);sameAuthority(authority,finalAuthority);steps.assertSource(source);
    stage='N02_PUBLIC_PROJECTION_REFUSED';validateImageInventoryPublicProjection(data);
  }catch(error){failure=error instanceof InventoryRefusal&&REFUSALS.has(error.code)?error.code:stage;}
  finally{try{sdk?.close();}catch{failure??='N02_CLEANUP_REFUSED';}}
  const minimal={schemaVersion:2,objectiveId:steps.inputs.objectiveId,scope:'READ_ONLY_INVENTORY',claimCreated:false,runPosts:0,sqlQueries:0,runtimeOrSheetsActivationPerformed:false,canRetry:false};let common;
  try{common={...minimal,...(sdk?{sdkAuthentication:sdk.report()}:{}),...(transport?{exchanges:transport.observations(),permissions:transport.permissionEvidence()}:{} )};validateImageInventoryPublicProjection(common);}
  catch{failure='N02_PUBLIC_PROJECTION_REFUSED';common={...minimal};}
  if(budget){try{budget.stop(failure??'N02_INVENTORY_FIN');const state=budget.inspect();validateImageInventoryPublicProjection(state);common.nativeSessionBudget=state;}catch{failure??='N02_PERSISTENCE_REFUSED';}}
  if(failure){
    const receipt={...common,kind:'EXPURGATED_N02_READ_ONLY_INVENTORY_STOP_V2',state:'READ_ONLY_INVENTORY_STOPPED',guardCode:failure};validateImageInventoryPublicProjection(receipt);
    const saved=await persistInventory(steps,'N02-STOP',receipt);return{state:receipt.state,guardCode:failure,...saved,runPosts:0,claimCreated:false};
  }
  const receipt={...common,kind:'NATIVE_READ_ONLY_INVENTORY_OBSERVATION_V2',state:'FIN_READ_ONLY_INVENTORY_NOT_BASELINE_OR_PRE',source,binding:steps.inputs.binding,
    humanAuthorityReceiptSha256:OPERATIONAL_HUMAN_SHA256,authority:{initial:authority.receipt,final:finalAuthority.receipt},observations:data,
    notCommonSnapshot:true,baselineEstablished:false,sqlPreservationPreAcquired:false,futurePlanQualified:false,productionReadinessProved:false};
  validateImageInventoryPublicProjection(receipt);const saved=await persistInventory(steps,'N02-INVENTORY-native-FIN',receipt);return{state:receipt.state,...saved,runPosts:0,claimCreated:false,baselineEstablished:false};
}
function readJson(file,max=1048576){const bytes=readPoolPrivateFile(file,max);const value=JSON.parse(bytes);validateImageInventoryPublicProjection(value);return value;}
function savePublic(dir,name,value){
  try{validateImageInventoryPublicProjection(value);assert(['N02-STOP','N02-INVENTORY-native-FIN'].includes(name));const bytes=Buffer.from(JSON.stringify(value,null,2)+'\n'),file=path.join(dir,name+'.json'),fd=fs.openSync(file,'wx',0o600);try{let offset=0;while(offset<bytes.length){const count=fs.writeSync(fd,bytes,offset,bytes.length-offset);assert(count>0);offset+=count;}fs.fsyncSync(fd);}finally{fs.closeSync(fd);}return{path:file,sha256:byteHash(fs.readFileSync(file))};}catch{refuse('N02_PERSISTENCE_REFUSED');}
}
export async function runImageInventoryV2(args){
  try{
    assert.equal(process.versions.node,'22.23.3');assert(!process.env.NODE_OPTIONS&&!process.env.NODE_PATH);const options=parseImageInventoryArguments(args);
    assert.equal(typeof localSource.readImageOperationalSource,'function');const sourceReader=localSource.readImageOperationalSource;
    const journalDirectory=localSource.imageExternalDirectory(options['--journal-dir']),output=localSource.imageExternalDirectory(options['--output-dir']);assert.notEqual(journalDirectory,output);
    validateImageInventoryDirectoryState(fs.readdirSync(journalDirectory),fs.readdirSync(output));
    const inputs={objectiveId:options['--objective-id'],dossier:readJson(options['--inventory-dossier']),binding:readJson(options['--session-binding']),journalDirectory};
    const jiraBytes=readPoolPrivateFile(options['--jira-evidence'],65536),github=createReadOnlyGithubReader();
    const guard=source=>{assert.deepEqual(sourceReader(),source,'OPERATIONAL_SOURCE_CHANGED');};let stableAuthority;
    return await performInventory({inputs,validateInputs:()=>{exact(inputs.binding,BINDING_FIELDS);validateImageInventoryPublicProjection(inputs.dossier);},readSource:sourceReader,assertSource:guard,
      authorize:action=>authorizeImageInventory({github,objectiveId:inputs.objectiveId,localSource:sourceReader(),jiraBytes,action}),
      openSdk:(operationContract,authority,source)=>{stableAuthority=authority;return openOfficialSdkOperationalSession({operationContract,getAuthority:()=>stableAuthority,assertCurrent:()=>{assertAuthorityCurrent(stableAuthority,Date.now());guard(source);}});},
      openBudget:()=>createImageSessionBudget({directory:journalDirectory,binding:inputs.binding}),
      openTransport:(accessToken,authority,budget)=>createImageOperationalTransport({binding:inputs.binding,accessToken,getAuthority:()=>authority,sessionBudget:budget}),
      persist:(name,value)=>savePublic(output,name,value)});
  }catch(error){const code=error instanceof InventoryRefusal&&REFUSALS.has(error.code)?error.code:'N02_INPUTS_REFUSED';return{state:'READ_ONLY_INVENTORY_REFUSED_OR_EVIDENCE_INCOMPLETE',guardCode:code,claimCreated:false,runPosts:0,canRetry:false};}
}
// Explicit fake-port seam; never an authority or native receipt source.
export async function simulateImageInventoryV2({syntheticOnly,...steps}){assert.equal(syntheticOnly,true);const persist=steps.persist;const result=await performInventory({...steps,persist:(name,value)=>persist(name,{...value,syntheticOnly:true,nativeAuthority:false})});return{...result,syntheticOnly:true,nativeAuthority:false};}
