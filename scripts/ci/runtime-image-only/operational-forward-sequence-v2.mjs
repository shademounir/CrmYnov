// Closed forward order over the existing executor/budget and source-pinned root
// adapter. No SDK acquisition, credentials, arbitrary CLI callbacks or rollback.
import assert from 'node:assert/strict';
import path from 'node:path';
import {IMAGE_PREPARATION_RULES_SHA256_V2} from './late-binding-v2.mjs';
const H=/^[a-f0-9]{64}$/u,S=/^[a-f0-9]{40}$/u;
export const IMAGE_FORWARD_SEQUENCE_RULES_V2=Object.freeze({schemaVersion:2,kind:'RC48_CLOSED_FORWARD_SEQUENCE_RULES_V2',order:['BACKUP','GENERAL_PRE','API_IMAGE','WEB_IMAGE','POST_PRESERVATION'],knownOperationPollIntervalMs:1000,maxKnownOperationObservationsPerStage:200,preFreshnessMs:300000,automaticMutationRetry:false,automaticRollback:false,sharedBudgetAcrossAllPhases:true,postComparisonUsesHistoricalPreCapture:true,sheetsActivation:false});
Object.freeze(IMAGE_FORWARD_SEQUENCE_RULES_V2.order);
const METHODS=['assertLocalState','prepareBackupReady','runGeneral','qualifyFinal','runPost','verifyPost','releasePost','saveReceipt'];
const INPUTS=['objectiveId','planSha256','staticDossierSha256','source','sessionBindingSha256','sdkSession','sharedBudget','executor','adapter'];
const BUDGET_FIELDS=['schemaVersion','kind','bindingSha256','firstNativeAt','deadlineAt','requestsReserved','remainingRequests','totalResponseBytes','remainingResponseBytes','pendingOrdinal','stopped','stopCode','remainingMs','lastRecordSha256'];
const CODES=new Set(['SEQUENCE_INPUTS_REFUSED','LOCAL_SOURCE_OR_LEASE_REFUSED','SDK_SESSION_REFUSED','SHARED_BUDGET_REFUSED','SHARED_BUDGET_EXPIRED','SHARED_BINDING_DRIFT','PREEXISTING_IMAGE_TRANSACTION','BACKUP_READY_REFUSED','BACKUP_DISPATCH_REFUSED','BACKUP_OBSERVATION_REFUSED','GENERAL_ENTRY_REFUSED','GENERAL_RESULT_REFUSED','FINAL_PREPARATION_REFUSED','SQL_PRE_EXPIRED','SQL_PRE_CHANGED','API_DISPATCH_REFUSED','API_OBSERVATION_REFUSED','WEB_DISPATCH_REFUSED','WEB_OBSERVATION_REFUSED','KNOWN_OPERATION_OBSERVATION_LIMIT','IMAGE_FIN_REFUSED','POST_ENTRY_REFUSED','POST_RESULT_REFUSED','POST_VERIFICATION_REFUSED','SEQUENCE_RECEIPT_REFUSED','SEQUENCE_CLEANUP_REFUSED']);
class SequenceRefusal extends Error{constructor(code){assert(CODES.has(code));super(code);Object.defineProperty(this,'code',{value:code});}}
function refuse(code){throw new SequenceRefusal(code);}
function exact(v,keys){assert(v&&Object.getPrototypeOf(v)===Object.prototype);assert(Object.values(Object.getOwnPropertyDescriptors(v)).every(d=>Object.hasOwn(d,'value')));assert.deepEqual(Object.keys(v).sort(),[...keys].sort());}
function time(v){assert.equal(typeof v,'string');assert(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z$/u.test(v));const n=Date.parse(v);assert(Number.isSafeInteger(n));return n;}
function reference(r){exact(r,['path','sha256']);assert(path.isAbsolute(r.path)&&r.path.endsWith('.json')&&!/private-key|credentials|\.private\.json/iu.test(r.path)&&H.test(r.sha256));return structuredClone(r);}
function input(value){exact(value,INPUTS);assert.match(value.objectiveId,/^rc48-image-only-[a-z0-9-]{8,80}$/u);for(const k of ['planSha256','staticDossierSha256','sessionBindingSha256']){assert(H.test(value[k]));}exact(value.source,['commit','tree','inputManifestSha256']);assert(S.test(value.source.commit)&&S.test(value.source.tree)&&H.test(value.source.inputManifestSha256));exact(value.adapter,METHODS);assert(METHODS.every(k=>typeof value.adapter[k]==='function'));exact(value.executor,['inspect','dispatch','observe']);exact(value.sdkSession,['accessToken','close','report']);exact(value.sharedBudget,['inspect','reserveRequest','recordResponse','stop']);for(const v of [value.executor,value.sdkSession,value.sharedBudget]){assert(Object.values(v).every(fn=>typeof fn==='function'));}return value;}
function projection(p,phase,i,now){
  assert(p&&p.schemaVersion===2&&p.preparationPhase===phase);assert.equal(p.generalPendingOnly,phase==='BACKUP_READY');assert.equal(p.planSha256,i.planSha256);assert.equal(p.staticDossierSha256,i.staticDossierSha256);assert.equal(p.preparationRulesSha256,IMAGE_PREPARATION_RULES_SHA256_V2);assert(H.test(p.preparationReceiptSha256));assert(time(p.qualifiedAt)<=now&&now<time(p.expiresAt));
  assert(Array.isArray(p.families));assert.deepEqual(p.families.map(r=>r.family).sort(),['JOB_INVENTORY','LEDGER','PERMISSIONS','POOL','RECOVERABILITY','ROLLBACK']);
  if(phase==='BACKUP_READY'){assert.equal(p.general,null);return null;}
  assert(p.general&&typeof p.general.transactionCompletedAt==='string');return time(p.general.transactionCompletedAt);
}
function operation(value){assert.equal(typeof value,'string');assert(value.length>0&&value.length<=512&&!/[\r\n?#]/u.test(value));return value;}
function inspectKnown(executor,stage,name){const r=executor.inspect(stage);assert.equal(r.state,'KNOWN_OPERATION_OBSERVE_ONLY');assert.equal(r.rows[1]?.payload.details.operation,name);return r;}
function inspectFin(executor,stage,result,name){const r=executor.inspect(stage);assert.equal(r.state,'FIN_NO_REPLAY');const fin=r.rows.at(-1)?.payload.details;assert.equal(fin.operation,name);assert.equal(fin.outcome,result.outcome);assert.equal(fin.nativeReceiptSha256,result.receiptSha256);return r;}
function publicBudget(value){exact(value,BUDGET_FIELDS);assert.equal(value.schemaVersion,2);assert.equal(value.kind,'IMAGE_NATIVE_SESSION_BUDGET_STATE_V2');assert(H.test(value.bindingSha256));for(const k of ['deadlineAt','requestsReserved','remainingRequests','totalResponseBytes','remainingResponseBytes','remainingMs']){assert(Number.isSafeInteger(value[k])&&value[k]>=0);}assert(value.firstNativeAt===null||Number.isSafeInteger(value.firstNativeAt));assert(value.pendingOrdinal===null||Number.isSafeInteger(value.pendingOrdinal));assert.equal(typeof value.stopped,'boolean');assert(value.stopCode===null||/^[A-Z][A-Z0-9_]{0,63}$/u.test(value.stopCode));assert(value.lastRecordSha256===null||H.test(value.lastRecordSha256));return structuredClone(value);}
const realPause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function releaseSequenceResources(resolved,provided,guardCode){
  try{await (resolved?.adapter??provided?.adapter)?.releasePost();}catch{guardCode??='SEQUENCE_CLEANUP_REFUSED';}
  try{await (resolved?.sdkSession??provided?.sdkSession)?.close();}catch{guardCode??='SEQUENCE_CLEANUP_REFUSED';}
  try{const b=resolved?.sharedBudget??provided?.sharedBudget;if(b){const before=publicBudget(b.inspect());if(!before.stopped){b.stop(guardCode?'IMAGE_FORWARD_SEQUENCE_STOP':'IMAGE_FORWARD_SEQUENCE_FIN');}}}catch{guardCode??='SEQUENCE_CLEANUP_REFUSED';}
  return guardCode;
}
function closedResourceReport(resolved,provided,guardCode){
  let sdkClosed=false,budgetState=null;
  try{const sdk=resolved?.sdkSession??provided?.sdkSession;if(sdk){const r=sdk.report();sdkClosed=r.closed===true&&r.tokenReferencesReleased===true;if(!sdkClosed){guardCode??='SEQUENCE_CLEANUP_REFUSED';}}const b=resolved?.sharedBudget??provided?.sharedBudget;budgetState=b?publicBudget(b.inspect()):null;}catch{guardCode??='SEQUENCE_CLEANUP_REFUSED';}
  return{sdkClosed,budgetState,guardCode};
}
async function sequence(value,{clock,pause,synthetic}){
  let i,guardCode=null,stage='INPUTS',lastNow=0,generalResult=null,generalProofRef=null,sqlFin=null,webFin=null,verifiedPost=null,postReceipt=null,terminalReference=null,receiptFailed=false;
  const calls={backupDispatch:0,generalEntry:0,apiDispatch:0,webDispatch:0,postEntry:0,knownOperationObservations:0},references=[];
  function now(){const n=clock();assert(Number.isSafeInteger(n)&&n>=lastNow);lastNow=n;return n;}
  function budget(){try{const b=publicBudget(i.sharedBudget.inspect());if(b.bindingSha256!==i.sessionBindingSha256){refuse('SHARED_BINDING_DRIFT');}if(b.stopped||b.pendingOrdinal!==null){refuse('SHARED_BUDGET_REFUSED');}if(b.remainingMs<=0||b.remainingRequests<=0||b.remainingResponseBytes<=0){refuse('SHARED_BUDGET_EXPIRED');}return b;}catch(error){if(error instanceof SequenceRefusal){throw error;}refuse('SHARED_BUDGET_REFUSED');}}
  async function guard(){stage='LOCAL_REVALIDATION';await i.adapter.assertLocalState();now();budget();const r=i.sdkSession.report();if(!r.authenticationChainValidated||r.closed||r.tokenReferencesReleased){refuse('SDK_SESSION_REFUSED');}}
  async function save(kind,details){try{const r=reference(await i.adapter.saveReceipt(kind,{schemaVersion:2,kind,objectiveId:i.objectiveId,planSha256:i.planSha256,staticDossierSha256:i.staticDossierSha256,source:structuredClone(i.source),sessionBindingSha256:i.sessionBindingSha256,at:new Date(now()).toISOString(),...(synthetic?{syntheticOnly:true,nativeAuthority:false}:{}),...details}));references.push(r);return r;}catch{receiptFailed=true;refuse('SEQUENCE_RECEIPT_REFUSED');}}
  async function qualify(){stage='FINAL_PREPARATION';if(sqlFin!==null&&now()-sqlFin>300000){refuse('SQL_PRE_EXPIRED');}assert.deepEqual(reference(generalResult.sourceProofRef),generalProofRef,'GENERAL_PROOF_REFERENCE_CHANGED');const p=await i.adapter.qualifyFinal(generalResult);const fin=projection(p,'FORWARD_FINAL',i,now());if(sqlFin!==null&&fin!==sqlFin){refuse('SQL_PRE_CHANGED');}const age=now()-fin;if(age<0||age>300000){refuse('SQL_PRE_EXPIRED');}sqlFin=fin;return p;}
  async function observeKnown(imageStage,name,dispatchAt){
    for(let n=0;n<IMAGE_FORWARD_SEQUENCE_RULES_V2.maxKnownOperationObservationsPerStage;n++){
      await guard();stage=imageStage+'_OBSERVE';inspectKnown(i.executor,imageStage,name);calls.knownOperationObservations++;
      const result=await i.executor.observe(imageStage);assert.equal(result.stage,imageStage);assert.equal(result.automaticRetryAllowed,false);
      if(result.state==='FIN_NO_REPLAY'){
        assert(H.test(result.receiptSha256));const nativeReceipt=reference(result.nativeReceipt);assert.equal(nativeReceipt.sha256,result.receiptSha256);inspectFin(i.executor,imageStage,result,name);assert.equal(result.outcome,'SUCCEEDED','FAILED_NATIVE_IMAGE_STAGE_NO_AUTOMATIC_ROLLBACK');
        if(imageStage==='BACKUP'){assert.equal(result.backup?.status,'SUCCESSFUL');assert(time(result.backup.completedAt)<=now());assert.equal(result.backup.nativeReceiptSha256,nativeReceipt.sha256);}
        if(imageStage==='WEB_IMAGE'){const observed=time(result.servedObservedAt);assert(observed>=dispatchAt&&observed<=now(),'WEB_FIN_SERVED_OBSERVATION_REQUIRED');}
        await save('IMAGE-STAGE-OBSERVED-FIN',{stage:imageStage,operation:name,outcome:result.outcome,nativeReceipt,...(imageStage==='WEB_IMAGE'?{servedObservedAt:result.servedObservedAt}:{})});return result;
      }
      assert.equal(result.state,'KNOWN_OPERATION_RUNNING');assert.equal(result.operation,name);inspectKnown(i.executor,imageStage,name);
      const delay=Math.min(IMAGE_FORWARD_SEQUENCE_RULES_V2.knownOperationPollIntervalMs,budget().remainingMs);assert(Number.isSafeInteger(delay)&&delay>0&&delay<60000);await pause(delay);
    }
    refuse('KNOWN_OPERATION_OBSERVATION_LIMIT');
  }
  async function image(imageStage){
    await guard();if(imageStage!=='BACKUP'){await qualify();await guard();if(now()-sqlFin>300000){refuse('SQL_PRE_EXPIRED');}}
    stage=imageStage+'_DISPATCH';assert.equal(i.executor.inspect(imageStage).state,'UNUSED','NO_MUTATION_REPLAY');const key={BACKUP:'backupDispatch',API_IMAGE:'apiDispatch',WEB_IMAGE:'webDispatch'}[imageStage];assert.equal(calls[key],0);calls[key]++;
    const dispatchAt=now(),result=await i.executor.dispatch(imageStage);assert.equal(result.state,'KNOWN_OPERATION_OBSERVE_ONLY');assert.equal(result.stage,imageStage);assert.equal(result.automaticRetryAllowed,false);const name=operation(result.operation);inspectKnown(i.executor,imageStage,name);return observeKnown(imageStage,name,dispatchAt);
  }
  try{
    try{i=input(value);}catch{refuse('SEQUENCE_INPUTS_REFUSED');}
    await guard();for(const s of ['BACKUP','API_IMAGE','WEB_IMAGE']){if(i.executor.inspect(s).state!=='UNUSED'){refuse('PREEXISTING_IMAGE_TRANSACTION');}}
    stage='BACKUP_READY';const ready=await i.adapter.prepareBackupReady();projection(ready,'BACKUP_READY',i,now());await guard();await save('IMAGE-SEQUENCE-START',{order:[...IMAGE_FORWARD_SEQUENCE_RULES_V2.order],entryCallsAttempted:structuredClone(calls)});
    const backupFin=await image('BACKUP');await guard();stage='GENERAL_ENTRY';calls.generalEntry++;generalResult=await i.adapter.runGeneral({backupFin});
    stage='GENERAL_RESULT';assert.equal(generalResult.state,'FRESH_PROSPECTIVE_GENERAL_PRE_OBSERVED');generalProofRef=reference(generalResult.sourceProofRef);assert.equal(generalResult.completionContext?.schemaVersion,2);assert(Array.isArray(generalResult.completionContext.completions));await qualify();await save('IMAGE-GENERAL-PRE-QUALIFIED',{sourceProofRef:generalProofRef,transactionCompletedAt:new Date(sqlFin).toISOString()});
    await image('API_IMAGE');webFin=await image('WEB_IMAGE');await guard();stage='POST_ENTRY';calls.postEntry++;
    // POST compares the retained PRE at its real capture time. The 5-minute PRE
    // deadline controls new PATCHes, not the later historical PRE/POST comparison.
    const afterImageObservedAt=webFin.servedObservedAt,postResult=await i.adapter.runPost({generalResult,webFin,afterImageObservedAt});stage='POST_RESULT';assert.equal(postResult?.state,'FIN_POST_PRESERVATION_OUTPUT_VERIFIED_V2');reference(postResult.sourceProofRef);assert.equal(postResult.completionContext?.schemaVersion,2);assert(Array.isArray(postResult.completionContext.completions));
    stage='POST_VERIFICATION';verifiedPost=await i.adapter.verifyPost({postResult,generalResult,webFin,afterImageObservedAt});assert(verifiedPost&&verifiedPost.schemaVersion===2);assert.equal(verifiedPost.kind,'RC48_IMAGE_POST_SOURCE_CHECKED_V2');assert.equal(verifiedPost.planSha256,i.planSha256);assert.equal(verifiedPost.afterImageObservedAt,afterImageObservedAt);assert.equal(verifiedPost.sqlPreservationClaimsChecked,true);assert.equal(verifiedPost.httpRoleClaimsChecked,true);assert.equal(verifiedPost.sheetsActivated,false);postReceipt=reference(verifiedPost.receipt);await guard();stage='COMPLETE';
  }catch(error){guardCode=error instanceof SequenceRefusal?error.code:stageCode(stage);}
  finally{guardCode=await releaseSequenceResources(i,value,guardCode);}
  const cleanup=closedResourceReport(i,value,guardCode),{sdkClosed,budgetState}=cleanup;guardCode=cleanup.guardCode;
  const state=guardCode?'SEQUENCE_STOPPED_NO_AUTOMATIC_RETRY':synthetic?'SYNTHETIC_SEQUENCE_FIN':'FIN_COMPATIBLE_RUNTIME_OBSERVED_NOT_SHEETS_ACTIVE';
  const result={schemaVersion:2,kind:'RC48_FORWARD_SEQUENCE_RESULT_V2',state,stage,guardCode,entryCallsAttempted:calls,sqlTransactionCompletedAt:sqlFin===null?null:new Date(sqlFin).toISOString(),afterImageObservedAt:webFin?.servedObservedAt??null,postReceipt,sdkClosedAndMemoryTokenReleased:sdkClosed,budgetState,references:[...references],automaticMutationRetry:false,automaticRollback:false,sheetsActivated:false,nativeAcceptance:false,providerOriginAuthenticatedByProtocol:false,...(synthetic?{syntheticOnly:true,nativeAuthority:false}:{})};
  if(i&&!receiptFailed){try{terminalReference=await save(guardCode?'IMAGE-SEQUENCE-STOP':'IMAGE-SEQUENCE-FIN',{state,stage,guardCode,entryCallsAttempted:structuredClone(calls),sqlTransactionCompletedAt:result.sqlTransactionCompletedAt,afterImageObservedAt:result.afterImageObservedAt,postReceipt:result.postReceipt,sdkClosedAndMemoryTokenReleased:sdkClosed,budgetState,automaticMutationRetry:false,automaticRollback:false,sheetsActivated:false,nativeAcceptance:false});}catch{result.state='SEQUENCE_STOPPED_NO_AUTOMATIC_RETRY';result.guardCode='SEQUENCE_RECEIPT_REFUSED';}}
  return{...result,terminalReference};
}
function stageCode(stage){
  const map={INPUTS:'SEQUENCE_INPUTS_REFUSED',LOCAL_REVALIDATION:'LOCAL_SOURCE_OR_LEASE_REFUSED',BACKUP_READY:'BACKUP_READY_REFUSED',BACKUP_DISPATCH:'BACKUP_DISPATCH_REFUSED',BACKUP_OBSERVE:'BACKUP_OBSERVATION_REFUSED',GENERAL_ENTRY:'GENERAL_ENTRY_REFUSED',GENERAL_RESULT:'GENERAL_RESULT_REFUSED',FINAL_PREPARATION:'FINAL_PREPARATION_REFUSED',API_IMAGE_DISPATCH:'API_DISPATCH_REFUSED',API_IMAGE_OBSERVE:'API_OBSERVATION_REFUSED',WEB_IMAGE_DISPATCH:'WEB_DISPATCH_REFUSED',WEB_IMAGE_OBSERVE:'WEB_OBSERVATION_REFUSED',POST_ENTRY:'POST_ENTRY_REFUSED',POST_RESULT:'POST_RESULT_REFUSED',POST_VERIFICATION:'POST_VERIFICATION_REFUSED'};return map[stage]??'SEQUENCE_INPUTS_REFUSED';
}
// The real CLI must construct this adapter from its fixed protected imports;
// no JSON/CLI option may supply a callback, clock, pause or alternate endpoint.
export function runImageForwardSequenceV2(value){return sequence(value,{clock:Date.now,pause:realPause,synthetic:false});}
export function simulateImageForwardSequenceV2({syntheticOnly,input:fakeInput,clock,pause}){assert.equal(syntheticOnly,true);assert.equal(typeof clock,'function');assert.equal(typeof pause,'function');return sequence(fakeInput,{clock,pause,synthetic:true});}
