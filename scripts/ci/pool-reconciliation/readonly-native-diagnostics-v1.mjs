// Diagnostic data is a strict projection, never an exception/body/header dump.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

export const NATIVE_OPERATION_PATTERN = /^projects\/crmynov-prod-n7x4q2\/locations\/europe-west1\/operations\/[A-Za-z0-9_-]+$/u;
export const DIAGNOSTIC_FIELDS = Object.freeze(['schemaVersion','kind','correlationId','objectiveId','objectiveSha256','stage','phase','startedAt','endedAt','durationMs','reason','httpStatus','networkCode','googleCode','transportInvoked','operationAcceptance','operationReference','diagnosticPersisted','diagnosticPersistenceFailed','canRetry']);
const phases = new Set(['VALIDATION','AUTHORITY','TOKEN','HTTP','READ','DECODE','OPERATION_VALIDATION','JOURNAL_PERSISTENCE']);
const reasons = new Set(['VALIDATION_REFUSED','AUTHORITY_REFUSED','TOKEN_ACQUISITION_FAILED','TOKEN_INVALID','HTTP_EXCHANGE_FAILED','HTTP_ERROR','RESPONSE_REDIRECTED','RESPONSE_CONTENT_TYPE','RESPONSE_BODY_MISSING','RESPONSE_READ_FAILED','RESPONSE_TOO_LARGE','RESPONSE_DECODE_FAILED','RESPONSE_JSON_INVALID','RESPONSE_SHAPE_INVALID','DEADLINE_EXCEEDED','OPERATION_NAME_ABSENT','OPERATION_NAME_INVALID','OPERATION_REFERENCE_PERSISTENCE_FAILED','DISPATCH_FAILED','DIAGNOSTIC_PERSISTENCE_FAILED']);
const networkCodes = new Set(['ECONNRESET','ECONNREFUSED','ENOTFOUND','EAI_AGAIN','ETIMEDOUT','ABORT_ERR','UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT','UND_ERR_BODY_TIMEOUT','UND_ERR_SOCKET']);
const googleCodes = new Set(['OK','CANCELLED','UNKNOWN','INVALID_ARGUMENT','DEADLINE_EXCEEDED','NOT_FOUND','ALREADY_EXISTS','PERMISSION_DENIED','RESOURCE_EXHAUSTED','FAILED_PRECONDITION','ABORTED','OUT_OF_RANGE','UNIMPLEMENTED','INTERNAL','UNAVAILABLE','DATA_LOSS','UNAUTHENTICATED']);
const stages = new Set(['CREATE','RUN','VERIFY','OBSERVE_CREATE','OBSERVE_RUN','READ_OUTPUT']);
const ownData = (object,key) => {
  if (!object || typeof object !== 'object') return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(object,key);
  return descriptor && Object.hasOwn(descriptor,'value') ? descriptor.value : undefined;
};
export function permittedNetworkCode(error) {
  const direct = ownData(error,'code');
  const nested = ownData(ownData(error,'cause'),'code');
  if (networkCodes.has(direct)) return direct;
  if (networkCodes.has(nested)) return nested;
  return null;
}
export function permittedGoogleCode(body) {
  const error = ownData(body,'error');
  const code = ownData(error,'status');
  return googleCodes.has(code) ? code : null;
}
export function diagnosticContext(input = {}) {
  const correlationId = input.correlationId ?? randomUUID();
  assert(/^[a-f0-9-]{16,64}$/u.test(correlationId),'DIAGNOSTIC_CORRELATION_INVALID');
  const objectiveId = input.objectiveId ?? null;
  const objectiveSha256 = input.objectiveSha256 ?? null;
  assert(objectiveId === null || /^[a-z0-9][a-z0-9-]{1,100}$/u.test(objectiveId),'DIAGNOSTIC_OBJECTIVE_ID_INVALID');
  assert(objectiveSha256 === null || /^[a-f0-9]{64}$/u.test(objectiveSha256),'DIAGNOSTIC_OBJECTIVE_HASH_INVALID');
  assert(stages.has(input.stage),'DIAGNOSTIC_STAGE_INVALID');
  return Object.freeze({correlationId,objectiveId,objectiveSha256,stage:input.stage});
}
export function sanitizedDiagnostic(context, observed) {
  const c = diagnosticContext(context);
  assert(phases.has(observed.phase) && reasons.has(observed.reason),'DIAGNOSTIC_ENUM_INVALID');
  assert(Number.isSafeInteger(observed.startedMs) && Number.isSafeInteger(observed.endedMs) && observed.endedMs >= observed.startedMs,'DIAGNOSTIC_CLOCK_INVALID');
  const httpStatus = Number.isInteger(observed.httpStatus) && observed.httpStatus >= 100 && observed.httpStatus <= 599 ? observed.httpStatus : null;
  const operationReference = NATIVE_OPERATION_PATTERN.test(observed.operationReference ?? '') ? observed.operationReference : null;
  let transportInvoked = null;
  if (observed.transportInvoked === true) transportInvoked = true;
  else if (observed.transportInvoked === false) transportInvoked = false;
  return Object.freeze({schemaVersion:1,kind:'EXPURGATED_READONLY_NATIVE_DIAGNOSTIC',...c,phase:observed.phase,
    startedAt:new Date(observed.startedMs).toISOString(),endedAt:new Date(observed.endedMs).toISOString(),durationMs:observed.endedMs-observed.startedMs,
    reason:observed.reason,httpStatus,networkCode:networkCodes.has(observed.networkCode)?observed.networkCode:null,
    googleCode:googleCodes.has(observed.googleCode)?observed.googleCode:null,transportInvoked,
    operationAcceptance:operationReference?'ACKNOWLEDGED_OPERATION_REFERENCE':'NOT_ESTABLISHED',operationReference,
    diagnosticPersisted:observed.diagnosticPersisted===true,diagnosticPersistenceFailed:observed.diagnosticPersistenceFailed===true,canRetry:false});
}
// Apply the projection again at every outward boundary, including forged
// instances. Only own data properties are read; accessors are never invoked.
export function projectDiagnostic(value) {
  if (!value || typeof value !== 'object') return null;
  try {
    const get=key=>ownData(value,key);
    assert(get('schemaVersion')===1&&get('kind')==='EXPURGATED_READONLY_NATIVE_DIAGNOSTIC'&&typeof get('correlationId')==='string');
    return sanitizedDiagnostic({correlationId:get('correlationId'),objectiveId:get('objectiveId'),objectiveSha256:get('objectiveSha256'),stage:get('stage')},
      {phase:get('phase'),reason:get('reason'),startedMs:Date.parse(get('startedAt')),endedMs:Date.parse(get('endedAt')),
        httpStatus:get('httpStatus'),networkCode:get('networkCode'),googleCode:get('googleCode'),transportInvoked:get('transportInvoked'),
        operationReference:get('operationReference'),diagnosticPersisted:get('diagnosticPersisted'),diagnosticPersistenceFailed:get('diagnosticPersistenceFailed')});
  } catch { return null; }
}
export class ReadOnlyNativeDiagnosticError extends Error {
  constructor(diagnostic) {
    const projected=projectDiagnostic(diagnostic);
    assert(projected,'DIAGNOSTIC_RECORD_INVALID');
    super('READONLY_NATIVE_'+projected.reason);
    this.name='ReadOnlyNativeDiagnosticError';
    Object.defineProperty(this,'diagnostic',{value:projected,enumerable:true,writable:false,configurable:false});
  }
}
export function diagnosticOf(error) {
  return error instanceof ReadOnlyNativeDiagnosticError ? projectDiagnostic(ownData(error,'diagnostic')) : null;
}
// This wraps the real driver authority callback; it does not replace or grant
// authority. A refused authority never reaches native token/HTTP construction.
export function withDiagnosticAuthority(authorize,{diagnostic,saveDiagnostic,clock=Date.now}) {
  return withDiagnosticPhase(authorize,{diagnostic,saveDiagnostic,clock,phase:'AUTHORITY',reason:'AUTHORITY_REFUSED'});
}
export function withDiagnosticPhase(authorize,{diagnostic,saveDiagnostic,clock=Date.now,phase,reason}) {
  assert.equal(typeof authorize,'function');const context=diagnosticContext(diagnostic);
  return async(...args)=>{
    const startedMs=clock();
    try{return await authorize(...args);}
    catch(error){
      const existing=diagnosticOf(error);if(existing)throw new ReadOnlyNativeDiagnosticError(existing);
      let record=sanitizedDiagnostic(context,{phase,reason,startedMs,endedMs:clock(),transportInvoked:false});
      if(saveDiagnostic){
        try{await saveDiagnostic(record);record=projectDiagnostic({...record,diagnosticPersisted:true});}
        catch{record=projectDiagnostic({...record,diagnosticPersistenceFailed:true});}
      }
      throw new ReadOnlyNativeDiagnosticError(record);
    }
  };
}
export function commandResult(result) {
  assert(result&&Object.getPrototypeOf(result)===Object.prototype,'COMMAND_RESULT_DATA_REQUIRED');
  assert(Object.values(Object.getOwnPropertyDescriptors(result)).every(item=>Object.hasOwn(item,'value')),'COMMAND_RESULT_ACCESSORS_REFUSED');
  const outcomes={RECONCILED:'SUCCEEDED',FAILED:'FAILED',REFUSED:'REFUSED',UNKNOWN:'INDETERMINATE',OPERATION:'ACKNOWLEDGED_PENDING',PENDING:'ACKNOWLEDGED_PENDING'};
  const operationOutcome=outcomes[result.state]??'NOT_DISPATCHED';
  const diagnostic=projectDiagnostic(ownData(result,'diagnostic'));
  const allowed=['schemaVersion','state','status','kind','code','job','objectiveSha256','operation','responseSha256','correlationId','uid','execution','metadataSha256','proofSha256','knownOperationReference','operationReferencePersistence','journalOutcomePersistence','receiptPath','receiptSha256','assessmentStatus','originalRunState','originalUnknownPreserved','sourceBoundClaimsChecked','officialReadPathExecuted','outputAccepted','nativeExecutionAuthorized'];
  const projected={};
  for(const key of allowed){
    const value=ownData(result,key);if(value===undefined)continue;
    assert(['string','number','boolean'].includes(typeof value)&&(!Number.isNaN(value)),'COMMAND_RESULT_PRIMITIVES_ONLY');
    if(typeof value==='string')assert(value.length<=4096&&!/[\u0000-\u001f]/u.test(value),'COMMAND_RESULT_VALUE_BOUND');
    projected[key]=value;
  }
  const hasReference=[projected.operation,projected.knownOperationReference,diagnostic?.operationReference].some(value=>NATIVE_OPERATION_PATTERN.test(value??''));
  const requestAcceptance=hasReference?'ACKNOWLEDGED_OPERATION_REFERENCE':'NOT_ESTABLISHED';
  const transportInvoked=diagnostic?.transportInvoked??(hasReference?true:null);
  return {...projected,...(Object.hasOwn(result,'diagnostic')?{diagnostic}:{}),commandCompleted:true,operationOutcome,operationSucceeded:operationOutcome==='SUCCEEDED',
    requestAcceptance,transportInvoked,
    nativeAcceptance:false,activationAuthorized:false,sheetsActivated:false,
    diagnosticAvailable:Boolean(diagnostic),resumeAuthorized:false,automaticRetryAllowed:false,canRetry:false};
}
