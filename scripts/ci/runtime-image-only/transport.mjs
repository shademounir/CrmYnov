// Narrow draft transport extension; NOT an authority issuer or standalone executable.
// Existing READ ONLY transports and their allowed methods are not modified.
import assert from 'node:assert/strict';
import {boundedJson} from '../pool-reconciliation/pool-native-transaction-v1.mjs';
import {assertAuthorityCurrent} from '../readonly-probe/probe-driver-authority-v1.mjs';
import {imageJournalDigest as digest} from './journal.mjs';
import {PROJECT,LOCATION} from './plan.mjs';
import {imagePlanScope,isImageRollback} from './plan-mode.mjs';
export {createImageOperationalTransport} from './operational-transport-v2.mjs';

const runOrigin='https://run.googleapis.com/v2/',sqlOrigin='https://sqladmin.googleapis.com/sql/v1beta4/',schedulerOrigin='https://cloudscheduler.googleapis.com/v1/';
const instance='crm-ynov-prod-pg17',sqlInstance='projects/'+PROJECT+'/instances/'+instance;
function opaque(value){assert.equal(typeof value,'string');assert.match(value,/^[A-Za-z0-9_-]{1,256}$/u);return value;}
function page(value){assert.equal(typeof value,'string');assert(value.length<=8192);return value;}
export function createImageOnlyTransport({plan,accessToken,getAuthority,fetchImpl=fetch,clock=Date.now}){
  plan=structuredClone(plan);
  assert.equal(typeof accessToken,'function');assert.equal(typeof getAuthority,'function');assert.equal(typeof fetchImpl,'function');if(isImageRollback(plan)){assert(plan.patches.length>=1&&plan.patches.length<=2);}else{assert.equal(plan.patches.length,2);}
  const planSha256=digest(plan);let lastClock;
  function authority(action){const now=clock();assert(Number.isSafeInteger(now));assert(lastClock===undefined||now>=lastClock,'CLOCK_MOVED_BACKWARDS');lastClock=now;const current=getAuthority();assert.equal(current?.entry?.scope,imagePlanScope(plan),'READONLY_AUTHORITY_IS_NOT_IMAGE_AUTHORITY');assert.equal(current.entry.planSha256,planSha256);assert.equal(current.entry.googleAccount,'casablancaynovcampus@gmail.com');assert(current.entry.actions.includes(action));assertAuthorityCurrent(current,now);return current;}
  async function exchange(url,action,body,method='GET'){
    authority(action);assert(['GET','POST','PATCH'].includes(method));if(method==='GET'){assert.equal(body,undefined);}const controller=new AbortController();let timer;
    try{return await Promise.race([(async()=>{const token=await accessToken({signal:controller.signal});assert.equal(controller.signal.aborted,false);assert.equal(typeof token,'string');assert(token.length>0&&token.length<=8192&&!/\s/u.test(token));authority(action);const response=await fetchImpl(url,{method,redirect:'error',signal:controller.signal,headers:{authorization:'Bearer '+token,accept:'application/json',...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});const result=await boundedJson(response);assert.equal(result.status,200);return result.value;})(),new Promise((resolve,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('IMAGE_NATIVE_DEADLINE'));},15000);})]);}
    catch{throw new Error('IMAGE_NATIVE_EXCHANGE_UNKNOWN_NO_RETRY');}finally{clearTimeout(timer);}
  }
  function service(kind){assert(['api','web'].includes(kind));return LOCATION+'/services/crm-prod-'+kind;}
  return Object.freeze({
    async getService(kind){const name=service(kind),value=await exchange(runOrigin+name,'READ_METADATA');assert.equal(value.name,name);return value;},
    async getRevision(kind,revision){const name=service(kind);assert.equal(typeof revision,'string');assert(revision.startsWith('crm-prod-'+kind+'-'));opaque(revision);const full=name+'/revisions/'+revision,value=await exchange(runOrigin+full,'READ_METADATA');assert.equal(value.name,full);return value;},
    async listJobs(pageToken=''){page(pageToken);const query=new URLSearchParams({pageSize:'100',showDeleted:'true',...(pageToken?{pageToken}:{})});return exchange(runOrigin+LOCATION+'/jobs?'+query,'READ_METADATA');},
    async listSchedulers(pageToken=''){page(pageToken);const query=new URLSearchParams({pageSize:'100',...(pageToken?{pageToken}:{})});return exchange(schedulerOrigin+LOCATION+'/jobs?'+query,'READ_METADATA');},
    async getSqlInstance(){const value=await exchange(sqlOrigin+sqlInstance,'READ_METADATA');assert.equal(value.project,PROJECT);assert.equal(value.name,instance);return value;},
    async listBackups(pageToken=''){page(pageToken);const query=new URLSearchParams({maxResults:'100',...(pageToken?{pageToken}:{})});return exchange(sqlOrigin+sqlInstance+'/backupRuns?'+query,'READ_METADATA');},
    async getBackup(id){assert.match(id,/^[1-9]\d{0,19}$/u);const value=await exchange(sqlOrigin+sqlInstance+'/backupRuns/'+id,'READ_METADATA');assert.equal(String(value.id),id);assert.equal(value.instance,instance);return value;},
    async createBackup(){const current=authority('CREATE_BACKUP');assert.match(current.entry.objectiveId,/^rc48-image-only-[a-z0-9-]{8,80}$/u);const description='CRMY-63 '+current.entry.objectiveId+' '+planSha256.slice(0,16);return exchange(sqlOrigin+sqlInstance+'/backupRuns','CREATE_BACKUP',{description},'POST');},
    async patchServiceImage(kind){const name=service(kind),patch=plan.patches.find(p=>p.resource===name);assert(patch);assert.equal(patch.method,'PATCH');assert.equal(patch.updateMask,'template.containers');assert.equal(patch.body.name,name);assert.equal(patch.body.etag,patch.expectedEtag);assert.deepEqual(Object.keys(patch.body).toSorted((a,b)=>a.localeCompare(b,'en')),['etag','name','template']);assert.deepEqual(Object.keys(patch.body.template),['containers']);return exchange(runOrigin+name+'?'+new URLSearchParams({updateMask:'template.containers'}),'PATCH_'+kind.toUpperCase(),patch.body,'PATCH');},
    async getRunOperation(name){const prefix=LOCATION+'/operations/';assert.equal(typeof name,'string');assert(name.startsWith(prefix));opaque(name.slice(prefix.length));const value=await exchange(runOrigin+name,'OBSERVE_OPERATION');assert.equal(value.name,name);return value;},
    async getSqlOperation(name){opaque(name);const value=await exchange(sqlOrigin+'projects/'+PROJECT+'/operations/'+name,'OBSERVE_OPERATION');assert.equal(value.name,name);assert.equal(value.targetProject,PROJECT);assert.equal(value.targetId,instance);return value;}
  });
}
