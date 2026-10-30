// Existing protected READ ONLY catalogue and merge gates, not a new authority.
import assert from 'node:assert/strict';import{createHash}from'node:crypto';
import{githubFile}from'../readonly-probe/probe-driver-authority-v1.mjs';
import{digest as poolDigest,TRUSTED_INTENT_SHA256}from'../pool-reconciliation/controlled-pool-contract-v1.mjs';
import{READONLY_RUNTIME_FILES}from'../pool-reconciliation/pool-job-dossier-v1.mjs';
import{POOL_DRIVER_INPUTS}from'../pool-reconciliation/pool-operational-driver-v1.mjs';
import{approvedMerge,verifySource}from'./protected-gates.mjs';
import{validateImagePreparationJobs}from'./preparation-jobs.mjs';
import{resolveImageCatalogueReviewV2,READONLY_CATALOGUE_PATH_V2,validateImageCatalogueReviewV2}from'./catalogue-origin-v2.mjs';
import{OPERATIONAL_HUMAN_SHA256}from'./late-binding-v2.mjs';
const ROOT='/repos/shademounir/CrmYnov/',CATALOG='docs/governance/readonly-probe-objectives-v1.json',H=/^[a-f0-9]{64}$/u,hash=b=>createHash('sha256').update(b).digest('hex');
function modulePath(file){
  if(file.startsWith('../readonly-probe/')){return 'scripts/ci/readonly-probe/'+file.slice('../readonly-probe/'.length);}
  return 'scripts/ci/pool-reconciliation/'+file;
}
function validatePreparationEntry(spec,e,now){
  assert.equal(e.schemaVersion,1);assert.equal(e.status,'approved');assert.equal(e.scope,spec.dossier.objective.purpose);assert.equal(e.ticket,'CRMY-63');assert.equal(e.businessMutation,false);assert(e.actions.includes('RUN')&&e.actions.includes('READ_OUTPUT'));assert.equal(e.originalIntentSha256,TRUSTED_INTENT_SHA256);
  assert.equal(e.googleAccount,'casablancaynovcampus@gmail.com');assert.equal(e.release.pr,243);assert.equal(e.release.mergeCommit,'8253024ea35cee6be5636cc6b10a88ae7e177377');assert.equal(e.release.releaseId,424492409);assert.equal(e.release.tag,'v0.1.0-rc.48');assert.deepEqual(e.driver.files.map(f=>f.path),POOL_DRIVER_INPUTS,'EXISTING_38_READONLY_DRIVER_INPUTS');
  assert(Number.isSafeInteger(now)&&Date.parse(e.validFrom)<=now&&now<Date.parse(e.expiresAt),'PREPARATION_OBJECTIVE_CURRENT');assert.equal(poolDigest(e),spec.catalogEntrySha256);assert.equal(e.dossierSha256,poolDigest(spec.dossier));
  for(const k of ['humanAuthorityReceiptSha256','independentInputsSha256','journalDirectorySha256']){assert(H.test(e[k]));}
  for(const [name,file]of Object.entries(READONLY_RUNTIME_FILES)){
    const input=e.driver.files.filter(f=>f.path===modulePath(file));assert.equal(input.length,1);assert.equal(hash(spec.dossier.bundle.modules[name].source),input[0].sha256,'PROTECTED_PRE_COLLECTOR_MODULE_BYTES');
  }
}
function approvedReader(github,{grant,actor,driver}){
  const cache=new Map();if(driver){cache.set(driver.pull.number,driver);}
  return {cache,async read(reference){
    const old=cache.get(reference.pr);if(old){assert.equal(old.pull.head.sha,reference.head);assert.equal(old.pull.merge_commit_sha,reference.mergeCommit);return old;}
    const value=await approvedMerge(github,reference,{grant,actor,base:'develop'});cache.set(reference.pr,value);return value;
  }};
}
async function verifyCollectorSource(github,e,cache){
  const source={commit:e.driver.mergeCommit,tree:e.driver.tree,clean:true,files:e.driver.files},old=cache.get(source.commit);
  if(old){assert.deepEqual(old,source);return source;}
  const commit=await github.get(ROOT+'git/commits/'+source.commit);assert.equal(commit.tree.sha,source.tree,'ACTUAL_PRE_DRIVER_TREE');await verifySource(github,source,e);cache.set(source.commit,source);return source;
}
async function verifyObjectiveOrigin(github,e,source,revision,approved,postV2=false){
  await approved.read(e.driver);let ref;
  if(postV2){ref=await resolveImageCatalogueReviewV2(github,{descriptor:e.objectiveReview,revision,expectedPath:READONLY_CATALOGUE_PATH_V2});}
  else{assert.deepEqual(Object.keys(e.objectiveReview),['pr']);const reused=approved.cache.get(e.objectiveReview.pr),pull=reused?.pull??await github.get(ROOT+'pulls/'+e.objectiveReview.pr);ref={pr:e.objectiveReview.pr,head:pull.head.sha,mergeCommit:pull.merge_commit_sha};}
  const objective=await approved.read(ref);
  assert(objective.files.some(f=>f.filename===CATALOG));const original=JSON.parse(await githubFile(github,CATALOG,ref.mergeCommit));assert.equal(poolDigest(original.entries.filter(row=>row.id===e.id)),poolDigest([e]));
  await Promise.all([...new Set([source.commit,ref.mergeCommit])].map(async commit=>{const comparison=await github.get(ROOT+'compare/'+commit+'...'+revision);assert.equal(comparison.merge_base_commit.sha,commit);assert(['ahead','identical'].includes(comparison.status));}));
}
export async function verifyImagePreparationOrigins(github,candidate,{revision,grant,actor,now,driver,readEvidence,protectedSource}){
  const specs=structuredClone(validateImagePreparationJobs(candidate));if(specs.length===0){return;}
  const catalogBytes=await githubFile(github,CATALOG,revision),catalog=JSON.parse(catalogBytes);assert.equal(catalog.schemaVersion,1);assert(Array.isArray(catalog.entries)&&catalog.entries.length<=100);
  const checkedSources=new Map(),approved=approvedReader(github,{grant,actor,driver});
  async function verifyAt(index){
    if(index>=specs.length){return;}
    const spec=specs[index],rows=catalog.entries.filter(e=>e.id===spec.objectiveId);assert.equal(rows.length,1,'PROTECTED_PREPARATION_OBJECTIVE_REQUIRED');const e=rows[0];
    const at=preparationAuthorityTime(spec,now,readEvidence),effectiveSpec=spec.postAdmissionVersion===2?await checkedPostOriginSpec(github,{spec,e,catalog,revision,readEvidence,now}):spec;
    const postV2=spec.postAdmissionVersion===2&&e.schemaVersion===2;
    if(postV2){validatePostPreparationEntryV2(effectiveSpec,e,at,protectedSource);}else{validatePreparationEntry(effectiveSpec,e,at);}
    const source=await verifyCollectorSource(github,e,checkedSources);await verifyObjectiveOrigin(github,e,source,revision,approved,postV2);return verifyAt(index+1);
  }
  await verifyAt(0);
}
function readPinned(ref,reader){assert.equal(typeof reader,'function','READ_ONLY_ADMISSION_EVIDENCE_READER_REQUIRED');const bytes=reader(ref.path);assert(Buffer.isBuffer(bytes)&&bytes.length<=1048576);assert.equal(hash(bytes),ref.sha256,'READ_ONLY_ADMISSION_EVIDENCE_CHANGED');return JSON.parse(bytes);}
function preparationAuthorityTime(spec,now,readEvidence){
  if(spec.schemaVersion!==2){return now;}
  if(spec.admission.kind==='HISTORICAL_LEDGER_FIN'){
    const at=Date.parse(spec.admission.startedAt);assert(Number.isSafeInteger(at)&&at<=Date.parse(spec.admission.completedAt)&&Date.parse(spec.admission.completedAt)<=now,'LEDGER_ACTUAL_EXECUTION_DATES_REQUIRED');
    const evidence=readPinned(spec.admission.authorityObservation,readEvidence);assert.equal(evidence.objectiveId,spec.objectiveId);assert(Date.parse(evidence.at)<=at&&at<Date.parse(evidence.expiresAt),'LEDGER_AUTHORITY_AT_EXECUTION_NOT_NOW');return at;
  }
  // Historical lineage only; the new prospective record is independently
  // source-checked before its separate durable RUN claim may be consumed.
  const at=Date.parse(spec.dossier.objective.intentAt);assert(Number.isSafeInteger(at)&&at<=now,'GENERAL_ORIGINAL_COLLECTOR_INTENT_TIME_REQUIRED');return at;
}
async function checkedPostOriginSpec(github,{spec,e,catalog,revision,readEvidence,now}){
  const origin=readPinned(spec.objectiveOrigin,readEvidence);assert.deepEqual(Object.keys(origin).sort(),['catalogRevision','entry']);assert.match(origin.catalogRevision,/^[a-f0-9]{40}$/u);assert.deepEqual(origin.entry,e,'POST_EXACT_CURRENT_PROTECTED_ENTRY_REQUIRED');assert.equal(poolDigest(origin.entry),spec.authorityRecordSha256,'POST_ACTUAL_RECORD_PIN_REQUIRED');
  const historical=origin.catalogRevision===revision?catalog:JSON.parse(await githubFile(github,CATALOG,origin.catalogRevision));assert.equal(historical.schemaVersion,1);assert.equal(poolDigest(historical.entries.filter(row=>row.id===spec.objectiveId)),poolDigest([e]));
  if(origin.catalogRevision!==revision){const relation=await github.get(ROOT+'compare/'+origin.catalogRevision+'...'+revision);assert.equal(relation.merge_base_commit.sha,origin.catalogRevision);assert(['ahead','identical'].includes(relation.status));}
  const observation=readPinned(spec.jobObservation,readEvidence);assert.equal(observation.request?.method,'GET');assert.equal(observation.request?.url,'https://run.googleapis.com/v2/'+spec.dossier.objective.jobName);assert.equal(observation.response?.status,200);assert.equal(observation.response?.projection?.uid,spec.uid);assert(Date.parse(observation.responseReceivedAt)<=now,'POST_JOB_REAL_OBSERVATION_REQUIRED');return{...spec,catalogEntrySha256:poolDigest(e)};
}
function validatePostPreparationEntryV2(spec,e,now,source){
  assert.equal(e.schemaVersion,2);assert.equal(e.status,'approved');assert.equal(e.scope,'GENERAL_PRESERVATION_READ_ONLY_V1');assert.equal(e.ticket,'CRMY-63');assert.equal(e.businessMutation,false);assert(e.actions.includes('RUN')&&e.actions.includes('READ_OUTPUT'));assert.equal(e.googleAccount,'casablancaynovcampus@gmail.com');assert.equal(e.humanAuthorityReceiptSha256,OPERATIONAL_HUMAN_SHA256);
  assert.equal(spec.dossier.bundle.request.phase,'POST');assert.equal(poolDigest(e),spec.catalogEntrySha256);assert.equal(e.dossierSha256,poolDigest(spec.dossier));assert.equal(e.release.pr,243);assert.equal(e.release.mergeCommit,'8253024ea35cee6be5636cc6b10a88ae7e177377');assert.equal(e.release.releaseId,424492409);assert.equal(e.release.tag,'v0.1.0-rc.48');
  assert(source&&source.clean,'POST_PROTECTED_CLOSED_OPERATIONAL_SOURCE_REQUIRED');assert.equal(source.commit,e.driver.mergeCommit);assert.equal(source.tree,e.driver.tree);assert.deepEqual(e.driver.files,source.files,'POST_EXACT_SOURCE_CLOSURE_NOT_ARBITRARY_SUPERSET');assert(POOL_DRIVER_INPUTS.every(file=>source.files.some(row=>row.path===file)),'POST_MUST_RETAIN_ALL_38_COLLECTOR_INPUTS');
  for(const [name,file]of Object.entries(READONLY_RUNTIME_FILES)){const row=source.files.filter(input=>input.path===modulePath(file));assert.equal(row.length,1);assert.equal(row[0].sha256,hash(spec.dossier.bundle.modules[name].source),'POST_QUALIFIED_INLINE_COLLECTOR_BYTES');}
  assert(Number.isSafeInteger(now)&&Date.parse(e.validFrom)<=now&&now<Date.parse(e.expiresAt),'POST_CURRENT_AUTHORITY_REQUIRED');validateImageCatalogueReviewV2(e.objectiveReview,READONLY_CATALOGUE_PATH_V2);
}
