// Historical protected253 catalogue targets driver252, not this unprotected corrected candidate.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {POOL_DRIVER_INPUTS} from '../pool-operational-driver-v1.mjs';
import {classifyApprovalMode} from '../../../pr-policy/policy.mjs';
const root=new URL('../../../../',import.meta.url);
const current=JSON.parse(fs.readFileSync(new URL('docs/governance/readonly-probe-objectives-v1.json',root)));
const historical=JSON.parse(fs.readFileSync(new URL("scripts/ci/pool-reconciliation/tests/fixtures/readonly-concrete-objectives-250-20261027.json",root)));
const sha256=b=>createHash('sha256').update(b).digest('hex');
const expectedDriver={"pr":252,"head":"1c53113eb7b29bd13a5bbfeb5f92ff25bb399dc2","mergeCommit":"3ea1484fe77f6a3d5078af947dc5bd15986f846a","tree":"437b33a97a63c780b73bfafbbc645e2f16990215"},expectedFilesSha256="b98133897bef715f2ee94fde6bf5f98f2ff1627ccd482ef0914e546a4583c056";
const objectiveReviewPr=253,validFrom="2026-10-27T19:42:11.265Z";
const scopes=['POOL_RECONCILIATION_READ_ONLY_V1','GENERAL_PRESERVATION_READ_ONLY_V1','SCHEMA_LEDGER_READ_ONLY_V1'];
test('rebound catalogue preserves exactly the same three existing PRE identities',()=>{
  assert.deepEqual(Object.keys(current).sort((a,b)=>a.localeCompare(b,'en')),['entries','schemaVersion']);
  assert.equal(current.schemaVersion,1);assert.equal(current.entries.length,3);
  assert.deepEqual(current.entries.map(e=>e.scope),scopes);
  assert.deepEqual(current.entries.map(e=>e.id),historical.entries.map(e=>e.id));
  assert.equal(new Set(current.entries.map(e=>e.dossierSha256)).size,3);
  assert.equal(new Set(current.entries.map(e=>e.journalDirectorySha256)).size,3);
});
for(const scope of scopes)test(scope+' binds actual corrected driver and real conversion container, not native acceptance',()=>{
  const entry=current.entries.find(e=>e.scope===scope),prior=historical.entries.find(e=>e.scope===scope);
  assert.deepEqual({...entry,driver:prior.driver,objectiveReview:prior.objectiveReview,validFrom:prior.validFrom},prior);
  assert.deepEqual(entry.objectiveReview,{pr:objectiveReviewPr});
  assert.equal(entry.validFrom,validFrom);assert.equal(entry.expiresAt,'2026-10-28T08:00:00.000Z');
  assert(Date.parse(entry.expiresAt)>Date.parse(entry.validFrom));
  assert(Date.parse(entry.expiresAt)-Date.parse(entry.validFrom)<=86400000);
  assert.deepEqual(Object.keys(entry.driver).sort((a,b)=>a.localeCompare(b,'en')),['files','head','mergeCommit','pr','tree']);
  for(const key of ['pr','head','mergeCommit','tree'])assert.equal(entry.driver[key],expectedDriver[key]);
  assert.equal(entry.driver.files.length,38);assert.deepEqual(entry.driver.files.map(f=>f.path),POOL_DRIVER_INPUTS);
  assert.equal(sha256(JSON.stringify(entry.driver.files)),expectedFilesSha256);
  for(const file of entry.driver.files){
    const historicalAdapter=file.path==='scripts/ci/pool-reconciliation/pool-driver-github-v1.mjs';
    const proofPath=historicalAdapter?'scripts/ci/pool-reconciliation/tests/fixtures/pool-driver-github-protected252-20261027.md':file.path;
    assert.equal(sha256(fs.readFileSync(new URL(proofPath,root))),file.sha256);
  }
  assert.equal(entry.businessMutation,false);
});
test('historical raw-source proof packaging stays within the unchanged protected tooling delegation',()=>{
  const grant=JSON.parse(fs.readFileSync(new URL('docs/governance/codex-delegation.json',root)));
  const changedFiles=['scripts/ci/pool-reconciliation/OPERATIONAL-INTEGRATION.md','scripts/ci/pool-reconciliation/pool-driver-github-v1.mjs','scripts/ci/pool-reconciliation/tests/pool-driver-github-v1.test.mjs','scripts/ci/pool-reconciliation/tests/readonly-concrete-objectives-v3.test.mjs','scripts/ci/pool-reconciliation/tests/fixtures/pool-driver-github-protected252-20261027.md'];
  const input={ticket:{scope:'prod'},defaultMode:'delegated-codex',migrationAssessment:{applicable:false},trustedGrant:grant,repository:'shademounir/CrmYnov',actor:'shademounir',base:'develop'};
  const result=classifyApprovalMode({...input,changedFiles});
  assert.equal(result.effectiveApprovalMode,'delegated-codex');
  assert(result.reasons.every(reason=>!reason.startsWith('ambiguous')));
  assert.throws(()=>classifyApprovalMode({...input,changedFiles:[changedFiles.at(-1).replace(/\.md$/u,'.txt')]}),/delegation_unresolved_scope_or_migration/u);
});
