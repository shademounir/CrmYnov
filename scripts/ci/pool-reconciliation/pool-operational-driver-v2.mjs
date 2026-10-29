// Diagnostic V2 composed from the existing executor; no catalogue entry is retargeted.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {byteHash,digest} from './controlled-pool-contract-v1.mjs';
import {POOL_DRIVER_INPUTS as priorInputs,POOL_OFFICIAL_GIT,readPoolPrivateFile,parseReadOnlyDriverArguments,buildReadOnlyObservationClaimReceipt} from './pool-operational-driver-v1.mjs';
import {authorizeReadOnlyDriver} from './pool-driver-authority-v1.mjs';
import {validateLocalReadOnlyDossier} from './pool-job-dossier-v1.mjs';
import {createReadOnlyNativeTransport,openReadOnlyTransactionJournal,dispatchReadOnlyOnce,observeReadOnlyOperation} from './pool-native-transaction-v2.mjs';
import {createReadOnlyOutputReader} from './pool-output-reader-v1.mjs';
import {reconcileVerifiedPoolOutput} from './pool-observation-reconciliation-v1.mjs';
import {fixedToolEnvironment} from '../readonly-probe/probe-driver-github-v1.mjs';
import {createReadOnlyGithubReader} from './pool-driver-github-v1.mjs';
import {createOfficialAccessToken} from '../readonly-probe/rc47-probe-official-auth-v1.mjs';
import {assertAuthorityCurrent} from '../readonly-probe/probe-driver-authority-v1.mjs';
import {diagnosticContext,sanitizedDiagnostic,diagnosticOf,commandResult,withDiagnosticAuthority,withDiagnosticPhase} from './readonly-native-diagnostics-v1.mjs';
export {POOL_OFFICIAL_GIT,readPoolPrivateFile,parseReadOnlyDriverArguments,buildReadOnlyObservationClaimReceipt} from './pool-operational-driver-v1.mjs';
const ROOT=path.resolve(import.meta.dirname,'../../..');
const modes=Object.freeze({verify:'VERIFY','create-job':'CREATE','observe-create':'OBSERVE_CREATE',run:'RUN','observe-run':'OBSERVE_RUN','read-output':'READ_OUTPUT'});
const additions=['scripts/ci/operational-driver-v3.mjs',...['pool-native-transaction-v2.mjs','readonly-native-diagnostics-v1.mjs','pool-operational-driver-v2.mjs'].map(name=>'scripts/ci/pool-reconciliation/'+name)];
export const POOL_DRIVER_INPUTS=Object.freeze([...new Set([...priorInputs,...additions])].sort((a,b)=>a.localeCompare(b,'en')));
export function parseDiagnosticDriverArguments(args){
  const stripped=[];let directory;
  for(let i=0;i<args.length;i++){
    if(args[i]==='--diagnostic-dir'){assert.equal(directory,undefined,'DUPLICATE_DIAGNOSTIC_DIRECTORY');assert.equal(typeof args[i+1],'string');directory=args[++i];}
    else stripped.push(args[i]);
  }
  assert(directory,'DIAGNOSTIC_DIRECTORY_REQUIRED');
  return {...parseReadOnlyDriverArguments(stripped),diagnosticDirectory:directory};
}
function checkedGit(){
  assert(process.platform==='win32'&&path.win32.isAbsolute(POOL_OFFICIAL_GIT),'WINDOWS_OPERATOR_REQUIRED');
  const stat=fs.lstatSync(POOL_OFFICIAL_GIT);assert(stat.isFile()&&!stat.isSymbolicLink(),'CANONICAL_OFFICIAL_GIT_REQUIRED');
  assert.equal(fs.realpathSync(POOL_OFFICIAL_GIT),path.win32.normalize(POOL_OFFICIAL_GIT));
  assert(!Object.keys(process.env).some(key=>/^GIT_/iu.test(key)),'AMBIENT_GIT_OVERRIDE');
  const options={encoding:'utf8',windowsHide:true,timeout:15000,maxBuffer:1048576,env:fixedToolEnvironment(process.env)};
  return args=>execFileSync(POOL_OFFICIAL_GIT,['-C',ROOT,...args],options).trim();
}
function localSource(){
  const git=checkedGit();assert.equal(git(['status','--porcelain','--untracked-files=all']),'');
  const files=POOL_DRIVER_INPUTS.map(relative=>({path:relative,sha256:byteHash(readPoolPrivateFile(path.join(ROOT,relative)))}));
  return{commit:git(['rev-parse','HEAD']),tree:git(['rev-parse','HEAD^{tree}']),clean:true,files};
}
function externalDirectory(value){
  assert(path.isAbsolute(value));const resolved=fs.realpathSync(value);
  assert.equal(resolved,path.resolve(value));assert(fs.statSync(resolved).isDirectory()&&!fs.lstatSync(value).isSymbolicLink());
  const relative=path.relative(ROOT,resolved);assert(path.isAbsolute(relative)||relative.startsWith('..'+path.sep),'JOURNAL_OUTSIDE_SOURCE');return resolved;
}
function diagnosticWriter(directory){
  return async record=>{
    const file=path.join(directory,record.correlationId+'.json'),fd=fs.openSync(file,'wx');
    try{fs.writeFileSync(fd,JSON.stringify(record,null,2)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  };
}
function localInputs(parsed){
  const options=parsed.options,dossier=JSON.parse(readPoolPrivateFile(options['--dossier']));
  const purpose=dossier.objective?.purpose;
  if(purpose!=='POOL_RECONCILIATION_READ_ONLY_V1')assert.equal(options['--purpose'],purpose,'EXPLICIT_PURPOSE_REQUIRED');
  if(options['--purpose'])assert.equal(options['--purpose'],purpose,'PURPOSE_ARGUMENT_BINDING');
  validateLocalReadOnlyDossier(dossier,relative=>fs.readFileSync(path.join(import.meta.dirname,relative)));
  const directory=externalDirectory(options['--journal-dir']),diagnosticsDirectory=externalDirectory(parsed.diagnosticDirectory);
  assert.notEqual(diagnosticsDirectory,directory,'DIAGNOSTICS_SEPARATE_FROM_JOURNAL');
  const journalPath=path.join(directory,'pool-native-transactions.sqlite');
  if(fs.existsSync(journalPath))assert.notEqual(byteHash(readPoolPrivateFile(journalPath)),'6c3816eea737aa035000b42d249e1cc697ddc4e666d3d97c0b5bdf2873f85450','HISTORICAL_GENERAL_UNKNOWN_JOURNAL_REFUSED_BEFORE_OPEN');
  const diagnostic=diagnosticContext({objectiveId:options['--objective-id'],objectiveSha256:dossier.objective.objectiveSha256,stage:modes[parsed.mode]});
  return{dossier,purpose,directory,diagnostic,saveDiagnostic:diagnosticWriter(diagnosticsDirectory),jiraBytes:readPoolPrivateFile(options['--jira-evidence'],65536)};
}
function freshAuthority(inputs,parsed,source){
  const github=createReadOnlyGithubReader();let current;
  const authorizeFresh=withDiagnosticAuthority(async()=>{
    assert.deepEqual(localSource(),source,'LOCAL_SOURCE_DRIFT');
    current=await authorizeReadOnlyDriver({github,objectiveId:parsed.options['--objective-id'],dossier:inputs.dossier,jiraBytes:inputs.jiraBytes,localSource:source,action:modes[parsed.mode]});
    assert.equal(current.entry.journalDirectorySha256,byteHash(inputs.directory));
    assert.deepEqual(localSource(),source);assertAuthorityCurrent(current,Date.now());return current;
  },{diagnostic:inputs.diagnostic,saveDiagnostic:inputs.saveDiagnostic});
  return{authorizeFresh,getAuthority:()=>current};
}
function sourceBoundClaims(context,verified,saved){
  const proof=buildReadOnlyObservationClaimReceipt({verified,authority:context.getAuthority(),dossier:context.dossier,source:context.source,saved});
  assert.equal(proof.officialReadPathExecuted,true);return proof;
}
async function readOutput(context,options){
  const saved=context.journal.inspect('RUN');assert.equal(saved?.state,'RECONCILED','KNOWN_RECONCILED_EXECUTION_REQUIRED');
  const outputDirectory=externalDirectory(options['--output-dir']);
  const save=async(name,value)=>fs.writeFileSync(path.join(outputDirectory,name+'.json'),JSON.stringify({at:new Date().toISOString(),...value},null,2)+'\n',{flag:'wx'});
  await context.authorizeFresh();const reader=createReadOnlyOutputReader({accessToken:context.accessToken,getAuthority:context.getAuthority});
  const verified=await reader({dossier:context.dossier,execution:saved.execution,privateKeyPem:readPoolPrivateFile(options['--private-key'],16384).toString('utf8'),save});
  assert.equal(verified.job.uid,saved.uid);
  if(context.purpose!=='POOL_RECONCILIATION_READ_ONLY_V1'){
    const proof=sourceBoundClaims(context,verified,saved);await save('READONLY-OBSERVATION-CLAIMS',proof);
    return{state:proof.kind,proofSha256:digest(proof),canRetry:false};
  }
  const result=reconcileVerifiedPoolOutput({verified,authority:context.getAuthority(),dossier:context.dossier,
    intentBytes:readPoolPrivateFile(options['--intent'],65536),independentInputBytes:readPoolPrivateFile(options['--independent-inputs'],65536),
    priorProof:options['--prior-proof']?JSON.parse(readPoolPrivateFile(options['--prior-proof'],65536)):null,now:Date.now()});
  await save('POOL-RECONCILIATION',result);return{state:result.status,proofSha256:result.proofSha256,canRetry:false};
}
async function performMode(context,parsed){
  const mode=parsed.mode;
  if(mode==='run'||mode==='create-job')return dispatchReadOnlyOnce({...context,stage:modes[mode]});
  if(mode==='observe-run'||mode==='observe-create'){
    await context.authorizeFresh();return observeReadOnlyOperation({objective:context.dossier.objective,stage:mode==='observe-run'?'RUN':'CREATE',transport:context.transport,journal:context.journal});
  }
  return readOutput(context,parsed.options);
}
export async function runReadOnlyOperationalDriver(args,{requiredPurpose}={}){
  assert.equal(process.versions.node,'22.23.3');assert(!process.env.NODE_OPTIONS&&!process.env.NODE_PATH);
  const parsed=parseDiagnosticDriverArguments(args),inputs=localInputs(parsed);
  return withDiagnosticPhase(async()=>{
  const source=localSource();
  if(requiredPurpose)assert.equal(inputs.purpose,requiredPurpose);
  const authorization=freshAuthority(inputs,parsed,source),authority=await authorization.authorizeFresh();
  if(parsed.mode==='verify')return commandResult({state:inputs.purpose==='POOL_RECONCILIATION_READ_ONLY_V1'?'POOL_AUTHORITY_AND_LOCAL_PAYLOAD_VERIFIED':'READONLY_AUTHORITY_AND_LOCAL_PAYLOAD_VERIFIED'});
  const accessToken=createOfficialAccessToken({account:authority.entry.googleAccount,gcloudPath:'C:/Program Files (x86)/Google/Cloud SDK/google-cloud-sdk/lib/gcloud.py',pythonPath:'C:/Program Files (x86)/Google/Cloud SDK/google-cloud-sdk/platform/bundledpython/python.exe'});
  const transport=createReadOnlyNativeTransport({purpose:inputs.purpose,accessToken,...authorization,diagnostic:inputs.diagnostic,saveDiagnostic:inputs.saveDiagnostic});
  const journal=openReadOnlyTransactionJournal({directory:inputs.directory,objective:inputs.dossier.objective,initialize:parsed.options['--initialize']==='yes'});
  try{return commandResult(await performMode({...inputs,...authorization,source,accessToken,transport,journal},parsed));}
  finally{journal.close();}
  },{diagnostic:inputs.diagnostic,saveDiagnostic:inputs.saveDiagnostic,phase:'VALIDATION',reason:'VALIDATION_REFUSED'})();
}
export function parsePoolDriverArguments(args){
  const parsed=parseDiagnosticDriverArguments(args);
  if(parsed.options['--purpose']){
    assert.equal(parsed.options['--purpose'],'POOL_RECONCILIATION_READ_ONLY_V1');
  }
  return parsed;
}
export async function runPoolOperationalDriver(args){return runReadOnlyOperationalDriver(args,{requiredPurpose:'POOL_RECONCILIATION_READ_ONLY_V1'});}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
  try{process.stdout.write(JSON.stringify({schemaVersion:1,...commandResult(await runReadOnlyOperationalDriver(process.argv.slice(2)))})+'\n');}
  catch(error){
    const now=Date.now(),diagnostic=diagnosticOf(error)??sanitizedDiagnostic(diagnosticContext({stage:'VERIFY'}),{startedMs:now,endedMs:now,phase:'VALIDATION',reason:'VALIDATION_REFUSED'});
    process.stderr.write(JSON.stringify(commandResult({state:'REFUSED',code:'POOL_OPERATIONAL_V2_GUARD',diagnostic}))+'\n');
    process.exitCode=1; // Same refusal code as V1; UNKNOWN stays exit0 and never authorizes retry.
  }
}
