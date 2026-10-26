import assert from'node:assert/strict';
import {createHash}from'node:crypto';
import {gzipSync,gunzipSync}from'node:zlib';
import {digest,validateEnvelope}from'./rc47-select-only-probe-core-v1.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
export const BOOTSTRAP=`import{createHash}from'node:crypto';import{gunzipSync}from'node:zlib';
try{const encoded=process.env.CRM_PROBE_BUNDLE_BASE64;if(typeof encoded!=='string'||encoded.length>32768)throw Error('bundle');const compressed=Buffer.from(encoded,'base64');if(createHash('sha256').update(compressed).digest('hex')!==process.env.CRM_PROBE_BUNDLE_SHA256)throw Error('binding');const raw=gunzipSync(compressed,{maxOutputLength:262144});const b=JSON.parse(raw);if(b.schemaVersion!==1||Object.keys(b.modules).sort((a,b)=>a.localeCompare(b,'en')).join(',')!=='adapter,core,entry')throw Error('shape');for(const m of Object.values(b.modules)){if(createHash('sha256').update(m.source).digest('hex')!==m.sha256)throw Error('source');}const uri=s=>'data:text/javascript;base64,'+Buffer.from(s).toString('base64');const core=uri(b.modules.core.source);const rewrite=(s,from,to)=>{if(s.split(from).length!==2)throw Error('imports');return s.replace(from,to)};const adapter=uri(rewrite(b.modules.adapter.source,'./rc47-select-only-probe-core-v1.mjs',core));let entry=rewrite(b.modules.entry.source,'./rc47-select-only-probe-core-v1.mjs',core);entry=rewrite(entry,'./rc47-select-only-probe-adapter-v1.mjs',adapter);const module=await import(uri(entry));const result=await module.executeControlledProbe(b);process.stdout.write(JSON.stringify(result)+String.fromCharCode(10));}catch{process.stdout.write(JSON.stringify({status:'REFUSED',code:'RC47_READONLY_PROBE_GUARD'})+String.fromCharCode(10));process.exitCode=1;}`;
export function buildProbeBundle({sources,envelope,compiledInventory,policy,expectedPreservation=null}){
 assert.deepEqual(Object.keys(sources).sort((a,b)=>a.localeCompare(b,'en')),['adapter','core','entry']);
 const modules=Object.fromEntries(Object.entries(sources).map(([name,source])=>{assert.equal(typeof source,'string');return[name,{source,sha256:hash(source)}]}));
 const helpers=['adapter','core','entry'].map(name=>({name,sha256:modules[name].sha256}));
 const boundEnvelope={...envelope,helperSha256:digest(helpers)};validateEnvelope(boundEnvelope);assert.equal(digest(compiledInventory),boundEnvelope.compiledInventorySha256);
 const payload={schemaVersion:1,envelope:boundEnvelope,compiledInventory,modules,policy,expectedPreservation};
 const raw=Buffer.from(JSON.stringify(payload));assert(raw.length<=262144);const compressed=gzipSync(raw,{level:9});assert(compressed.toString('base64').length<=32768,'CloudRun bundle env bound');
 return {payload,compressed,base64:compressed.toString('base64'),bundleSha256:hash(compressed),bootstrap:BOOTSTRAP,bootstrapSha256:hash(BOOTSTRAP),helpers,roundTrip:()=>JSON.parse(gunzipSync(compressed,{maxOutputLength:262144}))};
}
