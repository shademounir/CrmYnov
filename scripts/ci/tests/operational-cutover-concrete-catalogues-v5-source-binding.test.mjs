import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const catalog=JSON.parse(fs.readFileSync(path.resolve('docs/governance/runtime-image-only-objectives-v1.json'),'utf8'));
const id='rc48-image-only-inventory-20261104-v5-source-binding-v1';

test('V5 source-binding objective keeps driver, source binding, and adapter distinct',()=>{
  const entry=catalog.entries.find(e=>e.id===id);
  assert(entry);
  assert.deepEqual(entry.driver,{...entry.driver,role:'INVENTORY_DRIVER'});
  assert.deepEqual(entry.sourceBinding,{schemaVersion:1,pr:283,mergeCommit:'ba4a1a2caf6196a4b2e2447b6971f107ea76779c',tree:'74089082b3abea091ed8cd7968053307abdec970',role:'PROTECTED_SOURCE_BINDING'});
  assert.deepEqual(entry.adapterBinding,{schemaVersion:1,pr:284,mergeCommit:'1dc7e42607860269364f8be7d8b616646e7ab6e4',tree:'f24872a0a248493fe60c894e7993a8740fd0f808',role:'V5_ADAPTER'});
  assert.deepEqual(entry.actions,['READ_METADATA','TEST_PERMISSIONS','OBSERVE_OPERATION']);
  assert.equal(entry.businessMutation,false);
  assert.equal(entry.runtimeImageMutation,false);
});
