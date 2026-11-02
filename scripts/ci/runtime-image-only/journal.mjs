// Durable single-use local transaction receipts. No transport, credentials or native mutation.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

const stages=new Set(['BACKUP','API_IMAGE','WEB_IMAGE']);
const shaPattern=/^[a-f0-9]{64}$/u;
function canonical(value){
  if(Array.isArray(value)){return '['+value.map(canonical).join(',')+']';}
  if(value&&typeof value==='object'){return '{'+Object.keys(value).toSorted((a,b)=>a.localeCompare(b,'en')).map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';}
  const result=JSON.stringify(value);assert.notEqual(result,undefined,'JSON_VALUE_REQUIRED');return result;
}
export const imageJournalDigest=value=>createHash('sha256').update(canonical(value)).digest('hex');
function binding(input){
  assert.deepEqual(Object.keys(input).toSorted((a,b)=>a.localeCompare(b,'en')),['objectiveId','objectiveSha256','planSha256','sourceHead','stage']);
  assert.match(input.objectiveId,/^rc48-image-only-[a-z0-9-]{8,80}$/u);
  for(const key of ['objectiveSha256','planSha256']){assert.match(input[key],shaPattern);}
  assert.match(input.sourceHead,/^[a-f0-9]{40}$/u);assert(stages.has(input.stage));return structuredClone(input);
}
function directory(value){assert.equal(typeof value,'string');assert(path.isAbsolute(value));assert.equal(fs.realpathSync(value),path.resolve(value),'REAL_JOURNAL_DIRECTORY_REQUIRED');assert(fs.statSync(value).isDirectory());return value;}
function recordPath(dir,stage,n){return path.join(directory(dir),stage+'-'+n+'.json');}
function writeExclusive(file,value){
  const bytes=Buffer.from(JSON.stringify(value,null,2)+'\n'),fd=fs.openSync(file,'wx',0o600);
  try{let offset=0;while(offset<bytes.length){const count=fs.writeSync(fd,bytes,offset,bytes.length-offset);assert(count>0,'JOURNAL_WRITE_INCOMPLETE');offset+=count;}fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  return {path:file,sha256:createHash('sha256').update(fs.readFileSync(file)).digest('hex')};
}
function load(file){const r=JSON.parse(fs.readFileSync(file,'utf8'));assert.match(r.sha256,shaPattern);assert.equal(imageJournalDigest(r.payload),r.sha256,'JOURNAL_RECORD_TAMPERED');return r;}
function stamp(input,state,details,previousSha256,now){assert(Number.isSafeInteger(now)&&now>0);return {binding:binding(input),state,at:new Date(now).toISOString(),details,previousSha256};}
function append(dir,input,ordinal,state,details,previous,now){const payload=stamp(input,state,details,previous,now);return writeExclusive(recordPath(dir,input.stage,ordinal),{payload,sha256:imageJournalDigest(payload)});}
export function inspectImageTransaction(dir,input){
  const expected=binding(input),files=[1,2,3].map(n=>recordPath(dir,input.stage,n)),present=files.map(p=>fs.existsSync(p));
  assert(!present[1]||present[0],'ORPHAN_OPERATION');assert(!present[2]||present[1],'ORPHAN_FIN');
  const rows=[];let previous=null;
  for(let i=0;i<files.length;i++){if(!present[i]){continue;}const r=load(files[i]);assert.deepEqual(r.payload.binding,expected,'DIFFERENT_OBJECTIVE_CANNOT_REUSE_STAGE');assert.equal(r.payload.previousSha256,previous);assert.equal(r.payload.state,['INTENT_CONSUMED_BEFORE_REQUEST','NATIVE_OPERATION_RECORDED','NATIVE_FIN_OBSERVED'][i]);if(i>0){assert(Date.parse(r.payload.at)>=Date.parse(rows.at(-1).payload.at));}previous=r.sha256;rows.push(r);}
  return {state:['UNUSED','INTENT_ONLY_UNKNOWN_DO_NOT_RETRY','KNOWN_OPERATION_OBSERVE_ONLY','FIN_NO_REPLAY'][rows.length],rows,automaticMutationRetryAllowed:false};
}
export function consumeImageTransaction(dir,input,requestSha256,now){
  assert.match(requestSha256,shaPattern);assert.equal(inspectImageTransaction(dir,input).state,'UNUSED','TRANSACTION_ALREADY_CONSUMED');
  // The exclusive fsynced INTENT MUST succeed before the caller sends exactly one request.
  return append(dir,input,1,'INTENT_CONSUMED_BEFORE_REQUEST',{requestSha256},null,now);
}
export function recordImageOperation(dir,input,operation,now){
  const current=inspectImageTransaction(dir,input);assert.equal(current.state,'INTENT_ONLY_UNKNOWN_DO_NOT_RETRY');assert.equal(typeof operation,'string');assert(operation.length>0&&operation.length<=512);assert(!/[\r\n?#]/u.test(operation));
  return append(dir,input,2,'NATIVE_OPERATION_RECORDED',{operation},current.rows.at(-1).sha256,now);
}
export function finishImageTransaction(dir,input,operation,nativeReceiptSha256,outcome,now){
  const current=inspectImageTransaction(dir,input);assert.equal(current.state,'KNOWN_OPERATION_OBSERVE_ONLY');assert.equal(operation,current.rows.at(-1).payload.details.operation);assert.match(nativeReceiptSha256,shaPattern);assert(['SUCCEEDED','FAILED'].includes(outcome));
  return append(dir,input,3,'NATIVE_FIN_OBSERVED',{operation,nativeReceiptSha256,outcome},current.rows.at(-1).sha256,now);
}
export {createImageSessionBudget,IMAGE_SESSION_LIMITS_V2} from './journal-budget-v2.mjs';
export const HISTORICAL_GENERAL_PINS_V2=Object.freeze([
 {path:'C:/Crm Ynov/output/casablanca-pilot-20261022/runtime-pre-dossiers-20261028-v1/general/single-use-journal/pool-native-transactions.sqlite',sha256:'6c3816eea737aa035000b42d249e1cc697ddc4e666d3d97c0b5bdf2873f85450'},
 {path:'C:/Crm Ynov/output/casablanca-pilot-20261022/native-runtime-pre-session-20261028-v1/general/RUN-1-JOURNAL-SNAPSHOT.sqlite',sha256:'6c3816eea737aa035000b42d249e1cc697ddc4e666d3d97c0b5bdf2873f85450'},
 {path:'C:/Crm Ynov/output/casablanca-pilot-20261022/general-prospective-pre-native-20261029-v1/prospective-0d48bd85-8b95-f624-e32c-560406e6ddd8-CLAIM.json',sha256:'3ccfd96471f27c0ab8b36f07891e5974ec498cd574bb9d43ebf34a387dc6faa2'}
].map(Object.freeze));
export function inspectImageMutationDomainV2(dir,input,historicalGeneralPins=HISTORICAL_GENERAL_PINS_V2){
  assert.deepEqual(Object.keys(input).toSorted((a,b)=>a.localeCompare(b,'en')),['objectiveId','objectiveSha256','planSha256','sourceHead']);assert.deepEqual(historicalGeneralPins,HISTORICAL_GENERAL_PINS_V2,'HISTORICAL_GENERAL_PINS_MUST_NOT_BE_SUBSTITUTED');
  // Read the sealed raw bytes only; never open SQLite, reset its transaction or
  // interpret a bounded empty history as absence of the original RUN effects.
  const historical=historicalGeneralPins.map(ref=>{const st=fs.lstatSync(ref.path);assert(st.isFile()&&!st.isSymbolicLink()&&st.size<=10485760);assert.equal(createHash('sha256').update(fs.readFileSync(ref.path)).digest('hex'),ref.sha256,'HISTORICAL_GENERAL_BYTES_CHANGED');return{...ref};});
  const {transactions,imageMutationUnresolved}=inspectImageStagesV2(dir,input);
  return Object.freeze({schemaVersion:2,kind:'IMAGE_AND_HISTORICAL_GENERAL_DOMAINS_V2',imageMutationUnresolved,transactions,historicalGeneral:{state:'UNKNOWN_READ_ONLY_RUN_UNCHANGED',pins:historical,absenceOfEffectProven:false,replayAuthorized:false},automaticMutationRetryAllowed:false,nativeAcceptance:false});
}
export function inspectImageStagesV2(dir,input){
  assert.deepEqual(Object.keys(input).toSorted((a,b)=>a.localeCompare(b,'en')),['objectiveId','objectiveSha256','planSha256','sourceHead']);
  const transactions=[...stages].map(stage=>{const observed=inspectImageTransaction(dir,{...input,stage});return{stage,state:observed.state,recordSha256s:observed.rows.map(r=>r.sha256),outcome:observed.rows.at(-1)?.payload.details.outcome??null};});
  const imageMutationUnresolved=transactions.some(t=>['INTENT_ONLY_UNKNOWN_DO_NOT_RETRY','KNOWN_OPERATION_OBSERVE_ONLY'].includes(t.state));
  return{transactions,imageMutationUnresolved,nativeAcceptance:false,automaticMutationRetryAllowed:false};
}

// Additive config-only domain. Historical IMAGE exports and bytes above remain closed.
const readerProfilesV1=Object.freeze({
 API_READER_CONFIG:Object.freeze({scope:'RC48_API_SHEETS_READER_CONFIG_ONLY_V1',prefix:/^rc48-api-sheets-reader-config-[a-z0-9-]{8,64}$/u}),
 API_READER_CONFIG_ROLLBACK:Object.freeze({scope:'RC48_API_SHEETS_READER_CONFIG_ROLLBACK_V1',prefix:/^rc48-api-sheets-reader-rollback-[a-z0-9-]{8,64}$/u})
});
const readerResourceV1='projects/crmynov-prod-n7x4q2/locations/europe-west1/services/crm-prod-api';
function readerExactV1(value,keys){
 assert(value&&Object.getPrototypeOf(value)===Object.prototype,'READER_PLAIN_DATA_REQUIRED');
 const descriptors=Object.getOwnPropertyDescriptors(value);
 assert(Reflect.ownKeys(descriptors).every(key=>typeof key==='string'&&Object.hasOwn(descriptors[key],'value')),'READER_ACCESSOR_REFUSED');
 assert.deepEqual(Object.keys(descriptors).toSorted(codeUnitOrder),keys.toSorted(codeUnitOrder),'READER_EXACT_FIELDS_REQUIRED');
}
function readerBindingV1(input){
 readerExactV1(input,['objectiveId','objectiveSha256','planSha256','sourceHead','sourceTree','scope','stage','resource']);
 assert(Object.hasOwn(readerProfilesV1,input.stage),'READER_STAGE_REFUSED');const profile=readerProfilesV1[input.stage];
 assert.equal(input.scope,profile.scope,'READER_SCOPE_REFUSED');assert.match(input.objectiveId,profile.prefix);
 assert.equal(input.resource,readerResourceV1);for(const key of ['objectiveSha256','planSha256']){assert.match(input[key],shaPattern);}
 for(const key of ['sourceHead','sourceTree']){assert.match(input[key],/^[a-f0-9]{40}$/u);}return structuredClone(input);
}
function readerOperationV1(name){
 assert.equal(typeof name,'string');assert.match(name,/^projects\/crmynov-prod-n7x4q2\/locations\/europe-west1\/operations\/[A-Za-z0-9_-]{1,256}$/u,'READER_EXACT_OPERATION_REQUIRED');return name;
}
function readerAppendV1(dir,input,ordinal,state,details,previousSha256,now){
 assert(Number.isSafeInteger(now)&&now>0);const prior=inspectApiSheetReaderTransactionV1(dir,input);assert.equal(ordinal,prior.rows.length+1);assert.equal(previousSha256,prior.rows.at(-1)?.sha256??null);assert(now>=(prior.rows.length?Date.parse(prior.rows.at(-1).payload.at):1),'READER_APPEND_TIME_REGRESSION');
 const payload={binding:readerBindingV1(input),state,at:new Date(now).toISOString(),details,previousSha256};
 return writeExclusive(recordPath(dir,input.stage,ordinal),{payload,sha256:imageJournalDigest(payload)});
}
export function inspectApiSheetReaderTransactionV1(dir,input){
 const expected=readerBindingV1(input),names=fs.readdirSync(directory(dir));
 assert(names.every(name=>[1,2,3].some(n=>name===input.stage+'-'+n+'.json')),'READER_JOURNAL_DOMAIN_NOT_EMPTY_OR_DISTINCT');
 const files=[1,2,3].map(n=>recordPath(dir,input.stage,n)),present=files.map(file=>fs.existsSync(file));assert(!present[1]||present[0],'READER_ORPHAN_OPERATION');assert(!present[2]||present[1],'READER_ORPHAN_FIN');
 const states=['CONFIG_INTENT_CONSUMED_BEFORE_PATCH','CONFIG_OPERATION_RECORDED','CONFIG_FIN_OBSERVED'],rows=[];let previous=null,lastAt=0;
 for(let index=0;index<files.length;index++){
  if(!present[index]){continue;}const stat=fs.lstatSync(files[index]);assert(stat.isFile()&&!stat.isSymbolicLink()&&stat.size>0&&stat.size<=65536,'READER_REGULAR_BOUNDED_JOURNAL_REQUIRED');
  const row=load(files[index]);readerExactV1(row,['payload','sha256']);readerExactV1(row.payload,['binding','state','at','details','previousSha256']);assert.deepEqual(row.payload.binding,expected,'READER_DIFFERENT_BINDING');
  assert.equal(row.payload.previousSha256,previous);assert.equal(row.payload.state,states[index]);const at=Date.parse(row.payload.at);assert(Number.isSafeInteger(at)&&new Date(at).toISOString()===row.payload.at&&at>=lastAt,'READER_JOURNAL_TIME_INVALID');
  if(index===0){readerExactV1(row.payload.details,['requestSha256']);assert.match(row.payload.details.requestSha256,shaPattern);}
  else if(index===1){readerExactV1(row.payload.details,['operation']);readerOperationV1(row.payload.details.operation);}
  else{readerExactV1(row.payload.details,['operation','receiptSha256','outcome']);assert.equal(row.payload.details.operation,rows[1].payload.details.operation);assert.match(row.payload.details.receiptSha256,shaPattern);assert(['SUCCEEDED','FAILED'].includes(row.payload.details.outcome));}
  previous=row.sha256;lastAt=at;rows.push(row);
 }
 return {state:['UNUSED','INTENT_ONLY_UNKNOWN_DO_NOT_RETRY','KNOWN_OPERATION_OBSERVE_ONLY','FIN_NO_REPLAY'][rows.length],rows,automaticMutationRetryAllowed:false};
}
export function consumeApiSheetReaderTransactionV1(dir,input,requestSha256,now){
 assert.match(requestSha256,shaPattern);assert.equal(inspectApiSheetReaderTransactionV1(dir,input).state,'UNUSED','READER_TRANSACTION_ALREADY_CONSUMED');
 return readerAppendV1(dir,input,1,'CONFIG_INTENT_CONSUMED_BEFORE_PATCH',{requestSha256},null,now);
}
export function recordApiSheetReaderOperationV1(dir,input,operation,now){
 readerOperationV1(operation);const current=inspectApiSheetReaderTransactionV1(dir,input);assert.equal(current.state,'INTENT_ONLY_UNKNOWN_DO_NOT_RETRY','READER_INTENT_REQUIRED');
 return readerAppendV1(dir,input,2,'CONFIG_OPERATION_RECORDED',{operation},current.rows.at(-1).sha256,now);
}
export function finishApiSheetReaderTransactionV1(dir,input,operation,receiptSha256,outcome,now){
 const current=inspectApiSheetReaderTransactionV1(dir,input);assert.equal(current.state,'KNOWN_OPERATION_OBSERVE_ONLY');assert.equal(operation,current.rows[1].payload.details.operation);assert.match(receiptSha256,shaPattern);assert(['SUCCEEDED','FAILED'].includes(outcome));
 return readerAppendV1(dir,input,3,'CONFIG_FIN_OBSERVED',{operation,receiptSha256,outcome},current.rows.at(-1).sha256,now);
}
// Controlled local saver: reuses the historical wx/write-loop/fsync primitive.
// It is not authority or a substitute for actual R4 transport-origin admission.
export function inspectApiSheetReaderProofDirectoryV1(proofDir,input){
 const target=directory(proofDir);
 const expected=readerBindingV1(input),prefix=input.stage+'-PROOF-',names=fs.readdirSync(target).toSorted(codeUnitOrder);
 assert(names.length<200&&names.every((name,index)=>name===prefix+String(index+1).padStart(4,'0')+'.json'),'READER_PROOF_DIRECTORY_REFUSED');
 for(const name of names){const file=path.join(target,name),stat=fs.lstatSync(file);assert(stat.isFile()&&!stat.isSymbolicLink()&&stat.size>0&&stat.size<=1048576);const old=load(file);assert.deepEqual(old.payload.binding,expected);}
 return{directory:target,nextOrdinal:names.length+1,prefix};
}
export function persistApiSheetReaderProofV1(journalDir,proofDir,input,proof,now){
 const current=inspectApiSheetReaderTransactionV1(journalDir,input);assert.equal(current.state,'KNOWN_OPERATION_OBSERVE_ONLY');
 const state=inspectApiSheetReaderProofDirectoryV1(proofDir,input);assert.notEqual(fs.realpathSync(journalDir),fs.realpathSync(state.directory),'READER_PROOF_DIRECTORY_MUST_BE_DISTINCT');
 assert(Number.isSafeInteger(now)&&now>=Date.parse(current.rows.at(-1).payload.at));assert.equal(proof.scope,input.scope);assert.equal(proof.planSha256,input.planSha256);assert.equal(proof.operation,current.rows[1].payload.details.operation);
 const payload={schemaVersion:1,kind:'API_SHEETS_READER_CONFIG_OPERATION_PROOF_V1',binding:readerBindingV1(input),proof,observedAt:new Date(now).toISOString()};
 assert(Buffer.byteLength(JSON.stringify(payload))<=1000000);return writeExclusive(path.join(state.directory,state.prefix+String(state.nextOrdinal).padStart(4,'0')+'.json'),{payload,sha256:imageJournalDigest(payload)});
}

// Match the default UTF-16/code-unit order without locale-dependent hashes.
const codeUnitOrder=(left,right)=>{if(left<right)return -1;if(left>right)return 1;return 0;};
