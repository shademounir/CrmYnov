import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {createHash} from 'node:crypto';
import {rollbackFixture} from './rollback-synthetic-fixtures.mjs';
import {imageJournalDigest as digest,consumeImageTransaction,recordImageOperation,finishImageTransaction} from './journal.mjs';
import {readImageRollbackContext} from './rollback-context.mjs';
import {makeRc48ImageRollbackPlanDraft} from './rollback-plan.mjs';
import {validateImagePreparation} from './preparation.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function setup(t,kinds=['api','web'],failed){
  const f=rollbackFixture(kinds,failed),dir=fs.mkdtempSync(path.join(os.tmpdir(),'image-rollback-context-'));
  t.after(()=>{assert(dir.startsWith(path.join(os.tmpdir(),'image-rollback-context-')));fs.rmSync(dir,{recursive:true,force:true});});
  const journal=path.join(dir,'forward-journal');fs.mkdirSync(journal);
  const id='rc48-image-only-forward-synthetic-0001',dossier={id,candidate:f.input.candidate};
  const write=(name,value)=>{const file=path.join(dir,name+'.json'),bytes=Buffer.from(JSON.stringify(value));fs.writeFileSync(file,bytes,{flag:'wx'});return{path:file,sha256:sha(bytes)};};
  const files={plan:write('forward-plan',f.input.forwardPlan),dossier:write('forward-dossier',dossier),baseline:write('forward-baseline',f.input.originalBaseline)},receipts={};
  const binding={objectiveId:id,objectiveSha256:digest(dossier),planSha256:digest(f.input.forwardPlan),sourceHead:f.input.forwardEvidence.sourceHead};
  for(const stage of ['BACKUP','API_IMAGE','WEB_IMAGE']){
    const row=f.input.forwardEvidence.stages[stage];if(row.state==='UNUSED'){continue;}
    const proof={stage,operation:row.operation,outcome:row.outcome,nativeResponseSha256:row.nativeResponseSha256};if(row.served){proof.served=row.served;}
    const receipt=write(stage+'-native',proof);receipts[stage]=receipt.path;
    consumeImageTransaction(journal,{...binding,stage},'a'.repeat(64),f.now);
    recordImageOperation(journal,{...binding,stage},row.operation,f.now);
    finishImageTransaction(journal,{...binding,stage},row.operation,receipt.sha256,row.outcome,f.now);
  }
  const descriptor={schemaVersion:1,forwardObjectiveId:id,forwardSourceHead:binding.sourceHead,forwardJournalDirectory:journal,files,receipts};
  return{...f,dir,journal,binding,descriptor,read:()=>readImageRollbackContext(descriptor,f.input.candidate,p=>fs.readFileSync(p))};
}
for(const [name,kinds,failed]of [['success',['api','web'],undefined],['API-only',['api'],undefined],['known API failure',['api'],'api'],['known Web failure',['api','web'],'web']]){
  if(typeof name!=='string'){throw new TypeError('SYNTHETIC_CASE_NAME_REQUIRED');}
  test('reads authentic local journal chain and exact native receipt bytes for '+name,t=>{
    const x=setup(t,kinds,failed),before=fs.readdirSync(x.journal).map(n=>[n,sha(fs.readFileSync(path.join(x.journal,n)))]),context=x.read();
    assert.equal(context.forwardObjectiveId,x.descriptor.forwardObjectiveId);assert.equal(context.forwardEvidence.sourceHead,x.binding.sourceHead);
    assert(makeRc48ImageRollbackPlanDraft({...context,candidate:x.input.candidate,currentBaseline:x.input.currentBaseline},x.now));
    assert.deepEqual(fs.readdirSync(x.journal).map(n=>[n,sha(fs.readFileSync(path.join(x.journal,n)))]),before);
  });
}
test('changed forward source refuses the existing journal rather than retargeting its binding',t=>{
  const x=setup(t);x.descriptor.forwardSourceHead='f'.repeat(40);assert.throws(x.read);
});
test('changed native receipt bytes refuse even when the JSON value is unchanged',t=>{
  const x=setup(t);fs.appendFileSync(x.descriptor.receipts.API_IMAGE,'\n');assert.throws(x.read);
});
test('changed original input bytes refuse their pinned fingerprints',t=>{
  const x=setup(t);fs.appendFileSync(x.descriptor.files.plan.path,'\n');assert.throws(x.read);
});
test('a consumed forward intent without known operation remains UNKNOWN and cannot become rollback evidence',t=>{
  const x=setup(t,[]);consumeImageTransaction(x.journal,{...x.binding,stage:'API_IMAGE'},'a'.repeat(64),x.now);assert.throws(x.read,/FORWARD_UNKNOWN_OR_RUNNING_REFUSED/u);
});
test('a known but unfinished forward operation cannot be accepted as a FIN',t=>{
  const x=setup(t,[]);consumeImageTransaction(x.journal,{...x.binding,stage:'API_IMAGE'},'a'.repeat(64),x.now);recordImageOperation(x.journal,{...x.binding,stage:'API_IMAGE'},'synthetic-known',x.now);assert.throws(x.read,/FORWARD_UNKNOWN_OR_RUNNING_REFUSED/u);
});
test('a corrupted journal record refuses without repairing or rewriting it',t=>{
  const x=setup(t),file=path.join(x.journal,'API_IMAGE-3.json'),value=JSON.parse(fs.readFileSync(file));value.payload.details.outcome='FAILED';fs.writeFileSync(file,JSON.stringify(value));const before=sha(fs.readFileSync(file));assert.throws(x.read);assert.equal(sha(fs.readFileSync(file)),before);
});
test('secret-looking input path is rejected before reading its bytes',t=>{
  const x=setup(t);x.descriptor.files.plan.path=path.join(x.dir,'private-key.json');let reads=0;
  assert.throws(()=>readImageRollbackContext(x.descriptor,x.input.candidate,()=>{reads++;return Buffer.from('{}');}));assert.equal(reads,0);
});
test('unknown receipt stage is not an arbitrary local file reader',t=>{
  const x=setup(t);x.descriptor.receipts.OTHER=path.join(x.dir,'other.json');assert.throws(x.read);
});
test('candidate mismatch is not silently normalized to a new release',t=>{
  const x=setup(t);const candidate=structuredClone(x.input.candidate);candidate.releaseId=1;assert.throws(()=>readImageRollbackContext(x.descriptor,candidate,p=>fs.readFileSync(p)));
});

function preparation(){
  const now=Date.parse('2026-10-28T10:00:00Z'),hash='b'.repeat(64),content=Buffer.from('{}');
  const evidence=['POOL','LEDGER','GENERAL','PERMISSIONS','JOB_INVENTORY','RECOVERABILITY','ROLLBACK','FORWARD_EXECUTION'].map(kind=>({kind,path:kind+'.json',sha256:sha(content)}));
  const p={schemaVersion:1,kind:'RC48_IMAGE_ONLY_PREPARATION_QUALIFIED_V1',objectiveId:'rc48-image-only-rollback-synthetic-0001',qualifiedAt:new Date(now-1000).toISOString(),expiresAt:new Date(now+600000).toISOString(),applicationMain:'8253024ea35cee6be5636cc6b10a88ae7e177377',schemaCompatibilityQualifiedForImageChange:true,generalIdentity:'crm_runtime',ledgerIdentity:'crm_migrator',sameSqlSnapshotClaimed:false,historicalPermissionOriginUnproved:true,prospectivePermissionDecisionSha256:'a'.repeat(64),permissionConfigurationFreshlyCompared:true,preservationQualified:true,unknownPriorMutation:false,rollback:{kind:'IMAGE_ONLY',compatible:true,databaseRestore:false,preserveInterveningWrites:true,afterSheetsActivationAuthorized:false},backupRecoverabilityQualified:true,backupCreated:false,jobs:[],schedulers:[],evidence,forwardContextSha256:hash};
  const x={p,now,readEvidence:()=>content};x.refresh=()=>{x.bytes=Buffer.from(JSON.stringify(p));x.entry={id:p.objectiveId,scope:'RC48_SERVICE_IMAGE_ROLLBACK_V1',preparationReceiptSha256:sha(x.bytes),forwardContextSha256:hash};x.dossier={preparationReceiptSha256:sha(x.bytes),prospectivePermissionDecisionSha256:p.prospectivePermissionDecisionSha256,preservedJobs:[],preservedSchedulers:[],preparationEvidence:p.evidence};};x.refresh();return x;
}
test('rollback preparation requires eight distinct purposes including forward execution',()=>{
  const x=preparation();assert(validateImagePreparation(x));x.p.evidence.pop();x.refresh();assert.throws(()=>validateImagePreparation(x));
});
test('rollback preparation must match the protected forward-context hash',()=>{
  const x=preparation();x.p.forwardContextSha256='c'.repeat(64);x.refresh();assert.throws(()=>validateImagePreparation(x));
});
