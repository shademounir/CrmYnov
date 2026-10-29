import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {fixture} from './readonly-native-output-fixture-v1.mjs';
import {digest} from '../controlled-pool-contract-v1.mjs';
import {parseGeneralUnknownPreparationArguments,runGeneralUnknownPreparation} from '../general-unknown-preparation-v1.mjs';

const h=bytes=>createHash('sha256').update(bytes).digest('hex');
const hashFile=file=>h(fs.readFileSync(file));
const parent='projects/crmynov-prod-n7x4q2/locations/europe-west1';
const createOperation=parent+'/operations/synthetic-create';
const runOperation=parent+'/operations/synthetic-run';
function eventsFor(f){
  const common={job:f.objective.jobName,objectiveSha256:f.objective.objectiveSha256,canRetry:false};
  return [
    ['CREATE',0,{...common,state:'INTENT',at:'2026-10-27T14:00:00.000Z',bodySha256:'c'.repeat(64)}],
    ['CREATE',1,{...common,state:'OPERATION',operation:createOperation,responseSha256:'d'.repeat(64)}],
    ['CREATE',2,{...common,state:'RECONCILED',operation:createOperation,uid:f.job.uid}],
    ['RUN',0,{...common,state:'INTENT',at:'2026-10-27T14:00:00.100Z',uid:f.job.uid,etag:'synthetic-etag'}],
    ['RUN',1,{...common,state:'UNKNOWN'}],
  ].map(([stage,ordinal,payload])=>({stage,ordinal,state:payload.state,payload,sha:digest(payload)}));
}
function writeSnapshot(file,events,{application=1129467989,version=1,extraTable=false}={}){
  const db=new DatabaseSync(file);
  try{
    db.exec('PRAGMA application_id='+application+';PRAGMA user_version='+version+';CREATE TABLE events(stage TEXT NOT NULL,ordinal INTEGER NOT NULL,state TEXT NOT NULL,payload TEXT NOT NULL,sha TEXT NOT NULL,PRIMARY KEY(stage,ordinal));');
    const insert=db.prepare('INSERT INTO events VALUES(?,?,?,?,?)');
    for(const event of events)insert.run(event.stage,event.ordinal,event.state,JSON.stringify(event.payload),event.sha);
    if(extraTable)db.exec('CREATE TABLE forbidden(value TEXT)');
  }finally{db.close();}
}
function localFixture(t,{kind='general',eventsChange,snapshotOptions={}}={}){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'crmy-general-offline-'));
  t.after(()=>{assert(path.dirname(directory)===fs.realpathSync(os.tmpdir()));assert(path.basename(directory).startsWith('crmy-general-offline-'));fs.rmSync(directory,{recursive:true,force:true});});
  const f=fixture(kind),snapshot=path.join(directory,'RUN-1-JOURNAL-SNAPSHOT.sqlite'),dossier=path.join(directory,'dossier.json'),receipt=path.join(directory,'receipt.json');
  const events=eventsFor(f);if(eventsChange)eventsChange(events);
  writeSnapshot(snapshot,events,snapshotOptions);fs.writeFileSync(dossier,JSON.stringify(f.dossier));
  const args=['--snapshot',snapshot,'--snapshot-sha256',hashFile(snapshot),'--dossier',dossier,'--dossier-sha256',hashFile(dossier),'--receipt',receipt];
  return {directory,f,snapshot,dossier,receipt,args,events};
}
function withRecovered(local,change){
  const execution={...local.f.execution,uid:'synthetic-execution-uid'},recovered={operation:{name:runOperation,done:true,response:{name:execution.name,uid:execution.uid}},job:local.f.job,execution,observedAt:'2026-10-27T14:00:04.000Z'};
  if(change)change(recovered);
  const file=path.join(local.directory,'recovered.json');fs.writeFileSync(file,JSON.stringify(recovered));
  local.args.push('--recovered',file,'--recovered-sha256',hashFile(file));return file;
}
const denyNetwork=t=>t.mock.method(globalThis,'fetch',()=>{throw Error('NATIVE_CALL_FORBIDDEN');});
const getReceipt=local=>JSON.parse(fs.readFileSync(local.receipt,'utf8'));

test('actual offline adapter records absent candidate as indeterminate, never as successful reconciliation',async t=>{
  denyNetwork(t);const local=localFixture(t),before=fs.readFileSync(local.snapshot),dossierBefore=fs.readFileSync(local.dossier);
  const result=await runGeneralUnknownPreparation(local.args),receipt=getReceipt(local);
  assert.equal(result.state,'UNKNOWN_UNATTRIBUTED_NO_CANDIDATE');assert.equal(result.commandCompleted,true);
  assert.equal(result.operationOutcome,'INDETERMINATE');assert.equal(result.resumeAuthorized,false);assert.equal(result.canRetry,false);
  assert.equal(result.receiptSha256,hashFile(local.receipt));assert.equal(result.receiptCanonicalSha256,digest(receipt));
  assert.equal(receipt.reason,'RECOVERED_METADATA_NOT_AVAILABLE');assert.equal(receipt.assessment,null);
  assert.equal(receipt.examinedEvidence.length,2);assert.equal(receipt.journalSnapshotSha256,h(before));
  assert.equal(receipt.knownCreateOperation,createOperation);assert.equal(receipt.jobUid,local.f.job.uid);
  assert.equal(receipt.nativeCalls,0);assert.equal(receipt.journalWrites,0);assert.equal(receipt.operationalJournalOpened,false);
  for(const key of ['canRetry','sourceOrNativeOriginAuthenticated','originalRequestAttributionProved','journalReconciliationImplemented','outputVerified','nativeAcceptance','nativeExecutionAuthorized','activationAuthorized'])assert.equal(receipt[key],false,key);
  assert.deepEqual(fs.readFileSync(local.snapshot),before);assert.deepEqual(fs.readFileSync(local.dossier),dossierBefore);
  assert(!fs.existsSync(local.snapshot+'-journal'));assert(!fs.existsSync(local.snapshot+'-wal'));assert(!fs.existsSync(local.snapshot+'-shm'));
  assert.doesNotMatch(JSON.stringify(receipt),/DATABASE_URL|BEGIN PUBLIC KEY|synthetic@synthetic|taskTemplate|publicKeyPem/u);
});

test('coherent synthetic metadata keeps independent attribution, output acceptance and freshness unproved',async t=>{
  denyNetwork(t);const local=localFixture(t);withRecovered(local);
  const result=await runGeneralUnknownPreparation(local.args),receipt=getReceipt(local);
  assert.equal(result.state,'METADATA_COHERENT_NOT_ATTRIBUTED');assert.equal(result.operationOutcome,'INDETERMINATE');
  assert.equal(receipt.assessment.proposedOperation,runOperation);assert.equal(receipt.examinedEvidence.length,3);
  assert.equal(receipt.assessment.originalRequestAttributionProved,false);assert.equal(receipt.assessment.nativeAcceptance,false);
  assert.equal(receipt.historicalOutputNotFreshPre,true);assert.equal(result.currentPreConclusion,'NOT_ACQUIRED');
});

test('CREATE operation cannot be reused as recovered RUN; refusal is separate and expurgated',async t=>{
  const local=localFixture(t);withRecovered(local,recovered=>{recovered.operation.name=createOperation;recovered.operation.secret='DO_NOT_PERSIST';});
  const result=await runGeneralUnknownPreparation(local.args),receipt=getReceipt(local);
  assert.equal(result.state,'RECOVERED_CANDIDATE_REFUSED');assert.equal(receipt.reason,'GENERAL_PREPARATION_NOT_CREATE_OPERATION');
  assert.equal(receipt.assessment,null);assert(!fs.readFileSync(local.receipt,'utf8').includes('DO_NOT_PERSIST'));
});

test('malformed recovered JSON is refused without persisting raw text or parser details',async t=>{
  const local=localFixture(t),candidate=path.join(local.directory,'bad.json');fs.writeFileSync(candidate,'DO_NOT_PERSIST_SECRET malformed');
  local.args.push('--recovered',candidate,'--recovered-sha256',hashFile(candidate));
  await runGeneralUnknownPreparation(local.args);const receipt=getReceipt(local);
  assert.equal(receipt.status,'RECOVERED_CANDIDATE_REFUSED');assert.equal(receipt.reason,'RECOVERED_METADATA_VALIDATOR_REFUSED');
  assert(!fs.readFileSync(local.receipt,'utf8').includes('DO_NOT_PERSIST_SECRET'));
});

test('invalid recovered UTF8 is refused rather than silently normalized',async t=>{
  const local=localFixture(t),candidate=path.join(local.directory,'bad-utf8.json');
  fs.writeFileSync(candidate,Buffer.from([123,34,120,34,58,34,255,34,125]));
  local.args.push('--recovered',candidate,'--recovered-sha256',hashFile(candidate));
  await runGeneralUnknownPreparation(local.args);assert.equal(getReceipt(local).status,'RECOVERED_CANDIDATE_REFUSED');
  assert.equal(getReceipt(local).reason,'RECOVERED_METADATA_VALIDATOR_REFUSED');
});

test('oversized snapshot is refused before SQLite opens it',async t=>{
  const local=localFixture(t);fs.appendFileSync(local.snapshot,Buffer.alloc(1048576));local.args[3]=hashFile(local.snapshot);
  await assert.rejects(runGeneralUnknownPreparation(local.args),/INPUT_BOUND/u);assert(!fs.existsSync(local.receipt));
});

test('a receipt is exclusive and cannot overwrite any prior assessment',async t=>{
  const local=localFixture(t);fs.writeFileSync(local.receipt,'prior durable receipt');
  await assert.rejects(runGeneralUnknownPreparation(local.args),/RECEIPT_ALREADY_EXISTS/u);
  assert.equal(fs.readFileSync(local.receipt,'utf8'),'prior durable receipt');
});

for(const mode of ['snapshot','dossier','recovered'])test('wrong pinned '+mode+' hash is refused without a receipt',async t=>{
  const local=localFixture(t);if(mode==='recovered')withRecovered(local);
  local.args[local.args.indexOf('--'+mode+'-sha256')+1]='0'.repeat(64);
  await assert.rejects(runGeneralUnknownPreparation(local.args),/INPUT_SHA256_MISMATCH/u);assert(!fs.existsSync(local.receipt));
});

for(const suffix of ['-wal','-shm','-journal'])test('snapshot '+suffix+' sidecar is refused, not deleted or opened',async t=>{
  const local=localFixture(t);fs.writeFileSync(local.snapshot+suffix,'preserve');
  await assert.rejects(runGeneralUnknownPreparation(local.args),/SNAPSHOT_SIDECAR_REFUSED/u);
  assert.equal(fs.readFileSync(local.snapshot+suffix,'utf8'),'preserve');assert(!fs.existsSync(local.receipt));
});

for(const [name,snapshotOptions,code]of [
  ['wrong application',{application:123},'SNAPSHOT_APPLICATION'],['wrong version',{version:2},'SNAPSHOT_VERSION'],['extra schema',{extraTable:true},'SNAPSHOT_SCHEMA'],
])test('refuses '+name+' without accepting native evidence',async t=>{
  const local=localFixture(t,{snapshotOptions});await assert.rejects(runGeneralUnknownPreparation(local.args),new RegExp(code,'u'));assert(!fs.existsSync(local.receipt));
});

for(const [name,eventsChange,code]of [
  ['incomplete chain',events=>events.pop(),'EXACT_UNKNOWN_CHAIN_REQUIRED'],
  ['payload state drift',events=>{events[4].state='RECONCILED';},'EVENT_STATE_BINDING'],
  ['digest drift',events=>{events[3].sha='0'.repeat(64);},'EVENT_DIGEST'],
  ['retry enabled',events=>{events[4].payload.canRetry=true;events[4].sha=digest(events[4].payload);},'NO_RETRY'],
  ['UNKNOWN replaced',events=>{events[4].payload.state='RECONCILED';events[4].state='RECONCILED';events[4].sha=digest(events[4].payload);},'EXACT_UNKNOWN_CHAIN_REQUIRED'],
  ['operation added to UNKNOWN',events=>{events[4].payload.operation=runOperation;events[4].sha=digest(events[4].payload);},'UNKNOWN_MUST_REMAIN_UNKNOWN'],
  ['different objective',events=>{events[3].payload.objectiveSha256='b'.repeat(64);events[3].sha=digest(events[3].payload);},'EVENT_OBJECTIVE'],
])test('refuses '+name+' from snapshot without rewriting it',async t=>{
  const local=localFixture(t,{eventsChange}),before=fs.readFileSync(local.snapshot);
  await assert.rejects(runGeneralUnknownPreparation(local.args),new RegExp(code,'u'));assert(!fs.existsSync(local.receipt));assert.deepEqual(fs.readFileSync(local.snapshot),before);
});

test('operational journal basename is refused even when bytes match the snapshot hash',async t=>{
  const local=localFixture(t),journal=path.join(local.directory,'pool-native-transactions.sqlite');fs.copyFileSync(local.snapshot,journal);local.args[1]=journal;
  await assert.rejects(runGeneralUnknownPreparation(local.args),/OPERATIONAL_JOURNAL_REFUSED/u);assert(!fs.existsSync(local.receipt));
});
test('operational journal directory is refused even through an innocent snapshot basename',async t=>{
  const local=localFixture(t),directory=path.join(local.directory,'single-use-journal');fs.mkdirSync(directory);const journal=path.join(directory,'snapshot.sqlite');fs.copyFileSync(local.snapshot,journal);local.args[1]=journal;
  await assert.rejects(runGeneralUnknownPreparation(local.args),/OPERATIONAL_JOURNAL_REFUSED/u);assert(!fs.existsSync(local.receipt));
});
test('hard-linked input is refused rather than accepted as a distinct immutable copy',async t=>{
  const local=localFixture(t),alias=path.join(local.directory,'hardlink.sqlite');fs.linkSync(local.snapshot,alias);local.args[1]=alias;
  await assert.rejects(runGeneralUnknownPreparation(local.args),/ORDINARY_SINGLE_LINK_FILE_REQUIRED/u);assert(!fs.existsSync(local.receipt));
});
test('directory reparse alias is refused before snapshot read',async t=>{
  const local=localFixture(t),alias=path.join(local.directory,'alias');fs.symlinkSync(local.directory,alias,process.platform==='win32'?'junction':'dir');
  t.after(()=>{if(fs.existsSync(alias))fs.unlinkSync(alias);});local.args[1]=path.join(alias,path.basename(local.snapshot));
  await assert.rejects(runGeneralUnknownPreparation(local.args),/REPARSE_PATH_REFUSED/u);assert(!fs.existsSync(local.receipt));
});
test('distinct Ledger FIN cannot substitute for the original General UNKNOWN',async t=>{
  const local=localFixture(t,{kind:'ledger'});await assert.rejects(runGeneralUnknownPreparation(local.args),/GENERAL_PURPOSE_ONLY/u);assert(!fs.existsSync(local.receipt));
});
test('changed dossier body is refused even with its new raw hash',async t=>{
  const local=localFixture(t),dossier=JSON.parse(fs.readFileSync(local.dossier,'utf8'));dossier.bundle.nonce='f'.repeat(64);fs.writeFileSync(local.dossier,JSON.stringify(dossier));local.args[5]=hashFile(local.dossier);
  await assert.rejects(runGeneralUnknownPreparation(local.args));assert(!fs.existsSync(local.receipt));
});

const argumentCases=[
  ['no args',()=>[]],['odd args',args=>args.slice(0,-1)],['unknown capability',args=>[...args,'--transport','native']],
  ['initialize',args=>[...args,'--initialize','yes']],['private key',args=>[...args,'--private-key','secret']],
  ['duplicate option',args=>[...args,'--snapshot','second']],['missing required',args=>args.slice(2)],
  ['recovered without hash',args=>[...args,'--recovered','file']],['hash without recovered',args=>[...args,'--recovered-sha256','a'.repeat(64)]],
  ['invalid hash',args=>args.map((value,index)=>index===3?'no-hash':value)],['newline',args=>args.map((value,index)=>index===1?'file\nother':value)],
];
for(const [name,change]of argumentCases)test('strict offline CLI refuses '+name,()=>{
  const args=['--snapshot','snapshot','--snapshot-sha256','a'.repeat(64),'--dossier','dossier','--dossier-sha256','b'.repeat(64),'--receipt','receipt'];
  assert.throws(()=>parseGeneralUnknownPreparationArguments(change(args)),/GENERAL_OFFLINE_/u);
});

test('adapter imports only offline validators and opens snapshot SQLite explicitly read-only',()=>{
  const source=fs.readFileSync(new URL('../general-unknown-preparation-v1.mjs',import.meta.url),'utf8');
  assert.match(source,/new DatabaseSync\(input.path,\{readOnly:true\}\)/u);
  assert.doesNotMatch(source,/from\s+['"][^'"]*(?:pool-native-transaction|pool-driver-authority|pool-driver-github|child_process)/u);
  assert.doesNotMatch(source,/createOfficialAccessToken|createReadOnlyNativeTransport|\.append\(|fetch\(/u);
});
