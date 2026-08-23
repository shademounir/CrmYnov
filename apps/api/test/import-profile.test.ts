import assert from "node:assert/strict";
import test from "node:test";
import * as XLSX from "@e965/xlsx";
import { AuditService } from "../src/audit/audit.service.js";
import { ImportProfileController } from "../src/import-profile/import-profile.controller.js";
import { ImportProfileService, type ProfileFileInput } from "../src/import-profile/import-profile.service.js";

const headers = ["Submission ID", "Submission Time", "Nom - Prénom", "Nom - Nom", "Adresse éléctronique", "Numéro de téléphone", "Niveau d'étude", "Formation choisie", "Webhook Info"];
const manager = { userId: "synthetic-manager", roles: ["MANAGER" as const], scopes: [{ kind: "GLOBAL" as const }], sessionId: "00000000-0000-4000-8000-000000000001" };
const request = { principal: manager, header: () => "synthetic-correlation" } as never;

function csvInput(rows: string[][], overrides: Partial<ProfileFileInput> = {}): ProfileFileInput {
  const csv = rows.map((row) => row.map((value) => `"${value.replaceAll('"', '""')}"`).join(",")).join("\r\n");
  const bytes = Buffer.from(csv, "utf8");
  return { fileName: "synthetic-forminator.csv", mimeType: "text/csv", sizeBytes: bytes.length,
    contentBase64: bytes.toString("base64"), expectedProfile: "FORMINATOR_ZAPIER", ...overrides };
}

function xlsxInput(rows: unknown[][]): ProfileFileInput {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), "Synthetic");
  const bytes = Buffer.from(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Uint8Array);
  return { fileName: "synthetic-forminator.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    sizeBytes: bytes.length, contentBase64: bytes.toString("base64"), expectedProfile: "FORMINATOR_ZAPIER" };
}

test("profiles a synthetic CSV without returning or persisting cell values", () => {
  const audit = new AuditService(); const controller = new ImportProfileController(new ImportProfileService(), audit);
  const input = csvInput([headers, ["SYN-001", "2026-08-23T09:00:00Z", "Prénom", "Synthétique", "lead@example.invalid", "+212600000001", "BAC", "Programme test", "synthetic"]]);
  const first = controller.profile(input, request); const replay = controller.profile(input, request);
  assert.equal(first.accepted, true); assert.equal(first.mutated, false); assert.equal(first.profileId, replay.profileId);
  assert.equal(first.sheets[0]?.rowCount, 1); assert.deepEqual(first.sheets[0]?.columns.map((column) => column.name), headers);
  const serialized = JSON.stringify(first); assert.equal(serialized.includes("lead@example.invalid"), false); assert.equal(serialized.includes("SYN-001"), false);
  assert.equal(audit.list().length, 1); assert.equal(JSON.stringify(audit.list()).includes("lead@example.invalid"), false);
});

test("profiles an XLSX using structure only", () => {
  const result = new ImportProfileService().profile(xlsxInput([headers, ["SYN-002", new Date("2026-08-23T09:00:00Z"), "Prénom", "Synthétique", "", "+212600000002", "BAC", "Programme test", ""]]));
  assert.equal(result.accepted, true); assert.equal(result.fileType, "XLSX"); assert.equal(result.sheets[0]?.rowCount, 1);
  assert.equal(result.sheets[0]?.columns[1]?.inferredType, "DATE");
});

test("selects the canonical legacy sheet without treating reporting sheets as leads", () => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["Indicateur"], [1]]), "DASHBOARD");
  const legacyHeaders = ["NOM", "PRÉNOM", "TÉLÉPHONE", "EMAIL", "NIVEAU", "SPÉCIALITÉ", "FORMATION SOUHAITÉE", "DATE RÉCEPTION", "DATE TRAITEMENT", "DÉLAI (jours)", "SOURCE", "STATUT", "COMMENTAIRE 1", "QUALIFICATION", "COMMENTAIRE 2", "rdv", "PROCHAINE ACTION", "RESPONSABLE", "PAYS", "Part 1er (%)", "Lien WhatsApp", "VILLE"];
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([legacyHeaders]), "LEADS YNOV.MA");
  const bytes = Buffer.from(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Uint8Array);
  const result = new ImportProfileService().profile({ fileName: "synthetic-legacy.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    sizeBytes: bytes.length, contentBase64: bytes.toString("base64"), expectedProfile: "LEGACY_CRM" });
  assert.equal(result.accepted, true); assert.equal(result.sheets.length, 2); assert.equal(result.unknownColumns.length, 0);
});

test("fails closed for formula cells, unknown columns and custom mappings", () => {
  const service = new ImportProfileService();
  const formula = service.profile(csvInput([headers, ["SYN-003", "2026-08-23", "=HYPERLINK(1)", "Synthétique", "", "+212600000003", "BAC", "Programme", ""]]));
  assert.equal(formula.accepted, false); assert.deepEqual(formula.reasons, ["formula_detected"]);
  const unknown = service.profile(csvInput([[...headers, "Unexpected"], ["SYN-004", "2026-08-23", "Prénom", "Synthétique", "", "+212600000004", "BAC", "Programme", "", "value"]]));
  assert.equal(unknown.accepted, false); assert.deepEqual(unknown.unknownColumns, ["Unexpected"]);
  const custom = service.profile(csvInput([["Colonne à arbitrer"], ["valeur synthétique"]], { expectedProfile: "CUSTOM" }));
  assert.equal(custom.requiresMapping, true); assert.equal(custom.accepted, false);
});

test("rejects mismatched MIME, malformed base64, unsafe names and oversize declarations", () => {
  const service = new ImportProfileService(); const valid = csvInput([headers]);
  const code = (action: () => unknown): string => { try { action(); return "missing_error"; } catch (error) {
    const response = (error as { getResponse?: () => unknown }).getResponse?.() as { code?: string } | undefined; return response?.code ?? "unknown";
  } };
  assert.equal(code(() => service.profile({ ...valid, mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })), "mime_type_mismatch");
  assert.equal(code(() => service.profile({ ...valid, contentBase64: "not base64" })), "base64_invalid");
  assert.equal(code(() => service.profile({ ...valid, fileName: "../synthetic.csv" })), "file_name_invalid");
  assert.equal(code(() => service.profile({ ...valid, sizeBytes: 5 * 1024 * 1024 + 1 })), "file_size_invalid");
  assert.equal(code(() => service.profile({ ...valid, fileName: "synthetic.xlsm" })), "macro_file_refused");
});

test("rejects formulas embedded in XLSX cells and never evaluates them", () => {
  const input = xlsxInput([headers, ["SYN-005", "2026-08-23", "Prénom", "Synthétique", "", "+212600000005", "BAC", "Programme", ""]]);
  const bytes = Buffer.from(input.contentBase64, "base64"); const workbook = XLSX.read(bytes, { type: "buffer" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]!]; assert.ok(sheet); sheet.C2 = { t: "n", f: "1+1" };
  const modified = Buffer.from(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Uint8Array);
  const result = new ImportProfileService().profile({ ...input, sizeBytes: modified.length, contentBase64: modified.toString("base64") });
  assert.equal(result.accepted, false); assert.equal(result.formulaCount, 1); assert.equal(result.reasons.includes("formula_detected"), true);
});
