import assert from 'node:assert/strict';
import {digest} from './controlled-pool-contract-v1.mjs';
import {buildPoolRuntimeBundle} from './pool-runtime-bundle-v1.mjs';
import {POOL_IMAGE,validatePoolObjective,poolPrivateNetwork} from './pool-native-output-v1.mjs';
const ROOT='projects/crmynov-prod-n7x4q2/locations/europe-west1/jobs/';
export const POOL_RUNTIME_FILES=Object.freeze({collector:'pool-read-only-collector-v1.mjs',entry:'pool-runtime-entry-v1.mjs',output:'pool-sealed-output-v1.mjs'});
export function buildPoolJobDossier({sources,request,jobName,nonce,databaseBindingSha256,publicKeyPem,networkBinding,databaseSecretVersion,intentAt}){
  assert.deepEqual(networkBinding,poolPrivateNetwork(),'EXISTING_PRIVATE_NETWORK_REQUIRED');
  assert(/^[1-9]\d*$/u.test(databaseSecretVersion));
  const bound=buildPoolRuntimeBundle({sources,request,jobName,nonce,databaseBindingSha256,publicKeyPem});
  const databaseSecretRef={secret:'crm-prod-runtime-database-url',version:databaseSecretVersion};
  const task={containers:[{image:POOL_IMAGE,command:['/nodejs/bin/node'],args:['--input-type=module','--eval',bound.bootstrap],env:[{name:'DATABASE_URL',valueSource:{secretKeyRef:databaseSecretRef}},{name:'GOOGLE_CLOUD_PROJECT',value:'crmynov-prod-n7x4q2'},{name:'CRM_POOL_BUNDLE_SHA256',value:bound.bundleSha256},{name:'CRM_POOL_BUNDLE_BASE64',value:bound.base64}],resources:{limits:{cpu:'1000m',memory:'512Mi'}}}],vpcAccess:structuredClone(networkBinding),maxRetries:0,timeout:'120s',serviceAccount:'crm-prod-api@crmynov-prod-n7x4q2.iam.gserviceaccount.com',executionEnvironment:'EXECUTION_ENVIRONMENT_GEN2'};
  const objective={schemaVersion:1,purpose:request.purpose,main:'8253024ea35cee6be5636cc6b10a88ae7e177377',image:POOL_IMAGE,jobName:ROOT+jobName,serviceAccount:task.serviceAccount,objectiveSha256:digest({request,jobName,nonce,databaseBindingSha256,key:bound.publicKeySha256,source:bound.sourceSha256,image:POOL_IMAGE,networkBinding,databaseSecretVersion,intentAt}),sourceSha256:bound.sourceSha256,bundleSha256:bound.bundleSha256,bootstrapSha256:bound.bootstrapSha256,databaseBindingSha256,publicKeySha256:bound.publicKeySha256,taskTemplateSha256:digest(task),taskTemplate:task,databaseSecretRef,intentAt};
  validatePoolObjective(objective);
  const job={labels:{'crmynov-probe-objective':objective.objectiveSha256.slice(0,63)},template:{taskCount:1,parallelism:1,template:task}};
  return {schemaVersion:1,objective,job,bundle:bound.bundle};
}
export function validateLocalPoolDossier(dossier,readSource){
  assert.deepEqual(Object.keys(dossier).sort((a,b)=>a.localeCompare(b,'en')),['bundle','job','objective','schemaVersion']);assert.equal(dossier.schemaVersion,1);
  const e=dossier.objective;validatePoolObjective(e);assert.equal(typeof readSource,'function');
  assert.deepEqual(dossier.job,{labels:{'crmynov-probe-objective':e.objectiveSha256.slice(0,63)},template:{taskCount:1,parallelism:1,template:e.taskTemplate}});
  const sources=Object.fromEntries(Object.entries(POOL_RUNTIME_FILES).map(([name,file])=>[name,readSource(file).toString('utf8')]));
  const actual=dossier.bundle;
  const rebuilt=buildPoolJobDossier({sources,request:actual.request,jobName:actual.jobName,nonce:actual.nonce,databaseBindingSha256:actual.databaseBindingSha256,publicKeyPem:actual.publicKeyPem,networkBinding:e.taskTemplate.vpcAccess,databaseSecretVersion:e.databaseSecretRef.version,intentAt:e.intentAt});
  assert.deepEqual(dossier,rebuilt,'PROTECTED_LOCAL_PAYLOAD_BYTES');return dossier;
}
