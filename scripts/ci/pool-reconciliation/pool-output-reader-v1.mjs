// Official fixed endpoints only. POST entries:list reads logs, never dispatches a job.
import assert from 'node:assert/strict';
import {createAuthorityBoundFetch} from '../readonly-probe/probe-driver-authority-v1.mjs';
import {poolOutputReadRequests,verifyPoolOutputClaims} from './pool-native-output-v1.mjs';
async function readJson(response){
  assert.equal(response.status,200);assert.equal(response.redirected,false);assert(/^application\/json(?:;|$)/iu.test(response.headers.get('content-type')??''));assert(response.body);
  const reader=response.body.getReader(),chunks=[];let length=0;
  try{for(;;){const p=await reader.read();if(p.done)break;length+=p.value.byteLength;assert(length<=1048576,'OFFICIAL_OUTPUT_RESPONSE_BOUND');chunks.push(p.value);}}
  finally{await reader.cancel();reader.releaseLock();}
  const value=JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(Buffer.concat(chunks)));assert(value&&Object.getPrototypeOf(value)===Object.prototype);return value;
}
export function createPoolOutputReader({accessToken,getAuthority,fetchImpl=fetch}){
  assert.equal(typeof accessToken,'function');const guarded=createAuthorityBoundFetch({fetchImpl,getAuthority});
  return async({dossier,execution,privateKeyPem,save,clock=Date.now})=>{
    assert.equal(typeof save,'function');const requests=poolOutputReadRequests(dossier.objective,execution,clock()),results=[];
    for(const [index,request] of requests.entries()){
      await save('NATIVE-OUTPUT-'+index+'-INTENT',{method:request.method,url:request.url,...(request.body?{body:request.body}:{})});
      const controller=new AbortController();let timer;
      try{
        const value=await Promise.race([(async()=>{
          const token=await accessToken({signal:controller.signal});assert(!controller.signal.aborted);assert(typeof token==='string'&&token.length>0&&!/\s/u.test(token));
          const response=await guarded(request.url,{method:request.method,redirect:'error',signal:controller.signal,headers:{authorization:'Bearer '+token,accept:'application/json',...(request.body?{'content-type':'application/json'}:{})},...(request.body?{body:JSON.stringify(request.body)}:{})});return readJson(response);
        })(),new Promise((resolve,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('OFFICIAL_OUTPUT_READ_DEADLINE'));},15000);})]);
        await save('NATIVE-OUTPUT-'+index+'-RESULT',value);results.push(value);
      }catch{await save('NATIVE-OUTPUT-'+index+'-FAILED',{state:'OUTPUT_READ_FAILED',mutatingJobRetryAllowed:false});throw Error('OFFICIAL_POOL_OUTPUT_NOT_ACQUIRED');}finally{clearTimeout(timer);}
    }
    const checked=verifyPoolOutputClaims({job:results[0],execution:results[1],logs:results[2],bundle:dossier.bundle,objective:dossier.objective,privateKeyPem,now:clock()});
    return {...checked,job:results[0],execution:results[1],officialReadPathExecuted:true,provenanceMeaning:'Official authenticated API read path; fixture injection is synthetic, no cryptographic provider signature is asserted'};
  };
}
