// Narrow comparison adapter for the existing official reader; immutable RC47 reader stays unchanged.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createOfficialGithubReader,fixedToolEnvironment,OFFICIAL_GH} from '../readonly-probe/probe-driver-github-v1.mjs';
const executeOfficial=promisify(execFile);
const PREFIX='/repos/shademounir/CrmYnov/compare/';
const COMPARE=/^\/repos\/shademounir\/CrmYnov\/compare\/[a-f0-9]{40}\.\.\.[a-f0-9]{40}$/u;
const TIMELINE=/^\/repos\/shademounir\/CrmYnov\/issues\/[1-9][0-9]{0,9}\/timeline$/u;
const TIMELINE_PROJECTION='map({event: .event})';
export function createReadOnlyGithubReader({execute=executeOfficial,environment=process.env}={}){
  const existing=createOfficialGithubReader({execute,environment});
  async function get(route){
    assert.equal(typeof route,'string');
    if(!route.startsWith(PREFIX)){return existing.get(route);}
    assert(route.length===PREFIX.length+83&&COMPARE.test(route),'EXACT_REPOSITORY_FULL_SHA_COMPARISON_REQUIRED');
    try{
      const env={...fixedToolEnvironment(environment),GH_HOST:'github.com',GH_PROMPT_DISABLED:'1',GH_DEBUG:'',GITHUB_DEBUG:''};
      const reply=await execute(OFFICIAL_GH,['api','--hostname','github.com','--method','GET',route],{encoding:'utf8',windowsHide:true,timeout:15000,maxBuffer:4194304,env});
      assert(Buffer.byteLength(reply.stdout)<=4194304);const value=JSON.parse(reply.stdout);
      assert(value&&Object.getPrototypeOf(value)===Object.prototype);
      assert(['ahead','identical','behind','diverged'].includes(value.status));
      assert(typeof value.merge_base_commit?.sha==='string'&&value.merge_base_commit.sha.length===40&&/^[a-f0-9]{40}$/u.test(value.merge_base_commit.sha));
      return value;
    }catch{throw new Error('OFFICIAL_GITHUB_COMPARISON_READ_FAILED');}
  }
  async function pages(route,key){
    if(typeof route!=='string'||!TIMELINE.test(route)){return existing.pages(route,key);}
    assert.equal(key,undefined,'TIMELINE_IS_AN_EVENT_ARRAY');
    const rows=[];
    for(let page=1;page<=100;page++){
      const target=route+'?per_page=100&page='+page;
      let items;
      try{
        const env={...fixedToolEnvironment(environment),GH_HOST:'github.com',GH_PROMPT_DISABLED:'1',GH_DEBUG:'',GITHUB_DEBUG:''};
        const reply=await execute(OFFICIAL_GH,['api','--hostname','github.com','--method','GET',target,'--jq',TIMELINE_PROJECTION],{encoding:'utf8',windowsHide:true,timeout:15000,maxBuffer:4194304,env});
        assert(Buffer.byteLength(reply.stdout)<=4194304);items=JSON.parse(reply.stdout);
        assert(Array.isArray(items)&&items.length<=100);
        assert(items.every(item=>item&&Object.getPrototypeOf(item)===Object.prototype&&Object.keys(item).length===1&&typeof item.event==='string'&&item.event.length>0&&item.event.length<=80),'ALL_TIMELINE_EVENTS_REQUIRED');
      }catch{throw new Error('OFFICIAL_GITHUB_TIMELINE_READ_FAILED');}
      rows.push(...items);assert(rows.length<=10000);
      if(items.length<100){return rows;}
    }
    throw new Error('GITHUB_PAGINATION_BOUND');
  }
  return Object.freeze({get,pages,reviewThreads:existing.reviewThreads});
}
