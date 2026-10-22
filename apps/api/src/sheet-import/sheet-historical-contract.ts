import { createHash } from "node:crypto";
import { ConflictException } from "@nestjs/common";
import { appendHash, appendPositions, type SheetAppendBoundary, type SheetAppendContract } from "./sheet-append-contract.js";
export const HISTORICAL_POLICY = "REVIEWED_HISTORICAL_SOURCE_AMENDMENT_V1" as const;
export function historicalInvalid(code: string): never { throw new ConflictException({ code: `sheet_historical_${code}` }); }
export function historicalCheck(value: unknown, code: string): asserts value { if (!value) historicalInvalid(code); }
export function historicalObject(value: unknown): Record<string, unknown> { historicalCheck(value && typeof value === "object" && !Array.isArray(value), "shape"); return value as Record<string, unknown>; }
export function historicalExact(value: unknown, fields: readonly string[]): Record<string, unknown> { const v = historicalObject(value); historicalCheck(JSON.stringify(Object.keys(v).sort()) === JSON.stringify([...fields].sort()), "shape"); return v; }
const stable = (v: unknown): unknown => Array.isArray(v) ? v.map(stable) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map(k => [k, stable((v as Record<string, unknown>)[k])])) : v;
export const historicalHash = (v: unknown): string => createHash("sha256").update(JSON.stringify(stable(v))).digest("hex");
export const historicalSha = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/u.test(v);
export interface HistoricalTransition { row: 2585 | 2586; column: 8; originalFingerprint: string; acceptedFingerprint: string; acceptedCells: string[] }
export interface HistoricalCapability { schemaVersion: 1; policy: typeof HISTORICAL_POLICY; campusId: string; workbookId: string; sheetId: number; tab: string; range: string; generation: string; boundaryRow: number; headerFingerprint: string; boundaryArtifactSha256: string; bindingSha256: string; sourceObservationSha256: string; transitions: HistoricalTransition[] }
export interface HistoricalPin { policy: typeof HISTORICAL_POLICY; inventorySha256: string; receiptInventorySha256: string; revision: 2; count: 2; capabilityArtifactSha256: string }
export function readHistoricalPin(value: unknown): HistoricalPin {
  const p = historicalExact(value, ["policy", "inventorySha256", "receiptInventorySha256", "revision", "count", "capabilityArtifactSha256"]);
  historicalCheck(p.policy === HISTORICAL_POLICY && p.revision === 2 && p.count === 2 && [p.inventorySha256, p.receiptInventorySha256, p.capabilityArtifactSha256].every(historicalSha), "pin");
  return p as unknown as HistoricalPin;
}
export function readHistoricalCapability(raw: unknown, boundary: SheetAppendBoundary, boundarySha: string): HistoricalCapability {
  const v = historicalExact(raw, ["schemaVersion", "policy", "campusId", "workbookId", "sheetId", "tab", "range", "generation", "boundaryRow", "headerFingerprint", "boundaryArtifactSha256", "bindingSha256", "sourceObservationSha256", "transitions"]);
  historicalCheck(v.schemaVersion === 1 && v.policy === HISTORICAL_POLICY && typeof v.campusId === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(v.campusId), "capability");
  historicalCheck(v.boundaryArtifactSha256 === boundarySha && [v.bindingSha256, v.sourceObservationSha256].every(historicalSha), "capability_pin");
  for (const key of ["workbookId", "sheetId", "tab", "range", "generation", "boundaryRow"] as const) historicalCheck(v[key] === boundary[key], "binding");
  historicalCheck(boundary.range === "A1:CV10001" && boundary.boundaryRow === 2586 && boundary.generation === "615e16cf-5029-4b48-90e8-76900990d63f", "pilot_boundary");
  const baseline = appendPositions(boundary.range, boundary.values);
  historicalCheck(v.headerFingerprint === appendHash(baseline.header) && Array.isArray(v.transitions) && v.transitions.length === 2, "transitions");
  for (const [index, input] of v.transitions.entries()) {
    const t = historicalExact(input, ["row", "column", "originalFingerprint", "acceptedFingerprint", "acceptedCells"]);
    const original = baseline.positions.find(p => p.row === t.row);
    historicalCheck(t.row === 2585 + index && t.column === 8 && original && Array.isArray(t.acceptedCells), "transition_scope");
    const cells: unknown[] = t.acceptedCells;
    historicalCheck(cells.length === original.cells.length && cells.every(c => typeof c === "string" && c.length <= 4000), "transition_cells");
    historicalCheck(JSON.stringify(original.cells.flatMap((cell, i) => cell === cells[i] ? [] : [i + 1])) === "[8]" && t.originalFingerprint === original.fingerprint && t.acceptedFingerprint === appendHash(cells), "transition_fingerprint");
  }
  return v as unknown as HistoricalCapability;
}
export interface HistoricalFiles { boundary: SheetAppendBoundary; boundarySha256: string; capability: HistoricalCapability; capabilitySha256: string }
export function validateHistoricalSource(files: HistoricalFiles, contract: SheetAppendContract, campusId: string, values: unknown): void {
  const { capability: c, boundary } = files;
  historicalCheck(c.campusId === campusId && c.bindingSha256 === contract.bindingSha256 && files.boundarySha256 === contract.artifactSha256, "binding");
  for (const k of ["workbookId", "sheetId", "tab", "range", "generation", "boundaryRow"] as const) historicalCheck(contract[k] === boundary[k], "binding");
  const baseline = appendPositions(contract.range, boundary.values), observed = appendPositions(contract.range, values);
  historicalCheck(appendHash(baseline.header) === contract.headerFingerprint && appendHash(observed.header) === contract.headerFingerprint && observed.lastOccupiedRow >= contract.boundaryRow, "source_structure");
  historicalCheck(historicalHash(baseline.positions.map(({ row, fingerprint }) => ({ row, fingerprint }))) === historicalHash(contract.historicalFingerprints), "original_inventory");
  const present = new Map(observed.positions.map(p => [p.row, p.fingerprint]));
  for (const p of baseline.positions) historicalCheck(present.get(p.row) === (c.transitions.find(t => t.row === p.row)?.acceptedFingerprint ?? p.fingerprint), "source_changed");
}
export interface HistoricalRequest { row: 2585 | 2586; reason: string; confirmed: true; expectedVersion: number; expectedRevision: 0 | 1; idempotencyKey: string }
export function readHistoricalRequest(raw: unknown): HistoricalRequest {
  const r = historicalExact(raw, ["row", "reason", "confirmed", "expectedVersion", "expectedRevision", "idempotencyKey"]);
  historicalCheck([2585,2586].includes(Number(r.row)) && typeof r.row === "number" && r.confirmed === true && typeof r.reason === "string" && r.reason.trim() === r.reason && r.reason.length >= 8 && r.reason.length <= 1000 && !/[\p{Cc}]/u.test(r.reason), "request");
  historicalCheck(Number.isSafeInteger(r.expectedVersion) && Number(r.expectedVersion) > 0 && [0,1].includes(Number(r.expectedRevision)) && typeof r.expectedRevision === "number" && typeof r.idempotencyKey === "string" && /^[A-Za-z0-9:_-]{16,128}$/u.test(r.idempotencyKey), "request");
  return r as unknown as HistoricalRequest;
}
export interface HistoricalDecision { row: number; revision: number; action: "ACKNOWLEDGE_SOURCE_ONLY"; reason: string; actorId: string; sessionId: string; authenticationVersion: number; connectorVersion: number; idempotencyKey: string; decidedAt: string; capabilitySha256: string; bindingSha256: string; boundaryArtifactSha256: string; originalFingerprint: string; acceptedFingerprint: string; previousDecisionHash: string | null; effects: 0 }
const decisionFields = ["row","revision","action","reason","actorId","sessionId","authenticationVersion","connectorVersion","idempotencyKey","decidedAt","capabilitySha256","bindingSha256","boundaryArtifactSha256","originalFingerprint","acceptedFingerprint","previousDecisionHash","effects"] as const;
export function historicalDecisionHash(raw: unknown): string { const d = historicalExact(raw, decisionFields); return appendHash(decisionFields.map(k => [k,d[k]])); }
export const historicalInventoryHash = (decisions: HistoricalDecision[]): string => appendHash(decisions.map(historicalDecisionHash));
