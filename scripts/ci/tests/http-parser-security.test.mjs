import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {execFile} from 'node:child_process';import {promisify} from 'node:util';import {fileURLToPath} from 'node:url';import {createRequire} from 'node:module';
const run=promisify(execFile),root=new URL('../../../',import.meta.url),require=createRequire(import.meta.url);
const pkg=JSON.parse(fs.readFileSync(new URL('package.json',root))),lock=JSON.parse(fs.readFileSync(new URL('package-lock.json',root)));
for(const [name,version] of [['body-parser','2.4.0'],['multer','2.5.0']])test(name+' patched version is pinned, locked and really installed',()=>{
  assert.equal(pkg.overrides[name],version);assert.equal(lock.packages['node_modules/'+name].version,version);assert.equal(require(name+'/package.json').version,version);
  assert.equal(lock.packages['node_modules/'+name].resolved,'https://registry.npmjs.org/'+name+'/-/'+name+'-'+version+'.tgz');assert.match(lock.packages['node_modules/'+name].integrity,/^sha512-/u);
});
for(const mode of ['compressed-tail','late-filter'])test('isolated child survives '+mode+' regression without masking uncaught errors',{timeout:15000},async()=>{
  const result=await run(process.execPath,[fileURLToPath(new URL('../fixtures/http-parser-security-child.mjs',import.meta.url)),mode],{timeout:12000,maxBuffer:1048576,windowsHide:true});
  assert.deepEqual(JSON.parse(result.stdout.trim()),{mode,completed:true,synthetic:true,productionMutation:false});assert.equal(result.stderr,'');
});
