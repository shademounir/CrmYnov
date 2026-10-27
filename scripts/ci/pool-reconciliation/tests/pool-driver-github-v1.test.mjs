// Synthetic official-process responses only, never real authentication/native acceptance.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createReadOnlyGithubReader} from '../pool-driver-github-v1.mjs';
import {createOfficialGithubReader,OFFICIAL_GH} from '../../readonly-probe/probe-driver-github-v1.mjs';
import {authorityFixture} from '../../readonly-probe/tests/probe-driver-fixtures-v1.mjs';
import {authorizePoolDriver} from '../pool-driver-authority-v1.mjs';
import {TRUSTED_INTENT_SHA256,digest} from '../controlled-pool-contract-v1.mjs';
import {GITHUB_CODE_REVIEW_POLICY_PATH} from '../../../pr-policy/github-code-review.mjs';
const PREFIX='/repos/shademounir/CrmYnov/compare/',left='a'.repeat(40),right='b'.repeat(40),route=PREFIX+left+'...'+right;
function reader(value={status:'ahead',merge_base_commit:{sha:left}}){const calls=[];return {calls,github:createReadOnlyGithubReader({environment:{PATH:'SYNTHETIC_UNTRUSTED_PATH'},execute:async(file,args,options)=>{calls.push({file,args,options});return {stdout:JSON.stringify(value)};}})};}
test('comparison uses one official GET with fixed tool environment and original bounds',async()=>{const f=reader(),result=await f.github.get(route);assert.equal(result.merge_base_commit.sha,left);assert.equal(f.calls.length,1);const call=f.calls[0];assert.equal(call.file,OFFICIAL_GH);assert.deepEqual(call.args,['api','--hostname','github.com','--method','GET',route]);assert.equal(call.options.timeout,15000);assert.equal(call.options.maxBuffer,4194304);assert.equal(call.options.windowsHide,true);assert.equal(call.options.env.GH_HOST,'github.com');assert.equal(call.options.env.GH_PROMPT_DISABLED,'1');assert(!call.options.env.PATH.includes('SYNTHETIC_UNTRUSTED_PATH'));});
for(const status of ['ahead','identical','behind','diverged'])test('returns real comparison status '+status+' without treating it as approval',async()=>{const f=reader({status,merge_base_commit:{sha:left}});assert.equal((await f.github.get(route)).status,status);});
for(const bad of [PREFIX+'main...develop',PREFIX+left+'..'+right,PREFIX+left+'....'+right,PREFIX+left+'%2e%2e%2e'+right,route+'?per_page=100',route+'/../contents',route+'#fragment',route+'\n','/repos/other/CrmYnov/compare/'+left+'...'+right,'https://api.github.com'+route,'/repos/shademounir/CrmYnov/contents/../private',PREFIX+'A'.repeat(40)+'...'+right])test('refuses ambiguous or foreign comparison '+JSON.stringify(bad),async()=>{const f=reader();await assert.rejects(f.github.get(bad));assert.equal(f.calls.length,0);});
test('historical reader retains its exact traversal refusal instead of being weakened',async()=>{let calls=0;const legacy=createOfficialGithubReader({execute:async()=>{calls++;return {stdout:'{}'};}});await assert.rejects(legacy.get(route));assert.equal(calls,0);});
test('noncomparison GET still uses the original reader',async()=>{const f=reader({login:'synthetic',type:'User'});assert.equal((await f.github.get('/user')).login,'synthetic');assert.equal(f.calls.length,1);assert.deepEqual(f.calls[0].args,['api','--hostname','github.com','--method','GET','/user']);});
for(const value of [{status:'unknown',merge_base_commit:{sha:left}},{status:'ahead',merge_base_commit:{sha:'short'}},[],null])test('malformed comparison response refuses '+JSON.stringify(value),async()=>{const f=reader(value);await assert.rejects(f.github.get(route),/OFFICIAL_GITHUB_COMPARISON_READ_FAILED/u);assert.equal(f.calls.length,1);});
test('read failure is not retried and cannot expose process stderr',async()=>{let calls=0;const github=createReadOnlyGithubReader({execute:async()=>{calls++;throw Error('SYNTHETIC_SENSITIVE_PROCESS_DETAIL');}});await assert.rejects(github.get(route),e=>e.message==='OFFICIAL_GITHUB_COMPARISON_READ_FAILED');assert.equal(calls,1);});
test('protected pool authority composes through the REAL official reader route guards on synthetic process responses',async()=>{
  const f=authorityFixture();f.dossier.objective={purpose:'POOL_RECONCILIATION_READ_ONLY_V1'};
  Object.assign(f.entry,{scope:'POOL_RECONCILIATION_READ_ONLY_V1',actions:['VERIFY','CREATE','OBSERVE_CREATE','RUN','OBSERVE_RUN','READ_OUTPUT'],originalIntentSha256:TRUSTED_INTENT_SHA256,independentInputsSha256:'d'.repeat(64),dossierSha256:digest(f.dossier)});f.authorization.actions=f.entry.actions;f.authorization.dossierSha256=f.entry.dossierSha256;
  for(const head of ['1','4','7'].map(c=>c.repeat(40))){f.responses.get(f.base+'commits/'+head+'/check-runs').push({id:90000+Number(head[0]),name:'simulate',status:'completed',conclusion:'success',head_sha:head});}
  f.responses.set(f.base+'branches/develop/protection',{enforce_admins:{enabled:true},required_status_checks:{strict:true,contexts:['pr-policy']}});
  const optionalPolicy=JSON.parse(fs.readFileSync(new URL('../../../../docs/governance/github-code-review-policy.json',import.meta.url)));f.responses.set(f.base+'contents/'+GITHUB_CODE_REVIEW_POLICY_PATH+'?ref='+'6'.repeat(40),f.blob(optionalPolicy));f.refreshCatalog();const calls=[];
  const github=createReadOnlyGithubReader({environment:{PATH:'SYNTHETIC'},execute:async(file,args)=>{
    assert.equal(file,OFFICIAL_GH);const tail=args.slice(3);if(tail[0]==='graphql'){calls.push('SYNTHETIC_GRAPHQL');return {stdout:JSON.stringify({data:{repository:{pullRequest:{reviewThreads:{pageInfo:{hasNextPage:false},nodes:[]},reviews:{nodes:[]}}}}})};}
    assert.deepEqual(tail.slice(0,2),['--method','GET']);const target=tail.at(-1);calls.push(target);const url=new URL(target,'https://api.github.com');let value;
    if(url.searchParams.has('per_page')){assert.equal(url.searchParams.get('page'),'1');const rows=f.responses.get(url.pathname);assert(Array.isArray(rows));value=url.pathname.endsWith('/check-runs')?{total_count:rows.length,check_runs:rows}:rows;}
    else{assert(f.responses.has(target),'SYNTHETIC_ROUTE_REQUIRED');value=f.responses.get(target);}
    return {stdout:JSON.stringify(value)};
  }});
  const result=await authorizePoolDriver({github,objectiveId:f.entry.id,dossier:f.dossier,jiraBytes:f.jiraBytes,localSource:f.localSource,action:'VERIFY',clock:()=>f.now});assert.equal(result.receipt.businessMutationAuthorized,false);assert.equal(result.receipt.gitHubCodeReviewRequired,false);assert(calls.filter(p=>p.startsWith(PREFIX)).length>=2);assert(calls.every(p=>!p.includes('run.googleapis.com')));
});
