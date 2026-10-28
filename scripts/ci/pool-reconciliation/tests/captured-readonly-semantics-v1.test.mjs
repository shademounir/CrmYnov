// Synthetic fixtures only. No live job, SQL, private key, process environment or provider.
import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './readonly-native-output-fixture-v1.mjs';
import {verifyReadOnlyOutputClaims} from '../pool-native-output-v1.mjs';
import {buildReadOnlyObservationClaimReceipt} from '../pool-operational-driver-v1.mjs';
import {digest} from '../controlled-pool-contract-v1.mjs';
import {digest as baselineDigest} from '../../readonly-probe/rc47-select-only-probe-core-v1.mjs';
import {hashBytes} from '../readonly-output-codec-v1.mjs';
import {validateCapturedReadOnlyMetadata,openCapturedReadOnlyObservation,compareCapturedGeneral,compareCapturedLedger} from '../captured-readonly-semantics-v1.mjs';

const DRIVER='d'.repeat(40),RC48='8253024ea35cee6be5636cc6b10a88ae7e177377',H='a'.repeat(64);
function captured(kind='general'){
  const f=fixture(kind),checked=verifyReadOnlyOutputClaims(f),authority={entry:{scope:f.objective.purpose,dossierSha256:digest(f.dossier)},receipt:{driverCommit:DRIVER,authorityRevision:'e'.repeat(40),objectiveId:'synthetic-only'}};
  const claim={at:new Date(f.now).toISOString(),...buildReadOnlyObservationClaimReceipt({verified:{...checked,job:f.job,officialReadPathExecuted:true},authority,dossier:f.dossier,source:{commit:DRIVER},saved:{uid:f.job.uid,execution:f.execution.name}})};
  const states=[['CREATE','INTENT'],['CREATE','OPERATION'],['CREATE','RECONCILED'],['RUN','INTENT'],['RUN','OPERATION'],['RUN','RECONCILED']];
  const hostResult={at:new Date(f.now+100).toISOString(),mode:'read-output',exitCode:0,result:{state:claim.kind,nativeAcceptance:false},journalEvents:states.map(([stage,state])=>({stage,state,job:f.job.name,objectiveSha256:f.objective.objectiveSha256,uid:f.job.uid,execution:f.execution.name}))};
  const at=new Date(f.now-200).toISOString();
  return {f,capture:{claim,hostResult,dossier:f.dossier,driverCommit:DRIVER,reads:{job:{at,...f.job},execution:{at,...f.execution},logs:{at,...f.logs}}}};
}
for(const kind of ['general','ledger'])test('synthetic accepted capture '+kind+' is historical inspection, never current native acceptance',()=>{
  const {f,capture}=captured(kind);let keyCalls=0;
  const checked=validateCapturedReadOnlyMetadata(capture);assert.equal(checked.recordedCapture.captureAgeMs,2000);
  const opened=openCapturedReadOnlyObservation(capture,()=>{keyCalls++;return f.privateKeyPem;});
  assert.equal(keyCalls,1);assert.deepEqual(opened.observation,f.payload.observation);
  assert.equal(opened.recordedCapture.freshAtRecordedCapture,true);assert.equal(opened.currentFreshnessAsserted,false);
  assert.equal(opened.nativeAcceptance,false);assert.equal(opened.providerCryptographicSignatureAsserted,false);assert.equal(opened.activationAuthorized,false);
});
const metadataRefusals=[
  ['failed original phase',c=>{c.hostResult.exitCode=1;}],
  ['wrong original state',c=>{c.hostResult.result.state='PENDING';}],
  ['missing original FIN',c=>{c.hostResult.journalEvents.pop();}],
  ['wrong journal objective',c=>{c.hostResult.journalEvents[0].objectiveSha256='f'.repeat(64);}],
  ['foreign journal job',c=>{c.hostResult.journalEvents[0].job+='-other';}],
  ['unbound driver',c=>{c.driverCommit='f'.repeat(40);}],
  ['foreign dossier',c=>{c.claim.dossierSha256='f'.repeat(64);}],
  ['fabricated native acceptance',c=>{c.claim.nativeAcceptance=true;}],
  ['missing official capture assertion',c=>{c.claim.officialReadPathExecuted=false;}],
  ['expired at original capture',c=>{c.claim.at=new Date(Date.parse(c.claim.transactionCompletedAt)+300001).toISOString();c.hostResult.at=new Date(Date.parse(c.claim.at)+100).toISOString();}],
  ['negative original age',c=>{c.claim.at=new Date(Date.parse(c.claim.transactionCompletedAt)-1).toISOString();c.hostResult.at=c.claim.at;}],
  ['result before capture',c=>{c.hostResult.at=new Date(Date.parse(c.claim.at)-1).toISOString();}],
  ['late native read',c=>{c.reads.job.at=new Date(Date.parse(c.claim.at)+1).toISOString();}],
  ['wrong UID',c=>{c.claim.jobUid='other-synthetic-uid';}],
  ['foreign execution',c=>{c.claim.execution+='-other';}],
  ['wrong image',c=>{c.reads.job.template.template.containers[0].image+='bad';}],
  ['public network',c=>{c.reads.execution.template.vpcAccess.egress='ALL_TRAFFIC';}],
  ['second native execution',c=>{c.reads.job.executionCount=2;}],
  ['altered encrypted result',c=>{c.reads.logs.entries[0].jsonPayload.ciphertext='AA==';}],
  ['foreign log origin',c=>{c.reads.logs.entries[0].resource.labels.job_name+='-other';}],
  ['wrong metadata commitment',c=>{c.claim.metadataSha256='f'.repeat(64);}],
  ['wrong sealed commitment',c=>{c.claim.sealedOutputSha256='f'.repeat(64);}],
];
for(const [name,mutate] of metadataRefusals)test('refuse '+name+' BEFORE opening even a synthetic key',()=>{
  const {capture}=captured();mutate(capture);let keyCalls=0;
  assert.throws(()=>openCapturedReadOnlyObservation(capture,()=>{keyCalls++;throw Error('SYNTHETIC_KEY_MUST_NOT_BE_OPENED');}));assert.equal(keyCalls,0);
});
test('decrypt only after metadata guards and refuse changed decrypted snapshot commitment',()=>{
  const {f,capture}=captured();capture.claim.snapshotSha256='f'.repeat(64);let keyCalls=0;
  assert.throws(()=>openCapturedReadOnlyObservation(capture,()=>{keyCalls++;return f.privateKeyPem;}),/CAPTURED_SNAPSHOT_BYTES/u);assert.equal(keyCalls,1);
});
test('no private key path/default capability is inferred',()=>{const {capture}=captured();assert.throws(()=>openCapturedReadOnlyObservation(capture,null),/EXPLICIT_LOCAL_KEY_CAPABILITY_REQUIRED/u);});

function ledger(){
  const migrations=Array.from({length:56},(_,i)=>({migration_name:'synthetic_'+String(i).padStart(2,'0'),checksum:H,finished:true,rolled_back:false}));
  const expectedSchema={main:RC48,columns:[{table_name:'synthetic_business',column_name:'id'}],indexes:[{table_name:'synthetic_business',index_name:'synthetic_idx'}],constraints:[{table_name:'synthetic_business',constraint_name:'synthetic_pk'}]};
  const snapshot={migrations,columns:[{table_name:'_prisma_migrations',column_name:'synthetic_ledger'},...structuredClone(expectedSchema.columns)],indexes:[{table_name:'_prisma_migrations',index_name:'synthetic_ledger_pk'},...structuredClone(expectedSchema.indexes)],constraints:structuredClone(expectedSchema.constraints)};
  const observation={purpose:'SCHEMA_LEDGER_READ_ONLY_V1',phase:'PRE',sourceClaimsOnly:true,nativeEvidenceAuthenticated:false,activationAuthorized:false,snapshot,ledgerSha256:hashBytes(JSON.stringify(migrations)),schemaSurfaceSha256:hashBytes(JSON.stringify({columns:snapshot.columns,indexes:snapshot.indexes,constraints:snapshot.constraints}))};
  return {observation,expectedLedger:{main:RC48,migrations:structuredClone(migrations)},expectedSchema};
}
test('ledger comparison uses protected 56 and distinguishes actual ledger relation from fixture business surface',()=>{
  const result=compareCapturedLedger(ledger());assert.equal(result.migrations,56);assert.equal(result.businessSurfaceCounts.columns,1);assert.equal(result.excludedLedgerRelationCounts.columns,1);assert.equal(result.fullSchemaCompatibilityProved,false);assert.equal(result.functionsTriggersPoliciesObserved,false);assert.equal(result.activationAuthorized,false);
});
for(const [name,mutate] of [
  ['wrong protected release',x=>{x.expectedLedger.main='f'.repeat(40);}],
  ['55 expected migrations',x=>{x.expectedLedger.migrations.pop();}],
  ['migration drift',x=>{x.observation.snapshot.migrations[0].checksum='f'.repeat(64);}],
  ['unfinished migration',x=>{x.observation.snapshot.migrations[0].finished=false;}],
  ['business column drift',x=>{x.observation.snapshot.columns[1].column_name='other';}],
  ['fixture ledger leaked to expected business surface',x=>{x.expectedSchema.columns.unshift({table_name:'_prisma_migrations',column_name:'synthetic_ledger'});}],
  ['ledger relation omitted',x=>{x.observation.snapshot.columns.shift();}],
  ['schema commitment changed',x=>{x.observation.schemaSurfaceSha256='f'.repeat(64);}],
])test('ledger refuses '+name,()=>{const x=ledger();mutate(x);assert.throws(()=>compareCapturedLedger(x));});

function general(){
  const campusId='a49902db-739e-4375-96c2-6512efe12d07',qualificationKey=H,settings={syntheticOnly:true},permissions=[{syntheticOnly:true}],baseline={targetMain:RC48,campusId,expectedMailVersion:4,expectedMailBaseline:'2026-10-21T19:29:49.289Z',qualificationKey};
  const memberships=Array.from({length:32},(_,i)=>({campus_id:campusId,campaign_id:'synthetic-campaign-'+Math.floor(i/8),user_id:'synthetic-user-'+i%8,active:true}));
  const roster=Array.from({length:8},(_,i)=>({id:'synthetic-user-'+i,active:true,roles:['COMMERCIAL'],campus_id:campusId}));
  const scopes=[{id:campusId,kind:'CAMPUS',state:'ACTIVE'},...Array.from({length:4},(_,i)=>({id:'synthetic-campaign-'+i,kind:'CAMPAIGN',scope:'CAMPUS',campus_id:campusId,state:'ACTIVE'}))];
  const snapshot={configuration:[{id:'internal-business-v1',enabled:true,version:4,activated_at:baseline.expectedMailBaseline,qualification_key:qualificationKey,settings}],memberships,roster,permissions,scopes,leads:[{id:'4f2805e0-d4f2-4fdf-96c6-263a990b6a71',status:'PROSPECT'},{id:'ca4c94e5-830d-433e-9c9b-0029148ac884',status:'CLOSED_LOST'}],followups:[{id:'54482786-140b-4381-8259-b14f48e1e1e3',state:'DUE',due_at:'2026-10-21T09:30:00.000Z'}],booking:[{lead_id:'4f2805e0-d4f2-4fdf-96c6-263a990b6a71',booking_state:'ACCEPTED',state:'CONFIRME',duration_minutes:30,reports:0,starts_at:'2026-10-21T10:00:00.000Z'}],pool:[{campus_id:campusId,version:1,rules:[]}],counters:[{campus_id:campusId,version:1,rule_id:'synthetic-rule',user_id:'synthetic-user-0',assigned_count:4}],journal:[{key:qualificationKey,status:'ACCEPTED',provider_id_present:true,sending_at:'2026-10-21T19:29:48.000Z'}]};
  Object.assign(baseline,{settingsSha256:baselineDigest(settings),membershipSha256:baselineDigest(memberships),permissionSha256:baselineDigest(permissions)});
  return {observation:{purpose:'GENERAL_PRESERVATION_READ_ONLY_V1',phase:'PRE',sourceClaimsOnly:true,nativeEvidenceAuthenticated:false,activationAuthorized:false,snapshot,snapshotSha256:baselineDigest(snapshot)},baseline};
}
test('general comparison is minimal observed invariants, not full portfolio/pool acceptance',()=>{
  const result=compareCapturedGeneral(general());assert.equal(result.activeMemberships,32);assert.equal(result.protectedLeadRecords,2);assert.equal(result.fullPortfolioCoverage,false);assert.equal(result.poolSemanticsRequireSeparateProof,true);assert.equal(result.historicalRawPoolHashRecovered,false);assert.equal(result.fullProductionPreservation,false);
});
test('general identity comparison is deterministic and does not reorder the observed source arrays',()=>{
  const input=general();input.observation.snapshot.roster.reverse();input.observation.snapshotSha256=baselineDigest(input.observation.snapshot);
  const before=structuredClone(input);assert.equal(compareCapturedGeneral(input).members,8);assert.deepEqual(input,before);
});
for(const [name,mutate] of [
  ['missing historical settings pin',x=>{x.baseline.settingsSha256='0'.repeat(64);}],
  ['changed mail settings',x=>{x.observation.snapshot.configuration[0].settings.syntheticOnly=false;}],
  ['changed permissions',x=>{x.observation.snapshot.permissions=[];}],
  ['duplicate membership',x=>{x.observation.snapshot.memberships[1]=x.observation.snapshot.memberships[0];}],
  ['inactive roster',x=>{x.observation.snapshot.roster[0].active=false;}],
  ['closed protected open lead',x=>{x.observation.snapshot.leads[0].status='CLOSED_LOST';}],
  ['moved protected booking',x=>{x.observation.snapshot.booking[0].starts_at='2026-10-22T10:00:00.000Z';}],
  ['pool version changed',x=>{x.observation.snapshot.pool[0].version=2;}],
  ['negative counter',x=>{x.observation.snapshot.counters[0].assigned_count=-1;}],
  ['missing qualification delivery',x=>{x.observation.snapshot.journal=[];}],
])test('general refuses '+name+' even when a synthetic snapshot commitment is recomputed',()=>{
  const x=general();mutate(x);x.observation.snapshotSha256=baselineDigest(x.observation.snapshot);assert.throws(()=>compareCapturedGeneral(x));
});
test('POST compares actual previous observed rows and allows monotonic counters/new mail evidence',()=>{
  const x=general(),prior=structuredClone(x.observation.snapshot);x.observation.phase='POST';x.observation.snapshot.counters[0].assigned_count=5;x.observation.snapshot.journal.push({key:'synthetic-new',status:'SENDING',sending_at:'2026-10-28T04:00:00.000Z'});x.observation.snapshotSha256=baselineDigest(x.observation.snapshot);assert.equal(compareCapturedGeneral({...x,prior}).postCompared,true);
});
test('POST refuses loss or modification of observed immutable evidence and counter regression',()=>{
  for(const mutate of [s=>{s.journal[0].sending_at='2026-10-21T19:29:49.000Z';},s=>{s.counters[0].assigned_count=3;},s=>{s.followups[0].state='SCHEDULED';}]){const x=general(),prior=structuredClone(x.observation.snapshot);x.observation.phase='POST';mutate(x.observation.snapshot);x.observation.snapshotSha256=baselineDigest(x.observation.snapshot);assert.throws(()=>compareCapturedGeneral({...x,prior}));}
});
