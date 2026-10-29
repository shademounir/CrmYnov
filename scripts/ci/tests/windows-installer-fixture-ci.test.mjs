import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fixtureSourcePaths,fixtureCaseIds,probeSourcePath,selectFixtureContext,fixturePaths,produceFixtureEvidence,fixedFixtureEnvironment,fixtureGitExecutable} from '../windows-installer-fixture-ci.mjs';
import {verifyWindowsFixtureArtifact,noticeTestSource,noticePlannerCases} from '../windows-installer-evidence.mjs';
const w=path.win32,h=b=>createHash('sha256').update(b).digest('hex'),bytes=v=>Buffer.from(JSON.stringify(v,null,2)+'\n');
const head='a'.repeat(40),tree='b'.repeat(40),nonce='1'.repeat(32);
test('fixture Git uses a canonical fixed absolute Windows executable without PATH resolution',()=>{
  assert.equal(fixtureGitExecutable,String.raw`C:\Program Files\Git\cmd\git.exe`);
  assert.equal(w.isAbsolute(fixtureGitExecutable),true);
  assert.equal(w.normalize(fixtureGitExecutable),fixtureGitExecutable);
  assert.equal(fixtureGitExecutable.includes('/'),false);
  assert.equal(w.normalize('C:/Program Files/Git/cmd/git.exe'),fixtureGitExecutable);
});
test('native fixture tools use only fixed system PATH directories without mutating the caller',()=>{
  const original={Path:'C:/synthetic-user-writable',PATH:'C:/synthetic-other',GITHUB_OUTPUT:'C:/synthetic-temp/output',SYNTHETIC_KEEP:'kept'};
  const before={...original},actual=fixedFixtureEnvironment(original);
  assert.deepEqual(original,before);
  assert.deepEqual(Object.keys(actual).filter(k=>k.toUpperCase()==='PATH'),['PATH']);
  assert.equal(actual.PATH,String.raw`C:\Program Files\Git\cmd;C:\Windows\System32;C:\Windows`);
  assert.equal(actual.GITHUB_OUTPUT,original.GITHUB_OUTPUT);assert.equal(actual.SYNTHETIC_KEEP,'kept');
});
function facts(){return{platform:'win32',actions:'true',runnerEnvironment:'github-hosted',runnerOs:'Windows',runnerArch:'X64',repository:'shademounir/CrmYnov',owner:'shademounir',actor:'shademounir',eventName:'pull_request',event:{pull_request:{head:{sha:head,repo:{fork:false,full_name:'shademounir/CrmYnov'}},base:{ref:'develop',repo:{full_name:'shademounir/CrmYnov'}}}},ref:'refs/pull/244/merge',workflowSha:'c'.repeat(40),runId:'123',runAttempt:'2',workspace:'C:\\synthetic\\repo',runnerTemp:'C:\\synthetic\\temp',checkoutHead:head,tree};}
function fakeIO(context,mode={}){
  // Pure in-memory protocol model. Never spawn a process, fake process.env,
  // read a real source or invoke the actual produce CLI/PowerShell/backend.
  const map=new Map(),dirs=new Set(),calls=[],outputs=[];const plan=fixturePaths(context,nonce);
  const put=(p,v)=>map.set(w.normalize(p),Buffer.isBuffer(v)?Buffer.from(v):bytes(v));
  const read=p=>{assert(map.has(w.normalize(p)),'SYNTHETIC_FILE_MISSING');return Buffer.from(map.get(w.normalize(p)));};
  for(const rel of fixtureSourcePaths)put(w.join(context.workspace,rel),Buffer.from('SyntheticOnly\n'));
  put(w.join(context.workspace,probeSourcePath),Buffer.from('SyntheticProbeSource'));
  put(w.join(context.workspace,'scripts/telephony-agent/tests/windows-installer.integration.ps1'),Buffer.from('SyntheticHarnessNotExecuted'));
  put(w.join(context.workspace,'scripts/telephony-agent/tests/windows-fixture-guards.psm1'),Buffer.from('SyntheticGuardSource'));
  put(w.join(context.workspace,noticeTestSource),Buffer.from('SyntheticNoticeTestSource'));
  const interpreter='C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';put(interpreter,Buffer.from('SyntheticInterpreterNotExecutable'));
  let frameworkReads=0;
  const io={frameworkSnapshot:()=>{frameworkReads++;return[{path:'SyntheticOnly',sha256:mode.frameworkDrift&&frameworkReads>1?'1'.repeat(64):'0'.repeat(64)}];},read,exists:p=>map.has(w.normalize(p)),mkdirNew:p=>{assert(!dirs.has(p));dirs.add(p);},writeNew:(p,b)=>{assert(!map.has(w.normalize(p)),'SYNTHETIC_NO_OVERWRITE');put(p,b);},outputs:v=>outputs.push(v),assertCheckout:()=>{if(mode.sourceDrift)throw new Error('WINDOWS_FIXTURE_CHECKOUT_CHANGED');},invokePowerShell:(script,args,timeoutMs)=>{
    calls.push({script,args,timeoutMs});
    if(script.endsWith('child-exit-semantics.ps1')){
      if(mode.probeTimeout)return{exitCode:null,errorCode:'ETIMEDOUT'};
      if(mode.probeFailure)return{exitCode:5};
      put(w.join(plan.probe,'RESULT.json'),{schemaVersion:1,status:'PASS',parentContinued:true,childExitCode:0,childBreakpointHits:1,powerShellVersion:'5.1.synthetic',probeSourceSha256:h(read(script)),interpreterSha256:h(read(interpreter)),syntheticOnly:true,installerExecuted:false,registryOrSdkUsed:false});
    }else{
      if(mode.harnessTimeout){put(w.join(plan.harness,'fresh-off.INTENT.json'),{id:'fresh-off',status:'INTENT_ONLY_OUTCOME_UNKNOWN_UNTIL_RESULT',head:context.head});return{exitCode:null,errorCode:'ETIMEDOUT'};}
      const manifest=w.join(plan.work,'source-manifest.json'),probe=w.join(plan.work,'probe-evidence.json');
      const references={SOURCE_MANIFEST:manifest,EXIT_PROBE_EVIDENCE:probe,EXIT_PROBE_SOURCE:w.join(context.workspace,probeSourcePath),POWERSHELL_INTERPRETER:interpreter,TEST_TOOLING_GUARD:w.join(context.workspace,'scripts/telephony-agent/tests/windows-fixture-guards.psm1')};
      const sources=fixtureSourcePaths.map(p=>({path:p,sha256:h(read(w.join(context.workspace,p))),lineCount:2,classification:p.includes('test-installer')?'TEST':'PRODUCTION',commands:[{line:1,column:1}]}));
      const framework={version:'3.4.0',files:[{path:'SyntheticOnly',sha256:'0'.repeat(64)}],payloadAuthenticatedByThisReport:false};
      put(w.join(plan.harness,'framework-provenance.json'),framework);
      const results=fixtureCaseIds.map((id,index)=>({id,status:'PASS',installerLeaseReleased:true,startUtc:new Date(index*2000).toISOString(),endUtc:new Date(index*2000+1000).toISOString()}));
      const report={schemaVersion:1,status:'PASS',head:context.head,tree:context.tree,runId:context.runId,runAttempt:context.runAttempt,evidenceKind:'NATIVE_POWERSHELL_COMMAND_BREAKPOINTS',sourceBeforeAfterVerified:true,sources,observations:sources.map(s=>({sourcePath:s.path,executedPath:w.join(context.workspace,s.path),sha256Before:s.sha256,sha256After:s.sha256,commands:[{line:1,column:1,hitCount:s.path.includes('package-')?0:1}]})),testCases:fixtureCaseIds.map(id=>({id,status:'PASS',installerLeaseReleased:true})),inputReferences:Object.entries(references).map(([role,p])=>({role,path:p,sha256Before:h(read(p)),sha256After:h(read(p))})),frameworkProvenanceSha256:h(read(w.join(plan.harness,'framework-provenance.json'))),githubIdentityAuthenticatedByThisReport:false,packagedExeTested:false,actualHistorical0413UpgradeTested:false,standardUserOrUacAcceptance:false,sdkSipUserOrProductionAcceptance:false,interruptedUninstallTested:false};
      if(mode.reorderedCases)report.testCases.reverse();
      else report.testCases=results;
      Object.assign(report,{interpreterVersionObserved:'5.1.synthetic',probeAuthorityAuthenticatedByThisReport:false,syntheticPackageOnly:true,unknownOutcomeCleanupAttempted:false});
      report.noticePlannerResult={sourcePath:noticeTestSource,sha256Before:h(read(w.join(context.workspace,noticeTestSource))),sha256After:h(read(w.join(context.workspace,noticeTestSource))),result:{synthetic:true,plannerOnly:true,productSdkInstallerNetworkNotExecuted:true,tests:17,pass:17,failures:0,results:noticePlannerCases.map(name=>({name,status:'PASS'}))}};
      if(mode.missingNoticeResult)delete report.noticePlannerResult;
      if(mode.badNoticeSource)report.noticePlannerResult.sha256After='e'.repeat(64);
      if(mode.badNoticeCase)report.noticePlannerResult.result.results[1]=report.noticePlannerResult.result.results[0];
      if(mode.noticeSourceDrift)put(w.join(context.workspace,noticeTestSource),Buffer.from('SyntheticNoticeTestChanged'));
      if(mode.badHead)report.head='d'.repeat(40);if(mode.missingCase)report.testCases.pop();if(mode.badReference)report.inputReferences[0].sha256After='e'.repeat(64);if(mode.missingZero)report.observations[2].commands=[];
      put(w.join(plan.harness,'coverage-evidence.json'),report);put(w.join(plan.harness,'FIXTURE-INTENT.json'),{head:context.head,tree:context.tree,status:'INTENT_ONLY_NOT_RESULT',syntheticPackageOnly:true,packagedExeTested:false,inputReferences:report.inputReferences.map(({sha256After,...r})=>r)});
      for(const result of results){const id=result.id;put(w.join(plan.harness,id+'.INTENT.json'),{id,head:context.head,status:'INTENT_ONLY_OUTCOME_UNKNOWN_UNTIL_RESULT',startUtc:result.startUtc});put(w.join(plan.harness,id+'.RESULT.json'),{...result,status:mode.failedCaseFile&&id==='fresh-off'?'FAILED':'PASS'});}
    }
    return{exitCode:0};
  }};
  return{io,map,dirs,calls,outputs,plan,read};
}
test('context facts select actual PR head, not the workflow merge revision',()=>{const c=selectFixtureContext(facts());assert.equal(c.head,head);assert.notEqual(c.head,c.workflowSha);assert.equal(c.officialEvidenceAuthenticated,false);});
for(const base of ['develop','main'])test('trusted same-repo PR base '+base,()=>{const f=facts();f.event.pull_request.base.ref=base;assert.equal(selectFixtureContext(f).head,head);});
test('main push uses strict after/ref and no PR object',()=>{const f=facts();f.eventName='push';f.workflowSha=head;f.ref='refs/heads/main';f.event={ref:f.ref,after:head,deleted:false,repository:{full_name:f.repository,owner:{login:f.owner}}};assert.equal(selectFixtureContext(f).head,head);});
for(const [name,mutate] of [
  ['local',f=>{f.actions='false';}],['selfhosted',f=>{f.runnerEnvironment='self-hosted';}],['linux',f=>{f.platform='linux';}],['fork',f=>{f.event.pull_request.head.repo.fork=true;}],['owner',f=>{f.actor='someone';}],['wrongbase',f=>{f.event.pull_request.base.ref='other';}],['mergecheckout',f=>{f.checkoutHead=f.workflowSha;}],['badRun',f=>{f.runAttempt='0';}],['traversalRoot',f=>{f.runnerTemp='C:\\temp\\..\\user';}],['nestedRoots',f=>{f.runnerTemp=f.workspace+'\\temp';}],
])test('reject '+name+' as data, without touching process environment or native IO',()=>{const f=facts();mutate(f);assert.throws(()=>selectFixtureContext(f),/WINDOWS_FIXTURE_/u);});
test('pure protocol produces exact-byte JSON-only artifact without counting manifest itself',()=>{
  const c=selectFixtureContext(facts()),f=fakeIO(c);const result=produceFixtureEvidence(c,f.io,nonce);
  assert.equal(f.calls.length,2);assert.equal(f.calls[0].timeoutMs,60000);assert.equal(f.calls[1].timeoutMs,600000);
  const manifest=JSON.parse(f.read(w.join(result.staging,'artifact-manifest.json')));assert.equal(manifest.files.length,21);assert(!manifest.files.some(r=>r.path==='artifact-manifest.json'));assert(manifest.files.every(r=>r.path.endsWith('.json')));
  for(const row of manifest.files){const b=f.read(w.join(result.staging,row.path));assert.equal(h(b),row.sha256);assert.equal(b.length,row.bytes);}
  assert(f.read(w.join(result.staging,'coverage-evidence.json')).equals(f.read(w.join(f.plan.harness,'coverage-evidence.json'))));
  assert.equal(h(f.read(w.join(result.staging,'artifact-manifest.json'))),result.manifestSha256);
  assert.equal(f.outputs.length,2);assert.equal(f.outputs[0]['artifact-path'],result.staging);assert.equal(f.outputs[1]['report-sha256'],result.reportSha256);
});
for(const mode of ['probeTimeout','probeFailure','harnessTimeout','badHead','missingCase','badReference','missingZero','failedCaseFile','frameworkDrift','reorderedCases','missingNoticeResult','badNoticeSource','badNoticeCase','noticeSourceDrift'])test('fail closed '+mode+' with no retry or native cleanup',()=>{
  const c=selectFixtureContext(facts()),f=fakeIO(c,{[mode]:true});assert.throws(()=>produceFixtureEvidence(c,f.io,nonce),/WINDOWS_FIXTURE_/u);assert(f.calls.length<=2);
  const d=JSON.parse(f.read(w.join(f.plan.staging,'producer-diagnostic.json')));assert.equal(d.retry,0);assert.equal(d.cleanupAttempted,false);assert.equal(f.outputs.length,1);assert(!f.outputs.some(o=>o['report-sha256']));
  if(mode==='harnessTimeout'){assert.equal(d.status,'UNKNOWN');assert(f.io.exists(w.join(f.plan.staging,'fresh-off.INTENT.json')));assert(!f.io.exists(w.join(f.plan.staging,'fresh-off.RESULT.json')));}
});
test('invalid nonce or source guard fails before native invocation',()=>{const c=selectFixtureContext(facts()),f=fakeIO(c,{sourceDrift:true});assert.throws(()=>produceFixtureEvidence(c,f.io,nonce));assert.equal(f.calls.length,0);assert.throws(()=>fixturePaths(c,'../bad'));});
function composition(eventName='pull_request'){
  const data=facts();if(eventName==='push'){data.eventName='push';data.workflowSha=head;data.ref='refs/heads/main';data.event={ref:data.ref,after:head,deleted:false,repository:{full_name:data.repository,owner:{login:data.owner}}};}
  const c=selectFixtureContext(data),f=fakeIO(c),result=produceFixtureEvidence(c,f.io,nonce);
  const files=new Map([...f.map.entries()].filter(([p])=>w.dirname(p)===result.staging).map(([p,b])=>[w.basename(p),Buffer.from(b)]));
  const expected={head:c.head,tree:c.tree,runId:c.runId,runAttempt:c.runAttempt,artifactId:'456',artifactDigest:'d'.repeat(64),manifestSha256:result.manifestSha256,reportSha256:result.reportSha256};
  const readSource=relative=>f.read(w.join(c.workspace,relative));return{c,f,files,expected,readSource};
}
for(const eventName of ['pull_request','push'])test('pure producer to actual consumer composition '+eventName,()=>{
  const x=composition(eventName);assert.equal(x.files.size,22);
  const r=verifyWindowsFixtureArtifact(x);assert.equal(r.head,head);assert.equal(r.tree,tree);assert.equal(r.officialEvidenceAuthenticated,false);assert.equal(r.nativeAcceptance,false);
  assert.equal(r.noticePlannerResult.tests,17);assert.deepEqual(r.noticePlannerResult.cases,noticePlannerCases);assert.equal(r.files.length,4);
  if(eventName==='pull_request')assert.notEqual(x.c.head,x.c.workflowSha);
});
test('composition refuses changed local source, probe alias or runtime reference',()=>{
  for(const relative of [fixtureSourcePaths[0],probeSourcePath,noticeTestSource,'scripts/telephony-agent/package-notices.psm1']){const x=composition();const original=x.readSource;x.readSource=p=>p===relative?Buffer.from('SYNTHETIC_DRIFT'):original(p);assert.throws(()=>verifyWindowsFixtureArtifact(x),/WINDOWS_FIXTURE_/u);}
  const x=composition();x.expected.runAttempt='99';assert.throws(()=>verifyWindowsFixtureArtifact(x),/WINDOWS_FIXTURE_/u);
});
