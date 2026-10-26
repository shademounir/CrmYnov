// Official gcloud authentication only. Token stays in memory and is never a receipt/log.
// This adapter does not authorize an execution or alter accounts, scopes or permissions.
import assert from 'node:assert/strict';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const run=promisify(execFile);
export function createOfficialAccessToken({account,gcloudPath,powershellPath,execute=run}) {
  assert.equal(typeof account,'string');assert.match(account,/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+$/u);
  assert.equal(gcloudPath,'C:\\Program Files (x86)\\Google\\Cloud SDK\\google-cloud-sdk\\bin\\gcloud.ps1');
  assert.equal(powershellPath,'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
  assert(path.win32.isAbsolute(gcloudPath));assert.equal(typeof execute,'function');
  return async({signal}={})=>{
    assert(signal instanceof AbortSignal);assert.equal(signal.aborted,false);
    try {
      const result=await execute(powershellPath,['-NoProfile','-NonInteractive','-File',gcloudPath,'auth','print-access-token','--account',account,'--quiet'],{signal,timeout:12000,maxBuffer:16384,encoding:'utf8',windowsHide:true,env:{...process.env,CLOUDSDK_CORE_DISABLE_PROMPTS:'1'}});
      assert.equal(signal.aborted,false);
      const token=result.stdout.trim();assert(token.length>0&&token.length<=8192);assert(!/\s/u.test(token));
      return token;
    } catch {throw new Error('OFFICIAL_AUTHENTICATION_FAILED');}
  };
}
