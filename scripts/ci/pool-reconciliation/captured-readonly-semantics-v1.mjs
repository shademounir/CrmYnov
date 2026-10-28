// Offline composition of a SUCCESSFULLY captured observation, not a new native read.
// The caller must independently retain/verify the actual host receipt hashes.
// No client, credentials, clock override, dispatch, SQL or RC47 retargeting.
import assert from 'node:assert/strict';
import {digest} from './controlled-pool-contract-v1.mjs';
import {openSealedReadOnlyOutput,hashBytes} from './readonly-output-codec-v1.mjs';
import {validateReadOnlyNativeExecution,readOnlyPurposeConfiguration} from './pool-native-output-v1.mjs';
import {digest as baselineDigest} from '../readonly-probe/rc47-select-only-probe-core-v1.mjs';

const RC48='8253024ea35cee6be5636cc6b10a88ae7e177377';
const GENERAL='GENERAL_PRESERVATION_READ_ONLY_V1',LEDGER='SCHEMA_LEDGER_READ_ONLY_V1';
const H=/^[a-f0-9]{64}$/u;
const time=value=>{const n=Date.parse(value);assert(Number.isFinite(n),'RECORDED_TIME_REQUIRED');return n;};
function body(record){const {at,...value}=record;time(at);return value;}
function same(actual,expected,code){assert.equal(digest(actual),digest(expected),code);}
function limitations(){return {providerCryptographicSignatureAsserted:false,currentFreshnessAsserted:false,sameSnapshotAsOtherPurpose:false,fullProductionPreservation:false,nativeAcceptance:false,activationAuthorized:false};}

function checkedHost(capture){
  const {claim,hostResult,dossier,driverCommit}=capture;
  assert([GENERAL,LEDGER].includes(dossier.objective.purpose),'CAPTURE_PURPOSE');
  assert.equal(dossier.objective.main,RC48);
  assert.equal(hostResult.exitCode,0,'SUCCESSFUL_ORIGINAL_OUTPUT_PHASE_REQUIRED');
  assert.equal(hostResult.mode,'read-output');
  assert.equal(hostResult.result.state,'SOURCE_BOUND_READONLY_OBSERVATION_CLAIMS_NOT_SEMANTIC_ACCEPTANCE');
  assert.equal(hostResult.result.nativeAcceptance,false);
  same(hostResult.journalEvents.map(e=>[e.stage,e.state]),[
    ['CREATE','INTENT'],['CREATE','OPERATION'],['CREATE','RECONCILED'],
    ['RUN','INTENT'],['RUN','OPERATION'],['RUN','RECONCILED'],
  ],'KNOWN_FIN_JOURNAL_REQUIRED');
  assert(hostResult.journalEvents.every(e=>e.job===dossier.objective.jobName&&e.objectiveSha256===dossier.objective.objectiveSha256),'JOURNAL_OBJECTIVE');
  assert.equal(claim.kind,'SOURCE_BOUND_READONLY_OBSERVATION_CLAIMS_NOT_SEMANTIC_ACCEPTANCE');
  assert.equal(claim.officialReadPathExecuted,true);assert.equal(claim.sourceBoundClaimsChecked,true);
  assert.equal(claim.nativeEvidenceAuthenticated,false);assert.equal(claim.nativeAcceptance,false);
  assert.equal(claim.activationAuthorized,false);assert.equal(claim.fullProductionPreflight,false);
  assert(/^[a-f0-9]{40}$/u.test(driverCommit),'EXPLICIT_PROTECTED_DRIVER_REQUIRED');
  assert.equal(claim.driverCommit,driverCommit);assert.equal(claim.dossierSha256,digest(dossier));
  assert.equal(claim.purpose,dossier.objective.purpose);assert.equal(claim.phase,dossier.bundle.request.phase);
  assert.equal(claim.sourceSha256,dossier.objective.sourceSha256);
  assert.equal(claim.databaseBindingSha256,dossier.objective.databaseBindingSha256);
  const saved=hostResult.journalEvents.at(-1);
  assert.equal(claim.job,saved.job);assert.equal(claim.jobUid,saved.uid);assert.equal(claim.execution,saved.execution);
  const capturedAt=time(claim.at),hostAt=time(hostResult.at),age=capturedAt-time(claim.transactionCompletedAt);
  assert(hostAt>=capturedAt&&hostAt-capturedAt<=10000,'ORIGINAL_CAPTURE_RESULT_TIME');
  assert(age>=0&&age<=300000,'ORIGINAL_CAPTURE_WAS_NOT_FRESH');
  return {saved,capturedAt,captureAgeMs:age};
}

function checkedLogs(logs,job,execution,objective){
  assert.equal(logs.nextPageToken??'','');assert.equal(logs.entries.length,1,'ONE_CAPTURED_RECORD');
  const entry=logs.entries[0],jobLeaf=job.name.split('/').at(-1);
  assert.equal(entry.resource.type,'cloud_run_job');
  assert.equal(entry.resource.labels.project_id,'crmynov-prod-n7x4q2');
  assert.equal(entry.resource.labels.location,'europe-west1');assert.equal(entry.resource.labels.job_name,jobLeaf);
  assert.equal(entry.logName,'projects/crmynov-prod-n7x4q2/logs/run.googleapis.com%2Fstdout');
  assert.equal(entry.labels['run.googleapis.com/execution_name'],execution.name.split('/').at(-1));
  assert.equal(entry.labels['run.googleapis.com/task_index'],'0');assert.equal(entry.labels['run.googleapis.com/task_attempt'],'0');
  assert(time(entry.timestamp)>=time(execution.startTime)-1000&&time(entry.timestamp)<=time(execution.completionTime)+1000,'CAPTURED_LOG_TIME');
  assert.equal(entry.textPayload,undefined);assert.equal(entry.jsonPayload.kind,readOnlyPurposeConfiguration(objective.purpose).kind);
  return entry.jsonPayload;
}

export function validateCapturedReadOnlyMetadata(capture){
  const host=checkedHost(capture),{claim,dossier,reads}=capture;
  const job=body(reads.job),execution=body(reads.execution),logs=body(reads.logs);
  const taskNetwork=reads.taskNetwork===undefined?undefined:body(reads.taskNetwork);
  validateReadOnlyNativeExecution(job,execution,dossier.objective,taskNetwork);
  assert.equal(job.uid,claim.jobUid);assert.equal(execution.name,claim.execution);
  assert(host.capturedAt>=time(execution.completionTime),'CAPTURE_BEFORE_EXECUTION_FIN');
  for(const record of Object.values(reads))assert(time(record.at)<=host.capturedAt&&time(record.at)>=time(execution.completionTime),'CAPTURED_NATIVE_READ_TIME');
  assert.equal(digest({job,execution,logs,...(taskNetwork===undefined?{}:{taskNetwork})}),claim.metadataSha256,'CAPTURED_NATIVE_METADATA_BYTES');
  const record=checkedLogs(logs,job,execution,dossier.objective);
  assert.equal(digest(record),claim.sealedOutputSha256,'CAPTURED_SEALED_RECORD_BYTES');
  return {record,job,execution,recordedCapture:{capturedAt:claim.at,transactionStartedAt:claim.transactionStartedAt,transactionCompletedAt:claim.transactionCompletedAt,captureAgeMs:host.captureAgeMs,freshAtRecordedCapture:true,currentFreshnessAsserted:false}};
}

export function openCapturedReadOnlyObservation(capture,loadPrivateKey){
  const checked=validateCapturedReadOnlyMetadata(capture);
  assert.equal(typeof loadPrivateKey,'function','EXPLICIT_LOCAL_KEY_CAPABILITY_REQUIRED');
  const {claim,dossier}=capture;
  const context={purpose:claim.purpose,phase:claim.phase,job:claim.job,execution:claim.execution,sourceSha256:claim.sourceSha256,nonce:dossier.bundle.nonce};
  const output=openSealedReadOnlyOutput(checked.record,{privateKeyPem:loadPrivateKey(),context});
  assert.equal(output.schemaVersion,1);assert.equal(output.sourceSha256,claim.sourceSha256);
  assert.equal(output.databaseBindingSha256,claim.databaseBindingSha256);
  same(output.runtime,{job:claim.job,execution:claim.execution,taskIndex:0,attempt:0},'CAPTURED_RUNTIME_BINDING');
  const observation=output.observation;
  assert.equal(observation.purpose,claim.purpose);assert.equal(observation.phase,claim.phase);
  assert.equal(observation.queryContractSha256,dossier.bundle.request.queryContractSha256);
  same(observation.identity,claim.identity,'CAPTURED_IDENTITY');
  same(observation.identity,{database:'crmynov_prod',role:readOnlyPurposeConfiguration(claim.purpose).role,readOnly:'on',isolation:'repeatable read'},'CAPTURED_ROLE');
  assert.equal(observation.transactionStartedAt,claim.transactionStartedAt);assert.equal(observation.transactionCompletedAt,claim.transactionCompletedAt);
  assert.equal(digest(observation.snapshot),claim.snapshotSha256,'CAPTURED_SNAPSHOT_BYTES');
  assert.equal(observation.sourceClaimsOnly,true);assert.equal(observation.nativeEvidenceAuthenticated,false);assert.equal(observation.activationAuthorized,false);
  return {observation,recordedCapture:checked.recordedCapture,...limitations()};
}

function checkedObservation(observation,purpose){
  assert.equal(observation.purpose,purpose);assert(['PRE','POST'].includes(observation.phase));
  assert.equal(observation.sourceClaimsOnly,true);assert.equal(observation.activationAuthorized,false);
  assert.equal(observation.nativeEvidenceAuthenticated,false);
  assert(Buffer.byteLength(JSON.stringify(observation.snapshot))<=524288,'SNAPSHOT_BOUND');
  return observation.snapshot;
}

export function compareCapturedLedger({observation,expectedLedger,expectedSchema}){
  const snapshot=checkedObservation(observation,LEDGER);
  assert.equal(expectedLedger.main,RC48);assert.equal(expectedSchema.main,RC48);
  assert.equal(expectedLedger.migrations.length,56,'PROTECTED_LEDGER_56_REQUIRED');
  const expected=expectedLedger.migrations.map(m=>({migration_name:m.migration_name,checksum:m.checksum,finished:true,rolled_back:false}));
  assert(expected.every(m=>H.test(m.checksum)));same(snapshot.migrations,expected,'PROTECTED_LEDGER_MISMATCH');
  assert.equal(observation.ledgerSha256,hashBytes(JSON.stringify(snapshot.migrations)),'LEDGER_CAPTURE_BYTES');
  const tables=['columns','indexes','constraints'],surface={},excluded={};
  for(const table of tables){
    assert(Array.isArray(snapshot[table])&&snapshot[table].length>0,'SCHEMA_SURFACE_REQUIRED');
    assert(!expectedSchema[table].some(r=>r.table_name==='_prisma_migrations'),'EXPECTED_BUSINESS_SURFACE_MUST_EXCLUDE_FIXTURE_LEDGER');
    surface[table]=snapshot[table].filter(r=>r.table_name!=='_prisma_migrations');
    excluded[table]=snapshot[table].length-surface[table].length;
    same(surface[table],expectedSchema[table],'PROTECTED_SCHEMA_SURFACE_MISMATCH');
  }
  assert(excluded.columns>0,'ACTUAL_LEDGER_RELATION_REQUIRED');
  assert.equal(observation.schemaSurfaceSha256,hashBytes(JSON.stringify({columns:snapshot.columns,indexes:snapshot.indexes,constraints:snapshot.constraints})),'FULL_CAPTURED_SCHEMA_BYTES');
  return {schemaVersion:1,status:'CAPTURED_LEDGER_AND_BUSINESS_SCHEMA_MATCH_PROTECTED_RC48',phase:observation.phase,migrations:56,businessSurfaceCounts:Object.fromEntries(tables.map(t=>[t,surface[t].length])),businessSurfaceSha256:digest(surface),excludedLedgerRelationCounts:excluded,functionsTriggersPoliciesObserved:false,fullSchemaCompatibilityProved:false,...limitations()};
}

function checkGeneralConfiguration(s,baseline){
  assert.equal(baseline.targetMain,RC48);assert.equal(baseline.expectedMailVersion,4);assert.equal(baseline.expectedMailBaseline,'2026-10-21T19:29:49.289Z');
  for(const pin of ['settingsSha256','membershipSha256','permissionSha256'])assert(H.test(baseline[pin])&&baseline[pin]!=='0'.repeat(64),'INDEPENDENT_BASELINE_PIN_REQUIRED');
  assert.equal(s.configuration.length,1);const c=s.configuration[0];
  assert.equal(c.id,'internal-business-v1');assert.equal(c.enabled,true);assert.equal(c.version,4);
  assert.equal(new Date(c.activated_at).toISOString(),baseline.expectedMailBaseline);assert.equal(c.qualification_key,baseline.qualificationKey);
  assert.equal(baselineDigest(c.settings),baseline.settingsSha256,'MAIL_SETTINGS_CHANGED');
  assert.equal(baselineDigest(s.permissions),baseline.permissionSha256,'PERMISSIONS_CHANGED');
}
function checkGeneralMembers(s,baseline){
  const active=s.memberships.filter(r=>r.active),members=[...new Set(active.map(r=>r.user_id))],campaigns=[...new Set(active.map(r=>r.campaign_id))];
  assert.equal(active.length,32);assert.equal(new Set(active.map(r=>[r.campus_id,r.campaign_id,r.user_id].join('/'))).size,32);
  assert.equal(members.length,8);assert.equal(campaigns.length,4);assert(active.every(r=>r.campus_id===baseline.campusId));
  assert.equal(baselineDigest(active),baseline.membershipSha256,'MAIL_MEMBERSHIPS_CHANGED');
  assert.equal(s.roster.length,8);assert(s.roster.every(r=>r.active&&Array.isArray(r.roles)&&r.roles.length>0));
  same([...s.roster.map(r=>r.id)].sort(),members.sort(),'MAIL_ROSTER_MEMBERS');
  assert(s.roster.every(r=>r.roles.includes('SUPER_ADMIN')||r.campus_id===baseline.campusId));
  assert.equal(s.scopes.length,5);assert(s.scopes.every(r=>r.state==='ACTIVE'));
  assert(s.scopes.some(r=>r.id===baseline.campusId&&r.kind==='CAMPUS'));
  assert(campaigns.every(id=>s.scopes.some(r=>r.id===id&&r.kind==='CAMPAIGN'&&r.scope==='CAMPUS'&&r.campus_id===baseline.campusId)));
}
function checkProtectedRecords(s){
  assert.equal(s.leads.length,2);const open=s.leads.find(r=>r.id==='4f2805e0-d4f2-4fdf-96c6-263a990b6a71'),closed=s.leads.find(r=>r.id==='ca4c94e5-830d-433e-9c9b-0029148ac884');
  assert(open&&!['CLOSED_LOST','ENROLLED'].includes(open.status),'PROTECTED_OPEN_LEAD');assert.equal(closed?.status,'CLOSED_LOST');
  assert(s.followups.some(r=>r.id==='54482786-140b-4381-8259-b14f48e1e1e3'&&['SCHEDULED','DUE'].includes(r.state)&&new Date(r.due_at).toISOString()==='2026-10-21T09:30:00.000Z'));
  assert.equal(s.booking.length,1);const b=s.booking[0];
  assert.equal(b.lead_id,open.id);assert.equal(b.booking_state,'ACCEPTED');assert.equal(b.state,'CONFIRME');assert.equal(b.duration_minutes,30);assert.equal(b.reports,0);
  assert.equal(new Date(b.starts_at).toISOString(),'2026-10-21T10:00:00.000Z');
}
function checkGeneralJournal(s,baseline){
  assert.equal(new Set(s.journal.map(r=>r.key)).size,s.journal.length);
  assert(s.journal.every(r=>['SENDING','ACCEPTED','UNCERTAIN'].includes(r.status)&&typeof r.sending_at==='string'&&Number.isFinite(Date.parse(r.sending_at))));
  const qualification=s.journal.find(r=>r.key===baseline.qualificationKey);
  assert.equal(qualification?.status,'ACCEPTED');assert.equal(qualification.provider_id_present,true);
}
function compareGeneralPrior(s,prior){
  for(const table of ['configuration','memberships','roster','permissions','scopes','leads','followups','booking','pool'])same(s[table],prior[table],'OBSERVED_RECORD_PRESERVATION_DIVERGENCE');
  for(const old of prior.journal){const current=s.journal.find(r=>r.key===old.key);assert(current,'JOURNAL_ROW_LOST');assert.equal(current.sending_at,old.sending_at);if(['ACCEPTED','UNCERTAIN'].includes(old.status))same(current,old,'IMMUTABLE_MAIL_EVIDENCE_CHANGED');}
  for(const old of prior.counters){const current=s.counters.find(r=>r.version===old.version&&r.rule_id===old.rule_id&&r.user_id===old.user_id);assert(current&&current.assigned_count>=old.assigned_count,'COUNTER_LOSS');}
}
export function compareCapturedGeneral({observation,baseline,prior=null}){
  const s=checkedObservation(observation,GENERAL);
  assert.equal(observation.snapshotSha256,baselineDigest(s),'GENERAL_CAPTURE_BYTES');
  same(Object.keys(s).sort(),['configuration','memberships','roster','permissions','scopes','leads','followups','booking','pool','counters','journal'].sort(),'GENERAL_SCOPE');
  checkGeneralConfiguration(s,baseline);checkGeneralMembers(s,baseline);checkProtectedRecords(s);checkGeneralJournal(s,baseline);
  assert.equal(s.pool.length,1);assert.equal(s.pool[0].campus_id,baseline.campusId);assert.equal(s.pool[0].version,1);
  assert(s.counters.every(r=>r.campus_id===baseline.campusId&&r.version===1&&Number.isSafeInteger(r.assigned_count)&&r.assigned_count>=0));
  if(prior!==null){assert.equal(observation.phase,'POST');compareGeneralPrior(s,prior);}
  return {schemaVersion:1,status:'CAPTURED_GENERAL_OBSERVED_INVARIANTS_MATCH',phase:observation.phase,mailVersion:4,mailBaseline:baseline.expectedMailBaseline,activeMemberships:32,members:8,campaigns:4,protectedLeadRecords:2,protectedBookingRecords:1,journalRows:s.journal.length,journalSha256:digest(s.journal),countersSha256:digest(s.counters),poolProjectionSha256:digest(s.pool),postCompared:prior!==null,historicalRawPoolHashRecovered:false,poolSemanticsRequireSeparateProof:true,fullPortfolioCoverage:false,...limitations()};
}
