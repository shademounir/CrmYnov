import {sheetApiObject} from "./sheets-client";
import type {ApiValue} from "../../_components/connected-resource";
export interface HistoricalReviewState{connectorVersion:number;revision:number;capabilitySha256:string;transitions:Array<{row:number;column:8;originalFingerprint:string;acceptedFingerprint:string}>;decisions:Array<{row:number;revision:number;idempotencyKey:string;receiptHash:string;reason:string}>}
export interface HistoricalCommand{row:2585|2586;reason:string;confirmed:true;expectedVersion:number;expectedRevision:0|1;idempotencyKey:string}
export function historicalReviewState(raw:ApiValue):HistoricalReviewState{
 const s=sheetApiObject(raw),sha=(x:unknown):x is string=>typeof x==="string"&&/^[a-f0-9]{64}$/u.test(x);
 const fail=():never=>{throw new Error("Preuve historique incomplète. Aucune décision n’est présumée.");};
 const text=(x:unknown):string=>typeof x==="string"?x:fail();
 if(s.policy!=="REVIEWED_HISTORICAL_SOURCE_AMENDMENT_V1"||s.activationAllowed!==false||s.businessEffects!==0||s.boundaryRow!==2586||s.generation!=="615e16cf-5029-4b48-90e8-76900990d63f"||!sha(s.capabilitySha256)||!Number.isSafeInteger(s.connectorVersion)||Number(s.connectorVersion)<1||!Number.isInteger(s.revision)||Number(s.revision)<0||Number(s.revision)>2||!Array.isArray(s.transitions)||s.transitions.length!==2||!Array.isArray(s.decisions)||s.decisions.length!==s.revision)fail();
 const rawTransitions=s.transitions,rawDecisions=s.decisions;if(!Array.isArray(rawTransitions)||!Array.isArray(rawDecisions))return fail();
 const transitions=rawTransitions.map((v,i)=>{const t=sheetApiObject(v);if(t.row!==2585+i||t.column!==8||!sha(t.originalFingerprint)||!sha(t.acceptedFingerprint)||t.originalFingerprint===t.acceptedFingerprint)fail();return{row:Number(t.row),column:8 as const,originalFingerprint:text(t.originalFingerprint),acceptedFingerprint:text(t.acceptedFingerprint)};});
 const decisions=rawDecisions.map((v,i)=>{const d=sheetApiObject(v);if(![2585,2586].includes(Number(d.row))||d.revision!==i+1||typeof d.idempotencyKey!=="string"||!sha(d.receiptHash)||typeof d.reason!=="string")fail();return{row:Number(d.row),revision:Number(d.revision),idempotencyKey:text(d.idempotencyKey),receiptHash:text(d.receiptHash),reason:text(d.reason)};});
 if(new Set(decisions.map(d=>d.row)).size!==decisions.length||new Set(decisions.map(d=>d.idempotencyKey)).size!==decisions.length)fail();
 return{connectorVersion:Number(s.connectorVersion),revision:Number(s.revision),capabilitySha256:text(s.capabilitySha256),transitions,decisions};
}
export function historicalCommand(state:HistoricalReviewState,row:2585|2586,reason:string,key:string):HistoricalCommand{
 if(state.revision>1||state.decisions.some(d=>d.row===row)||reason!==reason.trim()||reason.length<8||reason.length>1000||/[\p{Cc}]/u.test(reason)||!/^historical-[a-f0-9-]{36}$/u.test(key))throw new Error("Relisez l’état et fournissez un motif individuel valide.");
 return{row,reason,confirmed:true,expectedVersion:state.connectorVersion,expectedRevision:state.revision as 0|1,idempotencyKey:key};
}
