// OFFLINE only. No native client, credential source, job dispatch or operational journal handle.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {digest} from './controlled-pool-contract-v1.mjs';
import {validateLocalReadOnlyDossier} from './pool-job-dossier-v1.mjs';
import {assessRecoveredGeneralRunCandidate} from './general-unknown-candidate-assessment-v2.mjs';

const hashPattern=/^[a-f0-9]{64}$/u;
const optionsAllowed=Object.freeze(['--snapshot','--snapshot-sha256','--dossier','--dossier-sha256','--receipt','--recovered','--recovered-sha256']);
const operationalNames=new Set(['pool-native-transactions.sqlite','single-use-journal']);
const fail=code=>{throw new Error('GENERAL_OFFLINE_'+code);};
const demand=(value,code)=>{if(!value)fail(code);};
const hashBytes=bytes=>createHash('sha256').update(bytes).digest('hex');
const jsonBytes=bytes=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
const knownAssessorRefusals=new Set([
  'GENERAL_PREPARATION_PLAIN_INPUT','GENERAL_PREPARATION_NO_EXECUTION_CAPABILITIES','GENERAL_PREPARATION_INPUT_BOUND',
  'GENERAL_PREPARATION_GENERAL_PURPOSE_ONLY','GENERAL_PREPARATION_SNAPSHOT_HASH','GENERAL_PREPARATION_EXACT_UNKNOWN_CHAIN_REQUIRED',
  'GENERAL_PREPARATION_EVENT_SHAPE','GENERAL_PREPARATION_EVENT_DIGEST','GENERAL_PREPARATION_EVENT_OBJECTIVE','GENERAL_PREPARATION_NO_RETRY',
  'GENERAL_PREPARATION_INTENT_UID','GENERAL_PREPARATION_CREATE_OPERATION','GENERAL_PREPARATION_CREATE_RECEIPT_DIGESTS',
  'GENERAL_PREPARATION_INTENT_ETAG','GENERAL_PREPARATION_UNKNOWN_MUST_REMAIN_UNKNOWN','GENERAL_PREPARATION_UTC_TIME_REQUIRED',
  'GENERAL_PREPARATION_CREATE_BEFORE_RUN','GENERAL_PREPARATION_RECOVERED_METADATA_REQUIRED','GENERAL_PREPARATION_RECOVERED_OPERATION_REQUIRED',
  'GENERAL_PREPARATION_NOT_CREATE_OPERATION','GENERAL_PREPARATION_SUCCESSFUL_OPERATION_REQUIRED','GENERAL_PREPARATION_POSITIVE_NATIVE_FACTS_REQUIRED',
  'GENERAL_PREPARATION_RECOVERED_JOB_UID','GENERAL_PREPARATION_EXECUTION_UID','GENERAL_PREPARATION_OPERATION_EXECUTION_BINDING',
  'GENERAL_PREPARATION_OPERATION_METADATA_BINDING','GENERAL_PREPARATION_EXECUTION_AFTER_RUN_INTENT','GENERAL_PREPARATION_OBSERVATION_AFTER_COMPLETION',
]);

export function parseGeneralUnknownPreparationArguments(args){
  demand(Array.isArray(args)&&args.length>=10&&args.length<=14&&args.length%2===0,'ARGUMENTS');
  const options={};
  for(let index=0;index<args.length;index+=2){
    const key=args[index],value=args[index+1];
    demand(optionsAllowed.includes(key)&&!Object.hasOwn(options,key),'OPTION_NOT_ALLOWED_OR_DUPLICATE');
    demand(typeof value==='string'&&value.length>0&&value.length<=4096&&!/[\0\r\n]/u.test(value),'OPTION_VALUE');
    options[key]=value;
  }
  for(const key of optionsAllowed.slice(0,5))demand(Object.hasOwn(options,key),'REQUIRED_OPTION');
  demand(Object.hasOwn(options,'--recovered')===Object.hasOwn(options,'--recovered-sha256'),'RECOVERED_PAIR');
  for(const key of ['--snapshot-sha256','--dossier-sha256'])demand(hashPattern.test(options[key]),'INPUT_SHA256');
  if(options['--recovered-sha256'])demand(hashPattern.test(options['--recovered-sha256']),'INPUT_SHA256');
  return Object.freeze(options);
}

function canonicalPath(value,{file=true,output=false}={}){
  demand(typeof value==='string'&&path.isAbsolute(value),'ABSOLUTE_PATH_REQUIRED');
  const resolved=path.resolve(value),parent=path.dirname(resolved);
  let current=file?parent:resolved;
  while(true){
    demand(!fs.lstatSync(current).isSymbolicLink(),'REPARSE_PATH_REFUSED');
    const next=path.dirname(current);
    if(next===current){
      break;
    }
    current=next;
  }
  const parts=resolved.split(/[\\/]/u).map(part=>part.toLowerCase());
  demand(!parts.some(part=>operationalNames.has(part)),'OPERATIONAL_JOURNAL_REFUSED');
  const realParent=fs.realpathSync(parent);
  demand(realParent===parent,'NONCANONICAL_PATH');
  if(output){
    demand(!fs.existsSync(resolved),'RECEIPT_ALREADY_EXISTS');
    return resolved;
  }
  demand(!fs.lstatSync(resolved).isSymbolicLink()&&fs.realpathSync(resolved)===resolved,'REPARSE_PATH_REFUSED');
  const stat=fs.statSync(resolved);
  demand(stat.isFile()&&stat.nlink===1,'ORDINARY_SINGLE_LINK_FILE_REQUIRED');
  return resolved;
}

function pinnedFile(value,expectedSha256,maximum){
  const file=canonicalPath(value),fd=fs.openSync(file,'r');
  let bytes;
  try{const stat=fs.fstatSync(fd);demand(stat.isFile()&&stat.size>0&&stat.size<=maximum,'INPUT_BOUND');bytes=fs.readFileSync(fd);}
  finally{fs.closeSync(fd);}
  demand(bytes.length>0&&bytes.length<=maximum,'INPUT_BOUND');
  demand(hashBytes(bytes)===expectedSha256,'INPUT_SHA256_MISMATCH');
  return {path:file,sha256:expectedSha256,bytes};
}

function noSnapshotSidecars(file){
  for(const suffix of ['-wal','-shm','-journal'])demand(!fs.existsSync(file+suffix),'SNAPSHOT_SIDECAR_REFUSED');
}

function readSnapshotEvents(input){
  noSnapshotSidecars(input.path);
  const db=new DatabaseSync(input.path,{readOnly:true});
  try{
    demand(db.prepare('PRAGMA application_id').get().application_id===1129467989,'SNAPSHOT_APPLICATION');
    demand(db.prepare('PRAGMA user_version').get().user_version===1,'SNAPSHOT_VERSION');
    demand(db.prepare('PRAGMA integrity_check(1)').get().integrity_check==='ok','SNAPSHOT_INTEGRITY');
    const schema=db.prepare("SELECT name,type FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY name LIMIT 3").all();
    demand(schema.length===1&&schema[0].name==='events'&&schema[0].type==='table','SNAPSHOT_SCHEMA');
    const columns=db.prepare('PRAGMA table_info(events)').all().map(column=>column.name);
    assert.deepEqual(columns,['stage','ordinal','state','payload','sha'],'GENERAL_OFFLINE_SNAPSHOT_COLUMNS');
    demand(db.prepare('SELECT count(*) AS n FROM events').get().n===5,'EXACT_UNKNOWN_CHAIN_REQUIRED');
    const rows=db.prepare("SELECT stage,ordinal,state,payload,sha FROM events ORDER BY CASE stage WHEN 'CREATE' THEN 0 WHEN 'RUN' THEN 1 ELSE 2 END,ordinal LIMIT 6").all();
    return rows.map(row=>{
      demand(typeof row.payload==='string'&&Buffer.byteLength(row.payload)<=65536,'EVENT_BOUND');
      const payload=JSON.parse(row.payload);demand(payload.state===row.state,'EVENT_STATE_BINDING');
      return {stage:row.stage,ordinal:row.ordinal,payload,sha:row.sha};
    });
  }finally{db.close();}
}

function verifyOriginalChain(input){
  let refusal;
  try{assessRecoveredGeneralRunCandidate({...input,recovered:undefined});}catch(error){refusal=error;}
  // Reuse every original chain/UID/digest/objective validator before the known
  // absent-candidate boundary; never supply fabricated native metadata.
  if(refusal?.message!=='GENERAL_PREPARATION_RECOVERED_METADATA_REQUIRED')throw refusal??new Error('GENERAL_OFFLINE_CHAIN_BOUNDARY_NOT_REACHED');
}

function assessCandidate(input,candidate){
  if(!candidate)return {status:'UNKNOWN_UNATTRIBUTED_NO_CANDIDATE',reason:'RECOVERED_METADATA_NOT_AVAILABLE',assessment:null};
  try{return {status:'METADATA_COHERENT_NOT_ATTRIBUTED',reason:null,assessment:assessRecoveredGeneralRunCandidate({...input,recovered:jsonBytes(candidate.bytes)})};}
  catch(error){return {status:'RECOVERED_CANDIDATE_REFUSED',reason:knownAssessorRefusals.has(error.message)?error.message:'RECOVERED_METADATA_VALIDATOR_REFUSED',assessment:null};}
}

function verifyInputsUnchanged(inputs){
  for(const input of inputs){const current=pinnedFile(input.path,input.sha256,1048576);demand(current.bytes.equals(input.bytes),'INPUT_CHANGED_AFTER_READING');}
}

function writeReceipt(file,receipt){
  canonicalPath(file,{output:true});
  const fd=fs.openSync(file,'wx',0o600);
  try{fs.writeFileSync(fd,JSON.stringify(receipt,null,2)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
}

export async function runGeneralUnknownPreparation(args){
  const options=parseGeneralUnknownPreparationArguments(args),receiptPath=canonicalPath(options['--receipt'],{output:true});
  const snapshot=pinnedFile(options['--snapshot'],options['--snapshot-sha256'],1048576);
  const dossierFile=pinnedFile(options['--dossier'],options['--dossier-sha256'],1048576);
  const dossier=jsonBytes(dossierFile.bytes);
  validateLocalReadOnlyDossier(dossier,relative=>fs.readFileSync(new URL(relative,import.meta.url)));
  demand(dossier.objective.purpose==='GENERAL_PRESERVATION_READ_ONLY_V1','GENERAL_PURPOSE_ONLY');
  const events=readSnapshotEvents(snapshot),input={objective:dossier.objective,journalSnapshotSha256:snapshot.sha256,events};
  verifyOriginalChain(input);
  const candidate=options['--recovered']?pinnedFile(options['--recovered'],options['--recovered-sha256'],262144):null;
  const result=assessCandidate(input,candidate),inputs=[snapshot,dossierFile,...(candidate?[candidate]:[])];
  verifyInputsUnchanged(inputs);noSnapshotSidecars(snapshot.path);
  const receipt={schemaVersion:1,kind:'GENERAL_UNKNOWN_OFFLINE_RECONCILIATION_PREPARATION_ONLY',scope:'OFFLINE_PREPARATION_ONLY',
    assessedAt:new Date().toISOString(),offlineAdapterExecuted:true,status:result.status,reason:result.reason,
    objectiveSha256:dossier.objective.objectiveSha256,sourceSha256:dossier.objective.sourceSha256,job:dossier.objective.jobName,
    jobUid:events[3].payload.uid,runIntentAt:events[3].payload.at,knownCreateOperation:events[2].payload.operation,
    journalSnapshotSha256:snapshot.sha256,eventChainSha256:digest(events.map(event=>event.sha)),dossierSha256:dossierFile.sha256,
    examinedEvidence:inputs.map((value,index)=>({kind:['IMMUTABLE_UNKNOWN_SNAPSHOT','SOURCE_BOUND_DOSSIER','RECOVERED_METADATA'][index],sha256:value.sha256})),
    assessment:result.assessment,snapshotReadOnlyOpened:true,snapshotBeforeAfterSha256Verified:true,originalRunState:'UNKNOWN',
    originalUnknownPreserved:true,operationalJournalOpened:false,journalWrites:0,nativeCalls:0,canRetry:false,
    sourceOrNativeOriginAuthenticated:false,originalRequestAttributionProved:false,journalReconciliationImplemented:false,
    outputVerified:false,nativeAcceptance:false,nativeExecutionAuthorized:false,activationAuthorized:false,
    historicalOutputNotFreshPre:true,historicalConclusion:'UNKNOWN_UNATTRIBUTED',currentPreConclusion:'NOT_ACQUIRED',
    futureProtectedSourceAndSpecificAuthorityRequired:true};
  writeReceipt(receiptPath,receipt);
  return {schemaVersion:1,state:receipt.status,commandCompleted:true,operationOutcome:'INDETERMINATE',diagnosticAvailable:true,
    resumeAuthorized:false,canRetry:false,nativeAcceptance:false,activationAuthorized:false,sheetsActivated:false,
    receiptPath,receiptSha256:hashBytes(fs.readFileSync(receiptPath)),receiptCanonicalSha256:digest(receipt),
    historicalConclusion:'UNKNOWN_UNATTRIBUTED',currentPreConclusion:'NOT_ACQUIRED'};
}
