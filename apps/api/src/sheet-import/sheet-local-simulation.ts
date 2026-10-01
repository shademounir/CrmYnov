import type { ImportMappingTemplate } from "../import-mapping/import-mapping.service.js";
import type { IngestionRecordInput } from "../ingestion/ingestion.service.js";

function validEmail(value: string): boolean {
  if (value.length > 254 || /\s/u.test(value)) return false;
  const at = value.indexOf("@");
  if (at < 1 || at !== value.lastIndexOf("@")) return false;
  const domain = value.slice(at + 1);
  const dot = domain.lastIndexOf(".");
  return dot > 0 && dot < domain.length - 1 && !domain.startsWith(".");
}

function unambiguousPhone(value: string): boolean {
  // Formatting may be removed only from an explicitly international number.
  // Never infer a country prefix from a numeric spreadsheet cell or locale.
  if (!/^\+[0-9\s().-]+$/u.test(value)) return false;
  return /^\+[1-9][0-9]{7,14}$/u.test(value.replace(/[\s().-]/gu, ""));
}

function phoneReason(record: IngestionRecordInput, rawRow: Readonly<Record<string, string>>, mapping: Pick<ImportMappingTemplate, "columns">): string | undefined {
  const phoneColumns = mapping.columns.filter((column) => column.targetField === "phone" && column.action !== "IGNORE" && column.action !== "METADATA");
  const values = phoneColumns.map((column) => rawRow[column.sourceColumn]?.trim() ?? "");
  if (record.phone?.trim()) values.push(record.phone.trim());
  return values.some((value) => value !== "" && !unambiguousPhone(value)) ? "sheet_phone_ambiguous" : undefined;
}

/** Pure, shared preflight for LOCAL_ROW simulation and execution. Returns codes only,
 * never raw cells. Reference existence/authorization must still be checked by callers. */
export function evaluateLocalMappedRow(record: IngestionRecordInput, rawRow: Readonly<Record<string, string>>, mapping: Pick<ImportMappingTemplate, "columns">): string | undefined {
  if (mapping.columns.some((column) => column.required && !rawRow[column.sourceColumn]?.trim())) return "sheet_required_column_missing";
  if (!record.firstName?.trim() || !record.lastName?.trim()) return "identity_name_missing";
  const email = record.email?.trim();
  if (!email && !record.phone?.trim()) return "CONTACT_IDENTITY_MISSING";
  if (email && !validEmail(email)) return "email_invalid";
  const phone = phoneReason(record, rawRow, mapping);
  if (phone) return phone;
  if (![record.educationLevel, record.program, record.campus, record.campaign].every((value) => Boolean(value?.trim()))) return "sheet_required_reference_missing";
  return undefined;
}
