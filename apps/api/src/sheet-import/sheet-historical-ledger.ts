import type { AuditEvent, Prisma } from "@prisma/client";
import type { Principal } from "../auth/auth.types.js";
import type { AppendStream } from "./sheet-append-ledger.js";
import { appendPositions, appendHash } from "./sheet-append-contract.js";
import { historicalCheck as check, historicalExact, historicalHash, historicalDecisionHash, historicalInventoryHash, readHistoricalRequest,
  HISTORICAL_POLICY, type HistoricalDecision, type HistoricalFiles, type HistoricalPin, type HistoricalRequest } from "./sheet-historical-contract.js";
interface HistoricalAudit { schemaVersion: 1; policy: typeof HISTORICAL_POLICY; decision: HistoricalDecision; requestHash: string; previousReceiptHash: string | null; receiptHash: string }
type HistoricalEvent = Pick<AuditEvent,"id"|"occurredAt"|"actorId"|"actorRoles"|"sessionId"|"campusId"|"resourceType"|"resourceId"|"eventType"|"result"|"correlationId"|"idempotencyKey">;
function envelope(e: HistoricalEvent, a: HistoricalAudit): Record<string, unknown> {
  return { schemaVersion:1,id:e.id,occurredAt:e.occurredAt.toISOString(),actorId:e.actorId,actorRoles:e.actorRoles,sessionId:e.sessionId,campusId:e.campusId,
    resourceType:e.resourceType,resourceId:e.resourceId,eventType:e.eventType,result:e.result,correlationId:e.correlationId,idempotencyKey:e.idempotencyKey,
    requestHash:a.requestHash,previousReceiptHash:a.previousReceiptHash,decisionHash:historicalDecisionHash(a.decision) };
}
export interface HistoricalScope { files: HistoricalFiles; stream: AppendStream; connectorId: string }
const requestHash = (r: HistoricalRequest, actor: Pick<Principal,"userId"|"sessionId">, s: HistoricalScope): string => historicalHash({request:r,actorId:actor.userId,sessionId:actor.sessionId,capabilitySha256:s.files.capabilitySha256,streamId:s.stream.id,connectorId:s.connectorId,campusId:s.stream.campusId});
function assertScope(scope: HistoricalScope): void {
  const {files,stream}=scope,c=files.capability,contract=stream.contract;
  check(contract && c.campusId===stream.campusId && c.bindingSha256===contract.bindingSha256 && files.boundarySha256===contract.artifactSha256,"binding");
  for(const k of ["workbookId","sheetId","tab","range","generation","boundaryRow"] as const)check(c[k]===contract[k],"binding");
  const original=appendPositions(contract.range,files.boundary.values);
  check(original.lastOccupiedRow===contract.boundaryRow&&appendHash(original.header)===contract.headerFingerprint&&historicalHash(original.positions.map(({row,fingerprint})=>({row,fingerprint})))===historicalHash(contract.historicalFingerprints),"original_inventory");
}
export async function readHistoricalInventory(tx: Prisma.TransactionClient, scope: HistoricalScope): Promise<Array<{event:AuditEvent;after:HistoricalAudit}>> {
  assertScope(scope);
  const events=await tx.auditEvent.findMany({where:{resourceType:"SHEET_HISTORICAL",resourceId:scope.stream.id},orderBy:[{occurredAt:"asc"},{id:"asc"}],take:3});
  check(events.length<=2,"inventory_overflow");
  const parsed=events.map(event=>({event,after:historicalExact(event.after,["schemaVersion","policy","decision","requestHash","previousReceiptHash","receiptHash"]) as unknown as HistoricalAudit}));
  parsed.sort((a,b)=>a.after.decision.revision-b.after.decision.revision);
  let previousDecision:string|null=null,previousReceipt:string|null=null;const seenRows=new Set<number>(),seenKeys=new Set<string>();
  for(const [i,{event:e,after:a}] of parsed.entries()) {
    const d=a.decision; historicalDecisionHash(d);
    const transition=scope.files.capability.transitions.find(t=>t.row===d.row);
    check(transition&&d.originalFingerprint===transition.originalFingerprint&&d.acceptedFingerprint===transition.acceptedFingerprint,"decision_source");
    check(a.schemaVersion===1&&a.policy===HISTORICAL_POLICY&&d.action==="ACKNOWLEDGE_SOURCE_ONLY"&&d.effects===0&&d.revision===i+1,"event_shape");
    check(!seenRows.has(d.row)&&!seenKeys.has(d.idempotencyKey)&&d.previousDecisionHash===previousDecision&&a.previousReceiptHash===previousReceipt,"event_chain");
    check(e.eventType==="SHEET_HISTORICAL_ACK"&&e.result==="SUCCESS"&&e.campusId===scope.stream.campusId&&e.correlationId===scope.connectorId&&e.before===null&&e.minimizedIp===null,"event_scope");
    check(d.capabilitySha256===scope.files.capabilitySha256&&d.bindingSha256===scope.files.capability.bindingSha256&&d.boundaryArtifactSha256===scope.files.boundarySha256,"event_binding");
    const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
    check(typeof d.actorId==="string"&&uuid.test(d.actorId)&&typeof d.sessionId==="string"&&uuid.test(d.sessionId)&&d.actorId===e.actorId&&d.sessionId===e.sessionId&&d.idempotencyKey===e.idempotencyKey&&d.decidedAt===e.occurredAt.toISOString()&&e.occurredAt.valueOf()<=Date.now(),"event_identity");
    check(Number.isSafeInteger(d.authenticationVersion)&&d.authenticationVersion>0&&e.actorRoles.some(r=>r==="ADMIN"||r==="SUPER_ADMIN")&&e.actorRoles.every(r=>["ADMIN","SUPER_ADMIN","MANAGER","ADMISSIONS","AUDITOR"].includes(r)),"event_roles");
    const r=readHistoricalRequest({row:d.row,reason:d.reason,confirmed:true,expectedVersion:d.connectorVersion,expectedRevision:d.revision-1,idempotencyKey:d.idempotencyKey});
    check(a.requestHash===requestHash(r,{userId:d.actorId,sessionId:d.sessionId},scope)&&a.receiptHash===historicalHash(envelope(e,a)),"receipt_corrupt");
    previousDecision=historicalDecisionHash(d);previousReceipt=a.receiptHash;seenRows.add(d.row);seenKeys.add(d.idempotencyKey);
  }
  return parsed;
}
function receipt(event:HistoricalEvent,after:HistoricalAudit):Record<string,unknown>{return{id:event.id,occurredAt:event.occurredAt.toISOString(),row:after.decision.row,revision:after.decision.revision,idempotencyKey:event.idempotencyKey,receiptHash:after.receiptHash,effects:0,activationAllowed:false};}
/** Caller owns permission-write fence, current actor authentication, stopped
 * connector/version check, source validation and connector/stream locks. */
export async function acknowledgeHistorical(tx:Prisma.TransactionClient,scope:HistoricalScope,actor:Principal,request:HistoricalRequest):Promise<Record<string,unknown>> {
  const events=await readHistoricalInventory(tx,scope),user=await tx.collaborator.findUniqueOrThrow({where:{id:actor.userId}});
  const wanted=requestHash(request,actor,scope),prior=events.find(e=>e.event.idempotencyKey===request.idempotencyKey);
  if(prior){check(prior.after.requestHash===wanted&&prior.after.decision.authenticationVersion===user.authenticationVersion,"idempotency_conflict");return receipt(prior.event,prior.after);}
  check(!await tx.auditEvent.findUnique({where:{idempotencyKey:request.idempotencyKey}}),"global_key_conflict");
  check(events.length===request.expectedRevision&&!events.some(e=>e.after.decision.row===request.row),"revision_conflict");
  const transition=scope.files.capability.transitions.find(t=>t.row===request.row);check(transition,"decision_scope");
  const clock=await tx.$queryRaw<Array<{id:string;now:Date}>>`SELECT gen_random_uuid()::text AS id,date_trunc('milliseconds',clock_timestamp()) AS now`;const time=clock[0];check(time,"clock");
  check(actor.sessionId&&!user.firstLoginRequired,"identity");
  const decision:HistoricalDecision={row:request.row,revision:events.length+1,action:"ACKNOWLEDGE_SOURCE_ONLY",reason:request.reason,actorId:actor.userId,sessionId:actor.sessionId,
    authenticationVersion:user.authenticationVersion,connectorVersion:request.expectedVersion,idempotencyKey:request.idempotencyKey,decidedAt:time.now.toISOString(),capabilitySha256:scope.files.capabilitySha256,
    bindingSha256:scope.files.capability.bindingSha256,boundaryArtifactSha256:scope.files.boundarySha256,originalFingerprint:transition.originalFingerprint,acceptedFingerprint:transition.acceptedFingerprint,previousDecisionHash:events.length?historicalDecisionHash(events.at(-1)!.after.decision):null,effects:0};
  const after:HistoricalAudit={schemaVersion:1,policy:HISTORICAL_POLICY,decision,requestHash:wanted,previousReceiptHash:events.at(-1)?.after.receiptHash??null,receiptHash:""};
  const data:HistoricalEvent={id:time.id,occurredAt:time.now,actorId:actor.userId,actorRoles:actor.roles,sessionId:actor.sessionId,campusId:scope.stream.campusId,resourceType:"SHEET_HISTORICAL",resourceId:scope.stream.id,eventType:"SHEET_HISTORICAL_ACK",result:"SUCCESS",correlationId:scope.connectorId,idempotencyKey:request.idempotencyKey};
  after.receiptHash=historicalHash(envelope(data,after));
  const saved=await tx.auditEvent.create({data:{...data,after:after as unknown as Prisma.InputJsonObject}});return receipt(saved,after);
}
export async function verifiedHistoricalFingerprints(tx:Prisma.TransactionClient,scope:HistoricalScope,pin:HistoricalPin,qualifiedAt?:string):Promise<Array<{row:number;fingerprint:string}>> {
  const events=await readHistoricalInventory(tx,scope);check(pin.count===2&&pin.revision===2&&events.length===2&&pin.capabilityArtifactSha256===scope.files.capabilitySha256,"qualified_inventory_count");
  check(pin.inventorySha256===historicalInventoryHash(events.map(e=>e.after.decision))&&pin.receiptInventorySha256===historicalHash(events.map(e=>envelope(e.event,e.after))),"qualified_inventory_hash");
  if(qualifiedAt!==undefined)check(events.every(e=>e.event.occurredAt.valueOf()<=Date.parse(qualifiedAt)),"qualification_before_decision");
  return scope.files.capability.transitions.map(t=>({row:t.row,fingerprint:t.acceptedFingerprint}));
}
export async function historicalMonitor(tx:Prisma.TransactionClient,scope:HistoricalScope):Promise<Record<string,unknown>> {
  const events=await readHistoricalInventory(tx,scope);
  return {policy:HISTORICAL_POLICY,revision:events.length,decisions:events.map(e=>({...receipt(e.event,e.after),reason:e.after.decision.reason})),transitions:scope.files.capability.transitions.map(({row,column,originalFingerprint,acceptedFingerprint})=>({row,column,originalFingerprint,acceptedFingerprint})),capabilitySha256:scope.files.capabilitySha256,boundaryRow:scope.files.boundary.boundaryRow,generation:scope.files.boundary.generation,activationAllowed:false,businessEffects:0,
    ...(events.length===2?{inventorySha256:historicalInventoryHash(events.map(e=>e.after.decision)),receiptInventorySha256:historicalHash(events.map(e=>envelope(e.event,e.after)))}:{})};
}
