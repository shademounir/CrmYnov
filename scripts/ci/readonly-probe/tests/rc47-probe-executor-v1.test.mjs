// Synthetic HTTP responses and authority only; never native/PROD qualification.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fixture as nativeFixture} from './rc47-probe-native-guards-v1.test.mjs';
import {createProbeExecutor} from '../rc47-probe-executor-v1.mjs';

function fixture(mode='success') {
  const {e,job,execution}=nativeFixture();job.etag='native-synthetic-etag';
  const operation='projects/'+e.project+'/locations/'+e.region+'/operations/synthetic-executor';
  const directory=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'rc47-executor-unit-')));
  let posts=0,authorityCalls=0;
  const fetchImpl=async(url,options)=>{
    const resource=new URL(url).pathname.slice(4);let value;
    if(options.method==='POST') {posts++;assert.equal(options.body,JSON.stringify({etag:job.etag}));if(mode==='unknown')throw Error('private-error');value={name:operation};}
    else if(resource===job.name)value=job;
    else if(resource===job.name+'/executions')value={};
    else if(resource===operation)value={name:operation,done:true,response:{name:execution.name}};
    else if(resource===execution.name)value=execution;
    else throw Error('unexpected resource');
    return new Response(JSON.stringify(value),{status:200,headers:{'content-type':'application/json'}});
  };
  const options={objective:e,journalDirectory:directory,accessToken:async()=>'SYNTHETIC_ONLY',authorizeFresh:async target=>{authorityCalls++;if(mode==='denied')throw Error('denied');if(mode==='callback-mutates')target.jobName+='-different';},fetchImpl};
  let executor=createProbeExecutor({...options,initialize:true});
  return{e,job,execution,options,get executor(){return executor;},posts:()=>posts,authorityCalls:()=>authorityCalls,reopen(){executor.close();executor=createProbeExecutor(options);},close(){executor.close();}};
}
test('composed executor binds real native validators, journal and bounded transport',async()=>{
  const f=fixture();try{const accepted=await f.executor.dispatch();assert.equal(accepted.state,'OPERATION_OBSERVED');assert.equal(f.posts(),1);assert.equal(f.authorityCalls(),2);f.reopen();const done=await f.executor.observe();assert.equal(done.state,'NATIVE_EXECUTION_RECONCILED');assert.equal(done.evidence.completed,true);await assert.rejects(f.executor.dispatch());assert.equal(f.posts(),1);}finally{f.close();}
});
test('caller and authority mutation cannot change detached target',async()=>{
  const f=fixture('callback-mutates');try{const original=f.e.jobName;f.e.jobName+='-changed';await f.executor.dispatch();assert.equal(f.executor.inspect().job,original);assert.equal(f.posts(),1);}finally{f.close();}
});
test('unknown outcome remains non-retryable after process-style reopen',async()=>{
  const f=fixture('unknown');try{assert.equal((await f.executor.dispatch()).state,'RUN_OUTCOME_UNKNOWN');f.reopen();await assert.rejects(f.executor.dispatch());await assert.rejects(f.executor.observe());assert.equal(f.posts(),1);}finally{f.close();}
});
test('fresh authority refusal performs no run or consumed intent',async()=>{
  const f=fixture('denied');try{await assert.rejects(f.executor.dispatch());assert.equal(f.posts(),0);assert.equal(f.executor.inspect(),null);}finally{f.close();}
});
for(const [name,change] of [
  ['image',f=>f.job.template.template.containers[0].image+='-wrong'],
  ['retry',f=>f.job.template.template.maxRetries=1],
  ['plaintext secret',f=>f.job.template.template.containers[0].env[0]={name:'DATABASE_URL',value:'synthetic-secret'}],
  ['pre-existing execution',f=>f.job.executionCount=1]
])test('composition cannot substitute permissive native validator: '+name,async()=>{
  const f=fixture();try{change(f);await assert.rejects(f.executor.dispatch());assert.equal(f.posts(),0);assert.equal(f.executor.inspect(),null);}finally{f.close();}
});
test('foreign execution parent cannot be reconciled by composition',async()=>{
  const f=fixture();try{f.execution.job+='-foreign';await f.executor.dispatch();await assert.rejects(f.executor.observe());assert.equal(f.executor.inspect().state,'OPERATION_OBSERVED');assert.equal(f.posts(),1);}finally{f.close();}
});
test('no arbitrary or missing operation accepted for recovery',async()=>{
  const f=fixture();try{await assert.rejects(f.executor.observe());assert.equal(f.posts(),0);}finally{f.close();}
});
test('closed executor cannot dispatch or inspect',async()=>{
  const f=fixture();f.close();await assert.rejects(f.executor.dispatch());assert.throws(()=>f.executor.inspect());
});
test('no boolean authority or implicit authentication fallback',()=>{
  assert.throws(()=>createProbeExecutor({authorizeFresh:true}));
  assert.throws(()=>createProbeExecutor({authorizeFresh:async()=>{}}));
});
