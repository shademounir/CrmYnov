// Existing protected READ ONLY catalogue and merge gates, not a new authority.
import assert from 'node:assert/strict';import{createHash}from'node:crypto';
import{githubFile}from'../readonly-probe/probe-driver-authority-v1.mjs';
import{digest as poolDigest,TRUSTED_INTENT_SHA256}from'../pool-reconciliation/controlled-pool-contract-v1.mjs';
import{READONLY_RUNTIME_FILES}from'../pool-reconciliation/pool-job-dossier-v1.mjs';
import{POOL_DRIVER_INPUTS}from'../pool-reconciliation/pool-operational-driver-v1.mjs';
import{approvedMerge,verifySource}from'./protected-gates.mjs';
import{validateImagePreparationJobs}from'./preparation-jobs.mjs';
const ROOT='/repos/shademounir/CrmYnov/',CATALOG='docs/governance/readonly-probe-objectives-v1.json',H=/^[a-f0-9]{64}$/u,hash=b=>createHash('sha256').update(b).digest('hex');
export async function verifyImagePreparationOrigins(github,candidate,{revision,grant,actor,now,driver}){
  const specs=structuredClone(validateImagePreparationJobs(candidate));if(specs.length===0){return;}
  const catalog=JSON.parse(await githubFile(github,CATALOG,revision));assert.equal(catalog.schemaVersion,1);assert(Array.isArray(catalog.entries)&&catalog.entries.length<=100);
  const checkedSources=new Map(),checkedMerges=new Map();
  if(driver){checkedMerges.set(driver.pull.number,driver);}
  async function approved(reference){const old=checkedMerges.get(reference.pr);if(old){assert.equal(old.pull.head.sha,reference.head);assert.equal(old.pull.merge_commit_sha,reference.mergeCommit);return old;}const value=await approvedMerge(github,reference,{grant,actor,base:'develop'});checkedMerges.set(reference.pr,value);return value;}
  for(const spec of specs){
    const rows=catalog.entries.filter(e=>e.id===spec.objectiveId);assert.equal(rows.length,1,'PROTECTED_PREPARATION_OBJECTIVE_REQUIRED');const e=rows[0];
    assert.equal(e.schemaVersion,1);assert.equal(e.status,'approved');assert.equal(e.scope,spec.dossier.objective.purpose);assert.equal(e.ticket,'CRMY-63');assert.equal(e.businessMutation,false);assert(e.actions.includes('RUN')&&e.actions.includes('READ_OUTPUT'));assert.equal(e.originalIntentSha256,TRUSTED_INTENT_SHA256);
    assert.equal(e.googleAccount,'casablancaynovcampus@gmail.com');assert.equal(e.release.pr,243);assert.equal(e.release.mergeCommit,'8253024ea35cee6be5636cc6b10a88ae7e177377');assert.equal(e.release.releaseId,424492409);assert.equal(e.release.tag,'v0.1.0-rc.48');assert.deepEqual(e.driver.files.map(f=>f.path),POOL_DRIVER_INPUTS,'EXISTING_38_READONLY_DRIVER_INPUTS');
    assert(Number.isSafeInteger(now)&&Date.parse(e.validFrom)<=now&&now<Date.parse(e.expiresAt),'PREPARATION_OBJECTIVE_CURRENT');assert.equal(poolDigest(e),spec.catalogEntrySha256);assert.equal(e.dossierSha256,poolDigest(spec.dossier));for(const k of ['humanAuthorityReceiptSha256','independentInputsSha256','journalDirectorySha256']){assert(H.test(e[k]));}
    for(const [name,file]of Object.entries(READONLY_RUNTIME_FILES)){
      const p=file.startsWith('../readonly-probe/')?'scripts/ci/readonly-probe/'+file.slice('../readonly-probe/'.length):'scripts/ci/pool-reconciliation/'+file;
      const input=e.driver.files.filter(f=>f.path===p);assert.equal(input.length,1);assert.equal(hash(spec.dossier.bundle.modules[name].source),input[0].sha256,'PROTECTED_PRE_COLLECTOR_MODULE_BYTES');
    }
    const source={commit:e.driver.mergeCommit,tree:e.driver.tree,clean:true,files:e.driver.files},old=checkedSources.get(source.commit);
    if(old){assert.deepEqual(old,source);}else{const commit=await github.get(ROOT+'git/commits/'+source.commit);assert.equal(commit.tree.sha,source.tree,'ACTUAL_PRE_DRIVER_TREE');await verifySource(github,source,e);checkedSources.set(source.commit,source);}
    await approved(e.driver);assert.deepEqual(Object.keys(e.objectiveReview),['pr']);
    const reused=checkedMerges.get(e.objectiveReview.pr),pull=reused?.pull??await github.get(ROOT+'pulls/'+e.objectiveReview.pr),ref={pr:e.objectiveReview.pr,head:pull.head.sha,mergeCommit:pull.merge_commit_sha},objective=await approved(ref);
    assert(objective.files.some(f=>f.filename===CATALOG));const original=JSON.parse(await githubFile(github,CATALOG,ref.mergeCommit));assert.equal(poolDigest(original.entries.filter(row=>row.id===e.id)),poolDigest([e]));
    for(const commit of new Set([source.commit,ref.mergeCommit])){const comparison=await github.get(ROOT+'compare/'+commit+'...'+revision);assert.equal(comparison.merge_base_commit.sha,commit);assert(['ahead','identical'].includes(comparison.status));}
  }
}
