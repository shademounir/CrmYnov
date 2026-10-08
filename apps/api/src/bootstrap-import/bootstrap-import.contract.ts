import { BadRequestException } from "@nestjs/common";
import { createHash } from "node:crypto";

export const CHUNK_BYTES = 48 * 1024;
export const MAX_PACKAGE_BYTES = 5 * 1024 * 1024;
export const HISTORICAL_SHEETS = ["VISITES ET APPELS", "LEADS YNOV.COM", "LEADS YNOV.MA", "JOBINTECH REACT"] as const;
export const IMPORT_FIELDS = ["firstName", "lastName", "email", "phone", "program", "educationLevel", "source", "status", "temperature", "owner", "replacementOwner", "receivedDate"] as const;
export type ImportField = typeof IMPORT_FIELDS[number];
export interface CreateBootstrapInput { fileName: string; sizeBytes: number; sha256: string; campusId: string; idempotencyKey: string }
export interface BootstrapChunkInput { index: number; contentBase64: string; sha256: string }
export interface HistoricalSheetMapping { name: string; campaign: string; fields: Partial<Record<ImportField, string>>; commentColumns: string[]; ownerAliases: Record<string, string>; excludedColumns?: Array<{ column: string; reason: string }> }
export interface HistoricalMappingInput { expectedVersion: number; mappingVersion: "R8-v1"; sheets: HistoricalSheetMapping[] }
export interface HistoricalCycle { state: "UNSPECIFIED" | "CONFIRMED_TARGET" | "HISTORICAL_ENROLMENT" | "REVIEW"; label?: string; sourceColumns: string[]; reason: string }
export interface HistoricalAnnotationDecision { annotationId: string; reference: string; relationshipId: string; action: "PRESERVE_NOTE" | "EXCLUDE"; reason: string }
export interface HistoricalDecisionInput { expectedVersion: number; idempotencyKey: string; action: "CREATE_DOSSIER" | "LINK_EXISTING" | "IGNORE"; targetLeadId?: string; reason: string; cycle?: HistoricalCycle; annotations?: HistoricalAnnotationDecision[]; overrides?: Partial<Record<"firstName" | "lastName" | "email" | "phone" | "program" | "educationLevel" | "source" | "status" | "temperature" | "ownerId" | "campaign", string>> }
export interface BootstrapConfirmInput { expectedVersion: number; idempotencyKey: string; confirmed: true; limit?: number }
export interface BootstrapReopenInput { expectedVersion: number; idempotencyKey: string; reason: string }
export const SHA = /^[a-f0-9]{64}$/;
export const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export const KEY = /^[a-zA-Z0-9][a-zA-Z0-9:_-]{2,127}$/;
export const COLUMN = /^[A-Z]{1,2}$/;
export function refuse(code: string): never { throw new BadRequestException({ code }); }
export function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, canonical(entry)]));
  return value;
}
export function hash(value: unknown): string { return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex"); }
export function bytesHash(value: Uint8Array): string { return createHash("sha256").update(value).digest("hex"); }
export function decodeChunk(input: BootstrapChunkInput): Buffer {
  if (!input || !Number.isInteger(input.index) || input.index < 0 || input.index >= Math.ceil(MAX_PACKAGE_BYTES / CHUNK_BYTES) || !SHA.test(input.sha256)
    || typeof input.contentBase64 !== "string" || input.contentBase64.length < 4 || input.contentBase64.length > 65536 || !/^[A-Za-z0-9+/]*={0,2}$/.test(input.contentBase64)) refuse("bootstrap_chunk_invalid");
  const bytes = Buffer.from(input.contentBase64, "base64");
  if (!bytes.length || bytes.length > CHUNK_BYTES || bytes.toString("base64") !== input.contentBase64 || bytesHash(bytes) !== input.sha256) refuse("bootstrap_chunk_integrity_invalid");
  return bytes;
}
export function assertMapping(input: HistoricalMappingInput): void {
  if (!record(input) || Object.keys(input).some((key) => !["expectedVersion", "mappingVersion", "sheets"].includes(key)) || input.mappingVersion !== "R8-v1" || !Number.isInteger(input.expectedVersion) || input.expectedVersion < 1 || !Array.isArray(input.sheets) || input.sheets.length !== 4
    || input.sheets.some((sheet) => !record(sheet)) || new Set(input.sheets.map((sheet) => sheet.name)).size !== 4) refuse("bootstrap_mapping_invalid");
  for (const sheet of input.sheets) {
    if (Object.keys(sheet).some((key) => !["name", "campaign", "fields", "commentColumns", "ownerAliases", "excludedColumns"].includes(key)) || !HISTORICAL_SHEETS.includes(sheet.name as typeof HISTORICAL_SHEETS[number]) || typeof sheet.campaign !== "string" || sheet.campaign.length > 120 || !sheet.campaign.trim()
      || !record(sheet.fields) || Object.entries(sheet.fields).some(([key, value]) => !(IMPORT_FIELDS as readonly string[]).includes(key) || typeof value !== "string" || !COLUMN.test(value))
      || !sheet.fields.firstName || !sheet.fields.lastName || (!sheet.fields.email && !sheet.fields.phone)
      || !Array.isArray(sheet.commentColumns) || sheet.commentColumns.length > 10 || new Set(sheet.commentColumns).size !== sheet.commentColumns.length || sheet.commentColumns.some((column) => !COLUMN.test(column))
      || !record(sheet.ownerAliases) || Object.keys(sheet.ownerAliases).length > 120
      || Object.entries(sheet.ownerAliases).some(([alias, id]) => !alias.trim() || alias.length > 120 || !UUID.test(id))) refuse("bootstrap_mapping_invalid");
    if (sheet.excludedColumns !== undefined && (!Array.isArray(sheet.excludedColumns) || sheet.excludedColumns.length > 100 || sheet.excludedColumns.some((item) => !record(item) || Object.keys(item).some((key) => !["column", "reason"].includes(key)) || typeof item.column !== "string" || !COLUMN.test(item.column) || typeof item.reason !== "string" || item.reason.trim().length < 8 || item.reason.length > 500)
      || new Set(sheet.excludedColumns.map((item) => item.column)).size !== sheet.excludedColumns.length)) refuse("bootstrap_mapping_invalid");
    const included = new Set([...Object.values(sheet.fields), ...sheet.commentColumns]);
    if (sheet.excludedColumns?.some((item) => included.has(item.column))) refuse("bootstrap_mapping_overlap_invalid");
  }
}
export function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
