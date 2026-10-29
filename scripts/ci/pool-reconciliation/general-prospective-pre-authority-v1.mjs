// Additive authority for ONE prospective observation. This never renews the old
// catalogue, repairs UNKNOWN, grants IAM, or changes the runtime collector.
import assert from 'node:assert/strict';
import {byteHash,digest} from './controlled-pool-contract-v1.mjs';
import {POOL_DRIVER_INPUTS} from './pool-operational-driver-v2.mjs';
import {validateReadOnlyObjective} from './pool-native-output-v1.mjs';
import {assertAuthorityCurrent,githubFile} from '../readonly-probe/probe-driver-authority-v1.mjs';
import {DELEGATED_CHECKS,GRANT_PATH,grantDigest,validateGrant,selectDelegatedDecision,validateDelegatedDecision} from '../../pr-policy/delegation.mjs';
import {GITHUB_CODE_REVIEW_POLICY_PATH,validateProtectedCodeReviewPolicy} from '../../pr-policy/github-code-review.mjs';
import {validateRequiredChecks} from '../../release-manifest/checks.mjs';

export const BINDING=Object.freeze({
  project:'crmynov-prod-n7x4q2',region:'europe-west1',
  job:'projects/crmynov-prod-n7x4q2/locations/europe-west1/jobs/crm-prod-preservation-pre-20261028-147f390728',
  uid:'6333afa0-3af3-4916-9aa1-e1093ce0bea0',objectiveId:'rc48-general-pre-20261028-147f390728',
  purpose:'GENERAL_PRESERVATION_READ_ONLY_V1',objectiveSha256:'4aea7d0fc7912920af02d856dc43a25b5db860c1236ca66d68c97621255c7119',
  sourceSha256:'f2bdf90d80078a428a5a50bdf4d993592e9bac07dea798c13877c40030c71051',
  bundleSha256:'a05a141fb58ed22f9a3107dce73fcfee2df3bebb276c221d8b5f9702b4b63ad5',
  dossierSha256:'9b7da10de3c66adbfae17d7a116082a9abd1a73b86e8ae694b37e2e6b27d3e45',
  catalogueDossierSha256:'d388c05e23b9b13f355b71c6f4d598207fba7d97b5b5aff8f4a058ba2875098f',
  humanAuthorityReceiptSha256:'0d48bd858b95f624e32c560406e6ddd894d554d0757df0b2371668b301a0f7cd',
  capabilityId:'0d48bd85-8b95-f624-e32c-560406e6ddd8',
  evidenceDirectory:'C:/Crm Ynov/output/casablanca-pilot-20261022/general-prospective-pre-native-20261029-v1',
  journalSha256:'6c3816eea737aa035000b42d249e1cc697ddc4e666d3d97c0b5bdf2873f85450',
  proposalSha256:'5e98d450bc93ee4b170d367d441933a808ed32c214e075ebcc2f9706dbc67c6e',
  originalExpiresAt:'2026-10-29T14:35:01.178Z',
  knownCreateOperation:'projects/crmynov-prod-n7x4q2/locations/europe-west1/operations/26310575-b13a-4eeb-9eb4-26a5c8dbcab3',
});
export const PROSPECTIVE_DRIVER_INPUTS=Object.freeze([...new Set([...POOL_DRIVER_INPUTS,
  'scripts/ci/pool-reconciliation/general-prospective-pre-authority-v1.mjs',
  'scripts/ci/pool-reconciliation/general-prospective-pre-session-v1.mjs',
  'scripts/ci/pool-reconciliation/captured-readonly-semantics-v1.mjs',
  'scripts/ci/runtime-image-only/prospective-permissions.mjs',
])].sort((a,b)=>a.localeCompare(b,'en')));
export const CONSUMER_PINS=Object.freeze({
  cutoverIndexSha256:'104b6fe0a806eb141391a42bba2d2ae3bf2e52833d4fa7b7846643689799968f',
  baselineSha256:'124fcf4b8b3d0435176abc200150518941083c3ca44d5ccefb109af9bc9ef6af',
  configurationSha256:'71bd5607d649f11cb9b8bc470452034a8158a1b4e13c5e694978c225d5eff055',
  decisionSha256:'76835789d5c5c89375f7166c1125766b8f14d467a6cfc28ca4e492807b4e2081',
  currentComparisonSha256:'cf3d275e710a1defbcad4415b60cb94a0e3310764894c3a5e8d329c3f6d605a4',
  historicalPermissionSha256:'9448d82d19d04b4adfcc3dc28d1082c64f1867d5b9f648ae40a9145d2188aea7',
  managerIdSha256:'3d4983399d17031d77ba9f86bcadb7ad1d47ddbeb9ac4acd8c7992c172548560',
  managerGrantsSha256:'619e9ca59b60228499db4e29159a4247dabcf2c5f5272671082c450972f18603',
  humanInstructionSha256:'d8c500e884a6a1bf8fff293da4712c8e3f692657d2eccf195159f7cb4a645fab',
});
const HASH=/^[a-f0-9]{64}$/u,SHA=/^[a-f0-9]{40}$/u,UUID=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/u;
const REPO='shademounir/CrmYnov',API='/repos/'+REPO+'/';
const alphabetical=(left,right)=>left.localeCompare(right,'en');
export const NATIVE_JIRA_BINDING=Object.freeze({source:'OFFICIAL_ATLASSIAN_CONNECTOR_NATIVE_READ',
  accountId:'712020:9cf2f30e-a9a6-440b-9153-a43958e4ecc7',cloudId:'80fb4313-ab5c-42ac-a082-d016c237af5d',
  url:'https://mounirbaali-1778581315657.atlassian.net/browse/CRMY-63',key:'CRMY-63',id:'10681',issueType:'Task',status:'In Review',dependency:'CRMY-61'});
const nativeJiraCodes=new Set(['NATIVE_JIRA_EVIDENCE_REFUSED','NATIVE_JIRA_BYTES','NATIVE_JIRA_HASH','NATIVE_JIRA_JSON',
  'NATIVE_JIRA_SOURCE','NATIVE_JIRA_EXECUTOR','NATIVE_JIRA_ACTOR','NATIVE_JIRA_GRANT','NATIVE_JIRA_ACCOUNT','NATIVE_JIRA_TENANT',
  'NATIVE_JIRA_INVOCATION','NATIVE_JIRA_URL','NATIVE_JIRA_SCOPE','NATIVE_JIRA_FLAGS','NATIVE_JIRA_LABELS','NATIVE_JIRA_READINESS',
  'NATIVE_JIRA_LINKS','NATIVE_JIRA_LINK','NATIVE_JIRA_DEPENDENCY','NATIVE_JIRA_BLOCKED','NATIVE_JIRA_FRESHNESS']);
class NativeJiraEvidenceError extends Error{constructor(code){assert(nativeJiraCodes.has(code));super(code);this.name='NativeJiraEvidenceError';}}
function nativeJiraRequire(condition,code){if(!condition)throw new NativeJiraEvidenceError(code);}
function nativeJiraEdge(edge){
  if(edge===null){return null;}
  dataFields(edge,['key','status']);
  nativeJiraRequire(typeof edge.key==='string'&&/^CRMY-[1-9]\d{0,7}$/u.test(edge.key),'NATIVE_JIRA_LINK');
  nativeJiraRequire(typeof edge.status==='string'&&edge.status.length>0&&edge.status.length<=80&&!/[\u0000-\u001f]/u.test(edge.status),'NATIVE_JIRA_LINK');return edge;
}
function nativeJiraLink(link){
  dataFields(link,['id','type','inward','outward']);
  nativeJiraRequire(typeof link.id==='string'&&/^[1-9]\d{0,15}$/u.test(link.id),'NATIVE_JIRA_LINK');
  nativeJiraRequire(typeof link.type==='string'&&link.type.length>0&&link.type.length<=80&&!/[\u0000-\u001f]/u.test(link.type),'NATIVE_JIRA_LINK');
  nativeJiraEdge(link.inward);nativeJiraEdge(link.outward);
  nativeJiraRequire((link.inward===null)!==(link.outward===null),'NATIVE_JIRA_LINK');
  if(link.type==='Blocks'&&link.inward!==null){nativeJiraRequire(link.inward.status==='Done','NATIVE_JIRA_BLOCKED');}
  return link;
}
function nativeJiraDependencies(links){
  nativeJiraRequire(Array.isArray(links)&&links.length<=100,'NATIVE_JIRA_LINKS');const checked=links.map(nativeJiraLink);
  nativeJiraRequire(new Set(checked.map(link=>link.id)).size===checked.length,'NATIVE_JIRA_LINKS');
  const prerequisite=checked.filter(link=>link.type==='Blocks'&&link.inward?.key===NATIVE_JIRA_BINDING.dependency);
  nativeJiraRequire(prerequisite.length===1&&prerequisite[0].inward.status==='Done','NATIVE_JIRA_DEPENDENCY');
}
function nativeJiraTicket(ticket){
  dataFields(ticket,['key','id','issueType','status','labels','codexReady','blocked','links']);
  for(const key of ['key','id','issueType','status'])nativeJiraRequire(ticket[key]===NATIVE_JIRA_BINDING[key],'NATIVE_JIRA_SCOPE');
  const labels=ticket.labels;nativeJiraRequire(Array.isArray(labels)&&labels.length<=100,'NATIVE_JIRA_LABELS');
  nativeJiraRequire(labels.every(label=>typeof label==='string'&&label.length>0&&label.length<=128&&!/[\u0000-\u001f]/u.test(label)),'NATIVE_JIRA_LABELS');
  nativeJiraRequire(new Set(labels).size===labels.length&&labels.includes('codex-ready'),'NATIVE_JIRA_LABELS');
  nativeJiraRequire(ticket.codexReady===true&&ticket.blocked===false,'NATIVE_JIRA_READINESS');
  nativeJiraRequire(!labels.some(label=>['blocked','codex-blocked'].includes(label.toLowerCase())),'NATIVE_JIRA_BLOCKED');nativeJiraDependencies(ticket.links);
}
function nativeJiraIdentity(value,{actor,grantSha256}){
  nativeJiraRequire(value.source===NATIVE_JIRA_BINDING.source,'NATIVE_JIRA_SOURCE');nativeJiraRequire(value.executor==='Codex','NATIVE_JIRA_EXECUTOR');
  nativeJiraRequire(typeof actor==='string'&&value.observedBy===actor,'NATIVE_JIRA_ACTOR');
  nativeJiraRequire(HASH.test(grantSha256)&&value.grantDigest===grantSha256,'NATIVE_JIRA_GRANT');
  nativeJiraRequire(value.accountId===NATIVE_JIRA_BINDING.accountId,'NATIVE_JIRA_ACCOUNT');nativeJiraRequire(value.cloudId===NATIVE_JIRA_BINDING.cloudId,'NATIVE_JIRA_TENANT');
  nativeJiraRequire(typeof value.invocationId==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(value.invocationId),'NATIVE_JIRA_INVOCATION');
  nativeJiraRequire(value.url===NATIVE_JIRA_BINDING.url,'NATIVE_JIRA_URL');
}
function nativeJiraFlags(value){
  nativeJiraRequire(value.sourceReadinessOnly===true&&value.notPersonalHumanApproval===true&&value.productionDeploymentAuthorized===false&&value.noJiraMutation===true,'NATIVE_JIRA_FLAGS');
}
// Exact native receipt format actually acquired by the official connector. It
// has NO schemaVersion/claim UI fields. This output projection has its own version;
// it neither rewrites the original bytes nor asserts a provider signature.
export function validateNativeJiraReadObservation(bytes,{expectedSha256,actor,grantSha256,now}){
  try{
    nativeJiraRequire(Buffer.isBuffer(bytes)&&bytes.length<=65536,'NATIVE_JIRA_BYTES');
    nativeJiraRequire(HASH.test(expectedSha256)&&byteHash(bytes)===expectedSha256,'NATIVE_JIRA_HASH');
    let value;try{value=JSON.parse(bytes);}catch{throw new NativeJiraEvidenceError('NATIVE_JIRA_JSON');}
    dataFields(value,['observedAt','source','executor','observedBy','grantDigest','accountId','cloudId','invocationId','url','ticket',
      'sourceReadinessOnly','notPersonalHumanApproval','productionDeploymentAuthorized','noJiraMutation']);
    nativeJiraIdentity(value,{actor,grantSha256});nativeJiraTicket(value.ticket);nativeJiraFlags(value);
    const observed=canonicalTime(value.observedAt);nativeJiraRequire(Number.isSafeInteger(now)&&observed<=now&&now-observed<=600000,'NATIVE_JIRA_FRESHNESS');
    return Object.freeze({schemaVersion:1,kind:'PROSPECTIVE_NATIVE_JIRA_READINESS_PROJECTION_V1',source:NATIVE_JIRA_BINDING.source,
      observedAt:value.observedAt,observedBy:actor,accountId:NATIVE_JIRA_BINDING.accountId,cloudId:NATIVE_JIRA_BINDING.cloudId,
      invocationId:value.invocationId,ticket:NATIVE_JIRA_BINDING.key,dependency:NATIVE_JIRA_BINDING.dependency,
      sourceReadinessOnly:true,notPersonalHumanApproval:true,providerCryptographicSignatureAsserted:false,
      meaning:'Hash-pinned local receipt of an official Atlassian connector native read; not a provider cryptographic signature',
      productionDeploymentAuthorized:false,noJiraMutation:true});
  }catch(error){
    if(error instanceof NativeJiraEvidenceError){throw error;}
    throw new NativeJiraEvidenceError('NATIVE_JIRA_EVIDENCE_REFUSED');
  }
}
export function dataFields(value,keys){
  assert(value&&Object.getPrototypeOf(value)===Object.prototype,'PLAIN_DATA_REQUIRED');
  assert(Object.values(Object.getOwnPropertyDescriptors(value)).every(d=>Object.hasOwn(d,'value')),'ACCESSORS_REFUSED');
  assert.deepEqual(Object.keys(value).sort(alphabetical),[...keys].sort(alphabetical),'EXACT_FIELDS_REQUIRED');
}
export function canonicalTime(value){assert.equal(typeof value,'string');const n=Date.parse(value);assert(Number.isSafeInteger(n)&&new Date(n).toISOString()===value,'CANONICAL_TIME_REQUIRED');return n;}
function githubTime(value){assert.equal(typeof value,'string');return canonicalTime(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/u.test(value)?value.replace(/Z$/u,'.000Z'):value);}
function sourceShape(source){
  dataFields(source,['commit','tree','head','pr','files']);
  for(const k of ['commit','tree','head'])assert(SHA.test(source[k]),'PROTECTED_SOURCE_REF_REQUIRED');
  assert(Number.isSafeInteger(source.pr)&&source.pr>0);assert(Array.isArray(source.files));
  assert.deepEqual(source.files.map(f=>f.path),PROSPECTIVE_DRIVER_INPUTS,'COMPLETE_SOURCE_MANIFEST_REQUIRED');
  for(const file of source.files){dataFields(file,['path','sha256']);assert(HASH.test(file.sha256));}
}
export function validateProspectiveAuthorityRecord(record,now){
  dataFields(record,['schemaVersion','kind','capabilityId','proposalSha256','humanAuthorityReceiptSha256','binding',
    'validFrom','expiresAt','explicitWindowRenewal','originalExpiresAt','source','directorySha256','consumerSha256']);
  assert.equal(record.schemaVersion,1);assert.equal(record.kind,'GENERAL_PROSPECTIVE_PRE_SINGLE_OBSERVATION_AUTHORITY_V1');
  assert(UUID.test(record.capabilityId),'EXPLICIT_CAPABILITY_ID_REQUIRED');assert.deepEqual(record.binding,BINDING);
  assert.equal(record.capabilityId,BINDING.capabilityId,'ONE_HUMAN_DECISION_ONE_CAPABILITY');
  assert.equal(record.humanAuthorityReceiptSha256,BINDING.humanAuthorityReceiptSha256,'EXACT_HUMAN_AUTHORITY_RECEIPT');
  assert.equal(record.proposalSha256,BINDING.proposalSha256);assert.equal(record.originalExpiresAt,BINDING.originalExpiresAt);
  assert.equal(record.explicitWindowRenewal,true,'EXPLICIT_ADDITIVE_RENEWAL_REQUIRED');
  for(const k of ['humanAuthorityReceiptSha256','directorySha256','consumerSha256'])assert(HASH.test(record[k])&&record[k]!=='0'.repeat(64));
  assert.equal(record.consumerSha256,digest(CONSUMER_PINS),'FIXED_PROTECTED_CONSUMER_INPUTS_REQUIRED');
  const start=canonicalTime(record.validFrom),end=canonicalTime(record.expiresAt);
  assert(end>start&&end-start<=86400000,'BOUNDED_ADDITIVE_AUTHORITY_REQUIRED');
  assert(Number.isSafeInteger(now)&&now>=start&&now<end,'ADDITIVE_AUTHORITY_EXPIRED');sourceShape(record.source);return record;
}
export function validateProspectiveDossier(bytes){
  assert.equal(byteHash(bytes),BINDING.dossierSha256,'SEALED_DOSSIER_BYTES');const dossier=JSON.parse(bytes);
  validateReadOnlyObjective(dossier.objective);const objective=dossier.objective;
  assert.equal(objective.jobName,BINDING.job);assert.equal(objective.purpose,BINDING.purpose);
  for(const key of ['objectiveSha256','sourceSha256','bundleSha256'])assert.equal(objective[key],BINDING[key]);
  assert.equal(dossier.bundle.request.phase,'PRE');return dossier;
}
function operationalMarker(comments,record,actors){
  const prefix='<!-- codex-general-prospective-pre-authorization:v1';
  const candidates=comments.filter(c=>actors.includes(c.user?.login)&&c.user.type==='User'&&typeof c.body==='string'&&c.body.includes(prefix));
  candidates.sort((a,b)=>b.id-a.id);assert(candidates.length,'PROSPECTIVE_OPERATIONAL_MARKER_REQUIRED');
  const comment=candidates[0],start=comment.body.indexOf(prefix),end=comment.body.indexOf('-->',start+prefix.length);
  assert(comment.body.length<=65536&&start===comment.body.lastIndexOf(prefix)&&end>start);
  const marker=JSON.parse(comment.body.slice(start+prefix.length,end).trim());
  dataFields(marker,['schemaVersion','executor','capabilityId','authorityRecordSha256','driverCommit','grantDigest','jiraObservationSha256','expiresAt','businessMutation']);
  assert.equal(marker.schemaVersion,1);assert.equal(marker.executor,'Codex');assert.equal(marker.capabilityId,record.capabilityId);
  assert.equal(marker.authorityRecordSha256,digest(record));assert.equal(marker.driverCommit,record.source.commit);
  assert.equal(marker.businessMutation,false);return{marker,comment};
}
async function protectedSource(github,record,grant,actor){
  const source=record.source,pull=await github.get(API+'pulls/'+source.pr);
  assert.equal(pull.number,source.pr);assert.equal(pull.head.sha,source.head);assert.equal(pull.merge_commit_sha,source.commit);
  assert.equal(pull.base.ref,'develop');assert.equal(pull.base.repo.full_name,REPO);assert.equal(pull.head.repo.full_name,REPO);
  assert.equal(pull.merged,true);assert.equal(pull.draft,false);assert.equal(pull.auto_merge,null);assert(grant.authenticatedActors.includes(pull.merged_by.login));
  const labels=new Set(pull.labels.map(l=>l.name));assert(labels.has('codex-delegated-approved'));assert(!labels.has('po-approved')&&!labels.has('policy-approved'));
  const files=await github.pages(API+'pulls/'+source.pr+'/files'),checks=await github.pages(API+'commits/'+source.head+'/check-runs','check_runs');
  validateRequiredChecks([...DELEGATED_CHECKS,'simulate','pr-policy'],checks,{expectedSha:source.head});
  const comments=await github.pages(API+'issues/'+source.pr+'/comments');
  const timeline=await github.pages(API+'issues/'+source.pr+'/timeline');assert(!timeline.some(e=>['auto_merge_enabled','auto_merge_disabled'].includes(e.event)));
  const threads=await github.reviewThreads(source.pr);assert(!threads.reviewThreads.pageInfo.hasNextPage);
  assert(threads.reviewThreads.nodes.every(t=>t.isResolved));assert(!threads.reviews.nodes.some(r=>r.state==='CHANGES_REQUESTED'));
  const headGrant=JSON.parse(await githubFile(github,GRANT_PATH,source.head));assert.equal(grantDigest(headGrant),grantDigest(grant));
  validateDelegatedDecision({decision:selectDelegatedDecision(comments,grant.authenticatedActors),grant,repository:REPO,actor,base:'develop',
    changedFiles:files.map(f=>f.filename),reasons:['production','audited-repository-tooling'],headSha:source.head,pullRequestNumber:source.pr,
    requiredChecks:DELEGATED_CHECKS,checkRuns:checks,mergedAt:pull.merged_at,headGrantDigest:grantDigest(headGrant)});
  const tree=await github.get(API+'git/commits/'+source.commit);assert.equal(tree.tree.sha,source.tree);
  await verifyProtectedFilesSequentially(github,source);
  return comments;
}
async function verifyProtectedFilesSequentially(github,source,index=0){
  assert(Number.isSafeInteger(index)&&index>=0&&index<=PROSPECTIVE_DRIVER_INPUTS.length,'SOURCE_READ_BOUND');
  if(index===source.files.length){return;}
  const file=source.files[index];assert.equal(byteHash(await githubFile(github,file.path,source.commit)),file.sha256,'PROTECTED_SOURCE_BYTES');
  return verifyProtectedFilesSequentially(github,source,index+1);
}
// This is the real governance adapter, not a boolean/no-op authorization hook.
// Existing grant/check/policy validators and an explicit native Jira schema are
// composed here, without a bot gate or a connector-to-UI relabeling fallback.
export async function authorizeProspectiveGeneralPre({github,record,jiraBytes,localSource,clock=Date.now}){
  const began=clock();validateProspectiveAuthorityRecord(record,began);
  assert.deepEqual(localSource,{...record.source,clean:true},'LOCAL_FINAL_PROTECTED_SOURCE_REQUIRED');
  const user=await github.get('/user');assert.equal(user.type,'User');const actor=user.login;
  const branch=await github.get(API+'branches/develop');assert.equal(branch.protected,true);assert(SHA.test(branch.commit.sha));
  const protection=await github.get(API+'branches/develop/protection');assert.equal(protection.enforce_admins.enabled,true);
  assert.equal(protection.required_status_checks.strict,true);assert(protection.required_status_checks.contexts.includes('pr-policy'));
  assert.equal(protection.required_conversation_resolution.enabled,true);assert.equal(protection.allow_force_pushes.enabled,false);assert.equal(protection.allow_deletions.enabled,false);
  const revision=branch.commit.sha,grant=JSON.parse(await githubFile(github,GRANT_PATH,revision));
  validateGrant(grant,{repository:REPO,actor,base:'develop',reasons:['production','audited-repository-tooling']});assert.equal(grant.id,'crm-ynov-po-delegation-20261001');
  validateProtectedCodeReviewPolicy(JSON.parse(await githubFile(github,GITHUB_CODE_REVIEW_POLICY_PATH,revision)),REPO);
  const comparison=await github.get(API+'compare/'+record.source.commit+'...'+revision);
  assert.equal(comparison.merge_base_commit.sha,record.source.commit);assert(['ahead','identical'].includes(comparison.status));
  const catalogue=JSON.parse(await githubFile(github,'docs/governance/readonly-probe-objectives-v1.json',revision));
  const matches=catalogue.entries.filter(e=>e.id===BINDING.objectiveId);assert.equal(matches.length,1);const entry=matches[0];
  assert.equal(entry.scope,BINDING.purpose);assert.equal(entry.status,'approved');assert.equal(entry.businessMutation,false);
  assert.equal(entry.ticket,'CRMY-63');assert.equal(entry.expiresAt,BINDING.originalExpiresAt);assert.equal(entry.dossierSha256,BINDING.catalogueDossierSha256);
  const comments=await protectedSource(github,record,grant,actor),{marker,comment}=operationalMarker(comments,record,grant.authenticatedActors);
  assert.equal(marker.grantDigest,grantDigest(grant));
  const now=clock();validateProspectiveAuthorityRecord(record,now);assert(now>=began&&now-began<60000,'AUTHORITY_COLLECTION_BOUND');
  const issued=githubTime(comment.updated_at??comment.created_at),expiry=canonicalTime(marker.expiresAt);
  assert(issued<=now&&now-issued<600000&&expiry>now&&expiry-issued<=600000,'FRESH_OPERATIONAL_AUTHORITY_REQUIRED');
  const jira=validateNativeJiraReadObservation(jiraBytes,{expectedSha256:marker.jiraObservationSha256,actor,grantSha256:grantDigest(grant),now});
  assert.equal((await github.get(API+'branches/develop')).commit.sha,revision,'PROTECTED_AUTHORITY_DRIFT');
  const authority={entry:{scope:BINDING.purpose},receipt:{verifiedAt:new Date(now).toISOString(),
    expiresAt:new Date(Math.min(expiry,canonicalTime(record.expiresAt),Date.parse(jira.observedAt)+600000)).toISOString(),
    capabilityId:record.capabilityId,authorityRecordSha256:digest(record),authorityRevision:revision,
    jiraObservationSha256:byteHash(jiraBytes),humanAuthorityReceiptSha256:record.humanAuthorityReceiptSha256,
    jiraEvidenceSource:jira.source,jiraAccountId:jira.accountId,jiraCloudId:jira.cloudId,jiraInvocationId:jira.invocationId,
    jiraProviderCryptographicSignatureAsserted:false,
    driverCommit:record.source.commit,grantDigest:grantDigest(grant),operationalCommentId:comment.id,
    gitHubCodeReviewRequired:false,businessMutationAuthorized:false}};
  assertAuthorityCurrent(authority,clock());return Object.freeze(authority);
}
