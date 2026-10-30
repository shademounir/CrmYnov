// Pure path classification and unchanged policy guards. No fixture is read,
// executed, published or attested by this test; the grant is repository data.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {classifyApprovalMode,validatePullRequestPolicy} from '../../pr-policy/policy.mjs';
import {DELEGATED_CHECKS,GRANT_PATH,grantDigest,scopeDigest} from '../../pr-policy/delegation.mjs';

const FIXTURES=[
  'scripts/ci/runtime-image-only/fixtures/c389-local-source.mjs.fixture.txt',
  'scripts/ci/runtime-image-only/fixtures/c389-operational-forward-cli-v2.mjs.fixture.txt',
];
const grant=JSON.parse(fs.readFileSync(new URL('../../../docs/governance/codex-delegation.json',import.meta.url),'utf8'));
const HEAD='a'.repeat(40);
function classification(files=FIXTURES,overrides={}){return{changedFiles:[...files],ticket:{scope:'technical'},defaultMode:'delegated-codex',trustedGrant:structuredClone(grant),repository:'shademounir/CrmYnov',actor:'shademounir',base:'develop',migrationAssessment:{applicable:false},...overrides};}
function policy(){
  const files=[...FIXTURES],checks=DELEGATED_CHECKS.map((name,index)=>({id:index+1,name,head_sha:HEAD,status:'completed',conclusion:'success'}));
  return{approvalMode:'delegated-codex',repository:grant.repository,sourceRepository:grant.repository,actor:'shademounir',allowedActors:['shademounir'],branch:'feature/CRMY-63-audited-raw-dossier-fixtures',base:'develop',draft:false,labels:['codex-delegated-approved'],ticket:{key:'CRMY-63',issueType:'Task',status:'In Progress',labels:['codex-ready'],scope:'technical'},changedFiles:files,trustedGrant:structuredClone(grant),checkSha:HEAD,pullRequestNumber:42,mergeable:true,branchUpToDate:true,conversationsResolved:true,autoMerge:null,checkRuns:checks,requiredChecks:[...DELEGATED_CHECKS],delegatedDecision:{schemaVersion:1,executor:'Codex',decision:'approved',grantId:grant.id,grantDigest:grantDigest(grant),actor:'shademounir',commentId:123,createdAt:'2026-10-01T12:00:00Z',pullRequest:42,headSha:HEAD,scopeDigest:scopeDigest(files),checks:checks.map(({name,id})=>({name,id})),evidence:['https://github.com/shademounir/CrmYnov/actions/runs/123'],reservations:['Synthetic source-only path classification; no content attestation or PROD authority.'],rollback:'New normally protected source reversal only; no runtime or data operation.',personalVisualAcceptance:false,productionDeploymentAuthorized:false}};
}
for(const file of FIXTURES){
  test('exact RAW comparator is delegated repository tooling: '+file,()=>{const value=classifyApprovalMode(classification([file]));assert.equal(value.effectiveApprovalMode,'delegated-codex');assert(value.reasons.includes('audited-repository-tooling'));assert(!value.reasons.some(reason=>reason.startsWith('ambiguous')));});
  test('exact RAW comparator remains manual in ordinary mode: '+file,()=>{const value=classifyApprovalMode(classification([file],{defaultMode:'automated-policy'}));assert.equal(value.effectiveApprovalMode,'manual-po');assert(value.reasons.includes('ambiguous-path'));});
}
test('both exact comparators are admitted together without file contents or native authority',()=>{const value=classifyApprovalMode(classification());assert.deepEqual(value.reasons,['audited-repository-tooling']);assert.equal(value.effectiveApprovalMode,'delegated-codex');});
test('existing repository-relative slash normalization is unchanged',()=>{assert.equal(classifyApprovalMode(classification([FIXTURES[0].replaceAll('/','\\')])).effectiveApprovalMode,'delegated-codex');});
test('manual mode does not borrow the delegated fixture recognition',()=>{const value=classifyApprovalMode(classification(FIXTURES,{defaultMode:'manual-po'}));assert.equal(value.effectiveApprovalMode,'manual-po');assert(value.reasons.includes('ambiguous-path'));});
for(const file of [
  'scripts/ci/runtime-image-only/fixtures/other.txt',
  'scripts/ci/runtime-image-only/fixtures/c390-local-source.mjs.fixture.txt',
  'scripts/ci/runtime-image-only/fixtures/c389-local-source.mjs.txt',
  FIXTURES[0]+'.extra',FIXTURES[0]+' ',FIXTURES[0]+'\n',
  'scripts/ci/runtime-image-only/fixtures/C389-local-source.mjs.fixture.txt',
  'scripts/ci/runtime-image-only/fixtures/subdir/c389-local-source.mjs.fixture.txt',
  'scripts/ci/runtime-image-only/c389-local-source.mjs.fixture.txt',
  'infra/fixtures/c389-local-source.mjs.fixture.txt',
  'scripts/ci/runtime-image-only/fixtures/../fixtures/c389-local-source.mjs.fixture.txt',
  './'+FIXTURES[0],'/'+FIXTURES[0],'C:/'+FIXTURES[0],FIXTURES[0].replace('/fixtures/','//fixtures/'),FIXTURES[0]+'\0',
]){test('unknown/near-miss/malformed RAW path remains refused: '+JSON.stringify(file),()=>{assert.throws(()=>classifyApprovalMode(classification([file])),error=>error.reason==='delegation_unresolved_scope_or_migration');});}
test('an unrecognized neighbour still rejects a mixed changed-file set',()=>{assert.throws(()=>classifyApprovalMode(classification([...FIXTURES,'scripts/ci/runtime-image-only/fixtures/unreviewed.txt'])),error=>error.reason==='delegation_unresolved_scope_or_migration');});
test('existing general mjs tooling classification is not narrowed or represented as RAW content verification',()=>{assert.equal(classifyApprovalMode(classification([FIXTURES[0]+'.mjs'])).effectiveApprovalMode,'delegated-codex');});
test('all existing sensitive reasons survive fixture classification',()=>{const value=classifyApprovalMode(classification([...FIXTURES,'infra/environments/prod/main.tf','scripts/iam/check.mjs','scripts/secrets/check.mjs','docs/governance/scope.md'],{ticket:{scope:'prod'}}));for(const reason of ['audited-repository-tooling','terraform-bootstrap-state','production','iam-wif','secret-configuration','github-governance','ticket-sensitive-scope']){assert(value.reasons.includes(reason),reason);}assert(!value.reasons.includes('ambiguous-path'));});
for(const [name,mutate,reason] of [
  ['missing',value=>{delete value.trustedGrant;},'delegation_grant_missing_or_revoked'],
  ['revoked',value=>{value.trustedGrant.status='revoked';},'delegation_grant_missing_or_revoked'],
  ['repository',value=>{value.trustedGrant.repository='other/repo';},'delegation_grant_identity_mismatch'],
  ['actor',value=>{value.trustedGrant.authenticatedActors=[];},'delegation_actor_not_allowed'],
  ['base',value=>{value.trustedGrant.allowedBases=[];},'delegation_base_not_allowed'],
  ['authority',value=>{value.trustedGrant.authority.reference='';},'delegation_authority_missing'],
  ['scope',value=>{value.trustedGrant.allowedReasons=value.trustedGrant.allowedReasons.filter(reason=>reason!=='audited-repository-tooling');},'delegation_scope_not_authorized'],
  ['grant edit',value=>{value.changedFiles.push(GRANT_PATH);},'delegation_authority_change_requires_manual_po'],
]){test('exact fixture recognition never replaces the protected grant: '+name,()=>{const value=classification();mutate(value);assert.throws(()=>classifyApprovalMode(value),error=>error.reason===reason);});}
test('a normal delegated decision still validates distinctly from human and deployment approval',()=>{const value=validatePullRequestPolicy(policy());assert.equal(value.effectiveApprovalMode,'delegated-codex');assert.equal(value.delegatedApproval.humanApproved,false);assert.equal(value.approvalValidated,true);});
for(const [name,mutate,reason] of [
  ['missing decision',value=>{delete value.delegatedDecision;},'delegated_decision_missing_or_revoked'],
  ['wrong decision scope',value=>{value.delegatedDecision.scopeDigest='b'.repeat(64);},'delegated_decision_scope_mismatch'],
  ['wrong decision head',value=>{value.delegatedDecision.headSha='b'.repeat(40);},'delegated_decision_sha_mismatch'],
  ['stale examined check',value=>{value.delegatedDecision.checks[0].id=999;},'delegated_check_not_examined'],
  ['missing check',value=>{value.checkRuns=[];},'delegated_check_not_successful'],
  ['failed check',value=>{value.checkRuns[0].conclusion='failure';},'delegated_check_not_successful'],
  ['unresolved conversation',value=>{value.conversationsResolved=false;},'conversations_unresolved'],
  ['auto merge',value=>{value.autoMerge={};},'delegated_native_auto_merge_forbidden'],
  ['personal approval claim',value=>{value.delegatedDecision.personalVisualAcceptance=true;},'delegated_decision_misrepresents_acceptance_or_deployment'],
  ['deployment claim',value=>{value.delegatedDecision.productionDeploymentAuthorized=true;},'delegated_decision_misrepresents_acceptance_or_deployment'],
]){test('exact fixture recognition preserves the decision/check/control guard: '+name,()=>{const value=policy();mutate(value);assert.throws(()=>validatePullRequestPolicy(value),error=>error.reason===reason);});}
