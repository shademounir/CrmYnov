// Synthetic metadata only. No tests, credentials, filesystem or provider calls.
import {fixture,L} from './synthetic-fixtures.mjs';
import {makeRc48ServiceImagePlanDraft} from './plan.mjs';
import {validateImageOnlyServedState} from './served-state.mjs';
import {imageJournalDigest as digest} from './journal.mjs';
export function rollbackFixture(kinds=['api','web'],failedKind){
  const f=fixture(),forwardPlan=makeRc48ServiceImagePlanDraft(f.c,f.b,f.now),currentBaseline=structuredClone(f.b),operations={};
  currentBaseline.revisions={};
  const backup={name:'synthetic-forward-backup',status:'DONE',operationType:'BACKUP_VOLUME',targetProject:'crmynov-prod-n7x4q2',targetId:'crm-ynov-prod-pg17'};
  operations[backup.name]=backup;
  const forwardEvidence={planSha256:digest(forwardPlan),sourceHead:'d'.repeat(40),stages:{BACKUP:{state:'FIN_NO_REPLAY',outcome:'SUCCEEDED',nativeReceiptSha256:'b'.repeat(64),operation:backup.name,nativeResponseSha256:digest(backup)},API_IMAGE:{state:'UNUSED'},WEB_IMAGE:{state:'UNUSED'}}};
  for(const kind of kinds){
    const service=currentBaseline.services[kind],next=service.name+'/revisions/crm-prod-'+kind+'-00024-synthetic';
    Object.assign(service,{generation:'24',observedGeneration:'24',etag:'new-'+kind,latestReadyRevision:next,latestCreatedRevision:next});
    service.trafficStatuses[0].revision=next;service.template.containers[0].image=f.c.images[kind].destination;
    const revision={name:next,conditions:[{type:'Ready',state:'CONDITION_SUCCEEDED'}],containers:structuredClone(service.template.containers)};
    currentBaseline.revisions[kind]=revision;
    const operation={name:L+'/operations/synthetic-forward-'+kind,done:true,response:{name:service.name}};
    const row={state:'FIN_NO_REPLAY',outcome:'SUCCEEDED',nativeReceiptSha256:'a'.repeat(64),operation:operation.name,nativeResponseSha256:digest(operation)};
    if(kind===failedKind){
      service.terminalCondition.state='CONDITION_FAILED';service.latestReadyRevision=f.b.services[kind].latestReadyRevision;
      service.trafficStatuses=structuredClone(f.b.services[kind].trafficStatuses);revision.conditions[0].state='CONDITION_FAILED';
      delete operation.response;operation.error={code:9,message:'SYNTHETIC_FAILED_STARTUP'};row.outcome='FAILED';row.nativeResponseSha256=digest(operation);
    }else{row.served=validateImageOnlyServedState({plan:forwardPlan,candidate:f.c,baseline:f.b,kind,service,revision,observedAt:f.b.observedAt},f.now);}
    operations[operation.name]=operation;forwardEvidence.stages[kind==='api'?'API_IMAGE':'WEB_IMAGE']=row;
  }
  return{input:{forwardPlan,candidate:f.c,originalBaseline:f.b,currentBaseline,forwardEvidence},operations,now:f.now};
}
