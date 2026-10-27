// Source-catalogue tests only. No provider/client/credential/job construction.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {POOL_DRIVER_INPUTS} from '../pool-operational-driver-v1.mjs';
const root=new URL('../../../../',import.meta.url);
const catalogue=JSON.parse(fs.readFileSync(new URL('docs/governance/readonly-probe-objectives-v1.json',root),'utf8'));
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const expected=['POOL_RECONCILIATION_READ_ONLY_V1','GENERAL_PRESERVATION_READ_ONLY_V1','SCHEMA_LEDGER_READ_ONLY_V1'];
test('three explicit PRE objectives, no empty/default or business mutation',()=>{
  assert.deepEqual(Object.keys(catalogue).sort((a,b)=>a.localeCompare(b,'en')),['entries','schemaVersion']);
  assert.equal(catalogue.schemaVersion,1);assert.equal(catalogue.entries.length,3);
  assert.deepEqual(catalogue.entries.map(e=>e.scope),expected);
  assert.equal(new Set(catalogue.entries.map(e=>e.id)).size,3);
  assert.equal(new Set(catalogue.entries.map(e=>e.dossierSha256)).size,3);
  assert.equal(new Set(catalogue.entries.map(e=>e.journalDirectorySha256)).size,3);
});
for(const purpose of expected){
  test(purpose+' has finite authority and no implicit POST/retry',()=>{
    const entry=catalogue.entries.find(e=>e.scope===purpose);
    assert.equal(entry.schemaVersion,1);assert.equal(entry.status,'approved');
    assert.equal(entry.businessMutation,false);assert.equal(entry.ticket,'CRMY-63');
    assert.match(entry.id,/^rc48-(?:pool|general|ledger)-pre-20261027-[a-f0-9]{10}$/u);
    assert.deepEqual(entry.actions,['VERIFY','CREATE','OBSERVE_CREATE','RUN','OBSERVE_RUN','READ_OUTPUT']);
    assert(Number.isFinite(Date.parse(entry.validFrom)));assert(Number.isFinite(Date.parse(entry.expiresAt)));
    assert(Date.parse(entry.expiresAt)>Date.parse(entry.validFrom));
    assert(Date.parse(entry.expiresAt)-Date.parse(entry.validFrom)<=86400000);
    assert.equal(entry.expiresAt,'2026-10-28T08:00:00.000Z');
    assert.equal(entry.googleAccount,'casablancaynovcampus@gmail.com');
    assert.deepEqual(entry.objectiveReview,{pr:250});assert.equal(entry.driver.pr,251);
    assert.match(entry.driver.head,/^[a-f0-9]{40}$/u);assert.match(entry.driver.mergeCommit,/^[a-f0-9]{40}$/u);assert.match(entry.driver.tree,/^[a-f0-9]{40}$/u);
    // This protected catalogue still targets historical driver251. A future catalogue
    // must explicitly bind the corrected protected driver; never retarget it implicitly.
    assert.equal(entry.driver.head,'8d1e3b56dc67e153fa82e4749344fbcbff0ae17d');
    assert.equal(entry.driver.mergeCommit,'89c5ee785d56b6824f448073a1bac4032d223253');
    assert.equal(entry.driver.tree,'601642df902f71f065479c80c59ac123038935d2');
    assert.equal(sha256(JSON.stringify(entry.driver.files)),'08b684988183b4e767323c1719bf8510f55ba1a8c0b20b0b8c6d71ffb714a528');
    assert(entry.driver.files.every(f=>POOL_DRIVER_INPUTS.includes(f.path)));
    assert.equal(entry.driver.files.length,37);
    for(const file of entry.driver.files){assert.match(file.sha256,/^[a-f0-9]{64}$/u);}
    for(const name of ['dossierSha256','originalIntentSha256','independentInputsSha256','humanAuthorityReceiptSha256','journalDirectorySha256']){assert.match(entry[name],/^[a-f0-9]{64}$/u);assert.notEqual(entry[name],'0'.repeat(64));}
    assert.equal(entry.originalIntentSha256,'5a7bf55e05bd1adaf2b2805f300b119a2205e227fef594cdf96699d100d83af7');
    assert.equal(entry.independentInputsSha256,'7873b65dae9efaa82dee931531db07d40e4fe7870f94022c343d1edbe89ab4ca');
    assert.equal(entry.humanAuthorityReceiptSha256,'21fbec8b5e639da1806f0ae91e915e5fd8f5f91504d5e31d61c28b2c89f9a396');
    assert.deepEqual(entry.release,{pr:243,head:'d06302f13bc35cca78466a8bec8972e75804c72f',mergeCommit:'8253024ea35cee6be5636cc6b10a88ae7e177377',tag:'v0.1.0-rc.48',releaseId:424492409,postPublishRun:40359422772});
  });
}
