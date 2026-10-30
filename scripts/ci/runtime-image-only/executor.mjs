// Existing durable journal + narrow transport composed; no internal mutation loop.
import assert from 'node:assert/strict';
import {assertAuthorityCurrent} from '../readonly-probe/probe-driver-authority-v1.mjs';
import {imageJournalDigest as digest,inspectImageTransaction,consumeImageTransaction,recordImageOperation,finishImageTransaction} from './journal.mjs';
import {validateUnpatchedResourceClaims,LOCATION,PROJECT} from './plan.mjs';
import {validateImagePlan,validatePlannedImageServedState,imagePlanScope,isImageRollback} from './plan-mode.mjs';
import {imageServiceConfiguration} from './served-state.mjs';
const sqlInstance='crm-ynov-prod-pg17',stages=new Set(['BACKUP','API_IMAGE','WEB_IMAGE']);
const stageDetails={BACKUP:{action:'CREATE_BACKUP'},API_IMAGE:{action:'PATCH_API',kind:'api',patchIndex:0},WEB_IMAGE:{action:'PATCH_WEB',kind:'web',patchIndex:1}};
export function createImageOnlyExecutor({plan,candidate,baseline,rollbackContext,source,objectiveId,dossier,journalDirectory,transport,authorizeFresh,qualifyPreparation,saveReceipt,getCompletionContext,clock=Date.now}){
  plan=structuredClone(plan);candidate=structuredClone(candidate);baseline=structuredClone(baseline);rollbackContext=structuredClone(rollbackContext);source=structuredClone(source);dossier=structuredClone(dossier);
  validateImagePlan(plan,candidate,baseline,rollbackContext);
  const rollingBack=isImageRollback(plan);
  assert.equal(typeof authorizeFresh,'function');assert.equal(typeof qualifyPreparation,'function');assert.equal(typeof saveReceipt,'function');
  const binding=stage=>({objectiveId,objectiveSha256:digest(dossier),planSha256:digest(plan),sourceHead:source.commit,stage});
  function inspect(stage){assert(stages.has(stage));return inspectImageTransaction(journalDirectory,binding(stage));}
  async function authority(action){const a=await authorizeFresh(action);assert.equal(a.entry.scope,imagePlanScope(plan));assert.equal(a.entry.planSha256,digest(plan));assert.equal(a.receipt.driverCommit,source.commit);assert(a.entry.actions.includes(action));assertAuthorityCurrent(a,clock());return a;}
  async function qualified(a,stage){
    const projection=await qualifyPreparation(a,clock());
    if(a.entry.schemaVersion===2){
      const phase=stage==='BACKUP'?'BACKUP_READY':'FORWARD_FINAL';assert.equal(a.entry.preparationMode,'LATE_BOUND_V2');assert.equal(a.entry.preparationPhase,phase,'MUTATION_PREPARATION_PHASE_REFUSED');
      assert.equal(projection?.schemaVersion,2);assert.equal(projection.preparationPhase,phase);assert.equal(projection.generalPendingOnly,phase==='BACKUP_READY');
      assert.equal(projection.planSha256,digest(plan));assert.equal(projection.staticDossierSha256,digest(dossier));assert.equal(projection.preparationRulesSha256,a.entry.preparationRulesSha256);
      const t=Date.parse(projection.qualifiedAt),end=Date.parse(projection.expiresAt),now=clock();assert(Number.isSafeInteger(t)&&t<=now&&Number.isSafeInteger(end)&&now<end,'PREPARATION_PROJECTION_EXPIRED');
      assert.equal(typeof transport.assertMutationReady,'function');transport.assertMutationReady(stageDetails[stage].action);
    }
    return projection;
  }
  function priorSucceeded(stage){const r=inspect(stage);assert.equal(r.state,'FIN_NO_REPLAY',stage+'_FIN_REQUIRED');assert.equal(r.rows.at(-1).payload.details.outcome,'SUCCEEDED',stage+'_FAILED');return r;}
  async function preserved(a){if(a?.entry?.schemaVersion===2){assert.equal(typeof transport.collectJobs,'function');assert.equal(typeof transport.collectSchedulers,'function');const began=clock(),jobs=await transport.collectJobs(),schedulers=await transport.collectSchedulers();const completion=getCompletionContext===undefined?undefined:getCompletionContext();validateUnpatchedResourceClaims(plan,{jobs,schedulers,observedAt:new Date(began).toISOString()},completion);return;}const jobs=await transport.listJobs();assert(!jobs.nextPageToken);const schedulers=await transport.listSchedulers();assert(!schedulers.nextPageToken);validateUnpatchedResourceClaims(plan,{jobs:jobs.jobs??[],schedulers:schedulers.jobs??[]});}
  async function unchanged(kind){const current=await transport.getService(kind),before=baseline.services[kind];for(const k of ['name','uid','etag','generation','observedGeneration','latestReadyRevision','latestCreatedRevision']){assert.equal(current[k],before[k],'STALE_IMAGE_BASELINE_'+k);}assert.equal(current.reconciling??false,false);assert.equal(current.deleteTime,undefined);assert.equal(current.terminalCondition?.state,before.terminalCondition?.state);assert.deepEqual(current.trafficStatuses,before.trafficStatuses);assert.deepEqual(imageServiceConfiguration(current),imageServiceConfiguration(before),'SERVICE_CONFIGURATION_CHANGED');}
  async function freshBackup(){const r=priorSucceeded('BACKUP'),record=r.rows.at(-1).payload.details;assert.match(record.nativeReceiptSha256,/^[a-f0-9]{64}$/u);const operation=await transport.getSqlOperation(r.rows[1].payload.details.operation);assert.equal(operation.status,'DONE');assert.equal(operation.operationType,'BACKUP_VOLUME');assert.equal(operation.error,undefined);const b=await transport.getBackup(String(operation.backupContext?.backupId));assert.equal(b.status,'SUCCESSFUL');assert.equal(b.instance,sqlInstance);assert.equal(b.type,'ON_DEMAND');assert.equal(b.description,'CRMY-63 '+objectiveId+' '+digest(plan).slice(0,16));const t=Date.parse(b.startTime),end=Date.parse(b.endTime),now=clock();assert(t>=Date.parse(r.rows[0].payload.at)&&t<=end&&end<=now&&now-end<=3600000,'FRESH_SUCCESSFUL_BACKUP_REQUIRED');return b;}
  async function served(kind,v2=false){const service=await transport.getService(kind),revisionName=service.latestReadyRevision?.split('/').at(-1),revision=await transport.getRevision(kind,revisionName),observedAt=new Date(clock()).toISOString();const proof=validatePlannedImageServedState({plan,candidate,baseline,rollbackContext,kind,service,revision,observedAt},clock());return v2?{...proof,observedAt}:proof;}
  function planned(kind){return plan.patches.some(p=>p.resource===LOCATION+'/services/crm-prod-'+kind);}
  async function forwardOperationsStillFinal(){
    if(!rollingBack){return;}
    const rows=Object.entries(rollbackContext.forwardEvidence.stages);
    async function verifyAt(index){
      if(index>=rows.length){return;}
      const [stage,row]=rows[index];
      if(row.state==='UNUSED'){return verifyAt(index+1);}
      const operation=stage==='BACKUP'?await transport.getSqlOperation(row.operation):await transport.getRunOperation(row.operation);
      const done=stage==='BACKUP'?operation.status==='DONE':operation.done===true;
      assert(done,'FORWARD_OPERATION_NOT_TERMINAL');assert.equal(digest(operation),row.nativeResponseSha256,'FORWARD_NATIVE_OPERATION_CHANGED');
      const outcome=operation.error?'FAILED':'SUCCEEDED';assert.equal(outcome,row.outcome);
      return verifyAt(index+1);
    }
    return verifyAt(0);
  }
  async function rollbackPrerequisites(stage,kind){
    assert(planned(kind),'NO_UNPLANNED_ROLLBACK_PATCH');
    if(stage==='API_IMAGE'&&planned('web')){priorSucceeded('WEB_IMAGE');await served('web');}
    if(stage==='WEB_IMAGE'){await unchanged('api');}
    if(stage==='API_IMAGE'&&!planned('web')){await unchanged('web');}
  }
  async function prepareDispatch(stage,details){
    if(stage==='BACKUP'){
      await unchanged('api');await unchanged('web');
      const sql=await transport.getSqlInstance();
      assert.equal(sql.project,PROJECT);assert.equal(sql.name,sqlInstance);
      assert.equal(sql.databaseVersion,'POSTGRES_17');assert.equal(sql.state,'RUNNABLE');
      assert.equal(sql.settings?.backupConfiguration?.enabled,true);
      return;
    }
    await freshBackup();
    if(rollingBack){await rollbackPrerequisites(stage,details.kind);}
    else if(stage==='WEB_IMAGE'){priorSucceeded('API_IMAGE');await served('api');}
    await unchanged(details.kind);
  }
  async function submit(stage,details){
    if(stage==='BACKUP'){return transport.createBackup();}
    return transport.patchServiceImage(details.kind);
  }
  function validateOperation(stage,operation){
    const name=operation.name;assert.equal(typeof name,'string');
    if(stage==='BACKUP'){
      assert.match(name,/^[A-Za-z0-9_-]{1,256}$/u);
      assert.equal(operation.targetProject,PROJECT);assert.equal(operation.targetId,sqlInstance);
      assert.equal(operation.operationType,'BACKUP_VOLUME');
    }else{assert(name.startsWith(LOCATION+'/operations/'));}
    return name;
  }
  async function dispatch(stage){
    assert(stages.has(stage));assert.equal(inspect(stage).state,'UNUSED','NO_MUTATION_REPLAY');
    const details=stageDetails[stage],action=details.action;
    let a=await authority(action);await qualified(a,stage);await preserved(a);await forwardOperationsStillFinal();
    await prepareDispatch(stage,details);
    a=await authority(action);await qualified(a,stage);
    let request={objectiveId,planSha256:digest(plan),kind:'ON_DEMAND_BACKUP'};
    if(stage!=='BACKUP'){request=plan.patches.find(p=>p.resource===LOCATION+'/services/crm-prod-'+details.kind);assert(request,'ONLY_PLANNED_IMAGE_PATCH');}
    consumeImageTransaction(journalDirectory,binding(stage),digest(request),clock());
    // From here every exception leaves INTENT consumed/UNKNOWN. Never send again.
    const operation=await submit(stage,details),name=validateOperation(stage,operation);
    recordImageOperation(journalDirectory,binding(stage),name,clock());
    return {state:'KNOWN_OPERATION_OBSERVE_ONLY',stage,operation:name,automaticRetryAllowed:false};
  }
  async function observe(stage){const saved=inspect(stage);assert.equal(saved.state,'KNOWN_OPERATION_OBSERVE_ONLY','ONLY_KNOWN_OPERATION_CAN_BE_OBSERVED');const a=await authority('OBSERVE_OPERATION');const name=saved.rows[1].payload.details.operation,op=stage==='BACKUP'?await transport.getSqlOperation(name):await transport.getRunOperation(name);const done=stage==='BACKUP'?op.status==='DONE':op.done===true;if(!done){return {state:'KNOWN_OPERATION_RUNNING',stage,operation:name,automaticRetryAllowed:false};}
    const failed=!!op.error;let proof={stage,operation:name,outcome:failed?'FAILED':'SUCCEEDED',nativeResponseSha256:digest(op),at:new Date(clock()).toISOString()};
    if(!failed&&stage==='BACKUP'){assert.equal(op.operationType,'BACKUP_VOLUME');const backup=await transport.getBackup(String(op.backupContext?.backupId));assert.equal(backup.status,'SUCCESSFUL');assert.equal(backup.type,'ON_DEMAND');assert.equal(backup.instance,sqlInstance);assert(Date.parse(backup.startTime)>=Date.parse(saved.rows[0].payload.at));if(a.entry.schemaVersion===2){const end=Date.parse(backup.endTime);assert(Number.isSafeInteger(end)&&Date.parse(backup.startTime)<=end&&end<=clock(),'ACTUAL_BACKUP_COMPLETION_TIME_REQUIRED');}proof={...proof,backupId:String(backup.id),backupSha256:digest(backup),backupStartTime:backup.startTime,backupEndTime:backup.endTime};}
    if(!failed&&stage!=='BACKUP'){const kind=stage==='API_IMAGE'?'api':'web',v2=a.entry.schemaVersion===2;proof={...proof,served:await served(kind,v2)};const observed=v2?[proof.served.observedAt]:[];if(!rollingBack&&kind==='web'){const api=await served('api',v2);if(v2){proof.relatedServed={api};observed.push(api.observedAt);}}if(rollingBack&&kind==='api'&&planned('web')){const web=await served('web',v2);if(v2){proof.relatedServed={web};observed.push(web.observedAt);}}if(v2){proof.servedObservedAt=new Date(Math.max(...observed.map(Date.parse))).toISOString();}await preserved(a);}
    if(a.entry.schemaVersion===2){proof.at=new Date(clock()).toISOString();}
    const receipt=await saveReceipt(stage,proof);assert.match(receipt.sha256,/^[a-f0-9]{64}$/u);finishImageTransaction(journalDirectory,binding(stage),name,receipt.sha256,proof.outcome,clock());const result={state:'FIN_NO_REPLAY',stage,outcome:proof.outcome,receiptSha256:receipt.sha256,httpAndRoleRecipesStillRequired:true,automaticRetryAllowed:false};
    if(a.entry.schemaVersion===2){result.nativeReceiptSha256=receipt.sha256;if(typeof receipt.path==='string'){result.nativeReceipt={path:receipt.path,sha256:receipt.sha256};}if(proof.servedObservedAt){result.servedObservedAt=proof.servedObservedAt;}if(!failed&&stage==='BACKUP'){result.backup={id:proof.backupId,status:'SUCCESSFUL',completedAt:proof.backupEndTime,nativeReceiptSha256:receipt.sha256};}}return result;
  }
  return Object.freeze({inspect,dispatch,observe});
}
