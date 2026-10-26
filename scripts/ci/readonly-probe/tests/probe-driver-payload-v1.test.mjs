import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {validateLocalProbePayload} from '../probe-driver-payload-v1.mjs';
import {validateCreationDossier} from '../probe-job-creation-v1.mjs';
import {parseDriverArguments} from '../probe-operational-driver-v1.mjs';
import {dossierFixture} from './probe-driver-fixtures-v1.mjs';
const read=file=>fs.readFileSync(new URL('../'+file,import.meta.url));
test('actual protected payload rebuilt offline; never qualifies compiled image/native runtime',()=>{const{dossier}=dossierFixture({realPayload:true});assert.equal(validateLocalProbePayload(dossier,read).nativeExecutionQualified,false);});
for(const[name,change]of[
 ['RC48 sampler retarget',d=>d.objective.main='8253024ea35cee6be5636cc6b10a88ae7e177377'],
 ['missing pool pin',d=>delete d.preservation.poolSha256],
 ['blank pool pin',d=>d.preservation.poolSha256=''],
 ['retry',d=>d.job.template.template.maxRetries=1],
 ['more tasks',d=>d.job.template.taskCount=2],
 ['parallelism',d=>d.job.template.parallelism=2],
 ['wrong image',d=>d.job.template.template.containers[0].image+='-wrong'],
 ['plaintext DB',d=>d.job.template.template.containers[0].env[0]={name:'DATABASE_URL',value:'synthetic-forbidden'}],
 ['unversioned secret',d=>d.objective.databaseSecretRef.version='latest'],
 ['arbitrary bootstrap',d=>d.job.template.template.containers[0].args[2]='console.log(1)'],
 ['noncanonical base64',d=>d.job.template.template.containers[0].env.find(e=>e.name==='CRM_PROBE_BUNDLE_BASE64').value+='!'],
 ['extra HTTP-capable env',d=>d.job.template.template.containers[0].env.push({name:'OTHER',value:'bad'})]
])test('objective refuses '+name,()=>{const{dossier}=dossierFixture({realPayload:true});change(dossier);assert.throws(()=>validateLocalProbePayload(dossier,read));});
test('synthetic bootstrap contract accepted only for pure fixture; operational payload rejects it',()=>{const{dossier}=dossierFixture();assert(validateCreationDossier(dossier));assert.throws(()=>validateLocalProbePayload(dossier,read));});
test('changed protected source bytes cannot replace the bundled sampler',()=>{const{dossier}=dossierFixture({realPayload:true});assert.throws(()=>validateLocalProbePayload(dossier,()=>Buffer.from('wrong')));});
test('CLI parser has explicit one-action modes and no boolean authority/default execution',()=>{
 const args=['verify','--objective-id','fixture','--dossier','C:/fixture.json','--jira-evidence','C:/jira.json','--journal-dir','C:/journal'];assert.equal(parseDriverArguments(args).mode,'verify');
 for(const extra of [['--approve','yes'],['--initialize-run','yes'],['--objective-id','other'],['--support','yes']])assert.throws(()=>parseDriverArguments([...args,...extra]));
 assert.throws(()=>parseDriverArguments([]));assert.throws(()=>parseDriverArguments(['run']));assert.throws(()=>parseDriverArguments(['apply',...args.slice(1)]));
});
