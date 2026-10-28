import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {createHash} from 'node:crypto';
import {rollbackFixture} from './rollback-synthetic-fixtures.mjs';
import {makeRc48ImageRollbackPlanDraft as make} from './rollback-plan.mjs';
import {imageJournalDigest as digest} from './journal.mjs';
import {createImageOnlyExecutor} from './executor.mjs';
import {createImageOnlyTransport} from './transport.mjs';
import {parseImageOnlyArguments} from './cli.mjs';
import {L} from './synthetic-fixtures.mjs';
import {imagePlanScope,validateImagePlan} from './plan-mode.mjs';

function setup(t,kinds=['api','web'],failedKind){
  const f=rollbackFixture(kinds,failedKind),plan=make(f.input,f.now),directory=fs.mkdtempSync(path.join(os.tmpdir(),'image-rollback-test-'));
  t.after(()=>{assert(directory.startsWith(path.join(os.tmpdir(),'image-rollback-test-')));fs.rmSync(directory,{recursive:true,force:true});});
  const services=structuredClone(f.input.currentBaseline.services),revisions=structuredClone(f.input.currentBaseline.revisions),operations=structuredClone(f.operations),writes=[];
  const objectiveId='rc48-image-only-rollback-synthetic-0001',backupName='synthetic-rollback-backup',source={commit:'e'.repeat(40)},dossier={id:objectiveId,scope:'RC48_SERVICE_IMAGE_ROLLBACK_V1'};
  const backup={id:'42',instance:'crm-ynov-prod-pg17',type:'ON_DEMAND',status:'SUCCESSFUL',description:'CRMY-63 '+objectiveId+' '+digest(plan).slice(0,16),startTime:new Date(f.now).toISOString(),endTime:new Date(f.now).toISOString()};
  const transport={
    async listJobs(){return{jobs:structuredClone(f.input.currentBaseline.jobs)};},
    async listSchedulers(){return{jobs:structuredClone(f.input.currentBaseline.schedulers)};},
    async getService(kind){return structuredClone(services[kind]);},
    async getRevision(kind){return structuredClone(revisions[kind]);},
    async getSqlInstance(){return{project:'crmynov-prod-n7x4q2',name:'crm-ynov-prod-pg17',databaseVersion:'POSTGRES_17',state:'RUNNABLE',settings:{backupConfiguration:{enabled:true}}};},
    async getSqlOperation(name){assert(operations[name]);return structuredClone(operations[name]);},
    async getRunOperation(name){assert(operations[name]);return structuredClone(operations[name]);},
    async getBackup(id){assert.equal(id,'42');return structuredClone(backup);},
    async createBackup(){writes.push('BACKUP');operations[backupName]={name:backupName,status:'DONE',operationType:'BACKUP_VOLUME',targetProject:'crmynov-prod-n7x4q2',targetId:'crm-ynov-prod-pg17',backupContext:{backupId:'42'}};return structuredClone(operations[backupName]);},
    async patchServiceImage(kind){
      writes.push(kind);const patch=plan.patches.find(p=>p.resource.endsWith('-'+kind));assert(patch);
      const service=services[kind],next=service.name+'/revisions/crm-prod-'+kind+'-00025-rollback';
      service.template.containers=structuredClone(patch.body.template.containers);
      Object.assign(service,{generation:'25',observedGeneration:'25',etag:'rollback-'+kind,latestReadyRevision:next,latestCreatedRevision:next});
      service.terminalCondition.state='CONDITION_SUCCEEDED';service.trafficStatuses[0].revision=next;
      if(Object.hasOwn(service.template,'revision')){service.template.revision=next.split('/').at(-1);}
      revisions[kind]={name:next,conditions:[{type:'Ready',state:'CONDITION_SUCCEEDED'}],containers:structuredClone(service.template.containers)};
      const operation={name:L+'/operations/synthetic-rollback-'+kind,done:true,response:{name:service.name}};
      operations[operation.name]=operation;return structuredClone(operation);
    },
  };
  const rollbackContext={forwardPlan:f.input.forwardPlan,originalBaseline:f.input.originalBaseline,forwardEvidence:f.input.forwardEvidence};
  const authorizeFresh=async()=>({entry:{scope:'RC48_SERVICE_IMAGE_ROLLBACK_V1',planSha256:digest(plan),actions:['READ_METADATA','CREATE_BACKUP','PATCH_API','PATCH_WEB','OBSERVE_OPERATION']},receipt:{driverCommit:source.commit,verifiedAt:new Date(f.now).toISOString(),expiresAt:new Date(f.now+600000).toISOString()}});
  const executor=createImageOnlyExecutor({plan,candidate:f.input.candidate,baseline:f.input.currentBaseline,rollbackContext,source,objectiveId,dossier,journalDirectory:directory,transport,authorizeFresh,qualifyPreparation:async()=>{},saveReceipt:async(stage,proof)=>{const bytes=Buffer.from(JSON.stringify(proof));fs.writeFileSync(path.join(directory,stage+'-native.json'),bytes,{flag:'wx'});return{sha256:createHash('sha256').update(bytes).digest('hex')};},clock:()=>f.now});
  return{...f,plan,directory,transport,executor,services,revisions,operations,writes};
}
async function backup(x){await x.executor.dispatch('BACKUP');assert.equal((await x.executor.observe('BACKUP')).outcome,'SUCCEEDED');}
async function patch(x,stage){await x.executor.dispatch(stage);assert.equal((await x.executor.observe(stage)).outcome,'SUCCEEDED');}

for(const [name,kinds,failed]of [['successful full rollout',['api','web'],undefined],['clean API-only interruption',['api'],undefined],['known failed API',['api'],'api'],['known failed Web after successful API',['api','web'],'web']]){
  if(typeof name!=='string'){throw new TypeError('SYNTHETIC_CASE_NAME_REQUIRED');}
  test('existing executor performs single-use rollback for '+name,async t=>{
    const x=setup(t,kinds,failed);await backup(x);
    if(kinds.includes('web')){
      await assert.rejects(()=>x.executor.dispatch('API_IMAGE'));assert.equal(x.executor.inspect('API_IMAGE').state,'UNUSED');
      await patch(x,'WEB_IMAGE');
    }
    await patch(x,'API_IMAGE');assert.equal(x.executor.inspect('API_IMAGE').state,'FIN_NO_REPLAY');
    const expected=['BACKUP'];if(kinds.includes('web')){expected.push('web');}expected.push('api');assert.deepEqual(x.writes,expected);
    for(const kind of kinds){assert.equal(x.services[kind].template.containers[0].image,x.input.originalBaseline.services[kind].template.containers[0].image);}
    await assert.rejects(()=>x.executor.dispatch('API_IMAGE'));assert.deepEqual(x.writes,expected);
  });
}
test('a forward operation that is no longer terminal refuses before a rollback intent or mutation',async t=>{
  const x=setup(t);x.operations[x.input.forwardEvidence.stages.API_IMAGE.operation].done=false;
  await assert.rejects(()=>x.executor.dispatch('BACKUP'));assert.equal(x.executor.inspect('BACKUP').state,'UNUSED');assert.deepEqual(x.writes,[]);
});
test('changed native forward response hash refuses before a new backup is created',async t=>{
  const x=setup(t);x.operations[x.input.forwardEvidence.stages.API_IMAGE.operation].response.name+='-other';
  await assert.rejects(()=>x.executor.dispatch('BACKUP'));assert.equal(x.executor.inspect('BACKUP').state,'UNUSED');assert.deepEqual(x.writes,[]);
});
test('current failed-service drift refuses without consuming the rollback intent',async t=>{
  const x=setup(t,['api'],'api');x.services.api.template.serviceAccount='foreign';
  await assert.rejects(()=>x.executor.dispatch('BACKUP'));assert.equal(x.executor.inspect('BACKUP').state,'UNUSED');assert.deepEqual(x.writes,[]);
});
test('unplanned Web patch in an API-only rollback is refused and not sent',async t=>{
  const x=setup(t,['api']);await backup(x);await assert.rejects(()=>x.executor.dispatch('WEB_IMAGE'));assert.equal(x.executor.inspect('WEB_IMAGE').state,'UNUSED');assert.deepEqual(x.writes,['BACKUP']);
});
test('forward authority cannot authorize an inverse-image transport request',async()=>{
  const f=rollbackFixture(),plan=make(f.input,f.now);let native=0,tokens=0;
  const authority={entry:{scope:'RC48_SERVICE_IMAGE_ONLY_V1',googleAccount:'casablancaynovcampus@gmail.com',planSha256:digest(plan),actions:['PATCH_API']},receipt:{verifiedAt:new Date(f.now).toISOString(),expiresAt:new Date(f.now+60000).toISOString()}};
  const transport=createImageOnlyTransport({plan,getAuthority:()=>authority,accessToken:async()=>{tokens++;return'synthetic';},fetchImpl:async()=>{native++;return new Response('{}');},clock:()=>f.now});
  await assert.rejects(()=>transport.patchServiceImage('api'));assert.equal(tokens,0);assert.equal(native,0);
  assert.equal(imagePlanScope(plan),'RC48_SERVICE_IMAGE_ROLLBACK_V1');
});
test('rollback transport sends only its exact approved RC44 image patch',async()=>{
  const f=rollbackFixture(['api']),plan=make(f.input,f.now),calls=[];
  const authority={entry:{scope:'RC48_SERVICE_IMAGE_ROLLBACK_V1',googleAccount:'casablancaynovcampus@gmail.com',planSha256:digest(plan),actions:['PATCH_API']},receipt:{verifiedAt:new Date(f.now).toISOString(),expiresAt:new Date(f.now+60000).toISOString()}};
  const transport=createImageOnlyTransport({plan,getAuthority:()=>authority,accessToken:async()=>'synthetic',fetchImpl:async(url,init)=>{calls.push({url,body:JSON.parse(init.body),method:init.method});return new Response('{}',{status:200,headers:{'content-type':'application/json'}});},clock:()=>f.now});
  await transport.patchServiceImage('api');assert.equal(calls.length,1);const request=calls[0];if(request===undefined){throw new Error('EXPECTED_ROLLBACK_PATCH');}assert.deepEqual(request.body,plan.patches[0].body);assert.equal(request.method,'PATCH');assert(request.url.endsWith('?updateMask=template.containers'));
});
test('closed plan mode refuses invented directions or an unpinned inverse context',()=>{
  const f=rollbackFixture(),plan=make(f.input,f.now);
  assert.throws(()=>validateImagePlan({...plan,kind:'OTHER'},f.input.candidate,f.input.currentBaseline));
  assert.throws(()=>validateImagePlan(plan,f.input.candidate,f.input.currentBaseline));
  assert.throws(()=>validateImagePlan(f.input.forwardPlan,f.input.candidate,f.input.originalBaseline,{}));
});
test('rollback CLI requires an explicit context and no mutation objective in pure planning',()=>{
  const args=['plan-rollback','--candidate','c','--baseline','b','--output-dir','o','--rollback-context','f'];assert.equal(parseImageOnlyArguments(args).mode,'plan-rollback');
  assert.throws(()=>parseImageOnlyArguments(args.slice(0,-2)));assert.throws(()=>parseImageOnlyArguments([...args,'--objective-id','forbidden']));
});
