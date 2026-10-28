// Extension through operational-driver-v2.mjs: `image-only <explicit mode>`.
// No default objective, no new authentication or alternate native framework.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import{createHash}from'node:crypto';
import {readPoolPrivateFile} from '../pool-reconciliation/pool-operational-driver-v1.mjs';
import {readImageLocalSource,imageExternalDirectory} from './local-source.mjs';
import {createReadOnlyGithubReader} from '../pool-reconciliation/pool-driver-github-v1.mjs';
import {createOfficialAccessToken} from '../readonly-probe/rc47-probe-official-auth-v1.mjs';
import {authorizeImageOnlyDriver} from './authority.mjs';
import {validateImagePreparation} from './preparation.mjs';
import {createImageOnlyTransport} from './transport.mjs';
import {createImageOnlyExecutor} from './executor.mjs';
import {makeRc48ServiceImagePlanDraft} from './plan.mjs';
import {makeRc48ImageRollbackPlanDraft} from './rollback-plan.mjs';
import {readImageRollbackContext} from './rollback-context.mjs';
import {isImageRollback} from './plan-mode.mjs';
export {IMAGE_DRIVER_INPUTS} from './local-source.mjs';
const modes=new Set(['plan','plan-rollback','inspect','verify','backup','patch-api','patch-web','observe-backup','observe-api','observe-web']);
export function parseImageOnlyArguments(args){
  const mode=args[0];assert(modes.has(mode),'EXPLICIT_IMAGE_MODE_REQUIRED');const options={};
  for(let i=1;i<args.length;i+=2){const key=args[i];assert(['--rollback-context','--objective-id','--dossier','--plan','--candidate','--baseline','--preparation','--jira-evidence','--journal-dir','--output-dir'].includes(key));assert(!Object.hasOwn(options,key));assert.equal(typeof args[i+1],'string');assert(args[i+1].length>0);options[key]=args[i+1];}
  const planning=mode==='plan'||mode==='plan-rollback';
  const required=planning?['--candidate','--baseline','--output-dir']:['--objective-id','--dossier','--plan','--candidate','--baseline','--preparation','--jira-evidence','--journal-dir','--output-dir'];
  if(mode==='plan-rollback'){required.push('--rollback-context');}
  for(const key of required){assert(options[key],key+'_REQUIRED');}
  if(planning){assert(Object.keys(options).every(k=>required.includes(k)),'PLAN_IS_PURE_ONLY');}
  return {mode,options};
}
function save(dir,name,value){assert(/^(?:PREPARED-PLAN|BACKUP-native-FIN|API_IMAGE-native-FIN|WEB_IMAGE-native-FIN)$/u.test(name));const file=path.join(dir,name+'.json'),bytes=Buffer.from(JSON.stringify(value,null,2)+'\n'),fd=fs.openSync(file,'wx',0o600);try{let offset=0;while(offset<bytes.length){const count=fs.writeSync(fd,bytes,offset,bytes.length-offset);assert(count>0);offset+=count;}fs.fsyncSync(fd);}finally{fs.closeSync(fd);}return {path:file,sha256:createHash('sha256').update(fs.readFileSync(file)).digest('hex')};}
export async function runImageOnlyOperationalDriver(args){
  assert.equal(process.versions.node,'22.23.3');assert(!process.env.NODE_OPTIONS&&!process.env.NODE_PATH);
  const {mode,options}=parseImageOnlyArguments(args),read=p=>JSON.parse(readPoolPrivateFile(p)),candidate=read(options['--candidate']),baseline=read(options['--baseline']),output=imageExternalDirectory(options['--output-dir']);
  const loadRollback=()=>options['--rollback-context']?readImageRollbackContext(read(options['--rollback-context']),candidate,readPoolPrivateFile):undefined;
  const rollbackContext=loadRollback();
  if(mode==='plan'||mode==='plan-rollback'){
    let plan;
    if(mode==='plan-rollback'){plan=makeRc48ImageRollbackPlanDraft({...rollbackContext,candidate,currentBaseline:baseline},Date.now());}
    else{plan=makeRc48ServiceImagePlanDraft(candidate,baseline,Date.now());}
    const receipt=save(output,'PREPARED-PLAN',plan);return {state:'UNQUALIFIED_PURE_PLAN_ONLY',...receipt,executionAuthorized:false};
  }
  const source=readImageLocalSource(),dossier=read(options['--dossier']),plan=read(options['--plan']),jiraBytes=readPoolPrivateFile(options['--jira-evidence'],65536),preparationBytes=readPoolPrivateFile(options['--preparation']);
  if(isImageRollback(plan)){
    assert(rollbackContext);assert.notEqual(options['--objective-id'],rollbackContext.forwardObjectiveId);
  }else{assert.equal(rollbackContext,undefined);}
  const directory=imageExternalDirectory(options['--journal-dir']),github=createReadOnlyGithubReader();let authority;
  if(rollbackContext){assert.notEqual(directory,rollbackContext.originalJournalDirectory,'FORWARD_JOURNAL_MUST_REMAIN_IMMUTABLE');}
  async function authorizeFresh(action){assert.deepEqual(loadRollback(),rollbackContext,'FORWARD_ROLLBACK_CONTEXT_CHANGED');assert.deepEqual(readImageLocalSource(),source,'IMAGE_DRIVER_SOURCE_CHANGED');authority=await authorizeImageOnlyDriver({github,objectiveId:options['--objective-id'],dossier,plan,candidate,baseline,rollbackContext,localSource:source,jiraBytes,action});assert.equal(authority.entry.journalDirectorySha256,createHash('sha256').update(directory).digest('hex'));assert.deepEqual(readImageLocalSource(),source,'IMAGE_DRIVER_SOURCE_CHANGED');return authority;}
  const qualifyPreparation=(a,now)=>validateImagePreparation({bytes:preparationBytes,entry:a.entry,dossier,readEvidence:readPoolPrivateFile,now});
  const accessToken=createOfficialAccessToken({account:'casablancaynovcampus@gmail.com',gcloudPath:'C:/Program Files (x86)/Google/Cloud SDK/google-cloud-sdk/lib/gcloud.py',pythonPath:'C:/Program Files (x86)/Google/Cloud SDK/google-cloud-sdk/platform/bundledpython/python.exe'});
  const transport=createImageOnlyTransport({plan,accessToken,getAuthority:()=>authority});
  const executor=createImageOnlyExecutor({plan,candidate,baseline,rollbackContext,source,dossier,objectiveId:options['--objective-id'],journalDirectory:directory,transport,authorizeFresh,qualifyPreparation,saveReceipt:async(stage,receipt)=>save(output,stage+'-native-FIN',receipt)});
  if(mode==='inspect'){return {state:'LOCAL_JOURNAL_ONLY',stages:Object.fromEntries(['BACKUP','API_IMAGE','WEB_IMAGE'].map(s=>[s,executor.inspect(s).state])),nativeRequestMade:false};}
  if(mode==='verify'){const a=await authorizeFresh('READ_METADATA');qualifyPreparation(a,Date.now());return {state:'IMAGE_AUTHORITY_AND_PINNED_PREPARATION_VERIFIED',nativeRequestMade:false,productionRuntimeChanged:false};}
  const stageByMode={'backup':'BACKUP','patch-api':'API_IMAGE','patch-web':'WEB_IMAGE','observe-backup':'BACKUP','observe-api':'API_IMAGE','observe-web':'WEB_IMAGE'},stage=stageByMode[mode];return mode.startsWith('observe-')?executor.observe(stage):executor.dispatch(stage);
}
