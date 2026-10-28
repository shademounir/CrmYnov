// Local image extension attestation built on the existing official tool/file guards.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import{execFileSync}from'node:child_process';import{createHash}from'node:crypto';
import{POOL_DRIVER_INPUTS,POOL_OFFICIAL_GIT,readPoolPrivateFile}from'../pool-reconciliation/pool-operational-driver-v1.mjs';
import{fixedToolEnvironment}from'../readonly-probe/probe-driver-github-v1.mjs';
const root=path.resolve(import.meta.dirname,'../../..');
export const IMAGE_DRIVER_INPUTS=Object.freeze(['authority','cli','executor','preparation','journal','plan','served-state','transport','protected-gates','local-source','plan-mode','rollback-plan','rollback-context'].map(n=>'scripts/ci/runtime-image-only/'+n+'.mjs').concat('scripts/ci/operational-driver-v2.mjs'));
export function readImageLocalSource(){
 assert.equal(process.platform,'win32');assert.equal(fs.realpathSync(POOL_OFFICIAL_GIT),path.win32.normalize(POOL_OFFICIAL_GIT));assert(!fs.lstatSync(POOL_OFFICIAL_GIT).isSymbolicLink());assert(!Object.keys(process.env).some(k=>/^GIT_/iu.test(k)));
 const env=fixedToolEnvironment(process.env),git=(...args)=>execFileSync(POOL_OFFICIAL_GIT,['-C',root,...args],{encoding:'utf8',windowsHide:true,timeout:15000,maxBuffer:1048576,env}).trim();
 assert.equal(git('status','--porcelain','--untracked-files=all'),'','CLEAN_PROTECTED_IMAGE_EXTENSION_REQUIRED');
 const inputs=[...new Set([...POOL_DRIVER_INPUTS,...IMAGE_DRIVER_INPUTS])].sort((a,b)=>a.localeCompare(b,'en'));
 return{commit:git('rev-parse','HEAD'),tree:git('rev-parse','HEAD^{tree}'),clean:true,files:inputs.map(p=>({path:p,sha256:createHash('sha256').update(readPoolPrivateFile(path.join(root,p))).digest('hex')}))};
}
export function imageExternalDirectory(p){
 assert(path.isAbsolute(p));const resolved=fs.realpathSync(p);assert.equal(resolved,path.resolve(p));assert(fs.statSync(p).isDirectory()&&!fs.lstatSync(p).isSymbolicLink());
 const relative=path.relative(root,resolved);assert(relative.startsWith('..'+path.sep)||path.isAbsolute(relative),'IMAGE_RECEIPTS_OUTSIDE_SOURCE');return resolved;
}
