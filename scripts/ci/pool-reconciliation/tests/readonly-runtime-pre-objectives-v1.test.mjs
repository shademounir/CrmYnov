// Concrete fresh PRE pair; five historical objectives remain byte-equivalent.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {createHash} from 'node:crypto';
import {POOL_DRIVER_INPUTS} from '../pool-operational-driver-v1.mjs';
import {IMAGE_OPERATIONAL_DRIVER_INPUTS_V4} from '../../runtime-image-only/local-source.mjs';
import {verifySource} from '../../runtime-image-only/protected-gates.mjs';

const root=new URL('../../../../',import.meta.url),oldPath='scripts/ci/pool-reconciliation/tests/fixtures/readonly-concrete-objectives-262-20261028.json',read=p=>JSON.parse(fs.readFileSync(new URL(p,root))),prior=read(oldPath),current=read('scripts/ci/pool-reconciliation/tests/fixtures/readonly-probe-objectives-before-operational-273-20261030.json');
const expected=[{"id":"rc48-general-pre-20261028-147f390728","scope":"GENERAL_PRESERVATION_READ_ONLY_V1","dossierSha256":"d388c05e23b9b13f355b71c6f4d598207fba7d97b5b5aff8f4a058ba2875098f","journalDirectorySha256":"5714f004a255834e02931340a64cde2d96fefbb0fce9d86ad31a4077d9afb43e","humanAuthorityReceiptSha256":"85aa40f017f9bd457dbeb7787a2a8eb528ec9804b306d8665e2b54fee1699497","validFrom":"2026-10-28T14:35:01.178Z","expiresAt":"2026-10-29T14:35:01.178Z","freshEvidence":{"reason":"KNOWN_FIN_PREVIOUS_CAPTURE_NOT_CURRENT_RUNTIME_PRE","previousObjectiveId":"rc48-general-pre-20261027-febce8cb70","previousJobName":"projects/crmynov-prod-n7x4q2/locations/europe-west1/jobs/crm-prod-preservation-pre-20261027-febce8cb70","knownFinReceiptSha256":"2ea79cf1e3707ee0c290814972618114b3aed0a51486af366e98cce968be2e17","originalCreateRunMustNotBeReplayed":true,"noNewBaselineOrCohort":true}},{"id":"rc48-ledger-pre-20261028-61c3d8859d","scope":"SCHEMA_LEDGER_READ_ONLY_V1","dossierSha256":"5221cdbcc35dfcc326c7ea1c6d5360bb8d0a1ef246601f804d58d425bf0fe282","journalDirectorySha256":"cb59510f6a586c809e794911cd8a03e951397c9a4836420b1896b3ff2c2c37e7","humanAuthorityReceiptSha256":"85aa40f017f9bd457dbeb7787a2a8eb528ec9804b306d8665e2b54fee1699497","validFrom":"2026-10-28T14:35:01.178Z","expiresAt":"2026-10-29T14:35:01.178Z","freshEvidence":{"reason":"KNOWN_FIN_PREVIOUS_CAPTURE_NOT_CURRENT_RUNTIME_PRE","previousObjectiveId":"rc48-ledger-pre-20261028-f4b3d88b78","previousJobName":"projects/crmynov-prod-n7x4q2/locations/europe-west1/jobs/crm-prod-schema-ledger-pre-20261028-f4b3d88b78","knownFinReceiptSha256":"a57e679937cb1513071d9e9c7abc4e8d2e6deed30fb12bf61ee3fb2cac52f25d","originalCreateRunMustNotBeReplayed":true,"noNewBaselineOrCohort":true}}];
test('current catalogue retains all five original objectives and only adds the real General/Ledger PRE pair',()=>{
 assert.equal(createHash('sha256').update(fs.readFileSync(new URL(oldPath,root))).digest('hex'),'0afbe980b99db68463d5ba8777873f48f40a8db68597f098c650ab961059ef66');
 assert.deepEqual(Object.keys(current).sort((a,b)=>a.localeCompare(b,'en')),['entries','schemaVersion']);assert.equal(current.schemaVersion,1);assert.equal(current.entries.length,7);assert.deepEqual(current.entries.slice(0,5),prior.entries);
 for(const key of ['id','dossierSha256','journalDirectorySha256']){assert.equal(new Set(current.entries.map(e=>e[key])).size,7);}
 assert.deepEqual(current.entries.slice(5).map(e=>e.id),expected.map(e=>e.id));
});
for(const pin of expected){test(pin.scope+' concrete new objective binds its actual dossier, existing38source and knownFIN predecessor',async()=>{
 const e=current.entries.find(row=>row.id===pin.id),old=prior.entries.find(row=>row.scope===pin.scope);
 for(const key of Object.keys(pin)){assert.deepEqual(e[key],pin[key]);}
 assert.equal(e.schemaVersion,1);assert.equal(e.status,'approved');assert.equal(e.businessMutation,false);assert.equal(e.ticket,'CRMY-63');assert.deepEqual(e.objectiveReview,{pr:265});assert.equal(e.googleAccount,'casablancaynovcampus@gmail.com');
 assert.deepEqual(e.driver,old.driver);assert.deepEqual(e.release,old.release);assert.deepEqual(e.actions,old.actions);assert.equal(e.originalIntentSha256,old.originalIntentSha256);assert.equal(e.independentInputsSha256,old.independentInputsSha256);
 assert(Date.parse(e.expiresAt)>Date.parse(e.validFrom)&&Date.parse(e.expiresAt)-Date.parse(e.validFrom)<=86400000);assert.notEqual(e.dossierSha256,old.dossierSha256);assert.notEqual(e.journalDirectorySha256,old.journalDirectorySha256);
 assert.equal(e.freshEvidence.originalCreateRunMustNotBeReplayed,true);assert.equal(e.freshEvidence.noNewBaselineOrCohort,true);assert(prior.entries.some(row=>row.id===e.freshEvidence.previousObjectiveId));assert.match(e.freshEvidence.knownFinReceiptSha256,/^[a-f0-9]{64}$/u);
 assert.deepEqual(e.driver.files.map(f=>f.path),POOL_DRIVER_INPUTS);assert.equal(e.driver.files.length,38);
 for(const file of e.driver.files){assert.equal(createHash('sha256').update(historicalDriverBytesV4(file.path)).digest('hex'),file.sha256);}
 await rejectCurrentV4FilesUnderHistoricalIdentityV4(e);
});}

// Closed historical comparison only: never accept an arbitrary append or retarget
// an old objective. The full current V4 bytes are pinned before the old prefix.
const historicalPoolPath='scripts/ci/pool-reconciliation/pool-native-output-v1.mjs';
function historicalDriverBytesV4(file){
 const bytes=fs.readFileSync(new URL(file,root));if(file!==historicalPoolPath)return bytes;
 assert.equal(bytes.length,20039);assert.equal(createHash('sha256').update(bytes).digest('hex'),'68df9b59b155809707420fba7bdd37350c65829bc0d5ba242746b4cec60062fe');
 const historical=bytes.subarray(0,19204);assert.equal(createHash('sha256').update(historical).digest('hex'),'483b2f21c903d7d04e9b7e9ee3316934e89cc9cae272c111911c674be30f9ada');return historical;
}
async function rejectCurrentV4FilesUnderHistoricalIdentityV4(entry){
 let calls=0;const github={get(){calls++;throw new Error('UNEXPECTED_SYNTHETIC_GITHUB_CALL');}};
 // Deliberately inconsistent negative-test data, never an observed source,
 // approved catalogue, native-origin claim, or authority.
 const source={commit:entry.driver.mergeCommit,tree:entry.driver.tree,clean:true,files:IMAGE_OPERATIONAL_DRIVER_INPUTS_V4.map(file=>({path:file,sha256:createHash('sha256').update(fs.readFileSync(new URL(file,root))).digest('hex')}))};
 await assert.rejects(verifySource(github,source,entry),error=>{
  assert.equal(error.code,'ERR_ASSERTION');assert.equal(error.operator,'deepStrictEqual');
  const {files:actualFiles,...actualIdentity}=error.actual,{files:expectedFiles,...expectedIdentity}=error.expected;
  assert.deepEqual(actualIdentity,{commit:entry.driver.mergeCommit,tree:entry.driver.tree,clean:true});assert.deepEqual(expectedIdentity,actualIdentity);
  assert.deepEqual(actualFiles,source.files);assert.deepEqual(expectedFiles,entry.driver.files);assert.notDeepEqual(actualFiles,expectedFiles);return true;
 });assert.equal(calls,0,'CURRENT_V4_FILES_CANNOT_REUSE_HISTORICAL_IDENTITY_BEFORE_ANY_GET');
}
