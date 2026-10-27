// Explicit CLI. No default objective, credentials in files, native call or mutation.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {byteHash} from './controlled-pool-contract-v1.mjs';
import {authorizePoolDriver} from './pool-driver-authority-v1.mjs';
import {validateLocalPoolDossier} from './pool-job-dossier-v1.mjs';
import {createPoolNativeTransport,openPoolTransactionJournal,dispatchPoolOnce,observePoolOperation} from './pool-native-transaction-v1.mjs';
import {createPoolOutputReader} from './pool-output-reader-v1.mjs';
import {reconcileVerifiedPoolOutput} from './pool-observation-reconciliation-v1.mjs';
import {createOfficialGithubReader,fixedToolEnvironment} from '../readonly-probe/probe-driver-github-v1.mjs';
import {createOfficialAccessToken} from '../readonly-probe/rc47-probe-official-auth-v1.mjs';
import {DRIVER_INPUTS as PRIOR_DRIVER_INPUTS} from '../readonly-probe/probe-operational-driver-v1.mjs';
import {assertAuthorityCurrent} from '../readonly-probe/probe-driver-authority-v1.mjs';
const ROOT=path.resolve(import.meta.dirname,'../../..');
const own=['controlled-pool-contract-v1.mjs','pool-read-only-collector-v1.mjs','pool-sealed-output-v1.mjs','pool-runtime-entry-v1.mjs','pool-runtime-bundle-v1.mjs','pool-native-output-v1.mjs','pool-job-dossier-v1.mjs','pool-native-transaction-v1.mjs','pool-driver-authority-v1.mjs','pool-output-reader-v1.mjs','pool-observation-reconciliation-v1.mjs','pool-operational-driver-v1.mjs'];
export const POOL_DRIVER_INPUTS=Object.freeze([...new Set([...PRIOR_DRIVER_INPUTS,...own.map(n=>'scripts/ci/pool-reconciliation/'+n)])].sort((a,b)=>a.localeCompare(b,'en')));
export function readPoolPrivateFile(file,max=1048576){
  assert(path.isAbsolute(file));assert(!fs.lstatSync(file).isSymbolicLink());assert.equal(fs.realpathSync(file),path.resolve(file));
  const fd=fs.openSync(file,'r');try{const st=fs.fstatSync(fd);assert(st.isFile()&&st.size<=max);const bytes=fs.readFileSync(fd);assert(bytes.length<=max);return bytes;}finally{fs.closeSync(fd);}
}
export function parsePoolDriverArguments(args){
  const mode=args[0];assert(['verify','create-job','observe-create','run','observe-run','read-output'].includes(mode));
  const options={};for(let i=1;i<args.length;i+=2){const key=args[i];assert(['--objective-id','--dossier','--jira-evidence','--journal-dir','--initialize','--private-key','--independent-inputs','--intent','--prior-proof','--output-dir'].includes(key));assert(!Object.hasOwn(options,key));assert.equal(typeof args[i+1],'string');options[key]=args[i+1];}
  for(const key of ['--objective-id','--dossier','--jira-evidence','--journal-dir'])assert(options[key]);
  if(Object.hasOwn(options,'--initialize')){assert.equal(mode,'create-job');assert.equal(options['--initialize'],'yes');}
  const outputKeys=['--private-key','--independent-inputs','--intent','--prior-proof','--output-dir'];
  if(mode==='read-output'){for(const key of outputKeys.filter(k=>k!=='--prior-proof'))assert(options[key]);}
  else assert(outputKeys.every(k=>!Object.hasOwn(options,k)));
  return {mode,options};
}
function localSource(){
  assert(!Object.keys(process.env).some(k=>/^GIT_/iu.test(k)),'AMBIENT_GIT_OVERRIDE');
  const env=fixedToolEnvironment(process.env);
  const git=(...args)=>execFileSync('C:/Program Files/Git/cmd/git.exe',['-C',ROOT,...args],{encoding:'utf8',windowsHide:true,timeout:15000,maxBuffer:1048576,env:{...env,PATH:'C:/Program Files/Git/cmd;C:/Program Files/Git/mingw64/bin;C:/Windows/System32;C:/Windows'}}).trim();
  assert.equal(git('status','--porcelain','--untracked-files=all'),'');
  return {commit:git('rev-parse','HEAD'),tree:git('rev-parse','HEAD^{tree}'),clean:true,files:POOL_DRIVER_INPUTS.map(p=>({path:p,sha256:byteHash(readPoolPrivateFile(path.join(ROOT,p)))}))};
}
function canonicalDirectory(p){assert(path.isAbsolute(p));const resolved=fs.realpathSync(p);assert.equal(resolved,path.resolve(p));assert(fs.statSync(p).isDirectory());assert(!fs.lstatSync(p).isSymbolicLink());const relative=path.relative(ROOT,resolved);assert(relative.startsWith('..'+path.sep)||path.isAbsolute(relative),'JOURNAL_OUTSIDE_SOURCE');return resolved;}
export async function runPoolOperationalDriver(args){
  assert.equal(process.versions.node,'22.23.3');assert(!process.env.NODE_OPTIONS&&!process.env.NODE_PATH);
  const {mode,options}=parsePoolDriverArguments(args),dossier=JSON.parse(readPoolPrivateFile(options['--dossier'])),jiraBytes=readPoolPrivateFile(options['--jira-evidence'],65536);
  validateLocalPoolDossier(dossier,p=>fs.readFileSync(path.join(import.meta.dirname,p)));
  const source=localSource(),directory=canonicalDirectory(options['--journal-dir']),github=createOfficialGithubReader();let authority;
  const action={verify:'VERIFY','create-job':'CREATE','observe-create':'OBSERVE_CREATE',run:'RUN','observe-run':'OBSERVE_RUN','read-output':'READ_OUTPUT'}[mode];
  async function authorizeFresh(){assert.deepEqual(localSource(),source,'LOCAL_SOURCE_DRIFT');authority=await authorizePoolDriver({github,objectiveId:options['--objective-id'],dossier,jiraBytes,localSource:source,action});assert.equal(authority.entry.journalDirectorySha256,byteHash(directory));assert.deepEqual(localSource(),source);assertAuthorityCurrent(authority,Date.now());return authority;}
  await authorizeFresh();if(mode==='verify')return {state:'POOL_AUTHORITY_AND_LOCAL_PAYLOAD_VERIFIED',canRetry:false,nativeAcceptance:false,activationAuthorized:false};
  const accessToken=createOfficialAccessToken({account:authority.entry.googleAccount,gcloudPath:'C:/Program Files (x86)/Google/Cloud SDK/google-cloud-sdk/lib/gcloud.py',pythonPath:'C:/Program Files (x86)/Google/Cloud SDK/google-cloud-sdk/platform/bundledpython/python.exe'});
  const transport=createPoolNativeTransport({accessToken,getAuthority:()=>authority});
  const journal=openPoolTransactionJournal({directory,objective:dossier.objective,initialize:options['--initialize']==='yes'});
  try{
    if(mode==='create-job'||mode==='run')return await dispatchPoolOnce({dossier,stage:mode==='create-job'?'CREATE':'RUN',authorizeFresh,transport,journal});
    if(mode==='observe-create'||mode==='observe-run'){await authorizeFresh();return await observePoolOperation({objective:dossier.objective,stage:mode==='observe-create'?'CREATE':'RUN',transport,journal});}
    const saved=journal.inspect('RUN');assert.equal(saved?.state,'RECONCILED','KNOWN_RECONCILED_EXECUTION_REQUIRED');
    const outputDirectory=canonicalDirectory(options['--output-dir']);const save=async(name,value)=>fs.writeFileSync(path.join(outputDirectory,name+'.json'),JSON.stringify({at:new Date().toISOString(),...value},null,2)+'\n',{flag:'wx'});
    const reader=createPoolOutputReader({accessToken,getAuthority:()=>authority});await authorizeFresh();
    const verified=await reader({dossier,execution:saved.execution,privateKeyPem:readPoolPrivateFile(options['--private-key'],16384).toString('utf8'),save});assert.equal(verified.job.uid,saved.uid);
    const result=reconcileVerifiedPoolOutput({verified,authority,dossier,intentBytes:readPoolPrivateFile(options['--intent'],65536),independentInputBytes:readPoolPrivateFile(options['--independent-inputs'],65536),priorProof:options['--prior-proof']?JSON.parse(readPoolPrivateFile(options['--prior-proof'],65536)):null,now:Date.now()});
    await save('POOL-RECONCILIATION',result);return {state:result.status,proofSha256:result.proofSha256,canRetry:false,nativeAcceptance:false,activationAuthorized:false};
  }finally{journal.close();}
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
  try{const r=await runPoolOperationalDriver(process.argv.slice(2));process.stdout.write(JSON.stringify({schemaVersion:1,state:r.state,canRetry:false,nativeAcceptance:false,activationAuthorized:false})+'\n');}
  catch{process.stderr.write(JSON.stringify({state:'REFUSED',code:'POOL_OPERATIONAL_GUARD',canRetry:false})+'\n');process.exitCode=1;}
}
