// Additive, one-shot AUTH adapter. The RC47 factory and its validators remain
// byte-identical. This module has no CLI and never constructs a GCP client.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
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
async function performAuth({environment,platform,clock,invoke,schedule,cancel,guard,leaseExpiresAt,requestDeadline}){
  assert(['win32','linux','darwin'].includes(platform));const started=clock();assert(Number.isSafeInteger(started));
  const absoluteDeadline=started+15000,controller=new AbortController(),caps=[platform==='win32'?5000:3000,3000,6000],facts=STAGES.map((stage,i)=>factsFor(stage,caps[i]));
  const executor=createStageExecutor({controller,environment,clock,invoke,schedule,cancel,guard,absoluteDeadline,leaseExpiresAt,requestDeadline,facts});
  let token,returned=false,state='AUTH_PRECONDITION_REFUSED',authEnded;
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
  }finally{token=undefined;executor.finish();authEnded=clock();}
  await executor.settle();return reportOf(state,facts,started,authEnded,clock());
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
  assert.equal(syntheticOnly,true);return performAuth(input);
}
