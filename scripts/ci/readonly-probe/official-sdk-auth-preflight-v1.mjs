// Additive, one-shot AUTH adapter. The RC47 factory and its validators remain
// byte-identical. This module has no CLI and never constructs a GCP client.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createOfficialAccessToken,TOKEN_ENDPOINT} from './rc47-probe-official-auth-v1.mjs';
export const AUTH_ACCOUNT='casablancaynovcampus@gmail.com';
export const AUTH_PYTHON='C:/Program Files (x86)/Google/Cloud SDK/google-cloud-sdk/platform/bundledpython/python.exe';
export const AUTH_GCLOUD='C:/Program Files (x86)/Google/Cloud SDK/google-cloud-sdk/lib/gcloud.py';
export const AUTH_FACTORY_SHA256='1a3abc2f3826ad70055745f380d83b23708b188d6a03f1b6245f6ea0420f32c5';
const CONFIG_ARGS=['-I',AUTH_GCLOUD,'config','list','--all','--format=json(auth)','--quiet'];
const TOKEN_ARGS=['-I',AUTH_GCLOUD,'auth','print-access-token','--account',AUTH_ACCOUNT,'--quiet'];
const STAGES=['CONFIG_INITIAL','CONFIG_PINNED','TOKEN'];
const EMPTY_AUTH=['ACCESS_TOKEN','ACCESS_TOKEN_FILE','CREDENTIAL_FILE_OVERRIDE','IMPERSONATE_SERVICE_ACCOUNT','LOGIN_CONFIG_FILE'];
const SAFE_OS=new Set(['ENOENT','EACCES','EPERM','EINVAL','ENOMEM','EAGAIN','ABORT_ERR','ERR_CHILD_PROCESS_STDIO_MAXBUFFER']);
const SAFE_SIGNALS=new Set(['SIGTERM','SIGKILL','SIGINT']);
const epoch=()=>Math.floor(performance.timeOrigin+performance.now());
const alphabetical=(left,right)=>left.localeCompare(right,'en');
const own=(value,key)=>{const d=value&&typeof value==='object'?Object.getOwnPropertyDescriptor(value,key):null;return d&&Object.hasOwn(d,'value')?d.value:undefined;};
const errorClass=error=>SAFE_OS.has(own(error,'code'))?own(error,'code'):'OTHER';
const safeExit=value=>Number.isSafeInteger(value)&&value>=-2147483648&&value<=2147483647?value:null;
const absent=value=>value===null||value===undefined||value==='';
function ambientOverride(environment){return Object.entries(environment).some(([key,value])=>(key.toUpperCase().startsWith('CLOUDSDK_AUTH_')||key.toUpperCase()==='GOOGLE_APPLICATION_CREDENTIALS')&&!absent(value));}
function expectedEnvironment(environment,pinned){
  const value={...environment,PYTHONHOME:'',PYTHONPATH:'',CLOUDSDK_CORE_DISABLE_PROMPTS:'1',CLOUDSDK_CORE_DISABLE_FILE_LOGGING:'1'};
  if(!pinned){return value;}
  value.CLOUDSDK_CORE_ACCOUNT=AUTH_ACCOUNT;
  for(const key of Object.keys(value)){if(key.toUpperCase().startsWith('CLOUDSDK_AUTH_')){delete value[key];}}
  for(const name of EMPTY_AUTH){value['CLOUDSDK_AUTH_'+name]='';}
  value.CLOUDSDK_AUTH_DISABLE_CREDENTIALS='false';value.CLOUDSDK_AUTH_DISABLE_SSL_VALIDATION='false';value.CLOUDSDK_AUTH_TOKEN_HOST=TOKEN_ENDPOINT;return value;
}
function validateInvocation(file,args,options,environment,signal,index){
  assert.equal(file,AUTH_PYTHON);assert.deepEqual(args,index===2?TOKEN_ARGS:CONFIG_ARGS);
  assert.deepEqual(Object.keys(options).sort(alphabetical),['encoding','env','maxBuffer','signal','timeout','windowsHide']);
  // Validate the UNCHANGED factory call first. Only the internal execution
  // adapter translates initial config3s to5s on Windows, never a failed retry.
  assert.equal(options.timeout,index===2?6000:3000);assert.equal(options.maxBuffer,16384);
  assert.equal(options.encoding,'utf8');assert.equal(options.windowsHide,true);assert.equal(options.signal,signal);
  assert.deepEqual(options.env,expectedEnvironment(environment,index>0));
}
function factsFor(stage,cap){return{stage,stageCapMs:cap,effectiveBudgetMs:null,invoked:false,spawnObserved:false,processClosed:false,
  callbackObserved:false,deadlineTriggered:false,abortIssued:false,processErrorClass:null,processExitCode:null,terminationSignal:null,
  observedDeadlineExceeded:false,outputBoundAccepted:null,jsonSyntaxValid:null,configurationOrTokenValidated:false,durationMs:null,outcome:'NOT_REACHED'};}
function stageFailure(facts){
  if(facts.deadlineTriggered){return'AUTH_DEADLINE_TRIGGERED';}
  if(!facts.spawnObserved&&facts.processErrorClass){return'AUTH_PROCESS_START_FAILED';}
  if(facts.outputBoundAccepted===false){return'AUTH_OUTPUT_BOUND_REFUSED';}
  if(facts.processErrorClass){return'AUTH_PROCESS_EXIT_ERROR';}
  if(!facts.processClosed){return'AUTH_PROCESS_CLOSURE_UNCONFIRMED';}
  if(facts.jsonSyntaxValid===false){return'AUTH_JSON_REFUSED';}
  return facts.stage==='TOKEN'?'AUTH_TOKEN_VALIDATION_REFUSED':'AUTH_CONFIGURATION_REFUSED';
}
function reportOf(state,facts,started,authEnded,ended){
  return{schemaVersion:1,kind:'EXPURGATED_COMPLETE_OFFICIAL_SDK_AUTH_PREFLIGHT_V1',state,account:AUTH_ACCOUNT,
    absoluteEnvelopeMs:15000,authElapsedMs:Math.max(0,authEnded-started),cleanupElapsedMs:Math.max(0,ended-authEnded),
    elapsedMs:Math.max(0,ended-started),sdkCommandsInvoked:facts.filter(f=>f.invoked).length,stages:structuredClone(facts),
    authenticationChainValidated:state==='AUTHENTICATION_CHAIN_VALIDATED',accountIdentityIndependentlyProved:false,
    tokenExpirationKnown:false,iamPermissionsObserved:false,cloudRunOrLoggingResourceCalls:0,runPosts:0,sqlQueries:0,
    runCapabilityCreated:false,tokenReferencesReleased:true,tokenReferenceReleaseScope:'ADAPTER_JAVASCRIPT_ONLY',physicalStringErasureAsserted:false,
    rawOutputConfigurationEnvironmentOrTokenPersistedByAdapter:false,officialSdkMemoryOnlyGuaranteed:false,
    officialSdkCacheBehavior:'NOT_OBSERVED_STANDARD_INTERNAL_CACHE_MAY_WRITE',sdkInternalNetworkCoverage:'NOT_INSTRUMENTED_NOT_PROOF_OF_ABSENCE',canRetry:false};
}
function currentBoundary(context){
  const before=context.clock();assert(Number.isSafeInteger(before)&&before>=context.last);context.guard();const now=context.clock();
  assert(Number.isSafeInteger(now)&&now>=before);context.last=now;
  assert(now<context.absoluteDeadline&&now<context.leaseExpiresAt&&now<context.requestDeadline&&!context.controller.signal.aborted);return now;
}
class SdkStageProcess{
  constructor(context,index,file,args,options,began){
    Object.assign(this,{context,index,file,args,options,began});this.fact=context.facts[index];this.callbackSeen=false;this.closed=false;this.settled=false;
    this.closePromise=new Promise(resolve=>{this.closedResolve=resolve;});
  }
  stop(code,abort=false){
    if(this.settled){return;}
    this.settled=true;this.context.terminal=true;this.context.cancel(this.timer);this.fact.durationMs=Math.max(0,this.context.clock()-this.began);this.fact.outcome=code;
    if(abort){this.fact.abortIssued=true;this.context.controller.abort();}this.stdout=undefined;this.reject(new Error(code));
  }
  completionBoundary(){
    const c=this.context,now=c.clock();
    if(now>=this.deadline||now>=c.absoluteDeadline||now>=c.leaseExpiresAt||now>=c.requestDeadline){this.fact.observedDeadlineExceeded=true;return'AUTH_DEADLINE_EXCEEDED';}
    let checked;try{checked=currentBoundary(c);}catch{return'AUTH_PRECONDITION_REFUSED';}
    if(checked>=this.deadline){this.fact.observedDeadlineExceeded=true;return'AUTH_DEADLINE_EXCEEDED';}return null;
  }
  complete(){
    if(this.settled||!this.callbackSeen||!this.closed){return;}
    const refused=this.completionBoundary();if(refused){this.stop(refused,true);return;}
    if(this.callbackError){this.stop(stageFailure(this.fact));return;}
    if(!this.fact.spawnObserved||this.fact.processExitCode!==0||this.fact.terminationSignal!==null){this.stop('AUTH_PROCESS_CLOSURE_UNCONFIRMED');return;}
    this.settled=true;this.context.cancel(this.timer);this.fact.durationMs=Math.max(0,this.context.clock()-this.began);
    this.fact.outcome='PROCESS_COMPLETED_PENDING_FACTORY_VALIDATION';const privateStdout=this.stdout;this.stdout=undefined;this.resolve({stdout:privateStdout,stderr:''});
  }
  output(output){
    this.fact.outputBoundAccepted=typeof output==='string'&&Buffer.byteLength(output)<=16384;
    if(!this.fact.outputBoundAccepted){this.callbackError=true;this.fact.processErrorClass='ERR_CHILD_PROCESS_STDIO_MAXBUFFER';return;}
    this.stdout=output;
    if(this.index<2){try{JSON.parse(output);this.fact.jsonSyntaxValid=true;}catch{this.fact.jsonSyntaxValid=false;}}
  }
  callback(error,output){
    if(this.settled){return;}
    this.callbackSeen=true;this.fact.callbackObserved=true;this.callbackError=Boolean(error);
    if(error){this.fact.processErrorClass=errorClass(error);this.fact.processExitCode=safeExit(own(error,'code'));}
    else{this.output(output);}this.complete();
  }
  close(code,signal){
    this.closed=true;this.fact.processClosed=true;this.fact.processExitCode=safeExit(code)??this.fact.processExitCode;
    this.fact.terminationSignal=SAFE_SIGNALS.has(signal)?signal:null;this.closedResolve();this.complete();
  }
  dispatch(){
    const c=this.context,dispatch=currentBoundary(c),remaining=Math.min(this.fact.stageCapMs,c.absoluteDeadline-dispatch,c.leaseExpiresAt-dispatch,c.requestDeadline-dispatch);
    assert(remaining>0);this.deadline=dispatch+remaining;
    this.timer=c.schedule(()=>{if(this.settled){return;}this.fact.deadlineTriggered=true;this.stop('AUTH_DEADLINE_TRIGGERED',true);},remaining);
    // Validation, guards and timer installation all consume real remaining time.
    const processRemaining=this.deadline-c.clock();assert(processRemaining>0);this.fact.effectiveBudgetMs=processRemaining;this.fact.invoked=true;
    this.child=c.invoke(this.file,this.args,{...this.options,timeout:processRemaining},(error,output)=>this.callback(error,output));
    assert(this.child&&typeof this.child.once==='function');this.child.once('spawn',()=>{this.fact.spawnObserved=true;});
    this.child.once('close',(code,signal)=>this.close(code,signal));this.child.once('error',()=>{});
  }
  start(){return new Promise((resolve,reject)=>{
    this.resolve=resolve;this.reject=reject;
    try{this.dispatch();}catch(error){this.fact.processErrorClass=errorClass(error);if(!this.child){this.closedResolve();}this.stop(this.fact.invoked?'AUTH_PROCESS_START_FAILED':'AUTH_PRECONDITION_REFUSED',true);}
  });}
}
function createStageExecutor(context){
  Object.assign(context,{next:0,last:context.clock(),terminal:false,active:null});
  return{execute(file,args,options){
    const index=context.next++;assert(index<3&&!context.terminal);if(index>0){context.facts[index-1].configurationOrTokenValidated=true;}
    let began;
    try{currentBoundary(context);validateInvocation(file,args,options,context.environment,context.controller.signal,index);began=currentBoundary(context);}
    catch{context.terminal=true;context.facts[index].outcome='AUTH_PRECONDITION_REFUSED';throw new Error('AUTH_PRECONDITION_REFUSED');}
    context.active=new SdkStageProcess(context,index,file,args,options,began);return context.active.start();
  },finish(){context.terminal=true;},async settle(){
    // Observation-only cleanup is not a fourth auth stage and never permits a
    // late success. Return a stable snapshot after at most500ms of cleanup.
    let timer;try{await Promise.race([context.active?.closePromise??Promise.resolve(),new Promise(resolve=>{timer=context.schedule(resolve,500);})]);}
    finally{context.cancel(timer);}
  }};
}
async function performAuth({environment,platform,clock,invoke,schedule,cancel,guard,leaseExpiresAt,requestDeadline,retainOperationalToken=false}){
  assert(['win32','linux','darwin'].includes(platform));const started=clock();assert(Number.isSafeInteger(started));
  const absoluteDeadline=started+15000,controller=new AbortController(),caps=[platform==='win32'?5000:3000,3000,6000],facts=STAGES.map((stage,i)=>factsFor(stage,caps[i]));
  const executor=createStageExecutor({controller,environment,clock,invoke,schedule,cancel,guard,absoluteDeadline,leaseExpiresAt,requestDeadline,facts});
  let token,retainedToken,returned=false,state='AUTH_PRECONDITION_REFUSED',authEnded;
  try{
    guard();assert(started<leaseExpiresAt&&started<requestDeadline&&!ambientOverride(environment));
    const provider=createOfficialAccessToken({account:AUTH_ACCOUNT,gcloudPath:AUTH_GCLOUD,pythonPath:AUTH_PYTHON,environment,execute:executor.execute});
    token=await provider({signal:controller.signal});returned=true;guard();const ended=clock();
    assert(ended<absoluteDeadline&&ended<leaseExpiresAt&&ended<requestDeadline&&!controller.signal.aborted);
    assert(facts.every(f=>f.invoked&&f.spawnObserved&&f.processClosed));facts[2].configurationOrTokenValidated=true;
    for(const fact of facts){fact.outcome='VALIDATED';}state='AUTHENTICATION_CHAIN_VALIDATED';
  }catch{
    const active=facts.findLast(f=>f.invoked||f.outcome!=='NOT_REACHED');
    if(returned){state='AUTH_POSTCHECK_REFUSED';}
    else if(active){state=active.outcome.startsWith('AUTH_')?active.outcome:stageFailure(active);active.outcome=state;}
    else if(ambientOverride(environment)){state='AUTH_AMBIENT_OVERRIDE_REFUSED';}
  }finally{if(retainOperationalToken&&state==='AUTHENTICATION_CHAIN_VALIDATED'){retainedToken=token;}token=undefined;executor.finish();authEnded=clock();}
  await executor.settle();const report=reportOf(state,facts,started,authEnded,clock());
  return retainOperationalToken?{report,retainedToken}:report;
}
// Closed actual SDK entry. No injectable factory, process, account, deadline,
// clock or environment; caller only supplies a verified lease and local guard.
// The encompassing NON-CLI entry is responsible for the concrete source lease.
export async function runOfficialSdkAuthOnly({leaseExpiresAt,assertCurrent}){
  assert(Number.isSafeInteger(leaseExpiresAt));assert.equal(typeof assertCurrent,'function');const started=epoch();
  return performAuth({environment:process.env,platform:process.platform,clock:epoch,invoke:execFile,schedule:setTimeout,cancel:clearTimeout,
    guard:assertCurrent,leaseExpiresAt,requestDeadline:started+15000});
}
// Explicit synthetic test surface; returned data never includes the fake token.
// This is not a source of human, governance, permission, or RUN authority.
export async function simulateOfficialSdkAuthPreflight({syntheticOnly,...input}){
  assert.equal(syntheticOnly,true);return performAuth({...input,retainOperationalToken:false});
}

// This is a resource-session authentication adapter, not the closed historical
// AUTH_ONLY trial. It never constructs a URL, sends a resource request, grants
// IAM rights or arms an execution claim. The caller closes it in finally.
const OPERATIONAL_SCOPE=new Set(['READ_ONLY_INVENTORY','RC48_SERVICE_IMAGE_ONLY_V1','RC48_SERVICE_IMAGE_ROLLBACK_V1','POST_PRESERVATION_READ_ONLY_V2']);
const OPERATIONAL_FIELDS=['schemaVersion','kind','sessionId','authorityRecordSha256','resourceBindingSha256','sourceCommit','sourceTree','scope','project','region','windowStart','windowEnd','googleAccount'];
function operationalData(value,keys){
  assert(value&&Object.getPrototypeOf(value)===Object.prototype);const descriptors=Object.getOwnPropertyDescriptors(value);
  assert(Reflect.ownKeys(descriptors).every(key=>typeof key==='string'&&Object.hasOwn(descriptors[key],'value')));
  assert.deepEqual(Object.keys(descriptors).sort(alphabetical),[...keys].sort(alphabetical));
}
function operationalTime(value){assert.equal(typeof value,'string');const n=Date.parse(value);assert(Number.isSafeInteger(n)&&new Date(n).toISOString()===value);return n;}
function operationalPostResources(value){
  operationalData(value,['schemaVersion','kind','project','region','objectiveId','job','dossierSha256','sourceSha256','bundleSha256','image','role','selectCount']);
  assert.equal(value.schemaVersion,2);assert.equal(value.kind,'POST_PRESERVATION_RESOURCE_BINDING_V2');assert.equal(value.project,'crmynov-prod-n7x4q2');assert.equal(value.region,'europe-west1');
  assert.match(value.objectiveId,/^rc48-general-post-[a-z0-9-]{8,63}$/u);assert.match(value.job,/^projects\/crmynov-prod-n7x4q2\/locations\/europe-west1\/jobs\/crm-prod-preservation-post-[a-z0-9-]+$/u);
  for(const key of ['dossierSha256','sourceSha256','bundleSha256']){assert.match(value[key],/^[a-f0-9]{64}$/u);}
  assert.equal(value.image,'europe-west1-docker.pkg.dev/crmynov-prod-n7x4q2/crm-ynov-prod/api@sha256:d2b2f6b0cf0ed9d9eb1cb15b70924af38be7ca4c4a824b6b406bb62caf88cd8f');assert.equal(value.role,'crm_runtime');assert.equal(value.selectCount,13);
  const canonical='{'+Object.keys(value).sort(alphabetical).map(key=>JSON.stringify(key)+':'+JSON.stringify(value[key])).join(',')+'}';return createHash('sha256').update(canonical).digest('hex');
}
function operationalAuthority(contract,getAuthority,assertCurrent,clock){
  assertCurrent();const now=clock();assert(Number.isSafeInteger(now));const authority=getAuthority(),entry=authority?.entry,receipt=authority?.receipt;
  assert(entry?.schemaVersion===2&&receipt?.schemaVersion===2);assert.equal(entry.googleAccount,AUTH_ACCOUNT);
  assert.equal(entry.scope,contract.scope);assert.equal(entry.project,contract.project);assert.equal(entry.region,contract.region);
  assert.equal(entry.authorityRecordSha256,contract.authorityRecordSha256);assert.equal(receipt.authorityRecordSha256,contract.authorityRecordSha256);
  assert.equal(entry.resourceBindingSha256,contract.resourceBindingSha256);assert.equal(receipt.resourceBindingSha256,contract.resourceBindingSha256);
  assert.equal(entry.driver.mergeCommit,contract.sourceCommit);assert.equal(receipt.driverCommit,contract.sourceCommit);assert.equal(entry.driver.tree,contract.sourceTree);
  if(contract.scope==='READ_ONLY_INVENTORY'){
    assert.equal(entry.preparationMode,'READ_ONLY_INVENTORY');assert.equal(entry.preparationPhase,'READ_ONLY_INVENTORY');
    assert(entry.actions.every(action=>['READ_METADATA','TEST_PERMISSIONS','OBSERVE_OPERATION'].includes(action)));
  }else if(contract.scope==='POST_PRESERVATION_READ_ONLY_V2'){
    assert.equal(entry.preparationMode,'POST_PRESERVATION_V2');assert.equal(entry.preparationPhase,contract.preparationPhase);assert.equal(entry.commonSessionBindingSha256,contract.commonSessionBindingSha256);assert.equal(receipt.commonSessionBindingSha256,contract.commonSessionBindingSha256);
    const actions=['CREATE_POST_JOB','RUN_POST_JOB','READ_POST_OUTPUT','READ_METADATA','TEST_PERMISSIONS','OBSERVE_OPERATION'];assert.deepEqual([...entry.actions].sort(alphabetical),actions.sort(alphabetical));
    assert.equal(operationalPostResources(entry.resourceBindings),contract.resourceBindingSha256);
  }else{assert.equal(entry.preparationMode,'LATE_BOUND_V2');assert(['BACKUP_READY','FORWARD_FINAL'].includes(entry.preparationPhase));}
  const start=operationalTime(contract.windowStart),end=operationalTime(contract.windowEnd),lease=operationalTime(receipt.expiresAt);
  assert(operationalTime(entry.validFrom)<=start&&end<=operationalTime(entry.expiresAt));assert(now>=start&&now<end&&now<lease);
  assert(operationalTime(receipt.verifiedAt)<=now);return Math.min(end,lease);
}
function operationalContract(input){
  const post=own(input,'scope')==='POST_PRESERVATION_READ_ONLY_V2';operationalData(input,post?[...OPERATIONAL_FIELDS,'preparationPhase','commonSessionBindingSha256']:OPERATIONAL_FIELDS);assert.equal(input.schemaVersion,2);assert.equal(input.kind,'OFFICIAL_SDK_OPERATIONAL_RESOURCE_SESSION_V2');
  if(post){assert(['POST_RESOURCE_PREPARATION','POST_EXECUTION'].includes(input.preparationPhase));assert.match(input.commonSessionBindingSha256,/^[a-f0-9]{64}$/u);}
  assert.match(input.sessionId,/^local:[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u);
  for(const key of ['authorityRecordSha256','resourceBindingSha256']){assert.match(input[key],/^[a-f0-9]{64}$/u);}
  for(const key of ['sourceCommit','sourceTree']){assert.match(input[key],/^[a-f0-9]{40}$/u);}
  assert(OPERATIONAL_SCOPE.has(input.scope));assert.equal(input.project,'crmynov-prod-n7x4q2');assert.equal(input.region,'europe-west1');assert.equal(input.googleAccount,AUTH_ACCOUNT);
  const start=operationalTime(input.windowStart),end=operationalTime(input.windowEnd);assert(end>start&&end-start<=900000);return structuredClone(input);
}
async function operationalSession(input,dependencies){
  let contract,leaseExpiresAt;const {getAuthority,assertCurrent}=input;
  try{assert.equal(typeof getAuthority,'function');assert.equal(typeof assertCurrent,'function');contract=operationalContract(input.operationContract);leaseExpiresAt=operationalAuthority(contract,getAuthority,assertCurrent,dependencies.clock);}
  catch{throw new Error('SDK_OPERATION_CONTRACT_REFUSED');}
  const guard=()=>{operationalAuthority(contract,getAuthority,assertCurrent,dependencies.clock);},started=dependencies.clock();
  const auth=await performAuth({...dependencies,guard,leaseExpiresAt,requestDeadline:started+15000,retainOperationalToken:true});
  let token=auth.retainedToken;auth.retainedToken=undefined;let closed=false,last=dependencies.clock();
  const authentication=auth.report;
  function close(){token=undefined;closed=true;}
  function report(){
    const value=structuredClone(authentication);
    // Zero-resource fields belong only to AUTH_ONLY. This report describes
    // authentication, not the encompassing session's resource side effects.
    for(const key of ['cloudRunOrLoggingResourceCalls','runPosts','sqlQueries','runCapabilityCreated']){delete value[key];}
    return{...value,schemaVersion:2,kind:'EXPURGATED_OFFICIAL_SDK_OPERATIONAL_SESSION_AUTH_V2',
      scope:'OPERATIONAL_AUTHENTICATION_ONLY_NOT_RESOURCE_RESULT',sessionId:contract.sessionId,
      authorityRecordSha256:contract.authorityRecordSha256,resourceBindingSha256:contract.resourceBindingSha256,
      resourceAuthorityScope:contract.scope,...(contract.scope==='POST_PRESERVATION_READ_ONLY_V2'?{preparationPhase:contract.preparationPhase,commonSessionBindingSha256:contract.commonSessionBindingSha256}:{}),
      tokenReferencesReleased:closed||token===undefined,tokenReferenceReleaseScope:'ADAPTER_JAVASCRIPT_ONLY',closed};
  }
  async function accessToken({signal}={}){
    try{
      assert(!closed&&authentication.authenticationChainValidated&&typeof token==='string');assert(!signal?.aborted);
      const now=dependencies.clock();assert(Number.isSafeInteger(now)&&now>=last);last=now;guard();assert(!signal?.aborted);return token;
    }catch{close();throw new Error('SDK_OPERATION_SESSION_CLOSED_OR_PRECONDITION_REFUSED');}
  }
  if(!authentication.authenticationChainValidated){close();}
  return Object.freeze({accessToken,close,report});
}
export async function openOfficialSdkOperationalSession({operationContract,getAuthority,assertCurrent}){
  return operationalSession({operationContract,getAuthority,assertCurrent},{environment:process.env,platform:process.platform,clock:epoch,
    invoke:execFile,schedule:setTimeout,cancel:clearTimeout});
}
// Pure test surface: fake processes only, never an operational authority issuer.
export async function simulateOfficialSdkOperationalSession({syntheticOnly,operationContract,getAuthority,assertCurrent,...dependencies}){
  assert.equal(syntheticOnly,true);return operationalSession({operationContract,getAuthority,assertCurrent},dependencies);
}
