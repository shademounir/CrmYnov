// Explicit CLI. No default objective, credentials in files, native call or mutation.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {byteHash,digest} from './controlled-pool-contract-v1.mjs';
import {authorizeReadOnlyDriver} from './pool-driver-authority-v1.mjs';
import {validateLocalReadOnlyDossier} from './pool-job-dossier-v1.mjs';
import {createReadOnlyNativeTransport,openReadOnlyTransactionJournal,dispatchReadOnlyOnce,observeReadOnlyOperation} from './pool-native-transaction-v1.mjs';
import {createReadOnlyOutputReader} from './pool-output-reader-v1.mjs';
import {reconcileVerifiedPoolOutput} from './pool-observation-reconciliation-v1.mjs';
import {createOfficialGithubReader,fixedToolEnvironment} from '../readonly-probe/probe-driver-github-v1.mjs';
import {createOfficialAccessToken} from '../readonly-probe/rc47-probe-official-auth-v1.mjs';
import {DRIVER_INPUTS as PRIOR_DRIVER_INPUTS} from '../readonly-probe/probe-operational-driver-v1.mjs';
import {assertAuthorityCurrent} from '../readonly-probe/probe-driver-authority-v1.mjs';
const ROOT=path.resolve(import.meta.dirname,'../../..');
export const POOL_OFFICIAL_GIT=String.raw`C:\Program Files\Git\cmd\git.exe`;
const own=['general-preservation-read-only-collector-v1.mjs','schema-ledger-read-only-collector-v1.mjs','readonly-output-codec-v1.mjs','readonly-runtime-entry-v1.mjs','readonly-runtime-bundle-v1.mjs','controlled-pool-contract-v1.mjs','pool-read-only-collector-v1.mjs','pool-sealed-output-v1.mjs','pool-runtime-entry-v1.mjs','pool-runtime-bundle-v1.mjs','pool-native-output-v1.mjs','pool-job-dossier-v1.mjs','pool-native-transaction-v1.mjs','pool-driver-authority-v1.mjs','pool-output-reader-v1.mjs','pool-observation-reconciliation-v1.mjs','pool-operational-driver-v1.mjs'];
export const POOL_DRIVER_INPUTS=Object.freeze([...new Set([...PRIOR_DRIVER_INPUTS,...own.map(n=>'scripts/ci/pool-reconciliation/'+n),'scripts/pr-policy/github-code-review.mjs','docs/governance/github-code-review-policy.json'])].sort((a,b)=>a.localeCompare(b,'en')));
export function readPoolPrivateFile(file,max=1048576){
  assert(path.isAbsolute(file));assert(!fs.lstatSync(file).isSymbolicLink());assert.equal(fs.realpathSync(file),path.resolve(file));
  const fd=fs.openSync(file,'r');try{const st=fs.fstatSync(fd);assert(st.isFile()&&st.size<=max);const bytes=fs.readFileSync(fd);assert(bytes.length<=max);return bytes;}finally{fs.closeSync(fd);}
}
export function parseReadOnlyDriverArguments(args){
  const mode=args[0];assert(['verify','create-job','observe-create','run','observe-run','read-output'].includes(mode));
  const options={};for(let i=1;i<args.length;i+=2){const key=args[i];assert(['--purpose','--objective-id','--dossier','--jira-evidence','--journal-dir','--initialize','--private-key','--independent-inputs','--intent','--prior-proof','--output-dir'].includes(key));assert(!Object.hasOwn(options,key));assert.equal(typeof args[i+1],'string');options[key]=args[i+1];}
  for(const key of ['--objective-id','--dossier','--jira-evidence','--journal-dir'])assert(options[key]);
  if(Object.hasOwn(options,'--initialize')){assert.equal(mode,'create-job');assert.equal(options['--initialize'],'yes');}
  if(Object.hasOwn(options,'--purpose'))assert(['POOL_RECONCILIATION_READ_ONLY_V1','GENERAL_PRESERVATION_READ_ONLY_V1','SCHEMA_LEDGER_READ_ONLY_V1'].includes(options['--purpose']),'EXPLICIT_READONLY_PURPOSE');
  const outputKeys=['--private-key','--independent-inputs','--intent','--prior-proof','--output-dir'];
  if(mode==='read-output'){const nonPool=options['--purpose']&&options['--purpose']!=='POOL_RECONCILIATION_READ_ONLY_V1';for(const key of (nonPool?['--private-key','--output-dir']:outputKeys.filter(k=>k!=='--prior-proof')))assert(options[key]);if(nonPool)assert(['--independent-inputs','--intent','--prior-proof'].every(k=>!Object.hasOwn(options,k)),'POOL_INPUTS_NOT_GENERAL_AUTHORITY');}
  else assert(outputKeys.every(k=>!Object.hasOwn(options,k)));
  return {mode,options};
}
export function buildReadOnlyObservationClaimReceipt({verified,authority,dossier,source,saved}){
  assert(['GENERAL_PRESERVATION_READ_ONLY_V1','SCHEMA_LEDGER_READ_ONLY_V1'].includes(dossier.objective.purpose));assert.equal(source.commit,authority.receipt.driverCommit,'PROTECTED_DRIVER_BINDING');
  assert.equal(verified?.officialReadPathExecuted,true);assert.equal(verified?.sourceBoundClaimsChecked,true);assert.equal(verified.nativeAcceptance,false);assert.equal(authority.entry.scope,dossier.objective.purpose);assert.equal(authority.entry.dossierSha256,digest(dossier));assert.equal(verified.output.observation.purpose,dossier.objective.purpose);assert.equal(verified.job.uid,saved.uid);assert.equal(verified.output.runtime.execution,saved.execution);assert(typeof source.commit==='string'&&/^[a-f0-9]{40}$/u.test(source.commit));
  const purpose=dossier.objective.purpose;
  const o=verified.output.observation,proof={schemaVersion:1,kind:'SOURCE_BOUND_READONLY_OBSERVATION_CLAIMS_NOT_SEMANTIC_ACCEPTANCE',purpose,phase:o.phase,driverCommit:source.commit,authorityRevision:authority.receipt.authorityRevision,dossierSha256:authority.entry.dossierSha256,job:verified.job.name,jobUid:verified.job.uid,execution:saved.execution,metadataSha256:verified.metadataSha256,sealedOutputSha256:verified.sealedOutputSha256,sourceSha256:verified.output.sourceSha256,databaseBindingSha256:verified.output.databaseBindingSha256,identity:o.identity,transactionStartedAt:o.transactionStartedAt,transactionCompletedAt:o.transactionCompletedAt,snapshotSha256:digest(o.snapshot),snapshotDigestAlgorithm:'CONTROLLED_CANONICAL_CODEPOINT_SHA256_V1',collectorSnapshotSha256:o.snapshotSha256??null,ledgerSha256:o.ledgerSha256??null,schemaSurfaceSha256:o.schemaSurfaceSha256??null,officialReadPathExecuted:verified.officialReadPathExecuted,sourceBoundClaimsChecked:true,sameSnapshotAsOtherPurpose:false,nativeEvidenceAuthenticated:false,nativeAcceptance:false,fullProductionPreflight:false,schemaCompatibilityProved:false,historicalRawPoolHashRecovered:false,activationAuthorized:false};
  return proof;
}
function localSource(){
  assert.equal(process.platform,'win32','WINDOWS_OPERATOR_REQUIRED');
  assert(path.win32.isAbsolute(POOL_OFFICIAL_GIT));
  assert.equal(fs.realpathSync(POOL_OFFICIAL_GIT),path.win32.normalize(POOL_OFFICIAL_GIT),'CANONICAL_OFFICIAL_GIT_REQUIRED');
  assert(fs.statSync(POOL_OFFICIAL_GIT).isFile()&&!fs.lstatSync(POOL_OFFICIAL_GIT).isSymbolicLink());
  assert(!Object.keys(process.env).some(k=>/^GIT_/iu.test(k)),'AMBIENT_GIT_OVERRIDE');
  const env=fixedToolEnvironment(process.env);
  const git=(...args)=>execFileSync(POOL_OFFICIAL_GIT,['-C',ROOT,...args],{encoding:'utf8',windowsHide:true,timeout:15000,maxBuffer:1048576,env}).trim();
  assert.equal(git('status','--porcelain','--untracked-files=all'),'');
  return {commit:git('rev-parse','HEAD'),tree:git('rev-parse','HEAD^{tree}'),clean:true,files:POOL_DRIVER_INPUTS.map(p=>({path:p,sha256:byteHash(readPoolPrivateFile(path.join(ROOT,p)))}))};
}
function canonicalDirectory(p){assert(path.isAbsolute(p));const resolved=fs.realpathSync(p);assert.equal(resolved,path.resolve(p));assert(fs.statSync(p).isDirectory());assert(!fs.lstatSync(p).isSymbolicLink());const relative=path.relative(ROOT,resolved);assert(relative.startsWith('..'+path.sep)||path.isAbsolute(relative),'JOURNAL_OUTSIDE_SOURCE');return resolved;}
export async function runReadOnlyOperationalDriver(args,{requiredPurpose}={}){
  assert.equal(process.versions.node,'22.23.3');assert(!process.env.NODE_OPTIONS&&!process.env.NODE_PATH);
  const {mode,options}=parseReadOnlyDriverArguments(args),dossier=JSON.parse(readPoolPrivateFile(options['--dossier'])),jiraBytes=readPoolPrivateFile(options['--jira-evidence'],65536);
  const purpose=dossier.objective?.purpose;
  if(requiredPurpose)assert.equal(purpose,requiredPurpose);
  if(purpose!=='POOL_RECONCILIATION_READ_ONLY_V1')assert.equal(options['--purpose'],purpose,'EXPLICIT_PURPOSE_REQUIRED');
  if(options['--purpose'])assert.equal(options['--purpose'],purpose,'PURPOSE_ARGUMENT_BINDING');
  validateLocalReadOnlyDossier(dossier,p=>fs.readFileSync(path.join(import.meta.dirname,p)));
  const source=localSource(),directory=canonicalDirectory(options['--journal-dir']),github=createOfficialGithubReader();let authority;
  const action={verify:'VERIFY','create-job':'CREATE','observe-create':'OBSERVE_CREATE',run:'RUN','observe-run':'OBSERVE_RUN','read-output':'READ_OUTPUT'}[mode];
  async function authorizeFresh(){assert.deepEqual(localSource(),source,'LOCAL_SOURCE_DRIFT');authority=await authorizeReadOnlyDriver({github,objectiveId:options['--objective-id'],dossier,jiraBytes,localSource:source,action});assert.equal(authority.entry.journalDirectorySha256,byteHash(directory));assert.deepEqual(localSource(),source);assertAuthorityCurrent(authority,Date.now());return authority;}
  await authorizeFresh();if(mode==='verify')return {state:purpose==='POOL_RECONCILIATION_READ_ONLY_V1'?'POOL_AUTHORITY_AND_LOCAL_PAYLOAD_VERIFIED':'READONLY_AUTHORITY_AND_LOCAL_PAYLOAD_VERIFIED',canRetry:false,nativeAcceptance:false,activationAuthorized:false};
  const accessToken=createOfficialAccessToken({account:authority.entry.googleAccount,gcloudPath:'C:/Program Files (x86)/Google/Cloud SDK/google-cloud-sdk/lib/gcloud.py',pythonPath:'C:/Program Files (x86)/Google/Cloud SDK/google-cloud-sdk/platform/bundledpython/python.exe'});
  const transport=createReadOnlyNativeTransport({purpose,accessToken,getAuthority:()=>authority});
  const journal=openReadOnlyTransactionJournal({directory,objective:dossier.objective,initialize:options['--initialize']==='yes'});
  try{
    if(mode==='create-job'||mode==='run')return await dispatchReadOnlyOnce({dossier,stage:mode==='create-job'?'CREATE':'RUN',authorizeFresh,transport,journal});
    if(mode==='observe-create'||mode==='observe-run'){await authorizeFresh();return await observeReadOnlyOperation({objective:dossier.objective,stage:mode==='observe-create'?'CREATE':'RUN',transport,journal});}
    const saved=journal.inspect('RUN');assert.equal(saved?.state,'RECONCILED','KNOWN_RECONCILED_EXECUTION_REQUIRED');
    const outputDirectory=canonicalDirectory(options['--output-dir']);const save=async(name,value)=>fs.writeFileSync(path.join(outputDirectory,name+'.json'),JSON.stringify({at:new Date().toISOString(),...value},null,2)+'\n',{flag:'wx'});
    const reader=createReadOnlyOutputReader({accessToken,getAuthority:()=>authority});await authorizeFresh();
    const verified=await reader({dossier,execution:saved.execution,privateKeyPem:readPoolPrivateFile(options['--private-key'],16384).toString('utf8'),save});assert.equal(verified.job.uid,saved.uid);
    if(purpose!=='POOL_RECONCILIATION_READ_ONLY_V1'){
      const proof=buildReadOnlyObservationClaimReceipt({verified,authority,dossier,source,saved});
      assert.equal(proof.officialReadPathExecuted,true);await save('READONLY-OBSERVATION-CLAIMS',proof);return{state:proof.kind,proofSha256:digest(proof),canRetry:false,nativeAcceptance:false,activationAuthorized:false};
    }
    const result=reconcileVerifiedPoolOutput({verified,authority,dossier,intentBytes:readPoolPrivateFile(options['--intent'],65536),independentInputBytes:readPoolPrivateFile(options['--independent-inputs'],65536),priorProof:options['--prior-proof']?JSON.parse(readPoolPrivateFile(options['--prior-proof'],65536)):null,now:Date.now()});
    await save('POOL-RECONCILIATION',result);return {state:result.status,proofSha256:result.proofSha256,canRetry:false,nativeAcceptance:false,activationAuthorized:false};
  }finally{journal.close();}
}
export function parsePoolDriverArguments(args){const result=parseReadOnlyDriverArguments(args);if(result.options['--purpose'])assert.equal(result.options['--purpose'],'POOL_RECONCILIATION_READ_ONLY_V1');return result;}
export async function runPoolOperationalDriver(args){parsePoolDriverArguments(args);return runReadOnlyOperationalDriver(args,{requiredPurpose:'POOL_RECONCILIATION_READ_ONLY_V1'});}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
  try{const r=await runReadOnlyOperationalDriver(process.argv.slice(2));process.stdout.write(JSON.stringify({schemaVersion:1,state:r.state,canRetry:false,nativeAcceptance:false,activationAuthorized:false})+'\n');}
  catch{process.stderr.write(JSON.stringify({state:'REFUSED',code:'POOL_OPERATIONAL_GUARD',canRetry:false})+'\n');process.exitCode=1;}
}
