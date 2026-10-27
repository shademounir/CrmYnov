// Purpose-bound observation entry. No app bootstrap, provider, executor or CLI.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {runGeneralPreservationReadOnlyCollection,validateGeneralPreservationRequest} from './general-preservation-read-only-collector-v1.mjs';
import {runSchemaLedgerReadOnlyCollection,validateSchemaLedgerRequest} from './schema-ledger-read-only-collector-v1.mjs';
import {sealReadOnlyOutput,hashBytes,publicKeyFingerprint} from './readonly-output-codec-v1.mjs';
const ROOT='projects/crmynov-prod-n7x4q2/locations/europe-west1/jobs/';
const PROFILES=Object.freeze({
  GENERAL_PRESERVATION_READ_ONLY_V1:Object.freeze({prefix:'crm-prod-preservation-',role:'crm_runtime',validate:validateGeneralPreservationRequest,run:runGeneralPreservationReadOnlyCollection}),
  SCHEMA_LEDGER_READ_ONLY_V1:Object.freeze({prefix:'crm-prod-schema-ledger-',role:'crm_migrator',validate:validateSchemaLedgerRequest,run:runSchemaLedgerReadOnlyCollection}),
});
function exact(value,names){assert(value&&Object.getPrototypeOf(value)===Object.prototype,'PLAIN_FIELDS');assert.deepEqual(Object.keys(value).sort((a,b)=>a.localeCompare(b,'en')),[...names].sort((a,b)=>a.localeCompare(b,'en')),'EXACT_FIELDS');assert(Object.values(Object.getOwnPropertyDescriptors(value)).every(d=>Object.hasOwn(d,'value')),'DATA_FIELDS_ONLY');}
function profile(request){assert(request&&Object.getPrototypeOf(request)===Object.prototype);assert(Object.values(Object.getOwnPropertyDescriptors(request)).every(d=>Object.hasOwn(d,'value')),'DATA_FIELDS_ONLY');assert.equal(typeof request.purpose,'string');assert(Object.hasOwn(PROFILES,request.purpose),'PURPOSE');const p=PROFILES[request.purpose];p.validate(request);return p;}
export function validateReadOnlyRuntimeBundle(bundle){
  exact(bundle,['schemaVersion','request','jobName','nonce','databaseBindingSha256','publicKeyPem','modules']);assert.equal(bundle.schemaVersion,1);const p=profile(bundle.request);
  assert.equal(typeof bundle.jobName,'string');assert(bundle.jobName.startsWith(p.prefix));assert(/^[a-z0-9-]+$/u.test(bundle.jobName.slice(p.prefix.length)));assert(bundle.jobName.length<=63);
  for(const k of ['nonce','databaseBindingSha256']){assert(typeof bundle[k]==='string'&&/^[a-f0-9]{64}$/u.test(bundle[k]));}
  publicKeyFingerprint(bundle.publicKeyPem);
  exact(bundle.modules,['core','pool','general','ledger','crypto','codec','entry']);for(const value of Object.values(bundle.modules)){exact(value,['source','sha256']);assert.equal(typeof value.source,'string');assert(Buffer.byteLength(value.source)<=100000);assert.equal(hashBytes(value.source),value.sha256,'SOURCE_BYTES');}
  const manifest=Object.keys(bundle.modules).sort((a,b)=>a.localeCompare(b,'en')).map(name=>({name,sha256:bundle.modules[name].sha256}));return{sourceSha256:hashBytes(JSON.stringify(manifest)),publicKeySha256:publicKeyFingerprint(bundle.publicKeyPem)};
}
export function readOnlyDatabaseBinding(urlText,purpose){
  assert.equal(typeof purpose,'string');assert(Object.hasOwn(PROFILES,purpose));assert.equal(typeof urlText,'string');const url=new URL(urlText),p=PROFILES[purpose];assert.equal(url.protocol,'postgresql:');assert.equal(decodeURIComponent(url.username),p.role);assert.equal(url.pathname,'/crmynov_prod');const hosts=url.searchParams.getAll('host');assert(hosts.length<=1);const host=hosts[0]??url.hostname;assert(host&&host.length<=256);return hashBytes(JSON.stringify({role:p.role,database:'crmynov_prod',host,port:url.port||'5432'}));
}
export function validateReadOnlyRuntimeEnvironment(env,bundle){
  assert.equal(env.GOOGLE_CLOUD_PROJECT,'crmynov-prod-n7x4q2');assert.equal(env.CLOUD_RUN_JOB,bundle.jobName);const prefix=bundle.jobName+'-';assert.equal(typeof env.CLOUD_RUN_EXECUTION,'string');assert(env.CLOUD_RUN_EXECUTION.startsWith(prefix));assert(/^[a-z0-9]+$/u.test(env.CLOUD_RUN_EXECUTION.slice(prefix.length)));
  for(const [k,v]of Object.entries({CLOUD_RUN_TASK_COUNT:'1',CLOUD_RUN_TASK_INDEX:'0',CLOUD_RUN_TASK_ATTEMPT:'0'}))assert.equal(env[k],v);
  for(const k of ['K_SERVICE','GOOGLE_APPLICATION_CREDENTIALS','NODE_OPTIONS','NODE_PATH'])assert.equal(env[k],undefined);
  assert.equal(readOnlyDatabaseBinding(env.DATABASE_URL,bundle.request.purpose),bundle.databaseBindingSha256,'DATABASE_BINDING');return{job:ROOT+bundle.jobName,execution:ROOT+bundle.jobName+'/executions/'+env.CLOUD_RUN_EXECUTION};
}
export async function executeReadOnlyWithClient(input,{client,env,version,uid,gid}){
  // Pin JSON data before asynchronous work; reject accessor-backed bundle fields.
  validateReadOnlyRuntimeBundle(input);const bundle=structuredClone(input),bytes=validateReadOnlyRuntimeBundle(bundle),runtime=validateReadOnlyRuntimeEnvironment(env,bundle);assert.equal(version,'22.23.3');assert.equal(uid,65532);assert.equal(gid,65532);
  const observation=await profile(bundle.request).run(client,bundle.request),context={purpose:bundle.request.purpose,phase:bundle.request.phase,...runtime,sourceSha256:bytes.sourceSha256,nonce:bundle.nonce};
  return sealReadOnlyOutput({schemaVersion:1,observation,databaseBindingSha256:bundle.databaseBindingSha256,sourceSha256:bytes.sourceSha256,runtime:{...runtime,taskIndex:0,attempt:0}}, {publicKeyPem:bundle.publicKeyPem,context});
}
export async function executeNativeReadOnlyObservation(bundle){
  validateReadOnlyRuntimeBundle(bundle);validateReadOnlyRuntimeEnvironment(process.env,bundle);assert.equal(process.versions.node,'22.23.3');assert.equal(process.getuid(),65532);assert.equal(process.getgid(),65532);
  const {PrismaClient}=createRequire('/workspace/package.json')('@prisma/client'),client=new PrismaClient({log:[],errorFormat:'minimal'});try{return await executeReadOnlyWithClient(bundle,{client,env:process.env,version:process.versions.node,uid:process.getuid(),gid:process.getgid()});}finally{await client.$disconnect();}
}
