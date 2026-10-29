import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {convertPowerShellCoverage} from './powershell-command-coverage.mjs';
import {noticeTestSource,validateNoticePlannerEvidence} from './windows-installer-evidence.mjs';

export const fixtureSourcePaths=Object.freeze([
  'scripts/telephony-agent/install-windows-agent.ps1','scripts/telephony-agent/installer-transactions.psm1',
  'scripts/telephony-agent/package-windows-agent.ps1','scripts/telephony-agent/package-notices.psm1',
  'scripts/telephony-agent/test-installer-transactions.ps1',
]);
export const fixtureCaseIds=Object.freeze(['fresh-off','upgrade-off','rollback-off','uninstall','explicit-uninstall-repeat-not-interruption-proof','new-cycle-fresh-off','upgrade-on','final-uninstall']);
export const probeSourcePath='scripts/telephony-agent/tests/child-exit-semantics.ps1';
const harnessPath='scripts/telephony-agent/tests/windows-installer.integration.ps1';
const guardPath='scripts/telephony-agent/tests/windows-fixture-guards.psm1';
export const fixtureGitExecutable=String.raw`C:\Program Files\Git\cmd\git.exe`;
const interpreter=String.raw`C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`;
const modulePath=String.raw`C:\Windows\System32\WindowsPowerShell\v1.0\Modules`;
const frameworkRoot=String.raw`C:\Program Files\WindowsPowerShell\Modules\Pester\3.4.0`;
const w=path.win32,digest=b=>createHash('sha256').update(b).digest('hex');
const requireValue=(ok,code)=>{if(!ok)throw new Error('WINDOWS_FIXTURE_'+code);};
const sha40=v=>typeof v==='string'&&/^[a-f0-9]{40}$/u.test(v)&&v!=='0'.repeat(40);
const identity=v=>typeof v==='string'&&/^[1-9]\d{0,19}$/u.test(v);

/** Validates recorded facts only; NOT authentication of a GitHub runner. */
export function selectFixtureContext(facts){
  requireValue(facts?.platform==='win32'&&facts.actions==='true'&&facts.runnerEnvironment==='github-hosted'&&facts.runnerOs==='Windows'&&facts.runnerArch==='X64','HOST_REQUIRED');
  requireValue(facts.repository==='shademounir/CrmYnov'&&facts.owner==='shademounir'&&facts.actor==='shademounir','OWNER_REQUIRED');
  requireValue(identity(facts.runId)&&identity(facts.runAttempt),'RUN_IDENTITY');
  const event=facts.event;let head;
  if(facts.eventName==='pull_request'){
    const pr=event?.pull_request;
    requireValue(pr?.head?.repo?.fork===false&&pr.head.repo.full_name===facts.repository&&pr.base?.repo?.full_name===facts.repository,'PR_REPOSITORY');
    requireValue(['develop','main'].includes(pr.base.ref),'PR_BASE');head=pr.head.sha;
  }else{
    requireValue(facts.eventName==='push'&&facts.ref==='refs/heads/main'&&event?.ref==='refs/heads/main'&&event.deleted===false,'PUSH_REF');
    requireValue(event.repository?.full_name===facts.repository&&event.repository.owner?.login===facts.owner,'PUSH_REPOSITORY');
    head=event.after;requireValue(head===facts.workflowSha,'PUSH_SOURCE');
  }
  requireValue(sha40(head)&&head===facts.checkoutHead&&sha40(facts.tree),'CHECKOUT_SOURCE');
  for(const p of [facts.workspace,facts.runnerTemp])requireValue(typeof p==='string'&&/^[A-Za-z]:[\\/]/u.test(p)&&!/[\r\n\0]/u.test(p)&&!p.replaceAll('\\','/').split('/').includes('..'),'ROOT_PATH');
  const workspace=w.normalize(facts.workspace).toLowerCase(),temp=w.normalize(facts.runnerTemp).toLowerCase();
  requireValue(workspace!==temp&&!workspace.startsWith(temp+w.sep)&&!temp.startsWith(workspace+w.sep),'ROOTS_NOT_SEPARATE');
  return{head,tree:facts.tree,runId:facts.runId,runAttempt:facts.runAttempt,workspace:w.normalize(facts.workspace),runnerTemp:w.normalize(facts.runnerTemp),eventName:facts.eventName,workflowSha:facts.workflowSha,officialEvidenceAuthenticated:false};
}
export function fixturePaths(context,nonce){
  requireValue(/^[a-f0-9]{32}$/u.test(nonce),'NONCE');
  return{work:w.join(context.runnerTemp,'crmy-fixture-producer-'+nonce),staging:w.join(context.runnerTemp,'crmy-fixture-artifact-'+nonce),probe:w.join(context.runnerTemp,'desktop-child-exit-probe-'+nonce),harness:w.join(context.runnerTemp,'crmy-desktop-windows-fixture-'+nonce)};
}
function jsonBytes(value){return Buffer.from(JSON.stringify(value,null,2)+'\n');}
function requiredJson(io,file){const b=io.read(file);requireValue(Buffer.isBuffer(b)&&b.length>0&&b.length<=16777216,'JSON_BOUND');try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(b));}catch{throw new Error('WINDOWS_FIXTURE_JSON_INVALID');}}
function source(io,context,relative){return io.read(w.join(context.workspace,relative));}
function hashFile(io,file){return digest(io.read(file));}
function nativeStep(io,plan,id,script,args,timeoutMs){
  io.writeNew(w.join(plan.work,id+'.INTENT.json'),jsonBytes({id,status:'INTENT_ONLY_OUTCOME_UNKNOWN_UNTIL_RESULT',script,timeoutMs,retry:0}));
  let result;try{result=io.invokePowerShell(script,args,timeoutMs);}catch{throw new Error('WINDOWS_FIXTURE_CHILD_UNKNOWN_NO_RETRY');}
  let status='FAILED';
  if(result?.errorCode||result?.signal){status='UNKNOWN';}
  else if(result?.exitCode===0){status='PASS';}
  io.writeNew(w.join(plan.work,id+'.RESULT.json'),jsonBytes({id,status,exitCode:result?.exitCode??null,signalPresent:Boolean(result?.signal),childMayStillBeRunning:status==='UNKNOWN',cleanupAttempted:false,retry:0}));
  requireValue(status==='PASS',status==='UNKNOWN'?'CHILD_UNKNOWN_NO_RETRY':'CHILD_FAILED_NO_RETRY');
}
export function validateFixtureReport(report,context,io,expectedReferences){
  requireValue(report?.head===context.head&&report.tree===context.tree&&report.runId===context.runId&&report.runAttempt===context.runAttempt,'REPORT_IDENTITY');
  requireValue(report.githubIdentityAuthenticatedByThisReport===false&&report.packagedExeTested===false&&report.actualHistorical0413UpgradeTested===false&&report.standardUserOrUacAcceptance===false&&report.sdkSipUserOrProductionAcceptance===false&&report.interruptedUninstallTested===false,'REPORT_LIMITS');
  requireValue(Array.isArray(report.testCases)&&report.testCases.length===fixtureCaseIds.length,'CASES');
  requireValue(report.testCases.every((c,index)=>c.id===fixtureCaseIds[index]&&c.status==='PASS'&&c.installerLeaseReleased===true),'CASES');
  requireValue(Array.isArray(report.inputReferences)&&report.inputReferences.length===5,'INPUT_REFERENCES');
  for(const [role,file] of Object.entries(expectedReferences)){
    const rows=report.inputReferences.filter(r=>r.role===role);requireValue(rows.length===1,'INPUT_REFERENCE_DUPLICATE');
    requireValue(w.normalize(rows[0].path).toLowerCase()===w.normalize(file).toLowerCase()&&rows[0].sha256Before===hashFile(io,file)&&rows[0].sha256After===rows[0].sha256Before,'INPUT_REFERENCE_HASH');
  }
  // Strict pure converter checks all original coordinates including zeros. Its
  // XML is not emitted here; the separately reviewed consumer owns CI import.
  convertPowerShellCoverage(report,relative=>source(io,context,relative));
  validateNoticePlannerEvidence(report.noticePlannerResult,relative=>source(io,context,relative));
}
const rootFiles=Object.freeze(['coverage-evidence.json','source-manifest.json','probe-evidence.json','framework-provenance.json','FIXTURE-INTENT.json']);
function artifactManifest(context,io,staging,names){
  const files=names.sort((a,b)=>a.localeCompare(b,'en')).map(name=>{requireValue(/^[A-Za-z0-9_.-]+\.json$/u.test(name)&&!name.includes('..'),'ARTIFACT_FILE');const bytes=io.read(w.join(staging,name));return{path:name,sha256:digest(bytes),bytes:bytes.length};});
  const manifest={schemaVersion:1,kind:'WINDOWS_INSTALLER_FIXTURE_EVIDENCE',head:context.head,tree:context.tree,runId:context.runId,runAttempt:context.runAttempt,files};
  const bytes=jsonBytes(manifest);io.writeNew(w.join(staging,'artifact-manifest.json'),bytes);return digest(bytes);
}
function copyJson(io,from,to){requiredJson(io,from);const bytes=io.read(from);io.writeNew(to,bytes);requireValue(io.read(to).equals(bytes),'ARTIFACT_COPY_CHANGED');}
function originsFor(plan){
  const origins={'coverage-evidence.json':w.join(plan.harness,'coverage-evidence.json'),'source-manifest.json':w.join(plan.work,'source-manifest.json'),'probe-evidence.json':w.join(plan.work,'probe-evidence.json'),'framework-provenance.json':w.join(plan.harness,'framework-provenance.json'),'FIXTURE-INTENT.json':w.join(plan.harness,'FIXTURE-INTENT.json')};
  for(const id of fixtureCaseIds)for(const suffix of ['INTENT','RESULT'])origins[id+'.'+suffix+'.json']=w.join(plan.harness,id+'.'+suffix+'.json');
  return origins;
}
function retainFailureMetadata(io,plan){
  const retained=[];let metadataExportRefusals=0;
  for(const [name,from] of Object.entries(originsFor(plan))){
    if(io.exists(from)&&!io.exists(w.join(plan.staging,name))){
      try{copyJson(io,from,w.join(plan.staging,name));retained.push(name);}
      catch{metadataExportRefusals++;}
    }else if(io.exists(w.join(plan.staging,name))){retained.push(name);}
  }
  return{retained,metadataExportRefusals};
}
function completedArtifact(io,plan,context){
  const origins=originsFor(plan);
  requireValue(Object.keys(origins).length===rootFiles.length+fixtureCaseIds.length*2,'ARTIFACT_INVENTORY');
  for(const id of fixtureCaseIds){
    const intent=requiredJson(io,origins[id+'.INTENT.json']),result=requiredJson(io,origins[id+'.RESULT.json']);
    requireValue(intent.id===id&&intent.head===context.head&&intent.status==='INTENT_ONLY_OUTCOME_UNKNOWN_UNTIL_RESULT'&&result.id===id&&result.status==='PASS'&&result.installerLeaseReleased===true,'CASE_ARTIFACT');
  }
  for(const [name,from] of Object.entries(origins))copyJson(io,from,w.join(plan.staging,name));
  return{manifestSha:artifactManifest(context,io,plan.staging,Object.keys(origins)),reportSha:hashFile(io,w.join(plan.staging,'coverage-evidence.json'))};
}

/** IO is injected for pure unit tests. Actual CLI supplies only closed native IO. */
export function produceFixtureEvidence(context,io,nonce){
  const plan=fixturePaths(context,nonce);io.assertCheckout(context);
  io.mkdirNew(plan.work);io.mkdirNew(plan.staging);
  io.outputs({'artifact-path':plan.staging,head:context.head,tree:context.tree});
  io.writeNew(w.join(plan.work,'PRODUCER-INTENT.json'),jsonBytes({head:context.head,tree:context.tree,runId:context.runId,runAttempt:context.runAttempt,status:'INTENT_ONLY_NOT_AUTHENTICATION',noRetry:true}));
  let phase='SOURCE';
  try{
    const sourceManifest={schemaVersion:1,head:context.head,tree:context.tree,runId:context.runId,runAttempt:context.runAttempt,sources:fixtureSourcePaths.map(relative=>({path:relative,sha256:digest(source(io,context,relative))}))};
    const manifestPath=w.join(plan.work,'source-manifest.json');io.writeNew(manifestPath,jsonBytes(sourceManifest));
    const boundPaths=[...fixtureSourcePaths.map(p=>w.join(context.workspace,p)),w.join(context.workspace,harnessPath),w.join(context.workspace,guardPath),w.join(context.workspace,noticeTestSource)];
    const sourceHashes=boundPaths.map(file=>hashFile(io,file));
    const frameworkBefore=io.frameworkSnapshot();
    requireValue(Array.isArray(frameworkBefore)&&frameworkBefore.length>0&&frameworkBefore.length<=1000,'FRAMEWORK_BOUND');
    const probePath=w.join(context.workspace,probeSourcePath),probeHash=hashFile(io,probePath),exeHash=hashFile(io,interpreter);
    phase='PROBE';nativeStep(io,plan,'probe',probePath,['-OutputDirectory',plan.probe],60000);
    const record=requiredJson(io,w.join(plan.probe,'RESULT.json'));
    requireValue(record.schemaVersion===1&&record.status==='PASS'&&record.parentContinued===true&&record.childExitCode===0&&Number.isSafeInteger(record.childBreakpointHits)&&record.childBreakpointHits>0&&record.syntheticOnly===true&&record.installerExecuted===false&&record.registryOrSdkUsed===false,'PROBE_NOT_PASS');
    requireValue(record.probeSourceSha256===probeHash&&record.interpreterSha256===exeHash&&hashFile(io,probePath)===probeHash&&hashFile(io,interpreter)===exeHash,'PROBE_SOURCE_CHANGED');
    const probeEvidence={schemaVersion:1,record,runId:context.runId,runAttempt:context.runAttempt,sourceAndInterpreterBeforeAfterVerified:true,references:[{path:probePath,sha256:probeHash},{path:interpreter,sha256:exeHash}],officialEvidenceAuthenticated:false};
    const probeEvidencePath=w.join(plan.work,'probe-evidence.json');io.writeNew(probeEvidencePath,jsonBytes(probeEvidence));
    phase='HARNESS';nativeStep(io,plan,'harness',w.join(context.workspace,harnessPath),['-ExpectedHead',context.head,'-ExpectedTree',context.tree,'-SourceManifest',manifestPath,'-ExitProbeEvidence',probeEvidencePath,'-ExitProbeSource',probePath,'-OutputDirectory',plan.harness],600000);
    const report=requiredJson(io,w.join(plan.harness,'coverage-evidence.json'));
    validateFixtureReport(report,context,io,{SOURCE_MANIFEST:manifestPath,EXIT_PROBE_EVIDENCE:probeEvidencePath,EXIT_PROBE_SOURCE:probePath,POWERSHELL_INTERPRETER:interpreter,TEST_TOOLING_GUARD:w.join(context.workspace,guardPath)});
    const frameworkPath=w.join(plan.harness,'framework-provenance.json'),framework=requiredJson(io,frameworkPath);
    requireValue(framework.version==='3.4.0'&&Array.isArray(framework.files)&&framework.files.length>0&&framework.payloadAuthenticatedByThisReport===false,'FRAMEWORK_PROVENANCE');
    requireValue(report.frameworkProvenanceSha256===hashFile(io,frameworkPath),'FRAMEWORK_HASH');
    const canonicalFramework=rows=>JSON.stringify(rows.map(r=>({path:r.path,sha256:r.sha256})).sort((a,b)=>a.path.localeCompare(b.path,'en')));
    requireValue(canonicalFramework(frameworkBefore)===canonicalFramework(io.frameworkSnapshot())&&canonicalFramework(framework.files)===canonicalFramework(frameworkBefore),'FRAMEWORK_CHANGED');
    requireValue(boundPaths.every((file,index)=>hashFile(io,file)===sourceHashes[index]),'SOURCE_BYTES_CHANGED');
    io.assertCheckout(context);
    const {manifestSha,reportSha}=completedArtifact(io,plan,context);
    io.outputs({'report-sha256':reportSha,'manifest-sha256':manifestSha});
    io.writeNew(w.join(plan.work,'PRODUCER-RESULT.json'),jsonBytes({status:'PASS',head:context.head,tree:context.tree,runId:context.runId,runAttempt:context.runAttempt,reportSha256:reportSha,manifestSha256:manifestSha,nativeOrGithubIdentityAuthenticatedByProducer:false}));
    return{staging:plan.staging,head:context.head,tree:context.tree,reportSha256:reportSha,manifestSha256:manifestSha};
  }catch(error){
    // No broad copy, cleanup, retry or stdout/stderr export. An INTENT without
    // RESULT remains UNKNOWN. Even if timeouts signal an owned child, its stop
    // and installed state are not thereby proven; the VM must be reconciled.
    const code=error instanceof Error&&/^WINDOWS_FIXTURE_[A-Z0-9_]+$/u.test(error.message)?error.message:'WINDOWS_FIXTURE_IO_FAILURE_NO_RETRY';
    const {retained,metadataExportRefusals}=retainFailureMetadata(io,plan);
    const diagnostic={status:code.includes('UNKNOWN')?'UNKNOWN':'FAILED',phase,code,head:context.head,tree:context.tree,runId:context.runId,runAttempt:context.runAttempt,cleanupAttempted:false,retry:0,metadataExportRefusals};
    io.writeNew(w.join(plan.staging,'producer-diagnostic.json'),jsonBytes(diagnostic));
    if(!io.exists(w.join(plan.staging,'artifact-manifest.json')))artifactManifest(context,io,plan.staging,[...retained,'producer-diagnostic.json']);
    throw new Error(code);
  }
}

function safeFile(file){const stat=fs.lstatSync(file);requireValue(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<=16777216,'FILE_BOUND');return fs.readFileSync(file);}
function ensureAncestors(file){
  let current=w.resolve(file);
  while(current){
    if(fs.existsSync(current)){requireValue(!fs.lstatSync(current).isSymbolicLink(),'REPARSE_REFUSED');}
    const parent=w.dirname(current);
    if(parent===current){break;}
    current=parent;
  }
}
function writeExclusive(file,bytes){ensureAncestors(file);const fd=fs.openSync(file,'wx');try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
export function fixedFixtureEnvironment(environment){
  const env=Object.fromEntries(Object.entries(environment).filter(([key])=>key.toUpperCase()!=='PATH'));
  env.PATH=String.raw`C:\Program Files\Git\cmd;C:\Windows\System32;C:\Windows`;
  return env;
}
function nativeIO(context,environment){
  const toolEnvironment=fixedFixtureEnvironment(environment);
  function readGit(args){const r=spawnSync(fixtureGitExecutable,['-C',context.workspace,...args],{encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:1048576,env:toolEnvironment});requireValue(!r.error&&r.status===0,'GIT_READ_FAILED');return r.stdout.trim();}
  return{
    frameworkSnapshot:()=>{
      const rows=[];let entries=0;ensureAncestors(frameworkRoot);
      const visit=(dir,depth=0)=>{requireValue(depth<=20,'FRAMEWORK_DEPTH');for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
        requireValue(++entries<=2000,'FRAMEWORK_BOUND');
        const file=w.join(dir,entry.name);requireValue(!entry.isSymbolicLink(),'FRAMEWORK_REPARSE');
        if(entry.isDirectory())visit(file,depth+1);else{requireValue(entry.isFile()&&rows.length<1000,'FRAMEWORK_BOUND');rows.push({path:w.relative(frameworkRoot,file).replaceAll('\\','/'),sha256:digest(safeFile(file))});}
      }};visit(frameworkRoot);return rows;
    },
    exists:file=>fs.existsSync(file),
    read:file=>{ensureAncestors(file);return safeFile(file);},
    mkdirNew:dir=>{requireValue(w.dirname(dir).toLowerCase()===context.runnerTemp.toLowerCase(),'OUTPUT_ROOT');ensureAncestors(dir);requireValue(!fs.existsSync(dir),'OUTPUT_EXISTS');fs.mkdirSync(dir);},
    writeNew:writeExclusive,
    assertCheckout:ctx=>{requireValue(readGit(['rev-parse','HEAD'])===ctx.head&&readGit(['rev-parse','HEAD^{tree}'])===ctx.tree&&readGit(['status','--porcelain','--untracked-files=all'])==='','CHECKOUT_CHANGED');},
    outputs:values=>{const output=environment.GITHUB_OUTPUT;requireValue(typeof output==='string'&&w.isAbsolute(output),'GITHUB_OUTPUT_PATH');const relative=w.relative(context.runnerTemp,output);requireValue(relative!==''&&!w.isAbsolute(relative)&&relative.split(w.sep)[0]!=='..','GITHUB_OUTPUT_PATH');ensureAncestors(output);for(const [key,value] of Object.entries(values)){requireValue(['artifact-path','head','tree','report-sha256','manifest-sha256'].includes(key)&&typeof value==='string'&&!/[\r\n\0]/u.test(value),'OUTPUT_VALUE');fs.appendFileSync(output,key+'='+value+'\n');}},
    invokePowerShell:(script,args,timeoutMs)=>{
      const childEnv={...toolEnvironment,PSModulePath:modulePath};
      const r=spawnSync(interpreter,['-NoProfile','-File',script,...args],{windowsHide:true,timeout:timeoutMs,maxBuffer:1048576,encoding:'utf8',env:childEnv});
      return{exitCode:r.status,signal:r.signal,errorCode:r.error?.code??null};
    },
  };
}
function cli(){
  requireValue(process.argv.length===3&&process.argv[2]==='produce','CLI_MODE');
  const env=process.env;
  requireValue(process.platform==='win32'&&env.GITHUB_ACTIONS==='true'&&env.RUNNER_ENVIRONMENT==='github-hosted'&&env.RUNNER_OS==='Windows','HOST_REQUIRED');
  requireValue(!Object.keys(env).some(k=>/^GIT_(DIR|WORK_TREE|INDEX_FILE|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|CONFIG.*)$/iu.test(k)),'GIT_ENV_OVERRIDE');
  const event=JSON.parse(safeFile(env.GITHUB_EVENT_PATH).toString('utf8'));
  const workspace=env.GITHUB_WORKSPACE;requireValue(typeof workspace==='string'&&w.isAbsolute(workspace),'WORKSPACE');
  const git=args=>{const r=spawnSync(fixtureGitExecutable,['-C',workspace,...args],{encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:1048576,env:fixedFixtureEnvironment(env)});requireValue(!r.error&&r.status===0,'GIT_READ_FAILED');return r.stdout.trim();};
  const context=selectFixtureContext({platform:process.platform,actions:env.GITHUB_ACTIONS,runnerEnvironment:env.RUNNER_ENVIRONMENT,runnerOs:env.RUNNER_OS,runnerArch:env.RUNNER_ARCH,repository:env.GITHUB_REPOSITORY,owner:env.GITHUB_REPOSITORY_OWNER,actor:env.GITHUB_ACTOR,eventName:env.GITHUB_EVENT_NAME,event,ref:env.GITHUB_REF,workflowSha:env.GITHUB_SHA,runId:env.GITHUB_RUN_ID,runAttempt:env.GITHUB_RUN_ATTEMPT,workspace,runnerTemp:env.RUNNER_TEMP,checkoutHead:git(['rev-parse','HEAD']),tree:git(['rev-parse','HEAD^{tree}'])});
  produceFixtureEvidence(context,nativeIO(context,env),randomUUID().replaceAll('-',''));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{cli();}catch(error){console.error(error instanceof Error&&/^WINDOWS_FIXTURE_[A-Z0-9_]+$/u.test(error.message)?error.message:'WINDOWS_FIXTURE_PRODUCER_FAILED');process.exitCode=1;}
}
