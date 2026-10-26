// SYNTHETIC fixtures only. No official authentication, provider or native proof.
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {fixture as nativeFixture} from './rc47-probe-native-guards-v1.test.mjs';
import {digest,MAIN,IMAGE} from '../rc47-select-only-probe-core-v1.mjs';
import {buildProbeBundle} from '../rc47-probe-bundle-v2.mjs';
import {CATALOG_PATH,RELEASE_MAIN} from '../probe-driver-authority-v1.mjs';
import {DELEGATED_CHECKS,GRANT_PATH,grantDigest,scopeDigest} from '../../../pr-policy/delegation.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex'),root=new URL('../',import.meta.url);
export function dossierFixture({realPayload=false}={}) {
  const {e,job,execution}=nativeFixture(),H='a'.repeat(64),preservation={schemaVersion:1,main:MAIN,imageDigest:IMAGE,nativeExecutionImageDigest:IMAGE,project:'crmynov-prod-n7x4q2',database:'crmynov_prod',role:'crm_runtime',campusId:'00000000-0000-0000-0000-000000000001',helperSha256:H,compiledInventorySha256:H,nativeExecutionEnvelopeSha256:H,settingsSha256:H,membershipSha256:H,permissionSha256:H,poolSha256:H,expectedMailVersion:4,expectedMailBaseline:'2026-10-21T19:29:49.289Z',qualificationKey:H,migrations:Array.from({length:56},(_,i)=>({name:String(i).padStart(3,'0'),checksum:H}))};
  preservation.compiledInventorySha256=e.compiledInventorySha256;
  if(realPayload){
    const names={core:'rc47-select-only-probe-core-v1.mjs',adapter:'rc47-select-only-probe-adapter-v1.mjs',entry:'rc47-probe-controlled-entry-v2.mjs',native:'rc47-probe-native-guards-v1.mjs'};
    const source=Object.fromEntries(['core','adapter','entry'].map(n=>[n,fs.readFileSync(new URL(names[n],root),'utf8')]));
    const bundle=buildProbeBundle({sources:source,envelope:preservation,compiledInventory:e.compiledInventory,policy:{jobName:e.jobName.split('/').at(-1),mode:'PRE',nativeContractSha256:preservation.nativeExecutionEnvelopeSha256}});
    Object.assign(preservation,bundle.payload.envelope);e.bootstrapSha256=bundle.bootstrapSha256;e.bundleSha256=bundle.bundleSha256;e.helpers=Object.entries(names).map(([name,file])=>({name,sha256:hash(fs.readFileSync(new URL(file,root)))}));
    const c=job.template.template.containers[0];c.args[2]=bundle.bootstrap;
    c.env.find(v=>v.name==='CRM_PROBE_BUNDLE_BASE64').value=bundle.base64;c.env.find(v=>v.name==='CRM_PROBE_BUNDLE_SHA256').value=bundle.bundleSha256;
    e.taskTemplateSha256=digest(job.template.template);execution.template=structuredClone(job.template.template);
  }
  return{dossier:{schemaVersion:1,objective:e,job:{labels:job.labels,template:job.template},preservation},job,execution};
}
export function authorityFixture(dossier=dossierFixture().dossier) {
  const now=Date.parse('2026-10-26T18:00:00Z'),revision='6'.repeat(40),driverHead='1'.repeat(40),driverMerge='2'.repeat(40),objectiveHead='4'.repeat(40),objectiveMerge='5'.repeat(40),releaseHead='7'.repeat(40);
  const grant=JSON.parse(fs.readFileSync(new URL('../../../../docs/governance/codex-delegation.json',import.meta.url)));
  const fileBytes=new Map(Array.from({length:10},(_,i)=>['scripts/ci/readonly-probe/synthetic-'+i+'.mjs',Buffer.from('// SYNTHETIC '+i)]));
  const localSource={commit:driverMerge,tree:'3'.repeat(40),clean:true,files:[...fileBytes].map(([path,bytes])=>({path,sha256:hash(bytes)}))};
  const entry={schemaVersion:1,id:'synthetic-objective',status:'approved',scope:'READONLY_PRESERVATION_PROBE_ONLY',businessMutation:false,actions:['VERIFY','CREATE_JOB','OBSERVE_CREATE','DISPATCH','OBSERVE_RUN'],validFrom:'2026-10-26T17:00:00Z',expiresAt:'2026-10-26T19:00:00Z',dossierSha256:digest(dossier),ticket:'CRMY-63',driver:{pr:301,head:driverHead,mergeCommit:driverMerge,tree:localSource.tree,files:localSource.files},objectiveReview:{pr:302},release:{pr:243,head:releaseHead,mergeCommit:RELEASE_MAIN,tag:'v0.1.0-rc.48',releaseId:424492409,postPublishRun:9999},humanAuthorityReceiptSha256:'8'.repeat(64),googleAccount:'operator@example.test',journalDirectorySha256:'9'.repeat(64),baselineLineage:Object.fromEntries(['settingsSha256','membershipSha256','permissionSha256','poolSha256'].map(k=>[k,{value:dossier.preservation[k],evidenceSha256:'a'.repeat(64),source:'OFFICIAL_IMMUTABLE_BASELINE_RECEIPT',observedAt:'2026-10-25T12:00:00Z'}]))};
  const jiraBytes=Buffer.from(JSON.stringify({schemaVersion:1,source:'OFFICIAL_JIRA_UI_OPERATOR_OBSERVATION',executor:'Codex',observedBy:'shademounir',grantDigest:grantDigest(grant),observedAt:'2026-10-26T17:57:00Z',ticket:{key:'CRMY-63',codexReady:true,blocked:false,status:'In Review'},claim:'Operator-observed official Jira UI; not a cryptographic Jira connector or native signature'}));
  const authorization={schemaVersion:1,executor:'Codex',grantDigest:grantDigest(grant),objectiveId:entry.id,catalogEntrySha256:digest(entry),dossierSha256:entry.dossierSha256,driverCommit:localSource.commit,actions:entry.actions,productionBusinessMutation:false,expiresAt:'2026-10-26T18:04:00Z',jiraObservationSha256:hash(jiraBytes),humanAuthorityReceiptSha256:entry.humanAuthorityReceiptSha256};
  const catalog={schemaVersion:1,entries:[entry]},responses=new Map();
  const put=(route,value)=>responses.set(route,value),base='/repos/shademounir/CrmYnov/';
  put('/user',{login:'shademounir',type:'User'});put(base+'branches/develop',{commit:{sha:revision},protected:true});put(base+'branches/develop/protection',{required_status_checks:{contexts:['pr-policy']}});put(base+'branches/main',{commit:{sha:RELEASE_MAIN},protected:true});
  const blob=value=>({encoding:'base64',content:Buffer.from(typeof value==='string'?value:JSON.stringify(value)).toString('base64')});
  for(const sha of [revision,driverHead,objectiveHead,releaseHead])put(base+'contents/'+GRANT_PATH+'?ref='+sha,blob(grant));
  for(const sha of [revision,objectiveMerge])put(base+'contents/'+CATALOG_PATH+'?ref='+sha,blob(catalog));
  for(const [file,bytes]of fileBytes)put(base+'contents/'+file+'?ref='+driverMerge,blob(bytes.toString()));
  for(const sha of [driverMerge,objectiveMerge])put(base+'compare/'+sha+'...'+revision,{merge_base_commit:{sha},status:'ahead'});
  const prs=[{pr:301,head:driverHead,mergeCommit:driverMerge,files:['scripts/ci/readonly-probe/probe-operational-driver-v1.mjs'],target:'develop'},{pr:302,head:objectiveHead,mergeCommit:objectiveMerge,files:[CATALOG_PATH],target:'develop'},{pr:243,head:releaseHead,mergeCommit:RELEASE_MAIN,files:['release-manifest.json'],target:'main'}];
  for(const r of prs){
    const checks=DELEGATED_CHECKS.map((name,i)=>({id:r.pr*100+i,name,status:'completed',conclusion:'success',head_sha:r.head}));checks.push({id:r.pr*100+99,name:'pr-policy',status:'completed',conclusion:'success',head_sha:r.head});
    const decision={schemaVersion:1,executor:'Codex',decision:'approved',grantId:grant.id,grantDigest:grantDigest(grant),pullRequest:r.pr,headSha:r.head,scopeDigest:scopeDigest(r.files),checks:checks.filter(c=>c.name!=='pr-policy').map(c=>({name:c.name,id:c.id})),evidence:['https://example.test/synthetic'],reservations:[],rollback:'New protected revert preserving all useful data and source receipts.',personalVisualAcceptance:false,productionDeploymentAuthorized:false};
    const user={login:'shademounir',type:'User'};
    const comments=[{id:100,user,created_at:'2026-10-26T15:00:00Z',updated_at:'2026-10-26T15:00:00Z',body:'<!-- codex-delegated-decision\n'+JSON.stringify(decision)+'\n-->'},{id:101,user:{login:'chatgpt-codex-connector[bot]',type:'Bot'},performed_via_github_app:{slug:'chatgpt-codex-connector'},body:'<!-- codex-review-state:v1 '+JSON.stringify({code_review:{commit_sha:r.head,status:'completed',has_any_findings:false,has_unresolved_findings:false}})+' -->'}];
    if(r.pr===302)comments.push({id:102,user,created_at:'2026-10-26T17:55:00Z',updated_at:'2026-10-26T17:55:00Z',body:'<!-- codex-readonly-probe-objective-authorization:v1\n'+JSON.stringify(authorization)+'\n-->'});
    put(base+'pulls/'+r.pr,{number:r.pr,head:{sha:r.head,repo:{full_name:'shademounir/CrmYnov'}},base:{ref:r.target,repo:{full_name:'shademounir/CrmYnov'}},merge_commit_sha:r.mergeCommit,merged:true,draft:false,auto_merge:null,user,merged_by:user,merged_at:'2026-10-26T16:00:00Z',labels:[{name:'codex-delegated-approved'}]});
    put(base+'pulls/'+r.pr+'/files',r.files.map(filename=>({filename})));put(base+'commits/'+r.head+'/check-runs',checks);put(base+'issues/'+r.pr+'/comments',comments);put(base+'issues/'+r.pr+'/timeline',[]);
  }
  put(base+'commits/'+RELEASE_MAIN+'/check-runs',DELEGATED_CHECKS.map((name,i)=>({id:50000+i,name,status:'completed',conclusion:'success',head_sha:RELEASE_MAIN})));
  put(base+'releases/tags/v0.1.0-rc.48',{id:424492409,draft:false,prerelease:true,published_at:'2026-10-26T16:28:11Z'});put(base+'git/ref/tags/v0.1.0-rc.48',{object:{type:'commit',sha:RELEASE_MAIN}});
  put(base+'actions/runs/9999',{head_sha:RELEASE_MAIN,event:'release',path:'.github/workflows/release-publish.yml',status:'completed',conclusion:'success',created_at:'2026-10-26T16:28:15Z'});
  const calls=[];const lookup=route=>{calls.push(route);if(!responses.has(route))throw Error('SYNTHETIC_MISSING_ROUTE '+route);return structuredClone(responses.get(route));};
  const github={get:async route=>lookup(route),pages:async route=>lookup(route),reviewThreads:async()=>({reviewThreads:{pageInfo:{hasNextPage:false},nodes:[]},reviews:{nodes:[]}})};
  return {github,dossier,entry,catalog,grant,authorization,jiraBytes,localSource,now,responses,calls,base,blob,hash,refreshCatalog(){put(base+'contents/'+CATALOG_PATH+'?ref='+revision,blob(catalog));put(base+'contents/'+CATALOG_PATH+'?ref='+objectiveMerge,blob(catalog));authorization.catalogEntrySha256=digest(entry);const c=responses.get(base+'issues/302/comments').find(c=>c.id===102);c.body='<!-- codex-readonly-probe-objective-authorization:v1\n'+JSON.stringify(authorization)+'\n-->';}};
}
