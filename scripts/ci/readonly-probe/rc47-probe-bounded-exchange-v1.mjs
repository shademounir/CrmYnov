// Candidate external executor component. Not an authorization or native qualification.
import assert from 'node:assert/strict';
const base='https://run.googleapis.com/v2/projects/crmynov-prod-n7x4q2/locations/europe-west1/';
export function createBoundedExchange({accessToken,fetchImpl=fetch}){
 assert.equal(typeof accessToken,'function');assert.equal(typeof fetchImpl,'function');
 return async descriptor=>{
  assert.equal(descriptor.retry,0);assert.equal(descriptor.redirect,'error');assert.equal(descriptor.timeoutMs,15000);assert.equal(typeof descriptor.url,'string');assert(descriptor.url.startsWith(base));
  const u=new URL(descriptor.url),suffix=u.pathname.slice(new URL(base).pathname.length);assert.equal(u.href,descriptor.url,'canonical URL required; no path normalization aliases');assert.equal(u.origin,'https://run.googleapis.com');assert.equal(u.username,'');assert.equal(u.password,'');assert.equal(u.hash,'');
  const job='jobs/crm-prod-rc47-readonly-probe-[a-z0-9-]+';
  if(descriptor.method==='POST'){assert(new RegExp('^'+job+':run$','u').test(suffix));assert.equal(u.search,'');const body=JSON.parse(descriptor.body);assert.deepEqual(Object.keys(body),['etag']);assert.equal(typeof body.etag,'string');assert(body.etag.length>0&&body.etag.length<=256);}
  else{assert.equal(descriptor.method,'GET');assert(!Object.hasOwn(descriptor,'body'));assert(new RegExp('^(?:'+job+'(?:/executions(?:/[a-z0-9-]+)?)?|operations/[a-zA-Z0-9_-]+)$','u').test(suffix));if(u.search){assert(suffix.endsWith('/executions'));assert.deepEqual([...new Set(u.searchParams.keys())].sort(),u.searchParams.has('pageToken')?['pageSize','pageToken','showDeleted']:['pageSize','showDeleted']);for(const key of u.searchParams.keys())assert.equal(u.searchParams.getAll(key).length,1);assert.equal(u.searchParams.get('showDeleted'),'true');assert.equal(u.searchParams.get('pageSize'),'100');assert((u.searchParams.get('pageToken')??'').length<=8192);}}
  const controller=new AbortController();let timer;const deadline=new Promise((resolve,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('deadline'));},15000);});
  try{
   // Token callback is supplied by a future official authentication adapter; never logged or persisted here.
   return await Promise.race([(async()=>{const token=await accessToken({signal:controller.signal});assert.equal(controller.signal.aborted,false);assert.equal(typeof token,'string');assert(token.length>0&&!/[\r\n]/u.test(token));
   const response=await fetchImpl(descriptor.url,{method:descriptor.method,redirect:'error',signal:controller.signal,headers:{authorization:'Bearer '+token,accept:'application/json',...(descriptor.method==='POST'?{'content-type':'application/json'}:{})},...(descriptor.method==='POST'?{body:descriptor.body}:{})});
   assert.equal(response.status,200);assert.equal(response.redirected,false);assert(/^application\/json(?:;|$)/iu.test(response.headers.get('content-type')??''));assert(response.body);const reader=response.body.getReader();let size=0;const chunks=[];
   try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;assert(size<=1048576,'response bound');chunks.push(part.value);}}finally{await reader.cancel();reader.releaseLock();}
   const body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));assert(body!==null&&typeof body==='object'&&!Array.isArray(body));return{status:200,body};})(),deadline]);
  }catch{throw new Error('NATIVE_EXCHANGE_OUTCOME_UNKNOWN_NO_RETRY');}finally{clearTimeout(timer);}
 };
}
