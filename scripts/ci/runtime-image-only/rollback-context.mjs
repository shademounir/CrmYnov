// Read existing single-use forward records; never creates or repairs a record.
import assert from 'node:assert/strict';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {imageJournalDigest as digest,inspectImageTransaction} from './journal.mjs';
import {imageExternalDirectory} from './local-source.mjs';
import {validateRc48ServiceImagePlanDraft,LOCATION} from './plan.mjs';
import {IMAGE_ROLLBACK_COMPLETION_RULES_SHA256_V2} from './rollback-plan.mjs';

const stages=['BACKUP','API_IMAGE','WEB_IMAGE'],sha=/^[a-f0-9]{64}$/u;
function jsonFile(file,readFile){
  assert.equal(typeof file,'string');assert(path.isAbsolute(file));
  assert(file.endsWith('.json')&&!/private-key|credentials|gcloud|\.private\.json/iu.test(file),'ROLLBACK_SECRET_PATH_REFUSED');
  const bytes=readFile(file);assert(Buffer.isBuffer(bytes)&&bytes.length<=1048576);
  return{bytes,value:JSON.parse(bytes),sha256:createHash('sha256').update(bytes).digest('hex')};
}
function pinnedFile(pin,readFile){
  assert.deepEqual(Object.keys(pin).sort((a,b)=>a.localeCompare(b,'en')),['path','sha256']);assert.match(pin.sha256,sha);
  const file=jsonFile(pin.path,readFile);assert.equal(file.sha256,pin.sha256,'FORWARD_FILE_PIN_CHANGED');return file.value;
}
function operationName(stage,name){
  assert.equal(typeof name,'string');
  if(stage==='BACKUP'){assert.match(name,/^[A-Za-z0-9_-]{1,256}$/u);return;}
  assert(name.startsWith(LOCATION+'/operations/'));assert.match(name.slice((LOCATION+'/operations/').length),/^[A-Za-z0-9_-]{1,256}$/u);
}
function stageEvidence(stage,journal,binding,receipts,readFile){
  const record=inspectImageTransaction(journal,{...binding,stage});
  if(record.state==='UNUSED'){assert.equal(receipts[stage],undefined);return{state:'UNUSED'};}
  assert.equal(record.state,'FIN_NO_REPLAY','FORWARD_UNKNOWN_OR_RUNNING_REFUSED');
  const fin=record.rows.at(-1).payload.details,known=record.rows[1].payload.details.operation;
  operationName(stage,known);const file=jsonFile(receipts[stage],readFile);
  assert.equal(file.sha256,fin.nativeReceiptSha256,'FORWARD_NATIVE_RECEIPT_CHANGED');
  const proof=file.value;assert.equal(proof.stage,stage);assert.equal(proof.operation,known);assert.equal(proof.outcome,fin.outcome);
  assert.match(proof.nativeResponseSha256,sha);
  const row={state:record.state,outcome:proof.outcome,nativeReceiptSha256:file.sha256,operation:known,nativeResponseSha256:proof.nativeResponseSha256};
  if(stage!=='BACKUP'&&proof.outcome==='SUCCEEDED'){assert.equal(proof.served?.nativeMetadataClaimsChecked,true);row.served=proof.served;}
  return row;
}
export function readImageRollbackContext(descriptor,candidate,readFile){
  assert.equal(typeof readFile,'function');assert([1,2].includes(descriptor.schemaVersion),'EXPLICIT_ROLLBACK_DESCRIPTOR_VERSION');const operational=descriptor.schemaVersion===2;
  assert.match(descriptor.forwardObjectiveId,/^rc48-image-only-[a-z0-9-]{8,80}$/u);
  assert.match(descriptor.forwardSourceHead,/^[a-f0-9]{40}$/u);
  assert.deepEqual(Object.keys(descriptor.files).sort((a,b)=>a.localeCompare(b,'en')),operational?['baseline','completionContext','dossier','plan']:['baseline','dossier','plan']);
  assert(Object.keys(descriptor.receipts).every(k=>stages.includes(k)));
  const journal=imageExternalDirectory(descriptor.forwardJournalDirectory);
  const forwardPlan=pinnedFile(descriptor.files.plan,readFile),dossier=pinnedFile(descriptor.files.dossier,readFile),originalBaseline=pinnedFile(descriptor.files.baseline,readFile);
  assert.equal(dossier.id,descriptor.forwardObjectiveId);assert.deepEqual(dossier.candidate,candidate);
  validateRc48ServiceImagePlanDraft(forwardPlan,candidate,originalBaseline,Date.parse(forwardPlan.baselineObservedAt));
  if(operational){assert.equal(forwardPlan.readOnlyPreparationVersion,2,'ROLLBACK_V2_REQUIRES_REVIEWED_COLLECTOR_V2');assert.equal(descriptor.rollbackCompletionRulesSha256,IMAGE_ROLLBACK_COMPLETION_RULES_SHA256_V2);}else{assert.equal(forwardPlan.readOnlyPreparationVersion,undefined,'V2_FORWARD_REQUIRES_EXPLICIT_ROLLBACK_DESCRIPTOR_V2');}
  const binding={objectiveId:descriptor.forwardObjectiveId,objectiveSha256:digest(dossier),planSha256:digest(forwardPlan),sourceHead:descriptor.forwardSourceHead};
  const evidence=Object.fromEntries(stages.map(stage=>[stage,stageEvidence(stage,journal,binding,descriptor.receipts,readFile)]));
  assert.equal(evidence.BACKUP.state,'FIN_NO_REPLAY');assert.equal(evidence.BACKUP.outcome,'SUCCEEDED');
  const completionContext=operational?pinnedFile(descriptor.files.completionContext,readFile):undefined;
  return{...(operational?{schemaVersion:2,completionContext,completionContextSha256:digest(completionContext),completionContextEvidence:structuredClone(descriptor.files.completionContext),rollbackCompletionRulesSha256:IMAGE_ROLLBACK_COMPLETION_RULES_SHA256_V2}:{}),forwardPlan,originalBaseline,forwardObjectiveId:descriptor.forwardObjectiveId,forwardDossierSha256:digest(dossier),originalJournalDirectory:journal,forwardEvidence:{planSha256:binding.planSha256,sourceHead:binding.sourceHead,stages:evidence}};
}
