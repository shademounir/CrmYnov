// SYNTHETIC ONLY: existing collector builder and native fixtures, no provider.
import {preparedImageFixture} from './preparation-job-fixtures.mjs';
import {buildReadOnlyJobDossier} from '../pool-reconciliation/pool-job-dossier-v1.mjs';
const ref=leaf=>({path:'C:/synthetic/'+leaf+'.json',sha256:'d'.repeat(64)});
export function operationalPreparationFixtureV2(){
  const f=preparedImageFixture();f.c.readOnlyPreparationVersion=2;
  f.c.readOnlyPreparationJobs=f.c.readOnlyPreparationJobs.map((row,index)=>{
    const {execution,...rest}=row;
    return{schemaVersion:2,...rest,admission:index===0?{kind:'PROSPECTIVE_GENERAL_0_TO_1',authorityRecordSha256:'b'.repeat(64)}:{kind:'HISTORICAL_LEDGER_FIN',execution,startedAt:new Date(f.now-2000).toISOString(),completedAt:new Date(f.now-1000).toISOString(),authorityObservation:ref('ledger-authority')}};
  });
  const general=f.b.jobs.at(-2);general.executionCount=0;delete general.latestCreatedExecution;
  const pre=f.c.readOnlyPreparationJobs[0].dossier,b=pre.bundle,dossier=buildReadOnlyJobDossier({sources:Object.fromEntries(Object.entries(b.modules).map(([k,v])=>[k,v.source])),request:{...b.request,phase:'POST'},jobName:'crm-prod-preservation-post-synthetic-v2',nonce:b.nonce,databaseBindingSha256:b.databaseBindingSha256,publicKeyPem:b.publicKeyPem,networkBinding:pre.objective.taskTemplate.vpcAccess,databaseSecretVersion:'1',intentAt:pre.objective.intentAt});
  f.c.readOnlyPostJob={dossier,uid:'33333333-3333-4333-8333-333333333333',objectiveId:'rc48-general-post-synthetic-0001',authorityRecordSha256:'e'.repeat(64),objectiveOrigin:ref('post-origin'),jobObservation:ref('post-job')};
  f.b.jobs.push({name:dossier.objective.jobName,uid:f.c.readOnlyPostJob.uid,labels:dossier.job.labels,template:dossier.job.template,generation:'1',observedGeneration:'1',terminalCondition:{state:'CONDITION_SUCCEEDED'},executionCount:0});
  return f;
}
export function completedPreparationFixtureV2(f,kind='general'){
  const row=kind==='general'?f.c.readOnlyPreparationJobs[0]:f.c.readOnlyPostJob,job=structuredClone(f.b.jobs.find(j=>j.name===row.dossier.objective.jobName)),leaf=job.name.split('/').at(-1),name=job.name+'/executions/'+leaf+'-actual123';
  const execution={name,uid:'SYNTHETIC-execution-uid-'+kind,job:leaf,taskCount:1,parallelism:1,succeededCount:1,template:structuredClone(row.dossier.objective.taskTemplate),conditions:[{type:'Completed',state:'CONDITION_SUCCEEDED'}],startTime:new Date(f.now-1000).toISOString(),completionTime:new Date(f.now).toISOString()};
  job.executionCount=1;job.latestCreatedExecution={name,completionStatus:'EXECUTION_SUCCEEDED',completionTime:execution.completionTime};
  const completion={objectiveId:row.objectiveId,authorityRecordSha256:kind==='general'?row.admission.authorityRecordSha256:row.authorityRecordSha256,...(kind==='post'?{objectiveOriginSha256:row.objectiveOrigin.sha256}:{}),job:structuredClone(job),execution,taskNetwork:null,operation:{name:job.name.split('/jobs/')[0]+'/operations/11111111-aaaa-4bbb-8ccc-555555555555',done:true,response:{name,uid:execution.uid}},authority:{validFrom:new Date(f.now-2000).toISOString(),expiresAt:new Date(f.now+300000).toISOString()},observedAt:new Date(f.now).toISOString()};
  return{row,job,completion,context:{schemaVersion:2,completions:[completion]}};
}
