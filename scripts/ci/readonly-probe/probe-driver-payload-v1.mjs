import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {BOOTSTRAP,buildProbeBundle} from './rc47-probe-bundle-v2.mjs';
import {digest} from './rc47-select-only-probe-core-v1.mjs';
import {validateCreationDossier} from './probe-job-creation-v1.mjs';
const files={core:'rc47-select-only-probe-core-v1.mjs',adapter:'rc47-select-only-probe-adapter-v1.mjs',entry:'rc47-probe-controlled-entry-v2.mjs',native:'rc47-probe-native-guards-v1.mjs'};
const hash=b=>createHash('sha256').update(b).digest('hex');
export function validateLocalProbePayload(dossier,readSource) {
  validateCreationDossier(dossier);assert.equal(typeof readSource,'function');
  const container=dossier.job.template.template.containers[0];assert.equal(container.args[2],BOOTSTRAP,'bootstrap must be protected implementation');
  const compressed=Buffer.from(container.env.find(e=>e.name==='CRM_PROBE_BUNDLE_BASE64').value,'base64');
  const payload=JSON.parse(gunzipSync(compressed,{maxOutputLength:262144}));
  assert.equal(payload.policy.jobName,dossier.objective.jobName.split('/').at(-1));assert(['PRE','POST'].includes(payload.policy.mode));assert.equal(payload.policy.nativeContractSha256,dossier.preservation.nativeExecutionEnvelopeSha256);
  if(payload.policy.mode==='PRE')assert.equal(payload.expectedPreservation,null);else assert(payload.expectedPreservation?.schemaVersion===1);
  assert.equal(digest(payload.envelope),digest(dossier.preservation));
  const sources=Object.fromEntries(['core','adapter','entry'].map(name=>[name,readSource(files[name]).toString('utf8')]));
  const helpers=Object.entries(files).map(([name,file])=>({name,sha256:hash(readSource(file))})).sort((a,b)=>a.name.localeCompare(b.name,'en'));
  assert.deepEqual([...dossier.objective.helpers].sort((a,b)=>a.name.localeCompare(b.name,'en')),helpers);
  const rebuilt=buildProbeBundle({sources,envelope:dossier.preservation,compiledInventory:dossier.objective.compiledInventory,policy:payload.policy,expectedPreservation:payload.expectedPreservation});
  assert.equal(digest(rebuilt.payload),digest(payload));assert.equal(rebuilt.base64,compressed.toString('base64'));
  return {protectedBootstrap:true,protectedModuleBytes:true,preservationPinsPresent:true,compiledImageBytesVerified:false,nativeExecutionQualified:false};
}
