import test from 'node:test';
import assert from 'node:assert/strict';
import {createOfficialAccessToken} from '../rc47-probe-official-auth-v1.mjs';
const options={account:'fixture@example.invalid',gcloudPath:'C:/Program Files (x86)/Google/Cloud SDK/google-cloud-sdk/lib/gcloud.py',pythonPath:'C:/Program Files (x86)/Google/Cloud SDK/google-cloud-sdk/platform/bundledpython/python.exe',environment:{}};
const safe=JSON.stringify({auth:{impersonate_service_account:null,access_token_file:null,disable_credentials:false}});
const signal=()=>new AbortController().signal;
const isConfig=args=>args[2]==='config';
test('fixed executables, explicit account and protected subprocess auth environment',async()=>{
  const seen=[],controller=new AbortController();
  const get=createOfficialAccessToken({...options,environment:{TASK_MARKER:'public-fixture'},execute:async(file,args,opts)=>{
    seen.push({args,opts});assert.equal(file,options.pythonPath);assert.deepEqual(args.slice(0,2),['-I',options.gcloudPath]);assert.equal(opts.signal,controller.signal);assert.equal(opts.maxBuffer,16384);assert.equal(opts.shell,undefined);assert.equal(opts.windowsHide,true);
    assert.equal(opts.env.CLOUDSDK_CORE_DISABLE_FILE_LOGGING,'1');assert.equal(opts.env.TASK_MARKER,'public-fixture');
    if(isConfig(args)){assert.deepEqual(args.slice(2),['config','list','--all','--format=json(auth)','--quiet']);assert.equal(opts.timeout,3000);return{stdout:safe};}
    assert.deepEqual(args.slice(2),['auth','print-access-token','--account',options.account,'--quiet']);assert.equal(opts.timeout,6000);
    assert.equal(opts.env.CLOUDSDK_CORE_ACCOUNT,options.account);
    for(const key of ['IMPERSONATE_SERVICE_ACCOUNT','ACCESS_TOKEN','ACCESS_TOKEN_FILE','CREDENTIAL_FILE_OVERRIDE','LOGIN_CONFIG_FILE','TOKEN_HOST'])assert.equal(opts.env['CLOUDSDK_AUTH_'+key],'');
    assert.equal(opts.env.CLOUDSDK_AUTH_DISABLE_CREDENTIALS,'false');return{stdout:'SYNTHETIC_ONLY\r\n'};
  }});
  assert.equal(await get({signal:controller.signal}),'SYNTHETIC_ONLY');assert.equal(seen.length,3);
});
for(const field of ['gcloudPath','pythonPath','account'])test('refuse substituted executable or malformed account: '+field,()=>assert.throws(()=>createOfficialAccessToken({...options,[field]:'bad value'})));
for(const key of ['CLOUDSDK_AUTH_IMPERSONATE_SERVICE_ACCOUNT','CLOUDSDK_AUTH_ACCESS_TOKEN','CLOUDSDK_AUTH_ACCESS_TOKEN_FILE','CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE','CLOUDSDK_AUTH_TOKEN_HOST','CLOUDSDK_AUTH_NEW_UNKNOWN_OVERRIDE','cloudsdk_auth_impersonate_service_account','GOOGLE_APPLICATION_CREDENTIALS'])test('ambient '+key+' refuses before any subprocess or token read',async()=>{
  let calls=0;const get=createOfficialAccessToken({...options,environment:{[key]:'SYNTHETIC_PRIVATE'},execute:async()=>{calls++;throw Error('must not execute');}});
  await assert.rejects(get({signal:signal()}),e=>e.message==='OFFICIAL_AUTHENTICATION_FAILED');assert.equal(calls,0);
});
for(const key of ['impersonate_service_account','access_token_file','credential_file_override','token_host','disable_credentials','future_override'])test('active configuration '+key+' is rejected without issuing a credential',async()=>{
  let calls=0;const get=createOfficialAccessToken({...options,execute:async()=>{calls++;return{stdout:JSON.stringify({auth:{[key]:'SYNTHETIC_PRIVATE'}})};}});
  await assert.rejects(get({signal:signal()}),e=>e.message==='OFFICIAL_AUTHENTICATION_FAILED');assert.equal(calls,1);
});
test('configuration drift or ignored empty overrides fail closed before token command',async()=>{
  let calls=0;const get=createOfficialAccessToken({...options,execute:async()=>({stdout:++calls===1?safe:JSON.stringify({auth:{impersonate_service_account:'synthetic-foreign@example.invalid'}})})});
  await assert.rejects(get({signal:signal()}));assert.equal(calls,2);
});
test('environment is rechecked at invocation rather than trusted at construction',async()=>{
  const environment={};let calls=0;const get=createOfficialAccessToken({...options,environment,execute:async()=>{calls++;}});environment.CLOUDSDK_AUTH_ACCESS_TOKEN='SYNTHETIC_PRIVATE';await assert.rejects(get({signal:signal()}));assert.equal(calls,0);
});
test('already aborted request refuses before process creation',async()=>{
  const c=new AbortController();c.abort();let calls=0;const get=createOfficialAccessToken({...options,execute:async()=>{calls++;}});await assert.rejects(get({signal:c.signal}));assert.equal(calls,0);
});
test('abort after preflight prevents another subprocess',async()=>{
  const c=new AbortController();let calls=0;const get=createOfficialAccessToken({...options,execute:async()=>{calls++;c.abort();return{stdout:safe};}});await assert.rejects(get({signal:c.signal}));assert.equal(calls,1);
});
for(const stdout of ['', 'one\ntwo','x'.repeat(8193)])test('malformed token remains redacted: '+stdout.length,async()=>{
  const get=createOfficialAccessToken({...options,execute:async(_f,args)=>({stdout:isConfig(args)?safe:stdout})});await assert.rejects(get({signal:signal()}),e=>e.message==='OFFICIAL_AUTHENTICATION_FAILED');
});
for(const stdout of ['broken','[]','null',JSON.stringify({auth:[]}),JSON.stringify({auth:{x:'false'}}),'x'.repeat(16385)])test('invalid auth metadata refuses: '+stdout.length,async()=>{
  let calls=0;const get=createOfficialAccessToken({...options,execute:async()=>{calls++;return{stdout};}});await assert.rejects(get({signal:signal()}));assert.equal(calls,1);
});
test('subprocess errors remain redacted with no retry',async()=>{
  let calls=0;const get=createOfficialAccessToken({...options,execute:async()=>{calls++;throw Error('SYNTHETIC_PRIVATE_TOKEN');}});await assert.rejects(get({signal:signal()}),e=>e.message==='OFFICIAL_AUTHENTICATION_FAILED');assert.equal(calls,1);
});
