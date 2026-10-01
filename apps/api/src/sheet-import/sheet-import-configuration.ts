import { BadRequestException } from "@nestjs/common";
import { crmImportTargets, type ImportMappingColumnInput, type ImportMappingTemplate, type ImportDryRunInput, type MappingAction } from "../import-mapping/import-mapping.service.js";
import { parseSheetLocalRange } from "./sheet-local-observation.js";
import { ingestionSources } from "../ingestion/ingestion.service.js";

export interface SheetConfiguration {
  source?: { mode: "SIMULATED" | "GOOGLE"; identityMode: "EXTERNAL_ID" | "LOCAL_ROW"; sheetId?: number; range?: string };
  mapping: ImportMappingTemplate;
  context: ImportDryRunInput["context"];
  assignment: ImportDryRunInput["assignment"];
}

function invalid(): never { throw new BadRequestException({ code: "sheet_configuration_invalid" }); }
export function sheetObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  return Object.fromEntries(Object.entries(value));
}
export function sheetText(value: unknown, maximum = 200): string {
  if (typeof value !== "string" || !value.trim() || value.length > maximum || [...value].some((char) => char.charCodeAt(0) < 32)) invalid();
  return value.trim();
}
export function sheetVersion(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) invalid();
  return value;
}

function column(value: unknown): ImportMappingColumnInput {
  const item = sheetObject(value);
  const action = item.action;
  const actions: readonly string[] = ["DIRECT", "TRIM", "LOWERCASE", "PHONE", "DATE", "METADATA", "IGNORE"];
  if (typeof action !== "string" || !actions.includes(action)) invalid();
  const target = crmImportTargets.find((key) => key === item.targetField);
  if (item.targetField !== undefined && !target) invalid();
  if (item.required !== undefined && typeof item.required !== "boolean") invalid();
  return { sourceColumn: sheetText(item.sourceColumn), action: mappingAction(action),
    ...(target ? { targetField: target } : {}), ...(typeof item.required === "boolean" ? { required: item.required } : {}),
    ...(item.reason !== undefined ? { reason: sheetText(item.reason) } : {}) };
}
function mappingAction(value: string): MappingAction {
  switch (value) {
    case "DIRECT": case "TRIM": case "LOWERCASE": case "PHONE": case "DATE": case "METADATA": case "IGNORE": return value;
    default: return invalid();
  }
}

function mapping(value: unknown, local = false): ImportMappingTemplate {
  const item = sheetObject(value);
  if (item.profile !== (local ? "CUSTOM" : "FORMINATOR_ZAPIER") || !Array.isArray(item.columns) || item.columns.length > 100) invalid();
  return { id: sheetText(item.id), mappingKey: sheetText(item.mappingKey, 64), name: sheetText(item.name, 100), profile: local ? "CUSTOM" : "FORMINATOR_ZAPIER",
    version: sheetVersion(item.version), columns: item.columns.map(column), builtIn: false,
    createdAt: sheetText(item.createdAt), createdBy: sheetText(item.createdBy) };
}

function assignment(value: unknown): ImportDryRunInput["assignment"] {
  const item = sheetObject(value);
  switch (item.strategy) {
    case "UNASSIGNED": case "ROUND_ROBIN": case "CONTROLLED_RANDOM": return { strategy: item.strategy };
    case "FIXED": return { strategy: "FIXED", targetUserId: sheetText(item.targetUserId, 64) };
    default: return invalid();
  }
}

/** Only configuration metadata is persisted here; raw spreadsheet cells never enter this snapshot. */
export function readSheetConfiguration(value: unknown): SheetConfiguration {
  const item = sheetObject(value), context = sheetObject(item.context);
  const source = readSheetSource(item.source);
  const local = source?.identityMode === "LOCAL_ROW";
  const businessSource = ingestionSources.find((candidate) => candidate === context.source);
  if (!businessSource || (!local && businessSource !== "WEB_FORM") || context.technicalSystem !== (local ? "GOOGLE_SHEETS_LOCAL" : "FORMINATOR_ZAPIER")) invalid();
  return { ...(source ? { source } : {}), mapping: mapping(item.mapping, local), assignment: assignment(item.assignment), context: {
    source: businessSource, technicalSystem: local ? "GOOGLE_SHEETS_LOCAL" : "FORMINATOR_ZAPIER", originalSource: local ? sheetText(context.originalSource) : "FORMINATOR", recentSource: "GOOGLE_SHEETS",
    campus: sheetText(context.campus), campaign: sheetText(context.campaign),
    ...(context.program !== undefined ? { program: sheetText(context.program) } : {}),
    ...(context.educationLevel !== undefined ? { educationLevel: sheetText(context.educationLevel) } : {}),
  } };
}

function readSheetSource(raw: unknown): SheetConfiguration["source"] {
  if (raw === undefined) return undefined;
  const item = sheetObject(raw);
  if (item.mode !== "SIMULATED" && item.mode !== "GOOGLE") invalid();
  if (item.identityMode !== "EXTERNAL_ID" && item.identityMode !== "LOCAL_ROW") invalid();
  if (item.mode === "GOOGLE" || item.identityMode === "LOCAL_ROW") {
    if (typeof item.sheetId !== "number" || !Number.isSafeInteger(item.sheetId) || item.sheetId < 0) invalid();
    const range = sheetText(item.range, 64);
    try { parseSheetLocalRange(range); } catch { invalid(); }
    return { mode: item.mode, identityMode: item.identityMode, sheetId: item.sheetId, range };
  }
  return { mode: item.mode, identityMode: item.identityMode };
}
