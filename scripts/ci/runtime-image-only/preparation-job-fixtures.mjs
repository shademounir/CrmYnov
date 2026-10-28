// SYNTHETIC only. Reuses the existing qualified collector fixtures and builder.
import{fixture as readOnlyFixture}from'../pool-reconciliation/tests/readonly-native-output-fixture-v1.mjs';
import{buildReadOnlyJobDossier}from'../pool-reconciliation/pool-job-dossier-v1.mjs';
import{fixture as imageFixture}from'./synthetic-fixtures.mjs';
export function preparationPair(now){
 return ['general','ledger'].map((kind,i)=>{
  const f=readOnlyFixture(kind),b=f.bundle,dossier=buildReadOnlyJobDossier({sources:Object.fromEntries(Object.entries(b.modules).map(([k,v])=>[k,v.source])),request:b.request,jobName:b.jobName,nonce:b.nonce,databaseBindingSha256:b.databaseBindingSha256,publicKeyPem:b.publicKeyPem,networkBinding:f.objective.taskTemplate.vpcAccess,databaseSecretVersion:'1',intentAt:new Date(now-30000).toISOString()});
  const uid=(i===0?'11111111-1111-4111-8111-111111111111':'22222222-2222-4222-8222-222222222222'),job={...f.job,uid,labels:dossier.job.labels,template:dossier.job.template,generation:'1',observedGeneration:'1',terminalCondition:{state:'CONDITION_SUCCEEDED'},latestCreatedExecution:{name:f.execution.name,completionStatus:'EXECUTION_SUCCEEDED',completionTime:new Date(now-1000).toISOString()}};
  return{spec:{objectiveId:'rc48-'+kind+'-pre-synthetic-0001',catalogEntrySha256:'a'.repeat(64),dossier,uid,execution:f.execution.name},job};
 });
}
export function preparedImageFixture(){const f=imageFixture(),pair=preparationPair(f.now);f.c.readOnlyPreparationJobs=pair.map(p=>p.spec);f.b.jobs.push(...pair.map(p=>p.job));return f;}
