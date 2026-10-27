// Official fixed endpoints only. POST entries:list reads logs, never dispatches a job.
import assert from 'node:assert/strict';
import {createAuthorityBoundFetch} from '../readonly-probe/probe-driver-authority-v1.mjs';
import {poolOutputReadRequests,verifyPoolOutputClaims} from './pool-native-output-v1.mjs';
import {boundedJson} from './pool-native-transaction-v1.mjs';
async function readJson(response){const result=await boundedJson(response);assert.equal(result.status,200);return result.value;}
export function createPoolOutputReader({accessToken,getAuthority,fetchImpl=fetch}){
  assert.equal(typeof accessToken,'function');const guarded=createAuthorityBoundFetch({fetchImpl,getAuthority});
  return async({dossier,execution,privateKeyPem,save,clock=Date.now})=>{
    assert.equal(typeof save,'function');const requests=poolOutputReadRequests(dossier.objective,execution,clock()),results=[];
    async function readOne(index,request){
      await save('NATIVE-OUTPUT-'+index+'-INTENT',{method:request.method,url:request.url,...(request.body?{body:request.body}:{})});
      const controller=new AbortController();let timer;
      try{
        const value=await Promise.race([(async()=>{
          const token=await accessToken({signal:controller.signal});assert(!controller.signal.aborted);assert(typeof token==='string'&&token.length>0&&!/\s/u.test(token));
          const response=await guarded(request.url,{method:request.method,redirect:'error',signal:controller.signal,headers:{authorization:'Bearer '+token,accept:'application/json',...(request.body?{'content-type':'application/json'}:{})},...(request.body?{body:JSON.stringify(request.body)}:{})});return readJson(response);
        })(),new Promise((resolve,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('OFFICIAL_OUTPUT_READ_DEADLINE'));},15000);})]);
        await save('NATIVE-OUTPUT-'+index+'-RESULT',value);return value;
      }catch{await save('NATIVE-OUTPUT-'+index+'-FAILED',{state:'OUTPUT_READ_FAILED',mutatingJobRetryAllowed:false});throw new Error('OFFICIAL_POOL_OUTPUT_NOT_ACQUIRED');}finally{clearTimeout(timer);}
    }
    async function readAt(index){if(index===requests.length){return;}results.push(await readOne(index,requests[index]));return readAt(index+1);}
    await readAt(0);
    const checked=verifyPoolOutputClaims({job:results[0],execution:results[1],logs:results[2],bundle:dossier.bundle,objective:dossier.objective,privateKeyPem,now:clock()});
    return {...checked,job:results[0],execution:results[1],officialReadPathExecuted:true,provenanceMeaning:'Official authenticated API read path; fixture injection is synthetic, no cryptographic provider signature is asserted'};
  };
}
