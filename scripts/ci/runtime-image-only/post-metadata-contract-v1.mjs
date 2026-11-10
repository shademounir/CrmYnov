// Dedicated metadata purpose; the POST execution authority is never accepted here.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {imageJournalDigest as digest} from './journal.mjs';
import {assertNoReadOnlyExecutionMetadataV1,validateReadOnlyNativeJob} from '../pool-reconciliation/pool-native-output-v1.mjs';

export const POST_METADATA_V1=Object.freeze({
  kind:'RC48_FIXED_POST_JOB_METADATA_ONLY_V1',
  job:'projects/crmynov-prod-n7x4q2/locations/europe-west1/jobs/crm-prod-preservation-post-20261030-op-v1',
  uid:'5822363b-9c71-4ea6-b920-5d656150ebc4',
  taskTemplateSha256:'20747811418bcb78105e7932a9ee1b3478e281d456b8e8593c79e7cb612c66c8',
  dossierSha256:'484692845e99a828190e6b5232a9ea552d8bcf9b84f6573bda599c0f702723d0',
  objectiveSha256:'143d2890fc04d312a55e2a947fe51407b132be980e60fb5183d56df8aea68e5c',
});
export const POST_METADATA_URL_V1='https://run.googleapis.com/v2/'+POST_METADATA_V1.job;

export function validatePostMetadataBindingV1(value){
  assert.deepEqual(value,POST_METADATA_V1,'EXACT_POST_METADATA_BINDING_REQUIRED');
}
export function readPostMetadataDossierV1(bytes){
  assert(Buffer.isBuffer(bytes)&&bytes.length<=1048576);
  assert.equal(createHash('sha256').update(bytes).digest('hex'),POST_METADATA_V1.dossierSha256,'EXACT_IMMUTABLE_POST_DOSSIER_REQUIRED');
  const d=JSON.parse(bytes);
  assert.equal(d.objective.jobName,POST_METADATA_V1.job);
  assert.equal(d.objective.taskTemplateSha256,POST_METADATA_V1.taskTemplateSha256);
  assert.equal(d.objective.objectiveSha256,POST_METADATA_V1.objectiveSha256);
  assert.equal(d.bundle.request.phase,'POST');
  return d;
}
export function projectPostMetadataObservationV1({projection,exchange,dossier}){
  const url=POST_METADATA_URL_V1;
  assert.equal(exchange.kind,'EXPURGATED_IMAGE_NATIVE_EXCHANGE_OBSERVATION_V2');
  assert.equal(exchange.request?.method,'GET');assert.equal(exchange.request.url,url);
  assert.equal(exchange.status,200);assert.equal(exchange.responseFinalUrl,url);assert.equal(exchange.responseRedirected,false);
  assert.equal(exchange.outcome,'HTTP_200_RECEIVED_NOT_SEMANTIC_ACCEPTANCE');
  const start=Date.parse(exchange.requestStartedAt),end=Date.parse(exchange.responseObservedAt);
  assert(Number.isSafeInteger(start)&&Number.isSafeInteger(end)&&start<=end&&end-start<=15000);
  assert.equal(projection.uid,POST_METADATA_V1.uid);
  assert.equal(projection.name,POST_METADATA_V1.job);
  assert.equal(dossier.objective.taskTemplateSha256,POST_METADATA_V1.taskTemplateSha256);
  validateReadOnlyNativeJob(projection,dossier.objective);assertNoReadOnlyExecutionMetadataV1(projection);
  assert.equal(projection.reconciling??false,false);assert.equal(projection.deleteTime,undefined);
  assert.match(projection.generation,/^[1-9]\d*$/u);assert.equal(projection.observedGeneration,projection.generation);
  assert.equal(projection.terminalCondition?.state,'CONDITION_SUCCEEDED');
  assert.equal(typeof projection.etag,'string');assert(projection.etag.length>0);
  assert.equal(exchange.responseSha256,digest(projection));
  return {schemaVersion:2,kind:'NATIVE_GCP_JSON_GET_OBSERVATION_V2',requestStartedAt:exchange.requestStartedAt,responseReceivedAt:exchange.responseObservedAt,
    request:{method:'GET',url},response:{status:200,finalUrl:url,redirected:false,bodySha256:exchange.responseSha256,hashMeaning:'CANONICAL_PARSED_JSON_NOT_WIRE_BYTES',projection}};
}
