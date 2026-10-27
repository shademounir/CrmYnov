// Separate runtime-role business observation, never a replacement RC47 sampler.
// The overall proof MUST additionally authenticate the independent ledger purpose.
// No client/credentials/provider/job construction and no native acceptance here.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {QUERIES as STABLE_QUERIES,digest} from '../readonly-probe/rc47-select-only-probe-core-v1.mjs';
import {QUERIES as POOL_QUERIES,SESSION_SETTINGS} from './pool-read-only-collector-v1.mjs';
export const PURPOSE='GENERAL_PRESERVATION_READ_ONLY_V1';
const sha=value=>createHash('sha256').update(value).digest('hex');
const NAMES=Object.freeze(['configuration','memberships','roster','permissions','scopes','leads','followups','booking','pool','counters','journal']);
export const QUERIES=Object.freeze({identity:POOL_QUERIES.identity,...Object.fromEntries(NAMES.map(n=>[n,STABLE_QUERIES[n]]))});
const LIMITS=Object.freeze({configuration:1,memberships:1000,roster:100,permissions:100,scopes:5,leads:2,followups:100,booking:1,pool:1,counters:1000,journal:1000});
const FIELDS=Object.freeze({
  configuration:['id','enabled','version','activated_at','qualification_key','settings'],
  memberships:['campus_id','campaign_id','user_id','active'],
  roster:['id','active','roles','campus_id'],
  permissions:['id','kind','role','campus','version','grants'],
  scopes:['id','kind','code','scope','campus_id','state'],
  leads:['id','lead_code','status','assigned_to_id','campus','campaign','created_at'],
  followups:['id','lead_id','owner_id','state','due_at'],
  booking:['id','lead_id','state','starts_at','duration_minutes','booking_state','reports'],
  pool:['campus_id','version','rules'],
  counters:['campus_id','version','rule_id','user_id','assigned_count'],
  journal:['key','event_type','status','fingerprint','recipients_sha256','accepted_at','sending_at','uncertainty_code','provider_id_present','provider_id_sha256'],
});
export const QUERY_CONTRACT_SHA256=sha(JSON.stringify({purpose:PURPOSE,role:'crm_runtime',queries:QUERIES,settings:SESSION_SETTINGS,limits:LIMITS,fields:FIELDS,separateLedgerRequired:true}));
function exactKeys(value,names){assert(value&&Object.getPrototypeOf(value)===Object.prototype,'PLAIN_OBJECT');assert.deepEqual(Object.keys(value).sort((a,b)=>a.localeCompare(b,'en')),[...names].sort((a,b)=>a.localeCompare(b,'en')),'EXACT_FIELDS');assert(Object.values(Object.getOwnPropertyDescriptors(value)).every(d=>Object.hasOwn(d,'value')),'DATA_FIELDS_ONLY');}
export function validateGeneralPreservationRequest(request){
  exactKeys(request,['schemaVersion','purpose','phase','campusId','queryContractSha256']);
  assert.equal(request.schemaVersion,1);assert.equal(request.purpose,PURPOSE);assert(['PRE','POST'].includes(request.phase));
  assert.equal(typeof request.campusId,'string','SCALAR_CAMPUS_ID');assert(/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/u.test(request.campusId));assert.equal(request.queryContractSha256,QUERY_CONTRACT_SHA256);return request;
}
function time(value){assert.equal(typeof value,'string');assert(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/u.test(value));const n=Date.parse(value);assert(Number.isFinite(n));assert.equal(new Date(n).toISOString(),value.slice(0,23)+'Z');return n;}
function checkedIdentity(rows){
  assert(Array.isArray(rows)&&rows.length===1,'ONE_IDENTITY_REQUIRED');const row=rows[0];exactKeys(row,['database','role','read_only','isolation','transaction_started_at','observed_at']);
  assert.equal(row.database,'crmynov_prod');assert.equal(row.role,'crm_runtime','RUNTIME_ROLE_ONLY');assert.equal(row.read_only,'on');assert.equal(row.isolation,'repeatable read');
  const elapsed=time(row.observed_at)-time(row.transaction_started_at);assert(row.observed_at>=row.transaction_started_at&&elapsed<=25000,'TRANSACTION_BOUND');return {...row};
}
function checkedRows(name,rows){assert(Array.isArray(rows)&&rows.length<=LIMITS[name],'ROW_BOUND_'+name);for(const row of rows){exactKeys(row,FIELDS[name]);}const bytes=JSON.stringify(rows);assert(Buffer.byteLength(bytes)<=524288,'TABLE_BYTE_BOUND');const value=JSON.parse(bytes);for(const row of value){exactKeys(row,FIELDS[name]);}return value;}
export async function collectGeneralPreservationObservation(select,request){
  const target=Object.freeze({...validateGeneralPreservationRequest(request)});assert.equal(typeof select,'function');const initial=checkedIdentity(await select('identity',QUERIES.identity,[])),snapshot={};
  async function readAt(index){if(index===NAMES.length){return;}const name=NAMES[index],parameters=['scopes','pool','counters'].includes(name)?[target.campusId]:[];snapshot[name]=checkedRows(name,await select(name,QUERIES[name],parameters));return readAt(index+1);}
  await readAt(0);assert(Buffer.byteLength(JSON.stringify(snapshot))<=524288,'SNAPSHOT_BYTE_BOUND');const final=checkedIdentity(await select('identity-final',QUERIES.identity,[]));assert.equal(final.transaction_started_at,initial.transaction_started_at,'SAME_TRANSACTION_REQUIRED');assert(final.observed_at>=initial.observed_at,'CLOCK_REVERSED');
  return {schemaVersion:1,purpose:PURPOSE,phase:target.phase,queryContractSha256:QUERY_CONTRACT_SHA256,identity:{database:final.database,role:final.role,readOnly:final.read_only,isolation:final.isolation},transactionStartedAt:initial.transaction_started_at,transactionCompletedAt:final.observed_at,snapshot,snapshotSha256:digest(snapshot),sourceClaimsOnly:true,nativeEvidenceAuthenticated:false,migrationLedgerObserved:false,separateLedgerRequired:true,sameSnapshotAsLedger:false,sameSnapshotAsPool:false,historicalRawPoolHashRecovered:false,fullPreservationValidated:false,activationAuthorized:false};
}
export async function runGeneralPreservationReadOnlyCollection(client,request){
  const target=Object.freeze({...validateGeneralPreservationRequest(request)});assert.equal(typeof client?.$transaction,'function');
  return client.$transaction(async tx=>{assert.equal(typeof tx?.$executeRawUnsafe,'function');assert.equal(typeof tx?.$queryRawUnsafe,'function');async function settingAt(index){if(index===SESSION_SETTINGS.length){return;}await tx.$executeRawUnsafe(SESSION_SETTINGS[index]);return settingAt(index+1);}await settingAt(0);return collectGeneralPreservationObservation((_name,sql,p)=>tx.$queryRawUnsafe(sql,...p),target);},{isolationLevel:'RepeatableRead',maxWait:5000,timeout:25000});
}
