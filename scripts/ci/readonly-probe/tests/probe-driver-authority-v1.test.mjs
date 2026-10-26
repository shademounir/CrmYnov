import test from 'node:test';
import assert from 'node:assert/strict';
import {authorizeProbeDriver,CATALOG_PATH,validateOperatorJiraObservation,assertAuthorityCurrent,createAuthorityBoundFetch} from '../probe-driver-authority-v1.mjs';
import {createOfficialGithubReader,OFFICIAL_GH,fixedToolEnvironment} from '../probe-driver-github-v1.mjs';
import {authorityFixture} from './probe-driver-fixtures-v1.mjs';
const run=f=>authorizeProbeDriver({github:f.github,objectiveId:f.entry.id,dossier:f.dossier,jiraBytes:f.jiraBytes,localSource:f.localSource,action:'VERIFY',clock:()=>f.now});
test('synthetic full official-provenance graph constructs catalog without self-referential commit hash',async()=>{
  const f=authorityFixture();assert.deepEqual(f.entry.objectiveReview,{pr:302});const result=await run(f);assert.equal(result.receipt.objectiveId,f.entry.id);assert.equal(result.receipt.businessMutationAuthorized,false);assert.match(result.receipt.jiraEvidenceMeaning,/not a cryptographic/u);
});
for(const [name,prepare,advance]of[
 ['operational expiry',f=>{f.authorization.expiresAt=new Date(f.now+1000).toISOString();f.refreshCatalog();},2000],
 ['catalog expiry',f=>{f.entry.expiresAt=new Date(f.now+1000).toISOString();f.refreshCatalog();},2000],
 ['Jira freshness',f=>{const j=JSON.parse(f.jiraBytes);j.observedAt=new Date(f.now-599000).toISOString();f.jiraBytes=Buffer.from(JSON.stringify(j));f.authorization.jiraObservationSha256=f.hash(f.jiraBytes);f.refreshCatalog();},2000],
 ['comment freshness',f=>{f.responses.get(f.base+'issues/302/comments').find(c=>c.id===102).updated_at=new Date(f.now-599000).toISOString();},2000],
 ['exact collection deadline',()=>{},60000],
 ['backwards clock',()=>{},-1]
])test('live final clock refuses '+name,async()=>{
 const f=authorityFixture();prepare(f);const get=f.github.get;let count=0;
 f.github.get=async route=>{const result=await get(route);if(route===f.base+'branches/develop'&&++count===2)f.now+=advance;return result;};
 await assert.rejects(run(f));
});
test('returned expiry is the minimum Jira/comment/catalog/explicit bound and exact expiry refuses',async()=>{
 const f=authorityFixture(),result=await run(f);assert.equal(Date.parse(result.receipt.expiresAt),Date.parse(f.authorization.expiresAt));
 assertAuthorityCurrent(result,Date.parse(result.receipt.expiresAt)-1);assert.throws(()=>assertAuthorityCurrent(result,Date.parse(result.receipt.expiresAt)));assert.throws(()=>assertAuthorityCurrent(result,f.now-1));
});
test('authority-bound fetch checks after token boundary without changing GET metadata reads',async()=>{
 const f=authorityFixture(),authority=await run(f);let calls=0,now=f.now;
 const fetchImpl=createAuthorityBoundFetch({getAuthority:()=>authority,clock:()=>now,fetchImpl:()=>{calls++;return 'SYNTHETIC';}});
 assert.equal(fetchImpl('synthetic',{method:'GET'}),'SYNTHETIC');now=Date.parse(authority.receipt.expiresAt);assert.throws(()=>fetchImpl('synthetic',{method:'POST'}));assert.equal(calls,1);
});
test('fixed subprocess PATH removes all caller case variants and keeps no user-writable directory',()=>{
 const env=fixedToolEnvironment({Path:'C:/Users/test/bin',PATH:'bad',pAtH:'bad2',KEEP:'yes'});
 assert.deepEqual(Object.keys(env).filter(k=>k.toUpperCase()==='PATH'),['PATH']);assert.equal(env.KEEP,'yes');assert.equal(env.PATH,'C:/Program Files/Git/cmd;C:/Program Files/Git/mingw64/bin;C:/Windows/System32;C:/Windows');
});
test('guard normalizes lowercase POST and forwards the captured canonical method',async()=>{
 const f=authorityFixture(),authority=await run(f);let calls=0;
 const transport=createAuthorityBoundFetch({getAuthority:()=>authority,clock:()=>f.now,fetchImpl:(url,init)=>{calls++;assert.equal(init.method,'POST');return 'SYNTHETIC';}});
 assert.equal(transport('synthetic',{method:'pOsT',body:'{}'}),'SYNTHETIC');assert.equal(calls,1);
 f.now=Date.parse(authority.receipt.expiresAt);assert.throws(()=>transport('synthetic',{method:'post'}));assert.equal(calls,1);
});
for(const init of [{method:'DELETE'},{method:'PATCH'},{method:'HEAD'},{method:''},{method:undefined},{method:1},{method:' POST'},{body:'bad'},{method:'GET',body:undefined},{method:'GET',unknown:true},[],null])test('malformed or forbidden init never reaches fetch '+JSON.stringify(init),async()=>{
 const f=authorityFixture(),authority=await run(f);let calls=0;const transport=createAuthorityBoundFetch({getAuthority:()=>authority,clock:()=>f.now,fetchImpl:()=>{calls++;}});
 assert.throws(()=>transport('synthetic',init));assert.equal(calls,0);
});
test('Request objects, nonplain init and getter method/init cannot bypass classification',async()=>{
 const f=authorityFixture(),authority=await run(f);let calls=0,getters=0;const transport=createAuthorityBoundFetch({getAuthority:()=>authority,clock:()=>f.now,fetchImpl:()=>{calls++;}});
 assert.throws(()=>transport(new Request('https://example.test',{method:'POST'}),{}));
 assert.throws(()=>transport('synthetic',Object.create({method:'GET'})));
 const init={get method(){getters++;return getters===1?'GET':'POST';}};assert.throws(()=>transport('synthetic',init));
 const altered={method:'GET',get headers(){altered.method='POST';return {};}};assert.throws(()=>transport('synthetic',altered));
 assert.equal(calls,0);assert.equal(getters,0);assert.equal(altered.method,'GET');
});
test('omitted method is detached and explicitly sent as GET',()=>{
 let actual;const transport=createAuthorityBoundFetch({getAuthority:()=>undefined,clock:()=>1,fetchImpl:(url,init)=>{actual=init;}});transport('synthetic');assert.equal(actual.method,'GET');
});
test('official check pagination verifies total count across a full page',async()=>{
 let calls=0;const reader=createOfficialGithubReader({execute:async()=>{calls++;return{stdout:JSON.stringify({total_count:100,check_runs:Array.from({length:100},(_,i)=>({id:i}))})};},environment:{}});
 assert.equal((await reader.pages('/repos/shademounir/CrmYnov/commits/'+'1'.repeat(40)+'/check-runs','check_runs')).length,100);assert.equal(calls,1);
});
for(const[name,change]of[
  ['revoked grant',f=>{const p=f.base+'contents/docs/governance/codex-delegation.json?ref='+'6'.repeat(40);f.grant.status='revoked';f.responses.set(p,f.blob(f.grant));}],
  ['wrong actor',f=>f.responses.set('/user',{login:'other',type:'User'})],
  ['unprotected develop',f=>f.responses.get(f.base+'branches/develop').protected=false],
  ['missing protected policy',f=>f.responses.get(f.base+'branches/develop/protection').required_status_checks.contexts=[]],
  ['missing catalog',f=>f.responses.delete(f.base+'contents/'+CATALOG_PATH+'?ref='+'6'.repeat(40))],
  ['no approved objective',f=>{f.catalog.entries=[];f.refreshCatalog();}],
  ['duplicate objective',f=>{f.catalog.entries.push(structuredClone(f.entry));f.refreshCatalog();}],
  ['unapproved objective',f=>{f.entry.status='draft';f.refreshCatalog();}],
  ['expired objective',f=>{f.entry.expiresAt='2026-10-26T17:59:00Z';f.refreshCatalog();}],
  ['changed dossier',f=>f.dossier.objective.intentAt='2026-10-26T17:00:00Z'],
  ['missing pool lineage',f=>{delete f.entry.baselineLineage.poolSha256;f.refreshCatalog();}],
  ['TOFU lineage',f=>{f.entry.baselineLineage.poolSha256.source='CURRENT_STATE_ACCEPTED';f.refreshCatalog();}],
  ['wrong driver local commit',f=>f.localSource.commit='a'.repeat(40)],
  ['dirty driver',f=>f.localSource.clean=false],
  ['driver bytes drift',f=>{f.localSource.files[0].sha256='b'.repeat(64);f.refreshCatalog();}],
  ['self-referential objective hash field',f=>{f.entry.objectiveReview.head='4'.repeat(40);f.refreshCatalog();}],
  ['driver PR not merged',f=>f.responses.get(f.base+'pulls/301').merged=false],
  ['catalog PR not merged',f=>f.responses.get(f.base+'pulls/302').merged=false],
  ['catalog not in objective PR',f=>f.responses.set(f.base+'pulls/302/files',[])],
  ['stale source review',f=>{const c=f.responses.get(f.base+'issues/301/comments').find(c=>c.id===101);c.body=c.body.replace('1'.repeat(40),'f'.repeat(40));}],
  ['bot finding',f=>{const c=f.responses.get(f.base+'issues/301/comments').find(c=>c.id===101);c.body=c.body.replace('"has_any_findings":false','"has_any_findings":true');}],
  ['driver CI pending',f=>f.responses.get(f.base+'commits/'+'1'.repeat(40)+'/check-runs')[0].status='in_progress'],
  ['main drift',f=>f.responses.get(f.base+'branches/main').commit.sha='b'.repeat(40)],
  ['main latest check failed',f=>f.responses.get(f.base+'commits/'+f.entry.release.mergeCommit+'/check-runs')[0].conclusion='failure'],
  ['release not published',f=>f.responses.get(f.base+'releases/tags/v0.1.0-rc.48').draft=true],
  ['wrong tag commit',f=>f.responses.get(f.base+'git/ref/tags/v0.1.0-rc.48').object.sha='b'.repeat(40)],
  ['postpublication incomplete',f=>f.responses.get(f.base+'actions/runs/9999').status='in_progress'],
  ['Jira evidence tampered',f=>f.jiraBytes=Buffer.from('{}')],
  ['fresh auth absent',f=>{f.responses.get(f.base+'issues/302/comments').pop();}],
  ['fresh auth wrong objective',f=>{f.authorization.objectiveId='other';f.refreshCatalog();}],
  ['fresh auth expired',f=>{f.authorization.expiresAt='2026-10-26T17:59:00Z';f.refreshCatalog();}]
])test('fail closed: '+name,async()=>{const f=authorityFixture();change(f);await assert.rejects(run(f));});
test('review conversations must actually be resolved',async()=>{const f=authorityFixture();f.github.reviewThreads=async()=>({reviewThreads:{pageInfo:{hasNextPage:false},nodes:[{isResolved:false}]},reviews:{nodes:[]}});await assert.rejects(run(f));});
test('authority drift during collection is refused',async()=>{const f=authorityFixture(),get=f.github.get;let count=0;f.github.get=async route=>{const result=await get(route);if(route===f.base+'branches/develop'&&++count===2)result.commit.sha='a'.repeat(40);return result;};await assert.rejects(run(f));});
test('operator observation is explicitly not self-authenticating or a native signature',()=>{
 const f=authorityFixture();assert.throws(()=>validateOperatorJiraObservation(f.jiraBytes,{expectedSha256:'a'.repeat(64),ticket:'CRMY-63',actor:'shademounir',grantSha256:'a'.repeat(64),now:f.now}));
});
test('official github adapter performs bounded GET without extracting token or logging auth',async()=>{
 const calls=[];const reader=createOfficialGithubReader({execute:async(file,args,options)=>{calls.push({file,args,options});return{stdout:'{"login":"synthetic"}'};},environment:{GH_DEBUG:'api'}});
 assert.equal((await reader.get('/user')).login,'synthetic');assert.equal(calls[0].file,OFFICIAL_GH);assert.deepEqual(calls[0].args.slice(0,5),['api','--hostname','github.com','--method','GET']);assert.equal(calls[0].options.timeout,15000);assert.equal(calls[0].options.env.GH_DEBUG,'');assert(!calls[0].args.includes('token'));
 await assert.rejects(reader.get('/user/../tokens'));await assert.rejects(reader.get('https://example.test'));
});
