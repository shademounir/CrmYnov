import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {hashBytes} from './pool-sealed-output-v1.mjs';
import {validatePoolRuntimeBundle} from './pool-runtime-entry-v1.mjs';
export const POOL_BOOTSTRAP=`import{createHash}from'node:crypto';import{gunzipSync}from'node:zlib';
try{const v=process.env.CRM_POOL_BUNDLE_BASE64;if(typeof v!=='string'||v.length>32768)throw Error('bound');const z=Buffer.from(v,'base64');if(z.toString('base64')!==v||createHash('sha256').update(z).digest('hex')!==process.env.CRM_POOL_BUNDLE_SHA256)throw Error('binding');const b=JSON.parse(gunzipSync(z,{maxOutputLength:262144}));if(Object.keys(b.modules).sort().join(',')!=='collector,entry,output')throw Error('modules');for(const m of Object.values(b.modules)){if(createHash('sha256').update(m.source).digest('hex')!==m.sha256)throw Error('bytes');}const uri=s=>'data:text/javascript;base64,'+Buffer.from(s).toString('base64');const collector=uri(b.modules.collector.source),output=uri(b.modules.output.source);const replace=(s,a,t)=>{if(s.split(a).length!==2)throw Error('imports');return s.replace(a,t)};let entry=replace(b.modules.entry.source,'./pool-read-only-collector-v1.mjs',collector);entry=replace(entry,'./pool-sealed-output-v1.mjs',output);const module=await import(uri(entry));const result=await module.executeNativePoolObservation(b);process.stdout.write(JSON.stringify(result)+String.fromCharCode(10));}catch{process.stdout.write(JSON.stringify({schemaVersion:1,status:'REFUSED',code:'POOL_READONLY_RUNTIME_GUARD'})+String.fromCharCode(10));process.exitCode=1;}`;
export function buildPoolRuntimeBundle({sources,...parameters}){
  assert.deepEqual(Object.keys(sources).sort(),['collector','entry','output']);
  const modules=Object.fromEntries(Object.entries(sources).map(([name,source])=>{
    assert.equal(typeof source,'string');return [name,{source,sha256:hashBytes(source)}];
  }));
  const bundle={schemaVersion:1,...parameters,modules};const binding=validatePoolRuntimeBundle(bundle);
  const raw=Buffer.from(JSON.stringify(bundle));assert(raw.length<=262144,'BUNDLE_RAW_BOUND');
  const compressed=gzipSync(raw,{level:9}),base64=compressed.toString('base64');assert(base64.length<=32768,'CLOUD_RUN_ENV_BOUND');
  return {bundle,base64,bundleSha256:hashBytes(compressed),bootstrap:POOL_BOOTSTRAP,bootstrapSha256:hashBytes(POOL_BOOTSTRAP),...binding};
}
