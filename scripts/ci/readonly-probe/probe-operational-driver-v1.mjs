// Operational entry point. All mutating modes require a later protected catalog
// and fresh independently posted operational authorization; none is shipped here.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {digest} from './rc47-select-only-probe-core-v1.mjs';
import {validateNativeJob} from './rc47-probe-native-guards-v1.mjs';
import {createProbeExecutor} from './rc47-probe-executor-v1.mjs';
import {createHttpContract} from './rc47-probe-http-contract-v1.mjs';
import {createBoundedExchange} from './rc47-probe-bounded-exchange-v1.mjs';
import {createOfficialAccessToken} from './rc47-probe-official-auth-v1.mjs';
import {createOfficialGithubReader,fixedToolEnvironment} from './probe-driver-github-v1.mjs';
import {authorizeProbeDriver,assertAuthorityCurrent,createAuthorityBoundFetch} from './probe-driver-authority-v1.mjs';
import {validateLocalProbePayload} from './probe-driver-payload-v1.mjs';
import {openCreationJournal,createJobCreationTransport,createJobOnce,observeJobCreation} from './probe-job-creation-v1.mjs';
const ROOT=path.resolve(import.meta.dirname,'../../..'),LOCAL=import.meta.dirname;
export const OFFICIAL_GIT='C:\\Program Files\\Git\\cmd\\git.exe';
const hash=b=>createHash('sha256').update(b).digest('hex');
export const DRIVER_INPUTS=Object.freeze([
  'rc47-select-only-probe-core-v1.mjs','rc47-select-only-probe-adapter-v1.mjs','rc47-probe-controlled-entry-v2.mjs','rc47-probe-native-guards-v1.mjs','rc47-probe-bundle-v2.mjs','rc47-probe-executor-v1.mjs','rc47-probe-single-run-v1.mjs','rc47-probe-exclusive-journal-v1.mjs','rc47-probe-http-contract-v1.mjs','rc47-probe-bounded-exchange-v1.mjs','rc47-probe-official-auth-v1.mjs','probe-driver-github-v1.mjs','probe-driver-authority-v1.mjs','probe-job-creation-v1.mjs','probe-driver-payload-v1.mjs','probe-operational-driver-v1.mjs'
].map(p=>'scripts/ci/readonly-probe/'+p).concat(['scripts/pr-policy/delegation.mjs','scripts/release-manifest/checks.mjs']).sort((a,b)=>a.localeCompare(b,'en')));
export function readPrivateFile(file,max=1048576) {
  assert(path.isAbsolute(file));assert(!fs.lstatSync(file).isSymbolicLink());assert.equal(fs.realpathSync(file),path.resolve(file));
  const fd=fs.openSync(file,'r');try{const info=fs.fstatSync(fd);assert(info.isFile()&&info.size<=max);const bytes=fs.readFileSync(fd);assert(bytes.length<=max);return bytes;}finally{fs.closeSync(fd);}
}
export function parseDriverArguments(args) {
  assert(args.length>=1);const mode=args[0];assert(['verify','create-job','observe-create','run','observe-run'].includes(mode));
  const options={};for(let i=1;i<args.length;i+=2){const key=args[i];assert(['--objective-id','--dossier','--jira-evidence','--journal-dir','--initialize-create','--initialize-run'].includes(key));assert(!Object.hasOwn(options,key));assert(typeof args[i+1]==='string');options[key]=args[i+1];}
  for(const key of ['--objective-id','--dossier','--jira-evidence','--journal-dir'])assert(options[key]);
  for(const [key,requiredMode]of [['--initialize-create','create-job'],['--initialize-run','run']])if(Object.hasOwn(options,key)){assert.equal(options[key],'yes');assert.equal(mode,requiredMode);}
  return {mode,options};
}
function localSource() {
  assert(!Object.keys(process.env).some(k=>/^GIT_/iu.test(k)),'ambient Git overrides refused');
  const env=fixedToolEnvironment(process.env);
  const git=(...args)=>execFileSync(OFFICIAL_GIT,['-c','core.fsmonitor=false','-c','core.hooksPath=NUL','-c','core.untrackedCache=false','-C',ROOT,...args],{
    // Keep the executable and its subprocess search path literal at this boundary.
    // All caller PATH case variants were removed by fixedToolEnvironment above.
    env:{...env,PATH:'C:/Program Files/Git/cmd;C:/Program Files/Git/mingw64/bin;C:/Windows/System32;C:/Windows'},
    encoding:'utf8',windowsHide:true,timeout:15000,maxBuffer:1048576
  }).trim();
  const clean=git('status','--porcelain','--untracked-files=all')==='';assert(clean,'protected clean driver checkout required');
  return {commit:git('rev-parse','HEAD'),tree:git('rev-parse','HEAD^{tree}'),clean,files:DRIVER_INPUTS.map(p=>{const file=path.join(ROOT,p);assert(!fs.lstatSync(file).isSymbolicLink());assert.equal(fs.realpathSync(file),path.resolve(file));return{path:p,sha256:hash(fs.readFileSync(file))};})};
}
export async function runOperationalDriver(args) {
  assert.equal(process.versions.node,'22.23.3');assert(!process.env.NODE_OPTIONS&&!process.env.NODE_PATH,'ambient Node injection refused');
  const {mode,options}=parseDriverArguments(args),dossier=JSON.parse(readPrivateFile(options['--dossier'])),jiraBytes=readPrivateFile(options['--jira-evidence'],65536);
  validateLocalProbePayload(dossier,file=>fs.readFileSync(path.join(LOCAL,file)));
  const source=localSource();assert.deepEqual(source.files.map(f=>f.path),DRIVER_INPUTS);
  const github=createOfficialGithubReader();
  assert(path.isAbsolute(options['--journal-dir']));
  const directory=fs.realpathSync(options['--journal-dir']);assert.equal(directory,path.resolve(options['--journal-dir']));assert(!fs.lstatSync(directory).isSymbolicLink());assert(!directory.startsWith(ROOT+path.sep),'journal must be outside source checkout');
  const action={verify:'VERIFY','create-job':'CREATE_JOB','observe-create':'OBSERVE_CREATE',run:'DISPATCH','observe-run':'OBSERVE_RUN'}[mode];
  let authority;
  const fetchImpl=createAuthorityBoundFetch({fetchImpl:fetch,getAuthority:()=>authority});
  async function authorizeFresh(){assert.deepEqual(localSource(),source,'local protected driver source drift');authority=await authorizeProbeDriver({github,objectiveId:options['--objective-id'],dossier,jiraBytes,localSource:source,action});assert.equal(authority.entry.journalDirectorySha256,hash(directory),'reviewed durable journal location required');assert.deepEqual(localSource(),source,'local driver changed during authority collection');assertAuthorityCurrent(authority,Date.now());return authority;}
  await authorizeFresh();
  if(mode==='verify')return{state:'AUTHORITY_AND_LOCAL_PAYLOAD_VERIFIED',objectiveId:options['--objective-id'],dossierSha256:digest(dossier),nativeExecutionQualified:false,businessMutationAuthorized:false,canRetry:false};
  const accessToken=createOfficialAccessToken({account:authority.entry.googleAccount,gcloudPath:'C:/Program Files (x86)/Google/Cloud SDK/google-cloud-sdk/lib/gcloud.py',pythonPath:'C:/Program Files (x86)/Google/Cloud SDK/google-cloud-sdk/platform/bundledpython/python.exe'});
  const creation=openCreationJournal({directory,jobName:dossier.objective.jobName,dossierSha256:digest(dossier),initialize:options['--initialize-create']==='yes'});
  let executor;
  try {
    const transport=createJobCreationTransport({dossier,accessToken,fetchImpl});
    if(mode==='create-job')return await createJobOnce({dossier,authorizeFresh,transport,journal:creation});
    if(mode==='observe-create'){await authorizeFresh();return await observeJobCreation({dossier,transport,journal:creation});}
    const saved=creation.inspect();assert.equal(saved?.state,'NATIVE_JOB_RECONCILED','created native job receipt required');
    const native=createHttpContract({exchange:createBoundedExchange({accessToken,fetchImpl})});
    async function runAuthority(){await authorizeFresh();const job=await native.getJob(dossier.objective.jobName);validateNativeJob(job,dossier.objective);assert.equal(job.uid,saved.receipt.uid,'created native UID changed');}
    executor=createProbeExecutor({objective:dossier.objective,authorizeFresh:runAuthority,accessToken,journalDirectory:directory,initialize:options['--initialize-run']==='yes',fetchImpl});
    if(mode==='run')return await executor.dispatch();
    await runAuthority();return await executor.observe();
  }finally{executor?.close();creation.close();}
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
  try{const result=await runOperationalDriver(process.argv.slice(2));process.stdout.write(JSON.stringify({schemaVersion:1,state:result.state,canRetry:false,businessMutationAuthorized:false,nativePreservationOutputAcquired:false})+'\n');}
  catch{process.stderr.write(JSON.stringify({state:'REFUSED',code:'PROBE_OPERATIONAL_DRIVER_GUARD',canRetry:false})+'\n');process.exitCode=1;}
}
