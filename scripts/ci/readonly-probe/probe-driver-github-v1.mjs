// Official authenticated gh API, read-only routes only. No token extraction.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const run=promisify(execFile),REPO='/repos/shademounir/CrmYnov/';
export const OFFICIAL_GH='C:/Program Files/GitHub CLI/gh.exe';
function checkedPageTotal(value, previous) {
  assert(Number.isSafeInteger(value.total_count)&&value.total_count>=0);
  if(previous!==undefined){assert.equal(value.total_count,previous);}
  return value.total_count;
}
export function fixedToolEnvironment(environment) {
  const env=Object.fromEntries(Object.entries(environment).filter(([key])=>key.toUpperCase()!=='PATH'));
  env.PATH='C:/Program Files/Git/cmd;C:/Program Files/Git/mingw64/bin;C:/Windows/System32;C:/Windows';
  return env;
}
export function createOfficialGithubReader({execute=run,environment=process.env}={}) {
  async function invoke(args) {
    try {
      const env={...fixedToolEnvironment(environment),GH_HOST:'github.com',GH_PROMPT_DISABLED:'1',GH_DEBUG:'',GITHUB_DEBUG:''};
      const reply=await execute(OFFICIAL_GH,['api','--hostname','github.com',...args],{encoding:'utf8',windowsHide:true,timeout:15000,maxBuffer:4194304,env});
      assert(Buffer.byteLength(reply.stdout)<=4194304);return JSON.parse(reply.stdout);
    } catch { throw new Error('OFFICIAL_GITHUB_READ_FAILED'); }
  }
  async function get(route) {
    assert.equal(typeof route,'string');
    assert(route==='/user'||(route.startsWith(REPO)&&/^\/[A-Za-z0-9_./?=&-]+$/u.test(route)));
    assert(!route.includes('..'));return invoke(['--method','GET',route]);
  }
  async function pages(route,key) {
    assert(!route.includes('?'));const rows=[];let total;
    for(let page=1;page<=100;page++) {
      const value=await get(route+'?per_page=100&page='+page),items=key?value[key]:value;
      assert(Array.isArray(items)&&items.length<=100);
      if(key==='check_runs'){total=checkedPageTotal(value,total);}
      rows.push(...items);assert(rows.length<=10000);
      const reachedTotal=Number.isSafeInteger(total)&&rows.length>=Number(total);
      if(items.length<100||reachedTotal){if(Number.isSafeInteger(total)){assert.equal(rows.length,total);}return rows;}
    }
    throw new Error('GITHUB_PAGINATION_BOUND');
  }
  async function reviewThreads(number) {
    assert(Number.isSafeInteger(number)&&number>0);
    const query='query{repository(owner:"shademounir",name:"CrmYnov"){pullRequest(number:'+number+'){reviewThreads(first:100){nodes{id isResolved}pageInfo{hasNextPage}}reviews(last:100){nodes{state commit{oid}}}}}}';
    const result=await invoke(['graphql','-f','query='+query]);assert(!result.errors);
    return result.data.repository.pullRequest;
  }
  return Object.freeze({get,pages,reviewThreads});
}
