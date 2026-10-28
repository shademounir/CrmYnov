// Durable single-use local transaction receipts. No transport, credentials or native mutation.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

const stages=['BACKUP','API_IMAGE','WEB_IMAGE'];
const shaPattern=/^[a-f0-9]{64}$/u;
function canonical(value){
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  if(value&&typeof value==='object')return '{'+Object.keys(value).toSorted((a,b)=>a.localeCompare(b,'en')).map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
  const result=JSON.stringify(value);assert.notEqual(result,undefined,'JSON_VALUE_REQUIRED');return result;
}
export const imageJournalDigest=value=>createHash('sha256').update(canonical(value)).digest('hex');
function binding(input){
  assert.deepEqual(Object.keys(input).toSorted((a,b)=>a.localeCompare(b,'en')),['objectiveId','objectiveSha256','planSha256','sourceHead','stage']);
  assert.match(input.objectiveId,/^rc48-image-only-[a-z0-9-]{8,80}$/u);
  for(const key of ['objectiveSha256','planSha256'])assert.match(input[key],shaPattern);
  assert.match(input.sourceHead,/^[a-f0-9]{40}$/u);assert(stages.includes(input.stage));return structuredClone(input);
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
  for(let i=0;i<files.length;i++){if(!present[i])continue;const r=load(files[i]);assert.deepEqual(r.payload.binding,expected,'DIFFERENT_OBJECTIVE_CANNOT_REUSE_STAGE');assert.equal(r.payload.previousSha256,previous);assert.equal(r.payload.state,['INTENT_CONSUMED_BEFORE_REQUEST','NATIVE_OPERATION_RECORDED','NATIVE_FIN_OBSERVED'][i]);if(i>0)assert(Date.parse(r.payload.at)>=Date.parse(rows.at(-1).payload.at));previous=r.sha256;rows.push(r);}
  return {state:rows.length===0?'UNUSED':rows.length===1?'INTENT_ONLY_UNKNOWN_DO_NOT_RETRY':rows.length===2?'KNOWN_OPERATION_OBSERVE_ONLY':'FIN_NO_REPLAY',rows,automaticMutationRetryAllowed:false};
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
