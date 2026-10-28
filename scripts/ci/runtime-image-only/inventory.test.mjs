import test from 'node:test';
import assert from 'node:assert/strict';
import {makeRc48ServiceImagePlanDraft as make} from './plan.mjs';
import {fixture,L,uri,API48} from './synthetic-fixtures.mjs';
for(const index of [9,10,11,12]){
 test('newly observed exact job '+index+' cannot be recreated',()=>{const f=fixture();f.b.jobs[index].uid='00000000-0000-4000-8000-000000000000';assert.throws(()=>make(f.c,f.b,f.now));});
 test('newly observed exact job '+index+' cannot change image',()=>{const f=fixture();f.b.jobs[index].template.template.containers[0].image=uri('api','a'.repeat(64));assert.throws(()=>make(f.c,f.b,f.now));});
}
test('valid-looking read-only name cannot replace one of the 13 actual identities',()=>{const f=fixture();f.b.jobs[12].name=L+'/jobs/crm-prod-schema-ledger-pre-substitute';f.b.jobs[12].template.template.containers[0].image=uri('api',API48);assert.throws(()=>make(f.c,f.b,f.now),/UNREVIEWED_JOB_IDENTITY/u);});
