import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {URL as FileURL} from 'node:url';
import {imageJournalDigest as digest} from '../runtime-image-only/journal.mjs';
import {POST_METADATA_V1 as P,POST_METADATA_URL_V1 as URL,validatePostMetadataBindingV1,readPostMetadataDossierV1,projectPostMetadataObservationV1} from '../runtime-image-only/post-metadata-contract-v1.mjs';

test('POST binding accepts only the exact fixed metadata purpose',()=>{
  validatePostMetadataBindingV1({...P});
  for(const key of Object.keys(P)){
    const missing={...P};delete missing[key];
    assert.throws(()=>validatePostMetadataBindingV1(missing),/EXACT_POST_METADATA_BINDING_REQUIRED/u);
    assert.throws(()=>validatePostMetadataBindingV1({...P,[key]:'foreign'}),/EXACT_POST_METADATA_BINDING_REQUIRED/u);
  }
  assert.throws(()=>validatePostMetadataBindingV1({...P,runAuthorized:true}));
});
test('POST dossier rejects wrong bytes, type and size before interpreting configuration',()=>{
  for(const bytes of ['{}',null,Buffer.alloc(1048577),Buffer.from('{}')]){
    assert.throws(()=>readPostMetadataDossierV1(bytes));
  }
});
function observation(){
  return {projection:{uid:P.uid,name:P.job},dossier:{objective:{taskTemplateSha256:P.taskTemplateSha256}},exchange:{
    kind:'EXPURGATED_IMAGE_NATIVE_EXCHANGE_OBSERVATION_V2',request:{method:'GET',url:URL},status:200,responseFinalUrl:URL,responseRedirected:false,
    outcome:'HTTP_200_RECEIVED_NOT_SEMANTIC_ACCEPTANCE',requestStartedAt:'2026-11-11T10:00:00.000Z',responseObservedAt:'2026-11-11T10:00:01.000Z'}};
}
const changes={
  kind:v=>v.exchange.kind='FOREIGN',method:v=>v.exchange.request.method='POST',missingRequest:v=>delete v.exchange.request,
  url:v=>v.exchange.request.url+=':run',status:v=>v.exchange.status=403,origin:v=>v.exchange.responseFinalUrl='https://foreign.invalid/',
  redirected:v=>v.exchange.responseRedirected=true,outcome:v=>v.exchange.outcome='UNKNOWN',
  invalidTime:v=>v.exchange.requestStartedAt='invalid',backwards:v=>v.exchange.responseObservedAt='2026-11-11T09:59:59.000Z',
  timeout:v=>v.exchange.responseObservedAt='2026-11-11T10:00:15.001Z',uid:v=>v.projection.uid='foreign',
  name:v=>v.projection.name+='-foreign',task:v=>v.dossier.objective.taskTemplateSha256='0'.repeat(64),
};
for(const [name,change] of Object.entries(changes)){
  test('POST receipt refuses '+name+' before accepting task metadata',()=>{
    const value=observation();change(value);assert.throws(()=>projectPostMetadataObservationV1(value));
  });
}
test('HTTP 200 with exact identity is insufficient without the qualified task objective',()=>{
  assert.throws(()=>projectPostMetadataObservationV1(observation()));
});
function qualifiedObservation(){
  const stored=JSON.parse(fs.readFileSync(new FileURL('../runtime-image-only/fixtures/post-metadata-dossier-v1.json',import.meta.url)));
  assert.equal(stored.sha256,P.dossierSha256);
  const dossier=readPostMetadataDossierV1(Buffer.from(stored.base64,'base64'));
  const value=observation();value.dossier=dossier;
  value.projection={...structuredClone(dossier.job),name:P.job,uid:P.uid,generation:'1',observedGeneration:'1',terminalCondition:{state:'CONDITION_SUCCEEDED'},etag:'SYNTHETIC_ETAG',executionCount:0};
  value.exchange.responseSha256=digest(value.projection);return value;
}
test('POST projection accepts exact immutable task bytes with a synthetic direct GET exchange',()=>{
  const value=qualifiedObservation(),result=projectPostMetadataObservationV1(value);
  assert.equal(result.kind,'NATIVE_GCP_JSON_GET_OBSERVATION_V2');
  assert.equal(result.response.bodySha256,digest(value.projection));
  assert.deepEqual(result.response.projection,value.projection);
  assert.deepEqual(result.request,{method:'GET',url:URL});
});
const metadataChanges={
  execution:v=>v.projection.executionCount=1,reconciling:v=>v.projection.reconciling=true,
  deletion:v=>v.projection.deleteTime='2026-11-11T10:00:00Z',generation:v=>v.projection.generation='0',
  observedGeneration:v=>v.projection.observedGeneration='2',terminal:v=>v.projection.terminalCondition.state='CONDITION_FAILED',
  missingTerminal:v=>delete v.projection.terminalCondition,etag:v=>v.projection.etag='',
  responseHash:v=>v.exchange.responseSha256='0'.repeat(64),taskBytes:v=>v.projection.template.template.maxRetries=1,
};
for(const [name,change] of Object.entries(metadataChanges)){
  test('POST qualified task still refuses '+name,()=>{
    const value=qualifiedObservation();change(value);assert.throws(()=>projectPostMetadataObservationV1(value));
  });
}
