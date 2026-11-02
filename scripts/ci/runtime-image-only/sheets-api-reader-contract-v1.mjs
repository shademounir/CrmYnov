// SOURCE PROPOSAL ONLY. Pure semantics; not an authority, transport or native entry.
// Real evidence, protection, scope/SDK/journal hooks and guarded executor remain required.
import assert from 'node:assert/strict';
// Match the default UTF-16/code-unit order without locale-dependent hashes.
const codeUnitOrder=(left,right)=>{
 if(left<right){return -1;}
 if(left>right){return 1;}
 return 0;
};
import {imageJournalDigest as digest} from './journal.mjs';
import {imageServiceConfiguration,validateImageOnlyResourceState} from './served-state.mjs';
import {validateImageInventoryPublicProjection as publicData} from './operational-cli-v2.mjs';
import {IMAGE_OPERATIONAL_RESOURCES_V2} from './late-binding-v2.mjs';

const RESOURCE='projects/crmynov-prod-n7x4q2/locations/europe-west1/services/crm-prod-api';
const EXPECTED_UID=IMAGE_OPERATIONAL_RESOURCES_V2.services.find(row=>row.name===RESOURCE).uid;
const IMAGE='europe-west1-docker.pkg.dev/crmynov-prod-n7x4q2/crm-ynov-prod/api@sha256:d2b2f6b0cf0ed9d9eb1cb15b70924af38be7ca4c4a824b6b406bb62caf88cd8f';
const FLAG='CRM_GOOGLE_SHEETS_ENABLED';
const OTHER_FLAGS=['SHEETS_ENABLED','SHEET_ROW_APPEND_ENABLED','CRM_SHEET_APPEND_POLICY_QUALIFIED','SHEET_CUTOVER_ENABLED','FORMINATOR_WEBHOOK_ENABLED'];
const PROFILE=Object.freeze({
 ENABLE_READER:Object.freeze({scope:'RC48_API_SHEETS_READER_CONFIG_ONLY_V1',action:'PATCH_API_READER',stage:'API_READER_CONFIG',before:'false',after:'true'}),
 DISABLE_READER:Object.freeze({scope:'RC48_API_SHEETS_READER_CONFIG_ROLLBACK_V1',action:'ROLLBACK_API_READER',stage:'API_READER_CONFIG_ROLLBACK',before:'true',after:'false'})
});
function exact(value,keys){
 assert(value&&Object.getPrototypeOf(value)===Object.prototype);
 const descriptors=Object.getOwnPropertyDescriptors(value);
 assert(Reflect.ownKeys(descriptors).every(key=>typeof key==='string'&&Object.hasOwn(descriptors[key],'value')));
 assert.deepEqual(Object.keys(descriptors).toSorted(codeUnitOrder),[...keys].toSorted(codeUnitOrder));
}
function instant(value){assert.equal(typeof value,'string');const n=Date.parse(value);assert(Number.isSafeInteger(n)&&new Date(n).toISOString()===value);return n;}
function literal(container,name,value){
 const rows=container.env.filter(row=>row.name===name);assert.equal(rows.length,1,'EXACT_LITERAL_ENV_REQUIRED');
 exact(rows[0],['name','value']);assert.equal(rows[0].value,value,'EXACT_LITERAL_ENV_REQUIRED');return rows[0];
}
function beforeConfiguration(service,profile){
 publicData(service);assert.equal(service.name,RESOURCE);assert.equal(service.uid,EXPECTED_UID);
 assert.equal(typeof service.etag,'string');assert(service.etag.length>0&&service.etag.length<=1024&&!/[\u0000-\u001f\u007f]/u.test(service.etag));
 assert.equal(service.reconciling??false,false);assert.equal(service.deleteTime,undefined);
 assert.equal(service.terminalCondition?.state,'CONDITION_SUCCEEDED');
 assert.equal(service.latestCreatedRevision,service.latestReadyRevision);
 assert.equal(typeof service.latestReadyRevision,'string');const prefix=RESOURCE+'/revisions/',ready=service.latestReadyRevision.startsWith(prefix)?service.latestReadyRevision.slice(prefix.length):service.latestReadyRevision;
 assert.match(ready,/^crm-prod-api-[a-z0-9-]+$/u);assert.match(service.generation,/^[1-9]\d*$/u);assert.equal(service.observedGeneration,service.generation);
 assert(Array.isArray(service.trafficStatuses)&&service.trafficStatuses.length===1);const traffic=service.trafficStatuses[0];assert.equal(traffic.type,'TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST');assert.equal(traffic.percent,100);assert.equal(typeof traffic.revision,'string');
 assert.equal(traffic.revision.startsWith(prefix)?traffic.revision.slice(prefix.length):traffic.revision,ready,'READER_BASELINE_READY_REVISION_REQUIRED');
 const config=imageServiceConfiguration(service);assert.equal(config.template.containers.length,1);
 const container=config.template.containers[0];assert.equal(container.image,IMAGE);assert(Array.isArray(container.env));
 for(const name of OTHER_FLAGS){literal(container,name,'false');}literal(container,'CRM_BACKGROUND_WORKERS','external');
 literal(container,FLAG,profile.before);return config;
}
export function buildApiSheetReaderPlanDraftV1({direction,before,baselineObservedAt}){
 assert(Object.hasOwn(PROFILE,direction),'CLOSED_READER_DIRECTION_REQUIRED');instant(baselineObservedAt);
 const profile=PROFILE[direction],configuration=beforeConfiguration(before,profile),containers=structuredClone(configuration.template.containers);
 literal(containers[0],FLAG,profile.before).value=profile.after;
 return {schemaVersion:1,kind:'RC48_API_SHEETS_READER_CONFIG_PLAN_DRAFT_V1',direction,scope:profile.scope,action:profile.action,stage:profile.stage,
  resource:RESOURCE,expectedUid:EXPECTED_UID,expectedEtag:before.etag,image:IMAGE,baselineObservedAt,baselineConfigurationSha256:digest(configuration),
  patch:{method:'PATCH',resource:RESOURCE,expectedEtag:before.etag,updateMask:'template.containers',body:{name:RESOURCE,etag:before.etag,template:{containers}}},
  sourcePlanOnly:true,nativeAuthority:false,businessMutation:false,runtimeImageMutation:false,ingestionActivation:false};
}
export function validateApiSheetReaderPlanDraftV1(plan,before){
 publicData(plan);exact(plan,['schemaVersion','kind','direction','scope','action','stage','resource','expectedUid','expectedEtag','image','baselineObservedAt','baselineConfigurationSha256','patch','sourcePlanOnly','nativeAuthority','businessMutation','runtimeImageMutation','ingestionActivation']);
 const expected=buildApiSheetReaderPlanDraftV1({direction:plan.direction,before,baselineObservedAt:plan.baselineObservedAt});
 assert.deepEqual(plan,expected,'ONLY_EXACT_ONE_LITERAL_READER_FLAG_DIFF_ALLOWED');return expected;
}
// Local composition of an actual closed GET receipt, not provider-origin authentication.
// Caller must verify its source/native provenance before invoking this pure comparator.
export function validateApiSheetReaderCurrentCasV1({plan,before,observation,now}){
 validateApiSheetReaderPlanDraftV1(plan,before);publicData(observation);
 exact(observation,['schemaVersion','kind','requestStartedAt','responseReceivedAt','request','response']);
 assert.equal(observation.schemaVersion,2);assert.equal(observation.kind,'NATIVE_GCP_JSON_GET_OBSERVATION_V2');
 const start=instant(observation.requestStartedAt),end=instant(observation.responseReceivedAt);
 assert(Number.isSafeInteger(now)&&start<=end&&end<=now&&end-start<=15000&&now-start<600000,'FRESH_EXACT_API_CAS_OBSERVATION_REQUIRED');
 exact(observation.request,['method','url']);assert.deepEqual(observation.request,{method:'GET',url:'https://run.googleapis.com/v2/'+RESOURCE});
 exact(observation.response,['status','finalUrl','redirected','bodySha256','hashMeaning','projection']);
 assert.equal(observation.response.status,200);assert.equal(observation.response.redirected,false);assert.equal(observation.response.finalUrl,observation.request.url);
 assert.equal(observation.response.hashMeaning,'CANONICAL_PARSED_JSON_NOT_WIRE_BYTES');
 const current=observation.response.projection;assert.equal(digest(current),observation.response.bodySha256);
 beforeConfiguration(current,PROFILE[plan.direction]);
 assert.equal(current.uid,plan.expectedUid);assert.equal(current.etag,plan.expectedEtag,'READER_API_ETAG_CHANGED_NO_PATCH');
 assert.deepEqual(imageServiceConfiguration(current),imageServiceConfiguration(before),'READER_API_CONFIGURATION_DRIFT_NO_PATCH');
 for(const key of ['generation','observedGeneration','latestReadyRevision','latestCreatedRevision','trafficStatuses']){assert.deepEqual(current[key],before[key],'READER_API_RUNTIME_DRIFT_NO_PATCH');}
 return{schemaVersion:1,kind:'LOCAL_API_READER_CAS_COMPARISON_V1',planSha256:digest(plan),nativeGetReceiptSha256:digest(observation),requestStartedAt:observation.requestStartedAt,responseReceivedAt:observation.responseReceivedAt,nativeOriginAuthenticated:false,claimArmed:false,activationAuthorized:false};
}
export function validateApiSheetReaderServedV1({plan,before,service,revision,observedAt,now}){
 validateApiSheetReaderPlanDraftV1(plan,before);publicData({service,revision,observedAt});
 // Reuse only the existing shared pure resource comparator, not IMAGE_ONLY plan,
 // authority, scopes, stages, journal, executor or noFlagActivation admission.
 const compared=validateImageOnlyResourceState({before,patch:plan.patch,targetImage:IMAGE,kind:'api',service,revision,observedAt},now);
 assert.deepEqual(revision.containers,plan.patch.body.template.containers,'READER_SERVED_CONTAINER_CONFIGURATION_DRIFT');
 assert.equal(revision.containers.length,1);const container=revision.containers[0];
 literal(container,FLAG,PROFILE[plan.direction].after);for(const name of OTHER_FLAGS){literal(container,name,'false');}literal(container,'CRM_BACKGROUND_WORKERS','external');
 return{...compared,kind:'LOCAL_API_READER_CONFIG_SERVED_COMPARISON_V1',scope:plan.scope,planSha256:digest(plan),readerEnabled:PROFILE[plan.direction].after==='true',
  nativeOriginAuthenticated:false,httpRuntimeServedVerified:false,googleSourceReadVerified:false,connectorStoppedVerified:false,globalReadOnlyProved:false,sheetsActivated:false,activationAuthorized:false};
}

// Separate INPUTS preparation contract. Appended without changing any FLAG-ONLY
// export above. Pure local comparisons are NOT provider evidence or an issuer.
const INPUTS_SCOPE='RC48_API_GOOGLE_SHEETS_RUNTIME_INPUTS_ONLY_V1';
const INPUTS_ACTION='PREPARE_API_GOOGLE_SHEETS_INPUTS';
const INPUTS_STAGE='API_GOOGLE_SHEETS_INPUTS';
const INPUTS_RUNTIME_SA='crm-prod-api@crmynov-prod-n7x4q2.iam.gserviceaccount.com';
const INPUTS_BUCKET='crm-prod-sheet-private-n7x4q2';
const INPUTS_MOUNT='/var/run/crm-sheet-private';
const INPUTS_VOLUME='sheet-private';
const INPUTS_NAMES=['CRM_GOOGLE_SHEETS_AUTH_MODE','CRM_GOOGLE_SHEETS_IMPERSONATE_SERVICE_ACCOUNT','CRM_GOOGLE_SHEETS_ALLOWLIST_FILE','CRM_GOOGLE_SHEETS_ALLOWLIST_SHA256'];
const INPUTS_ADC_OVERRIDES=new Set(['CRM_GOOGLE_SHEETS_CREDENTIALS_FILE','GOOGLE_APPLICATION_CREDENTIALS','CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE','GOOGLE_GHA_CREDS_PATH','GCE_METADATA_HOST','GCE_METADATA_IP','GCE_METADATA_ROOT']);
function inputsReferenceV1(ref){
 exact(ref,['path','sha256']);assert.equal(typeof ref.path,'string');
 assert(/^(?:[A-Za-z]:[\\/]|\/)/u.test(ref.path)&&ref.path.length<=4096&&!/[\u0000-\u001f\u007f]/u.test(ref.path));
 assert(!ref.path.split(/[\\/]/u).some(part=>part==='..'||part==='.'),'INPUTS_REFERENCE_PATH');
 assert.match(ref.sha256,/^[a-f0-9]{64}$/u);return ref;
}
function inputsMetadataV1(value){
 publicData(value);exact(value,['schemaVersion','kind','allowlist','principal','object','runtimeIdentity','bucketEvidence']);
 assert.equal(value.schemaVersion,1);assert.equal(value.kind,'EXISTING_API_GOOGLE_SHEETS_INPUT_REFERENCES_V1');
 exact(value.allowlist,['reference','byteLength']);inputsReferenceV1(value.allowlist.reference);
 assert(Number.isSafeInteger(value.allowlist.byteLength)&&value.allowlist.byteLength>0&&value.allowlist.byteLength<=65536,'INPUTS_ALLOWLIST_SIZE');
 exact(value.principal,['email','projectId','evidence']);inputsReferenceV1(value.principal.evidence);
 assert.match(value.principal.projectId,/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/u);
 assert.match(value.principal.email,/^[a-z][a-z0-9-]{4,28}[a-z0-9]@[a-z][a-z0-9-]+\.iam\.gserviceaccount\.com$/u);
 assert.equal(value.principal.email.split('@')[1],value.principal.projectId+'.iam.gserviceaccount.com','INPUTS_PRINCIPAL_PROJECT');
 exact(value.object,['bucket','name','generation','size','evidence']);inputsReferenceV1(value.object.evidence);inputsReferenceV1(value.bucketEvidence);
 assert.equal(value.object.bucket,INPUTS_BUCKET);assert.equal(typeof value.object.name,'string');
 assert(value.object.name.length<=1024&&/^[A-Za-z0-9._/-]+\.json$/u.test(value.object.name)&&value.object.name.split('/').every(part=>part&&part!=='.'&&part!=='..'),'INPUTS_OBJECT_PATH');
 assert(value.object.name.includes(value.allowlist.reference.sha256),'INPUTS_HASH_ADDRESSED_OBJECT_REQUIRED');
 assert.match(value.object.generation,/^[1-9]\d{0,19}$/u);assert.equal(value.object.size,value.allowlist.byteLength,'INPUTS_OBJECT_SIZE');
 exact(value.runtimeIdentity,['serviceAccount','targetPrincipal','evidence']);inputsReferenceV1(value.runtimeIdentity.evidence);
 assert.equal(value.runtimeIdentity.serviceAccount,INPUTS_RUNTIME_SA);assert.equal(value.runtimeIdentity.targetPrincipal,value.principal.email);
 return value;
}
function inputsConfigurationV1(service){
 const config=beforeConfiguration(service,PROFILE.ENABLE_READER);assert.equal(config.template.serviceAccount,INPUTS_RUNTIME_SA,'INPUTS_RUNTIME_IDENTITY');
 const execution=config.template.executionEnvironment;assert(execution===undefined||execution==='EXECUTION_ENVIRONMENT_GEN2','INPUTS_GEN1_NOT_ALLOWED');
 const container=config.template.containers[0],names=container.env.map(row=>row.name);
 assert.equal(new Set(names).size,names.length,'INPUTS_DUPLICATE_ENV');
 assert(!names.some(name=>INPUTS_ADC_OVERRIDES.has(name)),'INPUTS_ADC_OVERRIDE_NOT_ALLOWED');
 for(const name of INPUTS_NAMES){const rows=container.env.filter(row=>row.name===name);if(rows.length){exact(rows[0],['name','value']);}}
 assert(config.template.volumes===undefined||Array.isArray(config.template.volumes));assert(container.volumeMounts===undefined||Array.isArray(container.volumeMounts));
 for(const rows of [config.template.volumes??[],container.volumeMounts??[]])assert.equal(new Set(rows.map(row=>row.name)).size,rows.length,'INPUTS_DUPLICATE_MOUNT');
 return config;
}
function inputsDesiredEnvV1(inputs){return[
 {name:INPUTS_NAMES[0],value:'ADC_IMPERSONATION'},
 {name:INPUTS_NAMES[1],value:inputs.principal.email},
 {name:INPUTS_NAMES[2],value:INPUTS_MOUNT+'/'+inputs.object.name},
 {name:INPUTS_NAMES[3],value:inputs.allowlist.reference.sha256}
];}
function inputsPatchV1(config,inputs){
 const containers=structuredClone(config.template.containers),volumes=structuredClone(config.template.volumes??[]),container=containers[0];
 for(const wanted of inputsDesiredEnvV1(inputs)){
  const current=container.env.find(row=>row.name===wanted.name);
  if(current){assert.deepEqual(current,wanted,'INPUTS_EXISTING_VALUE_MUST_MATCH_SELECTION');}else{container.env.push(wanted);}
 }
 const mount={name:INPUTS_VOLUME,mountPath:INPUTS_MOUNT},volume={name:INPUTS_VOLUME,gcs:{bucket:inputs.object.bucket,readOnly:true,mountOptions:['implicit-dirs']}};
 const mounts=container.volumeMounts??[];
 for(const current of mounts){assert.equal(typeof current.mountPath,'string');assert(current.mountPath.startsWith('/')&&!current.mountPath.endsWith('/')&&!current.mountPath.includes('//')&&!current.mountPath.split('/').some(part=>part==='..'||part==='.'),'INPUTS_MOUNT_PATH');
  if(current.name===INPUTS_VOLUME){assert.deepEqual(current,mount,'INPUTS_EXISTING_MOUNT_CONFLICT');}
  else{const a=current.mountPath.replace(/\/$/u,''),b=INPUTS_MOUNT;assert(a!==b&&!a.startsWith(b+'/')&&!b.startsWith(a+'/'),'INPUTS_OVERLAPPING_MOUNT');}
 }
 if(!mounts.some(row=>row.name===INPUTS_VOLUME)){mounts.push(mount);}container.volumeMounts=mounts;
 const current=volumes.find(row=>row.name===INPUTS_VOLUME);if(current){assert.deepEqual(current,volume,'INPUTS_EXISTING_VOLUME_CONFLICT');}else{volumes.push(volume);}
 assert(!containers.every((row,index)=>digest(row)===digest(config.template.containers[index]))||digest(volumes)!==digest(config.template.volumes??[]),'INPUTS_ALREADY_PREPARED_NO_PATCH');
 return{containers,volumes};
}
export function buildApiGoogleSheetsInputsPlanDraftV1({before,inputs,baselineObservedAt}){
 inputsMetadataV1(inputs);instant(baselineObservedAt);const config=inputsConfigurationV1(before),template=inputsPatchV1(config,inputs);
 return{schemaVersion:1,kind:'RC48_API_GOOGLE_SHEETS_INPUTS_PLAN_DRAFT_V1',scope:INPUTS_SCOPE,action:INPUTS_ACTION,stage:INPUTS_STAGE,
  resource:RESOURCE,expectedUid:EXPECTED_UID,expectedEtag:before.etag,image:IMAGE,runtimeServiceAccount:INPUTS_RUNTIME_SA,baselineObservedAt,baselineConfigurationSha256:digest(config),inputReferencesSha256:digest(inputs),
  patch:{method:'PATCH',resource:RESOURCE,expectedEtag:before.etag,updateMask:'template.containers,template.volumes',body:{name:RESOURCE,etag:before.etag,template}},
  implicitExecutionEnvironmentPolicy:'ONLY_UNSET_TO_DOCUMENTED_GEN2',sourcePlanOnly:true,nativeAuthority:false,businessMutation:false,runtimeImageMutation:false,ingestionActivation:false,createsCloudResources:false,changesIam:false};
}
export function validateApiGoogleSheetsInputsPlanDraftV1(plan,before,inputs){
 publicData(plan);const rebuilt=buildApiGoogleSheetsInputsPlanDraftV1({before,inputs,baselineObservedAt:plan.baselineObservedAt});
 assert.deepEqual(plan,rebuilt,'ONLY_FOUR_INPUT_ENV_AND_ONE_READONLY_MOUNT_ALLOWED');return rebuilt;
}
function inputsCasObservationV1(observation,now){
 publicData(observation);exact(observation,['schemaVersion','kind','requestStartedAt','responseReceivedAt','request','response']);
 assert.equal(observation.schemaVersion,2);assert.equal(observation.kind,'NATIVE_GCP_JSON_GET_OBSERVATION_V2');
 const start=instant(observation.requestStartedAt),end=instant(observation.responseReceivedAt);
 assert(Number.isSafeInteger(now)&&start<=end&&end<=now&&end-start<=15000&&now-start<600000,'FRESH_EXACT_INPUTS_CAS_OBSERVATION_REQUIRED');
 exact(observation.request,['method','url']);assert.deepEqual(observation.request,{method:'GET',url:'https://run.googleapis.com/v2/'+RESOURCE});
 exact(observation.response,['status','finalUrl','redirected','bodySha256','hashMeaning','projection']);
 assert.equal(observation.response.status,200);assert.equal(observation.response.redirected,false);assert.equal(observation.response.finalUrl,observation.request.url);
 assert.equal(observation.response.hashMeaning,'CANONICAL_PARSED_JSON_NOT_WIRE_BYTES');assert.equal(digest(observation.response.projection),observation.response.bodySha256);return observation.response.projection;
}
export function validateApiGoogleSheetsInputsCurrentCasV1({plan,before,inputs,observation,now}){
 validateApiGoogleSheetsInputsPlanDraftV1(plan,before,inputs);const current=inputsCasObservationV1(observation,now);inputsConfigurationV1(current);
 assert.equal(current.etag,plan.expectedEtag,'INPUTS_API_ETAG_CHANGED_NO_PATCH');
 assert.deepEqual(imageServiceConfiguration(current),imageServiceConfiguration(before),'INPUTS_API_CONFIGURATION_DRIFT_NO_PATCH');
 for(const key of ['generation','observedGeneration','latestReadyRevision','latestCreatedRevision','trafficStatuses'])assert.deepEqual(current[key],before[key],'INPUTS_API_RUNTIME_DRIFT_NO_PATCH');
 return{schemaVersion:1,kind:'LOCAL_API_GOOGLE_SHEETS_INPUTS_CAS_COMPARISON_V1',planSha256:digest(plan),inputReferencesSha256:digest(inputs),nativeGetReceiptSha256:digest(observation),nativeOriginAuthenticated:false,claimArmed:false,activationAuthorized:false};
}
function inputsRevisionV1(value){assert.equal(typeof value,'string');const prefix=RESOURCE+'/revisions/',leaf=value.startsWith(prefix)?value.slice(prefix.length):value;assert.match(leaf,/^crm-prod-api-[a-z0-9-]+$/u);return leaf;}
function inputsServedConfigurationV1({plan,before,service}){
 const expected=imageServiceConfiguration(before),actual=inputsConfigurationV1(service);
 expected.template.containers=structuredClone(plan.patch.body.template.containers);expected.template.volumes=structuredClone(plan.patch.body.template.volumes);
 const next=inputsRevisionV1(service.latestReadyRevision);
 if(Object.hasOwn(expected.template,'revision')){assert.equal(inputsRevisionV1(expected.template.revision),inputsRevisionV1(before.latestReadyRevision));assert.equal(inputsRevisionV1(actual.template.revision),next);expected.template.revision=actual.template.revision;}
 const documentedImplicitGen2=expected.template.executionEnvironment===undefined&&actual.template.executionEnvironment==='EXECUTION_ENVIRONMENT_GEN2';
 if(documentedImplicitGen2){expected.template.executionEnvironment='EXECUTION_ENVIRONMENT_GEN2';}
 assert.deepEqual(actual,expected,'INPUTS_NON_TARGET_CONFIGURATION_DRIFT');return{actual,documentedImplicitGen2};
}
export function validateApiGoogleSheetsInputsServedV1({plan,before,inputs,service,revision,observedAt,now}){
 validateApiGoogleSheetsInputsPlanDraftV1(plan,before,inputs);publicData({service,revision,observedAt});
 const observed=instant(observedAt);assert(Number.isSafeInteger(now)&&observed<=now&&now-observed<=300000,'CURRENT_INPUTS_SERVED_STATE_REQUIRED');
 const compared=inputsServedConfigurationV1({plan,before,service}),next=inputsRevisionV1(service.latestReadyRevision);
 assert(BigInt(service.generation)>BigInt(before.generation),'INPUTS_NEW_GENERATION_REQUIRED');assert.notEqual(next,inputsRevisionV1(before.latestReadyRevision),'INPUTS_NEW_REVISION_REQUIRED');
 assert.equal(revision.name,RESOURCE+'/revisions/'+next);assert.equal(revision.reconciling??false,false);assert.equal(revision.deleteTime,undefined);
 assert(Array.isArray(revision.conditions)&&revision.conditions.some(row=>row.type==='Ready'&&row.state==='CONDITION_SUCCEEDED'),'INPUTS_REVISION_READY_REQUIRED');
 assert.deepEqual(revision.containers,plan.patch.body.template.containers,'INPUTS_REVISION_CONTAINER_DRIFT');assert.deepEqual(revision.volumes,plan.patch.body.template.volumes,'INPUTS_REVISION_VOLUME_DRIFT');assert.equal(revision.serviceAccount,INPUTS_RUNTIME_SA);
 assert(revision.executionEnvironment===undefined||revision.executionEnvironment==='EXECUTION_ENVIRONMENT_GEN2','INPUTS_REVISION_GEN1_REFUSED');
 return{schemaVersion:1,kind:'LOCAL_API_GOOGLE_SHEETS_INPUTS_SERVED_COMPARISON_V1',scope:INPUTS_SCOPE,action:INPUTS_ACTION,stage:INPUTS_STAGE,resource:RESOURCE,uid:EXPECTED_UID,image:IMAGE,revision:revision.name,observedAt,configurationSha256:digest(compared.actual),planSha256:digest(plan),inputReferencesSha256:digest(inputs),documentedImplicitGen2:compared.documentedImplicitGen2,
  nativeOriginAuthenticated:false,httpRuntimeServedVerified:false,mountedObjectBytesVerified:false,googleSourceReadVerified:false,runtimeGooglePermissionsObserved:false,allSixFlagsRemainOff:true,sheetsActivated:false,activationAuthorized:false};
}
// This projection demonstrates the required R6 data lineage. It is deliberately
// NOT a replacement FIN/issuer. A future protected R6 adapter must authenticate
// reference bytes and native source/operation/preservation before consuming it.
export function projectApiGoogleSheetsInputsReaderLineageV1({plan,before,inputs,service,revision,observedAt,now,imageFin,readerBefore,evidenceRefs}){
 const prepared=validateApiGoogleSheetsInputsServedV1({plan,before,inputs,service,revision,observedAt,now});publicData({imageFin,readerBefore,evidenceRefs});
 exact(evidenceRefs,['imageFin','inputsPrepareFin','readerBaseline']);for(const ref of Object.values(evidenceRefs))inputsReferenceV1(ref);
 assert(imageFin.stage==='API_IMAGE'&&imageFin.outcome==='SUCCEEDED','INPUTS_ORIGINAL_IMAGE_FIN_REQUIRED');
 assert.equal(imageFin.served.kind,'api');assert.equal(imageFin.served.resource,RESOURCE);assert.equal(imageFin.served.uid,EXPECTED_UID);assert.equal(imageFin.served.image,IMAGE);
 assert.equal(imageFin.served.configurationSha256,digest(imageServiceConfiguration(before)),'INPUTS_IMAGE_TO_BEFORE_MISMATCH');assert.equal(inputsRevisionV1(imageFin.served.revision),inputsRevisionV1(before.latestReadyRevision));
 assert.deepEqual(readerBefore,service,'INPUTS_PREPARED_TO_READER_BASELINE_MISMATCH');
 return{schemaVersion:1,kind:'STRUCTURAL_ONLY_API_IMAGE_INPUTS_READER_LINEAGE_V1',evidenceRefs:structuredClone(evidenceRefs),originalImageFinCanonicalSha256:digest(imageFin),planSha256:digest(plan),inputReferencesSha256:digest(inputs),beforeConfigurationSha256:digest(imageServiceConfiguration(before)),afterConfigurationSha256:prepared.configurationSha256,readerBaselineConfigurationSha256:digest(imageServiceConfiguration(readerBefore)),oldImageFinRevision:imageFin.served.revision,preparedRevision:revision.name,readerBaselineRevision:readerBefore.latestReadyRevision,
  sourcePlanOnly:true,nativeAuthority:false,referencedBytesVerified:false,inputsPrepareFinAuthorityVerified:false,runtimeAdapterIntegrated:false,noImageFinRelabelled:true,activationAuthorized:false};
}
