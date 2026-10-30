// SYNTHETIC ONLY: actual qualified builders/source readers and public files.
// No SDK, provider, SQL, operational entry, real key file or native journal.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {validateImageDossierPublicProjectionV3 as validate} from './dossier-public-projection-v3.mjs';
import {validateImageInventoryPublicProjection as generic} from './operational-cli-v2.mjs';
import {readImageForwardPublicReferenceV2,simulateImageForwardPublicPersistenceV3} from './operational-forward-cli-v2.mjs';
import {validateImagePostDossierV2} from './post-operational-v2.mjs';
import {operationalPreparationFixtureV2} from './operational-preparation-fixtures-v2.mjs';
import {IMAGE_OPERATIONAL_DRIVER_INPUTS_V3,IMAGE_OPERATIONAL_DRIVER_INPUTS_V2,IMAGE_DRIVER_INPUTS} from './local-source.mjs';
import {buildReadOnlyJobDossier} from '../pool-reconciliation/pool-job-dossier-v1.mjs';

const REFUSAL=/^Error: IMAGE_TYPED_DOSSIER_PUBLIC_V3_REFUSED$/u;
const PRIVATE='PRIVATE_SYNTHETIC_DATA_MUST_BE_REFUSED';
const TYPED_MODULE='scripts/ci/runtime-image-only/dossier-public-projection-v3.mjs';
const SOURCE_ROOT=path.resolve(import.meta.dirname,'../../..');
const fixture=operationalPreparationFixtureV2();
const readSource=file=>fs.readFileSync(path.resolve(import.meta.dirname,'../pool-reconciliation',file));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const ordering=(left,right)=>left.localeCompare(right,'en');
const dossier=()=>structuredClone(fixture.c.readOnlyPostJob.dossier);
function temp(t){const directory=fs.mkdtempSync(path.join(os.tmpdir(),'crm-typed-dossier-public-v3-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));return directory;}
function freeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
function fileRef(directory,leaf,value){const bytes=Buffer.from(JSON.stringify(value,null,2)+'\n'),file=path.join(directory,leaf+'.json');fs.writeFileSync(file,bytes,{flag:'wx'});return{path:file,sha256:sha(bytes)};}

for(const [name,value] of [['GENERAL_POST',fixture.c.readOnlyPostJob.dossier],['GENERAL_PRE',fixture.c.readOnlyPreparationJobs[0].dossier],['LEDGER_PRE',fixture.c.readOnlyPreparationJobs[1].dossier]]){
  test('SYNTHETIC complete source-rebuilt '+name+' passes without changing any input field/byte/hash',()=>{
    const original=freeze(structuredClone(value)),before=JSON.stringify(original),digest=sha(before);
    assert.throws(()=>generic(original),/N02_PUBLIC_PROJECTION_REFUSED/u);
    assert.equal(validate(original,readSource),original);assert.equal(JSON.stringify(original),before);assert.equal(sha(JSON.stringify(original)),digest);
    assert.deepEqual(Object.keys(original.objective.databaseSecretRef).sort(ordering),['secret','version']);
  });
}
for(const name of ['candidate','plan','IMAGE','postJob','nestedArray']){
  test('SYNTHETIC qualified complete dossiers are recognised by full rebuilt shape inside '+name,()=>{
    const full=dossier();let wrapped;
    if(name==='postJob'){wrapped={state:'FIN_POST_RESOURCE_READY_UNUSED_V2',postJob:{dossier:full},runInvocations:0};}
    else if(name==='nestedArray'){wrapped={records:[{data:[full]}]};}
    else{wrapped={[name]:{readOnlyPostJob:{dossier:full},preparation:fixture.c.readOnlyPreparationJobs}};}
    const before=JSON.stringify(wrapped);assert.equal(validate(wrapped,readSource),wrapped);assert.equal(JSON.stringify(wrapped),before);
  });
}
test('SYNTHETIC actual JSON reader accepts built dossier and nested wrappers while retaining exact raw hash',t=>{
  const directory=temp(t),values=[dossier(),{candidate:{postJob:{dossier:dossier()}}}];
  for(const [index,value] of values.entries()){
    const ref=fileRef(directory,'input-'+index,value),before=fs.readFileSync(ref.path);
    assert.deepEqual(readImageForwardPublicReferenceV2(ref),value);assert.deepEqual(fs.readFileSync(ref.path),before);assert.equal(sha(before),ref.sha256);
    assert.throws(()=>readImageForwardPublicReferenceV2({...ref,sha256:'f'.repeat(64)}));
  }
});
test('SYNTHETIC real public saver and terminal result preserve postJob.dossier payload and persist once',t=>{
  const directory=temp(t),value={schemaVersion:2,state:'FIN_POST_RESOURCE_READY_UNUSED_V2',postJob:{dossier:dossier()},runInvocations:0,canRetry:false};
  const before=JSON.stringify(value),input={syntheticOnly:true,outputDirectory:directory,result:value,name:'POST-RESOURCE-PREPARATION-FIN'},out=simulateImageForwardPublicPersistenceV3(input),result=out.result;
  assert.equal(out.syntheticOnly,true);assert.equal(out.nativeAuthority,false);assert.equal(out.nativeAcceptance,false);
  assert.equal(result.state,value.state);assert.deepEqual(result.postJob,value.postJob);assert.equal(JSON.stringify(value),before);
  const bytes=fs.readFileSync(result.entryReceipt.path);assert.equal(sha(bytes),result.entryReceipt.sha256);assert.deepEqual(JSON.parse(bytes),{...value,syntheticOnly:true,nativeAuthority:false,nativeAcceptance:false});
  assert.equal(fs.readdirSync(directory).length,1);assert.deepEqual(JSON.parse(bytes).postJob.dossier,value.postJob.dossier);
  assert.throws(()=>simulateImageForwardPublicPersistenceV3(input),/OUTPUT_MUST_BE_EMPTY/u);
});
test('SYNTHETIC terminal and saver reject raw credentials without publishing the unsafe result',t=>{
  const directory=temp(t),value={postJob:{dossier:dossier()},access_token:PRIVATE};
  assert.throws(()=>simulateImageForwardPublicPersistenceV3({syntheticOnly:true,outputDirectory:directory,result:value,name:'UNSAFE'}),REFUSAL);
  assert.equal(fs.readdirSync(directory).length,0);
});
test('SYNTHETIC persistence seam refuses non-synthetic, noncanonical/internal/nonempty directories and capabilities',t=>{
  const directory=temp(t),input={syntheticOnly:true,outputDirectory:directory,result:{ok:true},name:'SYNTHETIC-PUBLIC'};
  for(const change of [{syntheticOnly:false},{outputDirectory:'relative-output'},{outputDirectory:path.resolve(import.meta.dirname)},{name:'not-an-uppercase-name'},{sdk:()=>{throw new Error(PRIVATE);}}]){assert.throws(()=>simulateImageForwardPublicPersistenceV3({...input,...change}));}
  fs.writeFileSync(path.join(directory,'existing.json'),'{}',{flag:'wx'});assert.throws(()=>simulateImageForwardPublicPersistenceV3(input),/OUTPUT_MUST_BE_EMPTY/u);
});
for(const [name,change] of [
  ['reference payload',value=>{value.objective.databaseSecretRef.secret=PRIVATE;}],
  ['extra reference member',value=>{value.objective.databaseSecretRef.extra='not-allowed';}],
  ['missing reference member',value=>{delete value.objective.databaseSecretRef.version;}],
  ['string reference replaced by volume',value=>{value.objective.databaseSecretRef.secret={secret:'not-a-reference-string'};}],
  ['phase changed without rebuild',value=>{value.bundle.request.phase='PRE';}],
  ['invalid phase',value=>{value.bundle.request.phase='RUN';}],
  ['image pin',value=>{value.objective.image='changed-image';}],
  ['source pin',value=>{value.objective.sourceSha256='f'.repeat(64);}],
  ['bundle code',value=>{value.bundle.modules.general.source+='\n// changed';}],
  ['SQL request',value=>{value.bundle.request.queryContractSha256='f'.repeat(64);}],
  ['task env reference',value=>{value.job.template.template.containers[0].env[0].valueSource.secretKeyRef.version='2';}],
  ['extra full-dossier member',value=>{value.extra=true;}],
  ['missing full-dossier member',value=>{delete value.bundle;}],
]){
  test('SYNTHETIC malformed/modified dossier refuses '+name,()=>{const value=dossier();change(value);assert.throws(()=>validate({postJob:{dossier:value}},readSource),REFUSAL);});
}
test('SYNTHETIC typed boundary does not replace the separate POST purpose/phase gate',()=>{
  const pre=structuredClone(fixture.c.readOnlyPreparationJobs[0].dossier);assert.equal(validate(pre,readSource),pre);
  assert.throws(()=>validateImagePostDossierV2(pre,readSource));assert.equal(validateImagePostDossierV2(dossier(),readSource).bundle.request.phase,'POST');
});
test('SYNTHETIC collector sources are never evaluated and wrong/missing source rejects exact rebuild',()=>{
  let calls=0;const wrong=file=>{calls++;return Buffer.concat([readSource(file),Buffer.from('\n// wrong source')]);};
  assert.throws(()=>validate(dossier(),wrong),REFUSAL);assert(calls>0);
  assert.throws(()=>validate(dossier(),()=>undefined),REFUSAL);assert.throws(()=>validate(dossier(),null),REFUSAL);
});
for(const value of [
  {databaseSecretRef:{secret:'existing-reference',version:'1'}},
  {objective:{databaseSecretRef:{secret:'existing-reference',version:'1'}}},
  {secret:'existing-reference'},
  {secretKeyRef:{secret:'existing-reference',version:'1',payload:PRIVATE}},
  {env:[{name:'DATABASE_URL',value:PRIVATE}]},
  {secret:{secret:'existing-reference',items:[{version:'1',path:'public'}]},password:PRIVATE},
  {access_token:PRIVATE},{stdout:PRIVATE},{cookie:PRIVATE},{value:'Bearer '+PRIVATE},
  {value:['-----BEGIN ','PRIVATE KEY-----'].join('')},
  {url:'https://public.invalid/?access_token='+PRIVATE},
]){test('SYNTHETIC no global reference/credential exception for '+Object.keys(value)[0],()=>{assert.throws(()=>validate(value,readSource),REFUSAL);});}
test('SYNTHETIC existing typed secretKeyRef and volume metadata retain generic behaviour',()=>{
  const value={secretKeyRef:{secret:'existing-reference',version:'1'},volumes:[{secret:{secret:'existing-reference',items:[{version:'1',path:'public'}]}}]};
  assert.equal(generic(value),value);assert.equal(validate(value,readSource),value);
});
for(const location of ['root','objective','reference','array']){
  test('SYNTHETIC '+location+' getters refuse without invoking their body',()=>{
    let calls=0;const value=location==='root'?{}:dossier(),getter={enumerable:true,get(){calls++;throw new Error(PRIVATE);}};
    if(location==='root'){Object.defineProperty(value,'payload',getter);}
    if(location==='objective'){Object.defineProperty(value,'objective',getter);}
    if(location==='reference'){Object.defineProperty(value.objective.databaseSecretRef,'secret',getter);}
    if(location==='array'){Object.defineProperty(value.job.template.template.containers[0].env,'0',getter);}
    assert.throws(()=>validate(value,readSource),REFUSAL);assert.equal(calls,0);
  });
}
test('SYNTHETIC proxies refuse before any trap or source reader is invoked',()=>{
  let traps=0,reads=0;const proxy=new Proxy(dossier(),{get(){traps++;throw new Error(PRIVATE);},getPrototypeOf(){traps++;throw new Error(PRIVATE);},ownKeys(){traps++;throw new Error(PRIVATE);}});
  assert.throws(()=>validate({nested:proxy},()=>{reads++;throw new Error(PRIVATE);}),REFUSAL);assert.equal(traps,0);assert.equal(reads,0);
});
test('SYNTHETIC cycles/prototypes/symbols/undefined/sparse arrays and depth remain refused',()=>{
  const cycle={};cycle.self=cycle;let cursor={};const deep=cursor;for(let index=0;index<65;index++){cursor.next={};cursor=cursor.next;}
  const sparse=[];sparse.length=1;
  for(const value of [cycle,deep,Object.assign(Object.create({}),{ok:true}),{[Symbol('private')]:PRIVATE},{missing:undefined},sparse]){assert.throws(()=>validate(value,readSource),REFUSAL);}
});
test('SYNTHETIC original volume and node bounds are enforced before any rebuild',()=>{
  let reads=0;const source=()=>{reads++;throw new Error(PRIVATE);};
  assert.throws(()=>validate({publicText:'x'.repeat(20971521)},source),REFUSAL);
  assert.throws(()=>validate(Array.from({length:200000},()=>null),source),REFUSAL);assert.equal(reads,0);
});
test('SYNTHETIC new module is explicit in operational closure only, historical image closure remains separate',()=>{
  assert.equal(IMAGE_OPERATIONAL_DRIVER_INPUTS_V3.filter(file=>file===TYPED_MODULE).length,1);assert(!IMAGE_OPERATIONAL_DRIVER_INPUTS_V2.includes(TYPED_MODULE));assert(!IMAGE_DRIVER_INPUTS.includes(TYPED_MODULE));
  assert.deepEqual(IMAGE_OPERATIONAL_DRIVER_INPUTS_V3.filter(file=>file!==TYPED_MODULE),IMAGE_OPERATIONAL_DRIVER_INPUTS_V2);assert.equal(IMAGE_OPERATIONAL_DRIVER_INPUTS_V2.length,79);assert.equal(IMAGE_OPERATIONAL_DRIVER_INPUTS_V3.length,80);
  for(const file of [TYPED_MODULE,'scripts/ci/runtime-image-only/local-source.mjs','scripts/ci/runtime-image-only/operational-forward-cli-v2.mjs']){assert(IMAGE_OPERATIONAL_DRIVER_INPUTS_V3.includes(file));assert(fs.readFileSync(path.join(SOURCE_ROOT,file)).length>0);}
});
test('SYNTHETIC rebuild from its own qualified builder remains usable, not an inline-code execution',()=>{
  const original=dossier(),bundle=original.bundle;
  const rebuilt=buildReadOnlyJobDossier({sources:Object.fromEntries(Object.entries(bundle.modules).map(([name,module])=>[name,module.source])),request:bundle.request,jobName:bundle.jobName,nonce:bundle.nonce,databaseBindingSha256:bundle.databaseBindingSha256,publicKeyPem:bundle.publicKeyPem,networkBinding:original.objective.taskTemplate.vpcAccess,databaseSecretVersion:original.objective.databaseSecretRef.version,intentAt:original.objective.intentAt});
  assert.deepEqual(rebuilt,original);assert.equal(validate(rebuilt,readSource),rebuilt);
});
