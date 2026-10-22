import { APPEND_MAX_BYTES, appendInvalid, readAppendBoundary, type SheetAppendBoundary } from "./sheet-append-contract.js";
import { readAppendQualification, type SheetAppendQualificationArtifact } from "./sheet-append-qualification.js";
import { readPinnedPrivateArtifact } from "./sheet-private-artifact.js";
import { readHistoricalCapability, type HistoricalFiles } from "./sheet-historical-contract.js";
export async function privateAppendBoundary(env: Readonly<Record<string,string|undefined>>, root: string): Promise<{boundary:SheetAppendBoundary;sha256:string}> {
  const a=await artifact(env.CRM_SHEET_APPEND_BOUNDARY_FILE,env.CRM_SHEET_APPEND_BOUNDARY_SHA256,root,APPEND_MAX_BYTES);
  return {boundary:readAppendBoundary(a.raw),sha256:a.sha256};
}
export async function privateAppendQualification(env: Readonly<Record<string,string|undefined>>, root: string): Promise<{qualification:SheetAppendQualificationArtifact;sha256:string}> {
  const a=await artifact(env.CRM_SHEET_APPEND_QUALIFICATION_FILE,env.CRM_SHEET_APPEND_QUALIFICATION_SHA256,root,65536);
  if(a.raw&&typeof a.raw==="object"&&("artifactSha256" in a.raw||"delegation" in a.raw))appendInvalid("qualification_invalid");
  return {qualification:readAppendQualification(a.raw),sha256:a.sha256};
}
export async function privateHistoricalFiles(env: Readonly<Record<string,string|undefined>>,root:string):Promise<HistoricalFiles>{
  const b=await privateAppendBoundary(env,root),a=await artifact(env.CRM_SHEET_HISTORICAL_CAPABILITY_FILE,env.CRM_SHEET_HISTORICAL_CAPABILITY_SHA256,root,65536);
  return {boundary:b.boundary,boundarySha256:b.sha256,capability:readHistoricalCapability(a.raw,b.boundary,b.sha256),capabilitySha256:a.sha256};
}
export interface HistoricalRuntimeEvidence extends HistoricalFiles {qualification:SheetAppendQualificationArtifact;qualificationSha256:string}
/** Read outside SQL and permission fences. Absence never authorizes schema3. */
export async function privateHistoricalRuntime(env: Readonly<Record<string,string|undefined>>,root:string):Promise<HistoricalRuntimeEvidence|undefined>{
  if(!env.CRM_SHEET_HISTORICAL_CAPABILITY_FILE&&!env.CRM_SHEET_HISTORICAL_CAPABILITY_SHA256)return undefined;
  const files=await privateHistoricalFiles(env,root),q=await privateAppendQualification(env,root);
  return {...files,qualification:q.qualification,qualificationSha256:q.sha256};
}
async function artifact(path:string|undefined,sha256:string|undefined,root:string,maxBytes:number):Promise<{raw:unknown;sha256:string}>{
  try {const a=await readPinnedPrivateArtifact({path,sha256,maxBytes},root);return {raw:a.raw,sha256:a.sha256};}
  catch{return appendInvalid("private_boundary_unavailable");}
}
