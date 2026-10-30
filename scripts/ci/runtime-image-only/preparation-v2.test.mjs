// Synthetic public records only. No SDK, database, provider or historical read.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {prepareImagePostReadiness} from './post-preservation.mjs';
import {fixture as postFixture} from './post-preservation-fixtures.mjs';
import {IMAGE_GENERAL_BINDING_V2} from './late-binding-v2.mjs';
import {CONSUMER_PINS} from '../pool-reconciliation/general-prospective-pre-authority-v1.mjs';
import {makeImageStaticPostContractV2,bindImageLivePostReadinessV2,validateImageGeneralPreEvidenceV2,validateImagePreparationV2,simulateImageIndependentEvidenceV2,validateImageIndependentEvidenceV2} from './preparation-v2.mjs';
import {operationalPreparationFixtureV2} from './operational-preparation-fixtures-v2.mjs';
import {makeRc48ServiceImagePlanDraft} from './plan.mjs';
import {IMAGE_ROLLBACK_COMPLETION_RULES_SHA256_V2} from './rollback-plan.mjs';
import {imageJournalDigest as digest} from './journal.mjs';
import {OPERATIONAL_HUMAN_SHA256,IMAGE_OPERATIONAL_RESOURCES_V2} from './late-binding-v2.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex'),H='a'.repeat(64);
function store(){const files=new Map();return{files,read:p=>files.get(p),save(name,value){const bytes=Buffer.from(JSON.stringify(value)),path='C:/synthetic/'+name+'.json';files.set(path,bytes);return{path,sha256:hash(bytes)};}};}
function generalFixture(){
  const s=store(),now=Date.parse('2026-10-30T12:00:00.000Z'),completed=new Date(now-1000).toISOString().replace('Z','000Z');
  const execution=IMAGE_GENERAL_BINDING_V2.job+'/executions/crm-prod-preservation-pre-20261028-147f390728-synthetic',operation='projects/crmynov-prod-n7x4q2/locations/europe-west1/operations/synthetic';
  const semantic={kind:'GENERAL-SEMANTIC-FIN',comparison:{semanticAccepted:true,originalRunState:'UNKNOWN',freshnessMs:300000,historicalBaselineSha256:CONSUMER_PINS.baselineSha256}};
  const capture={kind:'VERIFIED-NEW-ENCRYPTED-OUTPUT',jobUid:IMAGE_GENERAL_BINDING_V2.uid,metadataSha256:H,sealedOutputSha256:'b'.repeat(64),transactionCompletedAt:completed};
  const fin={state:'FRESH_PROSPECTIVE_GENERAL_PRE_OBSERVED',...capture,execution,operation};delete fin.kind;
  const proof={schemaVersion:3,kind:'VERIFIED_OPERATIONAL_GENERAL_PRE_V3',binding:structuredClone(IMAGE_GENERAL_BINDING_V2),authorityRecordSha256:H,
    semanticReceipt:s.save('semantic',semantic),nativeCapture:s.save('capture',capture),preFin:s.save('fin',fin),
    completionContext:{schemaVersion:2,completions:[{objectiveId:IMAGE_GENERAL_BINDING_V2.objectiveId,authorityRecordSha256:H,job:{uid:IMAGE_GENERAL_BINDING_V2.uid},execution:{name:execution},operation:{name:operation,done:true,response:{name:execution}}}]}};
  const f={...s,now,proof,semantic,capture,fin,dossier:{pendingGeneral:{prospectiveAuthoritySha256:H}}};
  f.refresh=()=>{f.proof.semanticReceipt=s.save('semantic',f.semantic);f.proof.nativeCapture=s.save('capture',f.capture);f.proof.preFin=s.save('fin',f.fin);f.reference=s.save('general',f.proof);};f.refresh();return f;
}
test('static POST contract excludes freshness/observations, not pinned identities or resource',async()=>{
  const f=postFixture(),ready=await prepareImagePostReadiness(f.args),contract=makeImageStaticPostContractV2(ready),later=structuredClone(ready);
  later.preparedAt=new Date(f.now+1200000).toISOString();later.expiresAt=new Date(f.now+1500000).toISOString();
  later.postJobObservationRef={path:'new-job-observation.json',sha256:'c'.repeat(64)};
  for(const actor of later.recipe.actors){actor.sessionObservation={path:'new-session-'+actor.key+'.json',sha256:'d'.repeat(64)};}
  assert.deepEqual(makeImageStaticPostContractV2(later),contract);
  const s=store(),reference=s.save('static',contract),bound=bindImageLivePostReadinessV2(later,reference,s.read);
  assert.equal(bound.staticPostContractSha256,reference.sha256);assert.equal(bound.preparedAt,later.preparedAt);
  assert.equal(bound.nativeExecutionAuthorized,false);assert.equal(bound.postObservationAcquired,false);
});
for(const [name,change]of [
  ['different job UID',r=>r.postJobUid='11111111-2222-4333-8444-555555555556'],
  ['different job',r=>r.postJob+='-other'],['different image recipe origin',r=>r.recipe.apiOrigin='https://crm-prod-api-other.run.app'],
  ['different actor',r=>r.recipe.actors[0].professionalEmailSha256='f'.repeat(64)],
  ['different role',r=>r.recipe.actors[1].role='AUDITOR'],['different source',r=>r.source.commit='e'.repeat(40)],
  ['different plan',r=>r.planSha256='f'.repeat(64)],['different collector',r=>r.postBundleSha256='e'.repeat(64)],
]){test('live readiness binding refuses '+name,async()=>{const f=postFixture(),ready=await prepareImagePostReadiness(f.args),s=store(),reference=s.save('static',makeImageStaticPostContractV2(ready)),changed=structuredClone(ready);change(changed);assert.throws(()=>bindImageLivePostReadinessV2(changed,reference,s.read));});}
test('a typed verified GENERAL packet is bound to the same job, new authority and real SQL FIN age',()=>{const f=generalFixture(),r=validateImageGeneralPreEvidenceV2(f.reference,{dossier:f.dossier,readEvidence:f.read,now:f.now});assert.equal(r.generalAgeMs,1000);assert.equal(r.completionContext.completions.length,1);});
for(const [name,change]of [
  ['semantic refusal',f=>f.semantic.comparison.semanticAccepted=false],
  ['historical state erased',f=>f.semantic.comparison.originalRunState='NO_EFFECT'],
  ['different baseline',f=>f.semantic.comparison.historicalBaselineSha256='d'.repeat(64)],
  ['different job UID',f=>f.capture.jobUid='wrong'],['different authority',f=>f.proof.authorityRecordSha256='e'.repeat(64)],
  ['different collector',f=>f.proof.binding.selectCount=12],['missing completion',f=>f.proof.completionContext.completions=[]],
  ['operation does not attribute execution',f=>f.proof.completionContext.completions[0].operation.response.name='other'],
  ['operation running',f=>f.proof.completionContext.completions[0].operation.done=false],
  ['operation failed',f=>f.proof.completionContext.completions[0].operation.error={code:7}],
  ['different completion authority',f=>f.proof.completionContext.completions[0].authorityRecordSha256='f'.repeat(64)],
  ['unrelated FIN',f=>f.fin.sealedOutputSha256='c'.repeat(64)],
]){test('GENERAL preparation refuses '+name,()=>{const f=generalFixture();change(f);f.refresh();assert.throws(()=>validateImageGeneralPreEvidenceV2(f.reference,{dossier:f.dossier,readEvidence:f.read,now:f.now}));});}
for(const age of [-1,300001]){test('GENERAL freshness does not reset at receipt/polling age '+age,()=>{const f=generalFixture(),sqlTime=Date.parse(f.capture.transactionCompletedAt);assert.throws(()=>validateImageGeneralPreEvidenceV2(f.reference,{dossier:f.dossier,readEvidence:f.read,now:sqlTime+age}));});}
test('GENERAL freshness includes exactly300000ms, never the time of the host receipt',()=>{const f=generalFixture(),sqlTime=Date.parse(f.capture.transactionCompletedAt);assert.equal(validateImageGeneralPreEvidenceV2(f.reference,{dossier:f.dossier,readEvidence:f.read,now:sqlTime+300000}).generalAgeMs,300000);});
test('a receipt byte/hash change is refused',()=>{const f=generalFixture();f.files.set(f.reference.path,Buffer.from('{}'));assert.throws(()=>validateImageGeneralPreEvidenceV2(f.reference,{dossier:f.dossier,readEvidence:f.read,now:f.now}));});
test('V2 cannot accept the V1 true flags or an incomplete envelope',()=>{assert.throws(()=>validateImagePreparationV2({bytes:Buffer.from('{}'),entry:{schemaVersion:2},readEvidence:()=>Buffer.from('{}'),readSource:()=>Buffer.from(''),now:1}));});

function independentFixture(){
  const f=operationalPreparationFixtureV2(),s=store(),pins={},consumerPins={};
  const source={commit:'c'.repeat(40),tree:'d'.repeat(40),files:['rollback-plan','rollback-context','preparation-jobs','plan','journal'].map(name=>({path:'scripts/ci/runtime-image-only/'+name+'.mjs',sha256:H}))};
  const plan=makeRc48ServiceImagePlanDraft(f.c,f.b,f.now),packets={};
  const add=(kind,value)=>{packets[kind]=value;return{kind,...s.save(kind,value)};};
  const pool=add('POOL',{syntheticOnly:true});pins.POOL=pool.sha256;
  const ledger=add('LEDGER',{status:'NEW_ACTUAL_LEDGER_56_AND_BUSINESS_SCHEMA_MATCH_PROTECTED_RC48',sameSnapshotAsGeneralOrPool:false,activation:false});pins.LEDGER=ledger.sha256;
  const configuration=s.save('configuration',{syntheticOnly:true}),decision=s.save('decision',{noPermissionWrite:true,historicalOriginAuditUnproved:true});
  const comparison=s.save('comparison',{all49MatchCapturedAndProspectivelyRequalifiedConfiguration:true,noPermissionWrite:true,notCommonSqlSnapshot:true,grants:Array(49).fill({syntheticOnly:true})});
  Object.assign(consumerPins,{configurationSha256:configuration.sha256,decisionSha256:decision.sha256,currentComparisonSha256:comparison.sha256});
  const permissions=add('PERMISSIONS',{schemaVersion:2,kind:'RC48_PROSPECTIVE_PERMISSION_RULE_READY_V2',configuration,decision,comparison});
  const inventory=add('JOB_INVENTORY',{schemaVersion:2,kind:'RC48_NATIVE_INVENTORY_PINNED_BASELINE_V2',baselineSha256:digest(f.b),baseline:f.b});
  const instance={project:'crmynov-prod-n7x4q2',name:'crm-ynov-prod-pg17',databaseVersion:'POSTGRES_17',state:'RUNNABLE',settings:{backupConfiguration:{enabled:true,pointInTimeRecoveryEnabled:true}}};
  const backups={items:[{instance:instance.name,status:'SUCCESSFUL',endTime:new Date(f.now-1000).toISOString()}]};
  const resource='https://sqladmin.googleapis.com/sql/v1beta4/projects/crmynov-prod-n7x4q2/instances/'+instance.name;
  const nativeBinding={sessionId:'local:12345678-1234-4234-8234-123456789abc',authorityRecordSha256:H,resourceBindingSha256:digest(IMAGE_OPERATIONAL_RESOURCES_V2),sourceCommit:source.commit,scope:'READ_ONLY_INVENTORY',project:'crmynov-prod-n7x4q2',region:'europe-west1'};
  const authority={schemaVersion:2,driverCommit:source.commit,authorityRevision:'e'.repeat(40),authorityRecordSha256:H,resourceBindingSha256:nativeBinding.resourceBindingSha256,scope:nativeBinding.scope};
  const native={kind:'NATIVE_READ_ONLY_INVENTORY_OBSERVATION_V2',state:'FIN_READ_ONLY_INVENTORY_NOT_BASELINE_OR_PRE',scope:'READ_ONLY_INVENTORY',humanAuthorityReceiptSha256:OPERATIONAL_HUMAN_SHA256,source,binding:nativeBinding,
    authority:{initial:{...authority,verifiedAt:new Date(f.now-750).toISOString()},final:{...authority,verifiedAt:new Date(f.now).toISOString()}},
    observations:{sqlInstance:instance,backups:backups.items},exchanges:[resource,resource+'/backupRuns?maxResults=100'].map(url=>({kind:'EXPURGATED_IMAGE_NATIVE_EXCHANGE_OBSERVATION_V2',status:200,outcome:'HTTP_200_RECEIVED_NOT_SEMANTIC_ACCEPTANCE',sessionId:nativeBinding.sessionId,authorityRecordSha256:H,resourceBindingSha256:nativeBinding.resourceBindingSha256,request:{method:'GET',url},responseSha256:url===resource?digest(instance):H,requestStartedAt:new Date(f.now-500).toISOString(),responseObservedAt:new Date(f.now-250).toISOString()}))};
  const local=s.save('restore-proof',{initiallyEmpty:true,expectedRowsSha256:H,restoredRowsSha256:H,auditStreamsConnectorsSessionsIdentical:true,productionRestored:false});pins.LOCAL_RESTORE=local.sha256;
  const procedure={schemaVersion:2,kind:'RC48_ISOLATED_RECOVERY_PROCEDURE_V2',sourceInstance:'projects/crmynov-prod-n7x4q2/instances/'+instance.name,restoreTargetKind:'SEPARATELY_AUTHORIZED_ISOLATED_TARGET_NOT_PROD',localRestoreProof:local,nativeRecoveryProcedureQualified:false,productionRestoreAuthorized:false,preserveInterveningWrites:true,sourceBackupMustBeRevalidated:true,nativeExecutionPerformed:false};
  const recovery=add('RECOVERABILITY',{schemaVersion:2,kind:'RC48_NATIVE_AVAILABILITY_AND_QUALIFIED_RECOVERY_PATH_V2',observedAt:new Date(f.now-500).toISOString(),inventoryObservation:s.save('native-inventory',native),instance:s.save('instance',instance),backups:s.save('backups',backups),localRestoreRecipe:local,isolatedRecoveryPlan:s.save('procedure',procedure),nativeRestoreDrillPerformed:false,productionRestorePerformed:false,limitations:['NO_NATIVE_CLOUD_SQL_RESTORE_DRILL','NO_PROD_SQL_RESTORE_AUTHORITY','METADATA_AND_RECIPE_ARE_DISTINCT_OBSERVATIONS']});
  const compatibility=s.save('compatibility',{comparison:{prismaSchemaBytesIdentical:true,migrationNamesAndChecksumsIdentical:true,migrationCounts:{rc44:56,rc48:56}}});pins.ROLLBACK=compatibility.sha256;
  const rollback=add('ROLLBACK',{schemaVersion:2,kind:'RC48_TO_CAPTURED_RC44_RETURN_RULE_READY_V2',compatibility,rollbackSource:s.save('historical-rollback',{head:'75f1422bdff08690733e4e52f39473a6056bdfe4',all36QualifiedExtensionBytesRetained:true}),completionRulesSha256:IMAGE_ROLLBACK_COMPLETION_RULES_SHA256_V2,operationalSource:{commit:source.commit,tree:source.tree,inputManifestSha256:digest(source.files)},rulesFiles:source.files,databaseRestore:false,preserveInterveningWrites:true,forwardFinRequired:true,afterSheetsActivationAuthorized:false});
  const dossier={independentEvidence:[pool,ledger,permissions,inventory,recovery,rollback]},context={plan,baseline:f.b,source,readEvidence:s.read,now:f.now};
  return{...s,f,dossier,context,pins,consumerPins,packets,native,procedure,run(){return simulateImageIndependentEvidenceV2({syntheticOnly:true,dossier,context,pins,consumerPins});},refresh(kind){Object.assign(dossier.independentEvidence.find(row=>row.kind===kind),s.save(kind,packets[kind]));}};
}
test('all six independent families compose honestly; native availability is not a Cloud SQL restore drill',()=>{
  const f=independentFixture(),r=f.run();assert.equal(r.families.length,6);assert.equal(r.nativeAuthority,false);
  assert.equal(r.families.find(row=>row.family==='RECOVERABILITY').nativeCloudSqlRestoreDrill,false);
  assert.equal(r.families.find(row=>row.family==='ROLLBACK').forwardFinAndFreshAuthorityStillRequired,true);
  assert.throws(()=>validateImageIndependentEvidenceV2(f.dossier,f.context),'synthetic pins must not replace the real native entry pins');
});
for(const [name,change,kind]of [
  ['old36-only rollback',f=>delete f.packets.ROLLBACK.operationalSource,'ROLLBACK'],
  ['completion rules drift',f=>f.packets.ROLLBACK.completionRulesSha256=H,'ROLLBACK'],
  ['operational source mismatch',f=>f.packets.ROLLBACK.operationalSource.commit='e'.repeat(40),'ROLLBACK'],
  ['unqualified return modules',f=>f.packets.ROLLBACK.rulesFiles=[],'ROLLBACK'],
  ['caller-rejuvenated metadata',f=>f.packets.RECOVERABILITY.observedAt=new Date(f.context.now).toISOString(),'RECOVERABILITY'],
  ['native drill fabricated',f=>f.packets.RECOVERABILITY.nativeRestoreDrillPerformed=true,'RECOVERABILITY'],
  ['old metadata outside24h',f=>f.context.now+=86400000,'RECOVERABILITY'],
  ['metadata disagrees with native FIN',f=>{f.native.observations.sqlInstance.state='FAILED';f.packets.RECOVERABILITY.inventoryObservation=f.save('changed-native',f.native);},'RECOVERABILITY'],
  ['native source missing',f=>{delete f.native.source;f.packets.RECOVERABILITY.inventoryObservation=f.save('changed-native',f.native);},'RECOVERABILITY'],
  ['foreign authority response',f=>{f.native.exchanges[0].authorityRecordSha256='e'.repeat(64);f.packets.RECOVERABILITY.inventoryObservation=f.save('changed-native',f.native);},'RECOVERABILITY'],
  ['metadata bytes/hash mismatch',f=>{f.native.exchanges[0].responseSha256='f'.repeat(64);f.packets.RECOVERABILITY.inventoryObservation=f.save('changed-native',f.native);},'RECOVERABILITY'],
  ['procedure reduced to a boolean',f=>{f.procedure.restoreCommandsQualified=true;delete f.procedure.localRestoreProof;f.packets.RECOVERABILITY.isolatedRecoveryPlan=f.save('changed-procedure',f.procedure);},'RECOVERABILITY'],
]){test('independent family composition refuses '+name,()=>{const f=independentFixture();change(f);f.refresh(kind);assert.throws(()=>f.run());});}
