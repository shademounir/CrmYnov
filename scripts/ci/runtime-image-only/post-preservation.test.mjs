import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,sqlFixture,startupPermissions} from './post-preservation-fixtures.mjs';
import {prepareImagePostReadiness as prepare,validateImagePostReadiness as validate,imagePostHttpRequests,imagePostSqlReadRequests,validateImagePostHttpObservations,compareImagePostSqlPreservation} from './post-preservation.mjs';
import {projectRc48StartupPermissions,verifyRc48StartupRuleSources} from './post-startup-permissions.mjs';
import {hashBytes} from '../pool-reconciliation/readonly-output-codec-v1.mjs';
import {imageJournalDigest as digest} from './journal.mjs';
const encode=p=>Buffer.from(JSON.stringify(p));
function check(f,p,now=f.args.now){const bytes=encode(p);return validate({bytes,expectedSha256:hashBytes(bytes),plan:f.args.plan,source:f.args.source,baseline:f.args.baseline,readSource:f.args.readSource,readEvidence:f.args.readEvidence,now});}
test('POST readiness composes protected-origin port and real-shaped job/session evidence, not a future execution or native authority',async()=>{
 const f=fixture(),before=structuredClone(f.args.recipe),p=await prepare(f.args),v=check(f,p);assert.equal(v.grantsNativeAuthority,false);assert.equal(v.providerOriginAuthenticatedByThisPureFunction,false);assert.equal(p.postExecutionAllocated,false);assert.equal(p.postObservationAcquired,false);assert.deepEqual(f.args.recipe,before);assert.equal(p.sevenFamilyRefs.length,7);
 const requests=imagePostSqlReadRequests(p,f.dossier,p.postJob+'/executions/crm-prod-preservation-post-synthetic-abc123',f.now,f.readSource);assert.deepEqual(requests.map(r=>r.method),['GET','GET','POST','GET']);assert(requests[2].body.filter.includes('SEALED_GENERAL_PRESERVATION_OUTPUT_V1'));assert.equal(imagePostHttpRequests(p).length,4);
});
for(const [name,change] of [
 ['missing native api URI',f=>delete f.args.baseline.services.api.uri],
 ['foreign native origin',f=>f.args.recipe.apiOrigin='https://other.invalid'],
 ['missing actual role session',f=>f.files.delete('manager.json')],
 ['one role only',f=>f.args.recipe.actors.pop()],
 ['no Super Admin',f=>f.args.recipe.actors[0].role='MANAGER'],
 ['bare true protected-origin assertion',f=>f.args.verifyProtectedObjective=async()=>true],
 ['unbound protected origin',f=>f.args.verifyProtectedObjective=async()=>({...f.origin,driverCommit:'f'.repeat(40)})],
 ['source bytes changed',f=>f.args.readSource=()=>Buffer.from('unprotected')],
 ['source with credential field',f=>f.args.source.token='SECRET'],
 ['same identity repackaged as two roles',f=>f.args.recipe.actors[1].professionalEmailSha256=f.args.recipe.actors[0].professionalEmailSha256],
 ['startup rule source drift',f=>f.args.readStartupSource=()=>Buffer.from('changed')],
 ['seven families incomplete',f=>f.args.sevenFamilyRefs.pop()],
 ['eight families would hide missing POST',f=>f.args.sevenFamilyRefs.push({kind:'POST',sourceContract:f.args.sevenFamilyRefs[0].sourceContract})],
 ['duplicate family',f=>f.args.sevenFamilyRefs[1]=f.args.sevenFamilyRefs[0]],
 ['lease exceeds oldest evidence',f=>f.args.expiresAt=new Date(f.now+600000).toISOString()],
 ['lease expired',f=>f.args.expiresAt=new Date(f.now).toISOString()],
 ['closed PRE job substituted',f=>{f.dossier.bundle.request.phase='PRE';f.args.postDossierRef=f.save('post-dossier.json',f.dossier);}],
])test('readiness refuses '+name,async()=>{const f=fixture();change(f);await assert.rejects(prepare(f.args));});
function mutateRecord(f,name,fn,refField){const r=JSON.parse(f.files.get(name));fn(r);const ref=f.save(name,r);if(refField==='job'){f.args.postJobObservationRef=ref;}else{f.args.recipe.actors.find(a=>a.key===refField).sessionObservation=ref;}}
for(const [name,fn] of [
 ['wrong method',r=>r.request.method='POST'],['foreign URL',r=>r.request.url='https://foreign.invalid'],['redirect',r=>r.response.redirected=true],['403 is a refusal not expiry',r=>r.response.status=403],['future observation',r=>r.responseReceivedAt='2026-10-30T00:00:00.000Z'],['over15s',r=>r.requestStartedAt='2026-10-28T01:24:00.000Z'],['credential field',r=>r.request.authorization='SECRET'],['secret response field',r=>r.response.cookie='SECRET'],['wrong identity',r=>r.response.projection.professionalEmailSha256='f'.repeat(64)],['role missing',r=>r.response.projection.roles=[]],['elevated session pretending Manager',r=>r.response.projection.roles.push('SUPER_ADMIN')],['secret rotation required',r=>r.response.projection.mustChangeSecret=true],['campus missing',r=>r.response.projection.scopes=[]],['cross-campus',r=>r.response.projection.scopes=[{kind:'CAMPUS',id:'other'}]],
])test('real-shaped session evidence refuses '+name,async()=>{const f=fixture();mutateRecord(f,'manager.json',fn,'manager');await assert.rejects(prepare(f.args));});
for(const [name,fn] of [
 ['already executed',r=>r.response.projection.executionCount=1],['previous execution',r=>r.response.projection.latestCreatedExecution={name:'old'}],['wrong UID representation',r=>r.response.projection.uid='caller-invented'],['wrong image',r=>r.response.projection.template.template.containers[0].image='other'],['wrong Run URL',r=>r.request.url+='?other'],
])test('POST job readiness refuses '+name,async()=>{const f=fixture();mutateRecord(f,'job-observation.json',fn,'job');await assert.rejects(prepare(f.args));});
test('readiness is pinned before asynchronous protected-origin verification',async()=>{const f=fixture();f.args.verifyProtectedObjective=async()=>{f.args.recipe.apiOrigin='https://changed.invalid';f.args.source.commit='f'.repeat(40);return f.origin;};const p=await prepare(f.args);assert.equal(p.recipe.apiOrigin,'https://crm-prod-api-synthetic-ew.a.run.app');assert.equal(p.source.commit,'c'.repeat(40));});
test('retained readiness cannot silently expire, change source, become execution authority or claim future observations',async()=>{const f=fixture(),p=await prepare(f.args);assert.throws(()=>check(f,p,f.now+300000));for(const field of ['nativeExecutionAuthorized','postExecutionAllocated','postObservationAcquired','sameSnapshotClaimed']){const changed=structuredClone(p);changed[field]=true;assert.throws(()=>check(f,changed));}const changed=structuredClone(p);changed.source.commit='f'.repeat(40);assert.throws(()=>check(f,changed));});
function http(f,p){
 return imagePostHttpRequests(p).map((request,index)=>{
  let projection;
  if(index===0){
   projection={service:'api',status:'ok',database:'ready'};
  }else if(index===1){
   projection={documentKind:'HTML',assetPaths:['/_next/static/synthetic.js']};
  }else{
   projection=JSON.parse(f.files.get(p.recipe.actors[index-2].key+'.json')).response.projection;
  }
  const r=f.record(request,projection);
  r.requestStartedAt=new Date(f.now+1000).toISOString();
  r.responseReceivedAt=new Date(f.now+1200).toISOString();
  return r;
 });
}
test('HTTP checks require native exact GET, real-shaped observed roles and origin, never Ready metadata alone',async()=>{const f=fixture(),p=await prepare(f.args),records=http(f,p),r=validateImagePostHttpObservations({readiness:p,records,afterImageObservedAt:new Date(f.now+500).toISOString(),now:f.now+1500});assert.equal(r.requestsAndRoleResponsesChecked,true);assert.equal(r.providerOriginAuthenticatedByThisPureFunction,false);assert.equal(r.notVisualOrInteractionQualification,true);});
for(const [name,change] of [['metadata instead HTTP',r=>r.length=0],['HTML absent',r=>r[1].response.projection.assetPaths=[]],['cross-origin asset',r=>r[1].response.projection.assetPaths=['https://foreign.invalid/a.js']],['database unavailable',r=>r[0].response.projection.database='offline'],['session expired',r=>r[2].response.status=401],['future response',r=>r[0].responseReceivedAt='2026-10-31T00:00:00.000Z']])test('POST HTTP refuses '+name,async()=>{const f=fixture(),p=await prepare(f.args),records=http(f,p);change(records);assert.throws(()=>validateImagePostHttpObservations({readiness:p,records,afterImageObservedAt:new Date(f.now+500).toISOString(),now:f.now+1500}));});
test('startup current MANAGER49 is unchanged; no epoch/audit absence of effects is claimed',()=>{const rows=startupPermissions(),before=structuredClone(rows),p=projectRc48StartupPermissions(rows);assert.deepEqual(p.permissions,rows);assert.deepEqual(rows,before);assert.equal(p.changes.length,0);assert.equal(p.managerExisting49Preserved,true);assert.equal(p.epochOrAuditAbsenceOfChangeNotClaimed,true);});
for(const role of ['MANAGER','ADMIN','SUPER_ADMIN'])test('only missing startup capabilities get a deterministic append-only projection for '+role,()=>{const rows=startupPermissions();rows[0].role=role;rows[0].grants=rows[0].grants.filter(g=>!['lead.qualification.update','telephony.free-call.create','reporting.pilotage.view'].includes(g.permission));const p=projectRc48StartupPermissions(rows),next=p.permissions[0],expectedScope={SUPER_ADMIN:'GLOBAL',ADMIN:'CAMPUS',MANAGER:'NONE'}[role];assert.equal(next.version,2);assert.equal(next.grants.length,49);assert.equal(next.grants.find(g=>g.permission==='telephony.free-call.create').scope,expectedScope);assert.equal(p.changes[0].auditObserved,false);});
function expectedMutationScope(role,campus){
 if(role==='SUPER_ADMIN'||role==='*'){return campus==='GLOBAL'?'GLOBAL':'CAMPUS';}
 return role==='ADMIN'?'CAMPUS':'NONE';
}
function expectedPilotageScope(role,campus){
 if(role==='SUPER_ADMIN'||role==='*'){return campus==='GLOBAL'?'GLOBAL':'CAMPUS';}
 return role==='ADMIN'||role==='MANAGER'?'CAMPUS':'NONE';
}
function assertStartupMatrixCase(role,campus){
 const rows=startupPermissions(),row=rows[0];row.role=role;row.kind=role==='*'?'CEILING':'ROLE';row.campus=campus;
 row.grants=row.grants.filter(g=>!['lead.qualification.update','telephony.free-call.create','reporting.pilotage.view'].includes(g.permission));
 row.grants.find(g=>g.permission==='reporting.view').scope=campus==='GLOBAL'?'GLOBAL':'CAMPUS';
 const before=structuredClone(rows),result=projectRc48StartupPermissions(rows),next=result.permissions[0],grants=Object.fromEntries(next.grants.map(g=>[g.permission,g.scope]));
 const mutationScope=expectedMutationScope(role,campus),pilotageScope=expectedPilotageScope(role,campus);
 assert.equal(grants['lead.qualification.update'],mutationScope);assert.equal(grants['telephony.free-call.create'],mutationScope);assert.equal(grants['reporting.pilotage.view'],pilotageScope);assert.equal(next.version,2);assert.equal(next.grants.length,49);assert.deepEqual(rows,before);assert.equal(result.changes[0].auditObserved,false);assert.equal(result.epochOrAuditAbsenceOfChangeNotClaimed,true);
}
test('startup projection keeps the exact role, ceiling, campus and pilotage matrix after branch extraction',()=>{
 for(const role of ['SUPER_ADMIN','ADMIN','MANAGER','ADMISSIONS','AUDITOR','*']){
  for(const campus of ['GLOBAL','SYNTHETIC_CAMPUS']){assertStartupMatrixCase(role,campus);}
 }
});
test('AUDITOR keeps read-only view scope but cannot acquire a mutating permission',()=>{
 const rows=startupPermissions();rows[0].role='AUDITOR';rows[0].grants.find(g=>g.permission==='lead.view').scope='CAMPUS';
 assert.deepEqual(projectRc48StartupPermissions(rows).permissions,rows);
 rows[0].grants.find(g=>g.permission==='lead.edit').scope='CAMPUS';assert.throws(()=>projectRc48StartupPermissions(rows));
});
for(const [name,change] of [['partial catalogue',r=>r[0].grants.pop()],['duplicate grant',r=>r[0].grants.push(r[0].grants[0])],['unknown grant',r=>r[0].grants[0].permission='invented'],['forbidden scope',r=>r[0].grants.find(g=>g.permission==='users.edit').scope='GLOBAL']])test('startup projection refuses '+name,()=>{const rows=startupPermissions();change(rows);assert.throws(()=>projectRc48StartupPermissions(rows));});
test('startup projection pins actual RC48 source bytes',()=>{const f=fixture();assert.match(verifyRc48StartupRuleSources(f.args.readStartupSource),/^[a-f0-9]{64}$/u);assert.throws(()=>verifyRc48StartupRuleSources(()=>Buffer.from('changed')));});
test('SQL POST compares independent real-shaped encrypted records and preserves historical freshness limits honestly',async()=>{const f=fixture(),p=await prepare(f.args),input=sqlFixture(p,f.dossier),r=compareImagePostSqlPreservation(input);assert.equal(r.managerExisting49Preserved,true);assert.equal(r.nativeAcceptance,false);assert.equal(r.sameSnapshotAsLedger,false);assert.equal(r.epochAndPermissionAuditObserved,false);assert.equal(r.fullPortfolioCoverage,false);assert.equal(r.compared.postCompared,true);});
test('SQL permits natural monotonic counter progress and additional mail journal, never rewrites them',async()=>{const f=fixture(),p=await prepare(f.args),input=sqlFixture(p,f.dossier);input.postInput.payload.observation.snapshot.counters[0].assigned_count++;input.postInput.payload.observation.snapshot.journal.push({key:'synthetic-natural',status:'SENDING',sending_at:'2026-10-28T01:26:00.000Z'});input.reseal();const r=compareImagePostSqlPreservation(input);assert.equal(r.naturalCounterAndMailProgressPreserved,true);assert.equal(r.compared.postCompared,true);});
test('SQL composition admits only the precomputed exact RC48 startup delta, never a changed Manager49',async()=>{
 const f=fixture(),p=await prepare(f.args),input=sqlFixture(p,f.dossier),old=startupPermissions()[0],admin={...structuredClone(old),id:'ROLE:ADMIN:GLOBAL',role:'ADMIN'};admin.grants=admin.grants.filter(g=>!['lead.qualification.update','telephony.free-call.create','reporting.pilotage.view'].includes(g.permission));
 const prior=[old,admin];input.preInput.payload.observation.snapshot.permissions=prior;input.baseline.permissionSha256=digest(prior);input.reseal(input.preInput);const projection=projectRc48StartupPermissions(prior);input.postInput.payload.observation.snapshot.permissions=projection.permissions;input.reseal();const result=compareImagePostSqlPreservation(input);assert.equal(result.startupPermissionProjection.length,1);assert.equal(result.startupPermissionProjection[0].configurationId,admin.id);assert.equal(result.managerExisting49Preserved,true);assert.equal(result.epochAndPermissionAuditObserved,false);
 input.postInput.payload.observation.snapshot.permissions[1].grants.find(g=>g.permission==='telephony.free-call.create').scope='GLOBAL';input.reseal();assert.throws(()=>compareImagePostSqlPreservation(input));
});
for(const [name,change] of [['lost historical row',i=>i.postInput.payload.observation.snapshot.journal=[]],['counter loss',i=>i.postInput.payload.observation.snapshot.counters[0].assigned_count=0],['Manager49 arbitrary change',i=>i.postInput.payload.observation.snapshot.permissions[0].version=2],['wrong POST UID',i=>i.postInput.job.uid='other'],['metadata time substituted',i=>i.afterImageObservedAt='2026-10-28T01:27:00.000Z'],['future PRE capture',i=>i.preCaptureObservedAt='2026-10-31T00:00:00.000Z'],['current POST expired',i=>i.now+=300001]])test('SQL POST refuses '+name+' without rollback or accepting current blindly',async()=>{const f=fixture(),p=await prepare(f.args),input=sqlFixture(p,f.dossier);change(input);input.reseal();assert.throws(()=>compareImagePostSqlPreservation(input));});
