// Original three retained byte-for-byte; two justified fresh SQL proof objectives only.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {createHash} from 'node:crypto';
import {POOL_DRIVER_INPUTS} from '../pool-operational-driver-v1.mjs';
const root=new URL('../../../../',import.meta.url),read=p=>JSON.parse(fs.readFileSync(new URL(p,root))),current=read('scripts/ci/pool-reconciliation/tests/fixtures/readonly-concrete-objectives-262-20261028.json'),prior=read('scripts/ci/pool-reconciliation/tests/fixtures/readonly-concrete-objectives-261-20261028.json');
const expected=[{"id":"rc48-pool-pre-20261028-5d481699db","scope":"POOL_RECONCILIATION_READ_ONLY_V1","dossierSha256":"359a48162741da3dcc68a70e3a4a556ab717088de43c39a1eeb718358513ce00","journalDirectorySha256":"e22b78bfc955f2155e9b0c94217cafc16daa8903a47aebcee2a834baad950986","freshEvidence":{"reason":"KNOWN_FIN_OLD_OUTPUT_EXCEEDED_FRESHNESS_BOUND","previousObjectiveId":"rc48-pool-pre-20261027-9b1b1fb83f","previousJobName":"projects/crmynov-prod-n7x4q2/locations/europe-west1/jobs/crm-prod-pool-reconcile-pre-20261027-9b1b1fb83f","knownFinReceiptSha256":"d928fa65cb33a102b469170937ddae55bb226e27db997696c44da09972dd5c58","failedOrStaleCaptureReceiptSha256":"9a6a229a54635148655fe9147fc20a29e22aca40662622ba793cba4f03a1895d","originalCreateRunMustNotBeReplayed":true,"noNewBaselineOrCohort":true}},{"id":"rc48-ledger-pre-20261028-f4b3d88b78","scope":"SCHEMA_LEDGER_READ_ONLY_V1","dossierSha256":"3ea6d42053ecea846bf105b70341e63d27e091ac573000fb92f5a62d90602f00","journalDirectorySha256":"28a9cc39a10801d895bb7fc341e04473846b7da36ae3718945c2be3670138b1d","freshEvidence":{"reason":"KNOWN_FIN_ORIGINAL_FIRST_OUTPUT_GET_FAILED_NO_SQL_CLAIMS","previousObjectiveId":"rc48-ledger-pre-20261027-d064303171","previousJobName":"projects/crmynov-prod-n7x4q2/locations/europe-west1/jobs/crm-prod-schema-ledger-pre-20261027-d064303171","knownFinReceiptSha256":"e78ed8b1b378e6916af2e0c4e12918e8d9d647f22c915359103887e7c3a78508","failedOrStaleCaptureReceiptSha256":"e78ed8b1b378e6916af2e0c4e12918e8d9d647f22c915359103887e7c3a78508","originalCreateRunMustNotBeReplayed":true,"noNewBaselineOrCohort":true}}];
test('retained PR262 catalogue keeps all three consumed original objectives unchanged and adds only two explicit fresh proof entries',()=>{
 assert.deepEqual(Object.keys(current).sort(),['entries','schemaVersion']);assert.equal(current.schemaVersion,1);assert.equal(current.entries.length,5);
 assert.deepEqual(current.entries.slice(0,3),prior.entries);assert.equal(new Set(current.entries.map(e=>e.id)).size,5);
 assert.equal(new Set(current.entries.map(e=>e.dossierSha256)).size,5);assert.equal(new Set(current.entries.map(e=>e.journalDirectorySha256)).size,5);
 assert.equal(current.entries.filter(e=>e.scope==='GENERAL_PRESERVATION_READ_ONLY_V1').length,1);
 assert.deepEqual(current.entries.slice(3).map(e=>e.id),expected.map(e=>e.id));
});
for(const pin of expected)test(pin.scope+' new objective pins distinct unused dossier/journal and a documented known-FIN freshness reason',()=>{
 const e=current.entries.find(e=>e.id===pin.id),old=prior.entries.find(e=>e.scope===pin.scope);
 for(const key of ['id','scope','dossierSha256','journalDirectorySha256','freshEvidence'])assert.deepEqual(e[key],pin[key]);
 assert.deepEqual(e.driver,old.driver);assert.deepEqual(e.release,old.release);assert.deepEqual(e.actions,old.actions);
 assert.equal(e.businessMutation,false);assert.equal(e.status,'approved');assert.equal(e.ticket,'CRMY-63');
 assert.deepEqual(e.objectiveReview,{pr:262});assert.equal(e.validFrom,"2026-10-28T04:02:58.407Z");assert.equal(e.expiresAt,'2026-10-28T08:00:00.000Z');
 assert(Date.parse(e.expiresAt)>Date.parse(e.validFrom)&&Date.parse(e.expiresAt)-Date.parse(e.validFrom)<86400000);
 assert.equal(e.originalIntentSha256,old.originalIntentSha256);assert.equal(e.independentInputsSha256,old.independentInputsSha256);assert.equal(e.humanAuthorityReceiptSha256,old.humanAuthorityReceiptSha256);
 assert.equal(e.freshEvidence.previousObjectiveId,old.id);assert.equal(e.freshEvidence.originalCreateRunMustNotBeReplayed,true);assert.equal(e.freshEvidence.noNewBaselineOrCohort,true);
 assert.notEqual(e.id,old.id);assert.notEqual(e.dossierSha256,old.dossierSha256);assert.notEqual(e.journalDirectorySha256,old.journalDirectorySha256);
 assert.deepEqual(e.driver.files.map(f=>f.path),POOL_DRIVER_INPUTS);assert.equal(e.driver.files.length,38);
 for(const file of e.driver.files)assert.equal(createHash('sha256').update(fs.readFileSync(new URL(file.path,root))).digest('hex'),file.sha256);
});
