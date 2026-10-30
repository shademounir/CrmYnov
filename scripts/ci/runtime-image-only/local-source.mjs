// Local image extension attestation built on the existing official tool/file guards.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import{execFileSync}from'node:child_process';import{createHash}from'node:crypto';
import{POOL_DRIVER_INPUTS,POOL_OFFICIAL_GIT,readPoolPrivateFile}from'../pool-reconciliation/pool-operational-driver-v1.mjs';
import{fixedToolEnvironment}from'../readonly-probe/probe-driver-github-v1.mjs';
import {PROSPECTIVE_DRIVER_INPUTS} from '../pool-reconciliation/general-prospective-pre-authority-v1.mjs';
const root=path.resolve(import.meta.dirname,'../../..');
export const IMAGE_DRIVER_INPUTS=Object.freeze(['authority','cli','executor','preparation','journal','plan','served-state','transport','protected-gates','local-source','plan-mode','rollback-plan','rollback-context','preparation-jobs','preparation-origins','prospective-permissions'].map(n=>'scripts/ci/runtime-image-only/'+n+'.mjs').concat('scripts/ci/operational-driver-v2.mjs'));
export const IMAGE_OPERATIONAL_DRIVER_INPUTS_V2=Object.freeze([...new Set([
 ...POOL_DRIVER_INPUTS,...IMAGE_DRIVER_INPUTS,...PROSPECTIVE_DRIVER_INPUTS,
 ...['late-binding-v2','inventory-authority-v2','catalogue-origin-v2','journal-budget-v2','operational-transport-v2','operational-permissions-v2','operational-cli-v2','preparation-v2','post-preservation','post-preservation-v2','post-readiness-v2','post-startup-permissions','post-operational-v2','operational-forward-sequence-v2','operational-forward-cli-v2'].map(n=>'scripts/ci/runtime-image-only/'+n+'.mjs'),
 'scripts/ci/readonly-probe/official-sdk-auth-preflight-v1.mjs',
 'scripts/ci/pool-reconciliation/general-operational-pre-v3.mjs',
])].sort((a,b)=>a.localeCompare(b,'en')));
// Source-bound public dossier adaptation has a distinct explicit closure.
// The protected c389/V2 list and historical catalogue pins remain unchanged.
export const IMAGE_OPERATIONAL_DRIVER_INPUTS_V3=Object.freeze([...IMAGE_OPERATIONAL_DRIVER_INPUTS_V2,'scripts/ci/runtime-image-only/dossier-public-projection-v3.mjs'].sort((a,b)=>a.localeCompare(b,'en')));
export function readImageLocalSource(){
 assert.equal(process.platform,'win32');assert.equal(fs.realpathSync(POOL_OFFICIAL_GIT),path.win32.normalize(POOL_OFFICIAL_GIT));assert(!fs.lstatSync(POOL_OFFICIAL_GIT).isSymbolicLink());assert(!Object.keys(process.env).some(k=>/^GIT_/iu.test(k)));
 const env=fixedToolEnvironment(process.env),git=(...args)=>execFileSync(POOL_OFFICIAL_GIT,['-C',root,...args],{encoding:'utf8',windowsHide:true,timeout:15000,maxBuffer:1048576,env}).trim();
 assert.equal(git('status','--porcelain','--untracked-files=all'),'','CLEAN_PROTECTED_IMAGE_EXTENSION_REQUIRED');
 const inputs=[...new Set([...POOL_DRIVER_INPUTS,...IMAGE_DRIVER_INPUTS])].sort((a,b)=>a.localeCompare(b,'en'));
 return{commit:git('rev-parse','HEAD'),tree:git('rev-parse','HEAD^{tree}'),clean:true,files:inputs.map(p=>({path:p,sha256:createHash('sha256').update(readPoolPrivateFile(path.join(root,p))).digest('hex')}))};
}
// Operational V2 is an explicit larger closure; historical image/V1 callers
// continue to receive exactly their original manifest.
export function readImageOperationalSource(){
 const legacy=readImageLocalSource();
 const files=IMAGE_OPERATIONAL_DRIVER_INPUTS_V3.map(relative=>({path:relative,sha256:createHash('sha256').update(readPoolPrivateFile(path.join(root,relative))).digest('hex')}));
 return {...legacy,files};
}
export function imageExternalDirectory(p){
 assert(path.isAbsolute(p));const resolved=fs.realpathSync(p);assert.equal(resolved,path.resolve(p));assert(fs.statSync(p).isDirectory()&&!fs.lstatSync(p).isSymbolicLink());
 const relative=path.relative(root,resolved);assert(relative.startsWith('..'+path.sep)||path.isAbsolute(relative),'IMAGE_RECEIPTS_OUTSIDE_SOURCE');return resolved;
}
