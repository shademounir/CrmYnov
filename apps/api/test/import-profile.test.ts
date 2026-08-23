import assert from "node:assert/strict";
import test from "node:test";
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

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}

function zip(files: Array<{ name: string; body: string }>): Buffer {
  const locals: Buffer[] = []; const centrals: Buffer[] = []; let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name); const body = Buffer.from(file.body); const checksum = crc32(body);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(body.length, 18); local.writeUInt32LE(body.length, 22); local.writeUInt16LE(name.length, 26);
    locals.push(local, name, body);
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
    central.writeUInt32LE(checksum, 16); central.writeUInt32LE(body.length, 20); central.writeUInt32LE(body.length, 24);
    central.writeUInt16LE(name.length, 28); central.writeUInt32LE(offset, 42); centrals.push(central, name); offset += local.length + name.length + body.length;
  }
  const centralDirectory = Buffer.concat(centrals); const eocd = Buffer.alloc(22); eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8); eocd.writeUInt16LE(files.length, 10); eocd.writeUInt32LE(centralDirectory.length, 12); eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralDirectory, eocd]);
}

function xml(value: unknown): string {
  let text = "";
  if (value instanceof Date) text = value.toISOString(); else if (typeof value === "string") text = value;
  else if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") text = value.toString();
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
function columnName(index: number): string { let value = index + 1; let result = ""; while (value > 0) { const digit = (value - 1) % 26; result = String.fromCharCode(65 + digit) + result; value = Math.floor((value - 1) / 26); } return result; }

function workbookBytes(sheets: Array<{ name: string; rows: unknown[][]; formula?: { row: number; column: number } }>): Buffer {
  const workbook = `<?xml version="1.0" encoding="UTF-8"?><workbook><sheets>${sheets.map((sheet, index) => `<sheet name="${xml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join("")}</sheets></workbook>`;
  const relations = `<?xml version="1.0" encoding="UTF-8"?><Relationships>${sheets.map((_sheet, index) => `<Relationship Id="rId${index + 1}" Target="worksheets/sheet${index + 1}.xml"/>`).join("")}</Relationships>`;
  const files = [{ name: "xl/workbook.xml", body: workbook }, { name: "xl/_rels/workbook.xml.rels", body: relations }];
  for (const [sheetIndex, sheet] of sheets.entries()) {
    const rows = sheet.rows.map((row, rowIndex) => `<row r="${rowIndex + 1}">${row.map((value, columnIndexValue) => {
      const reference = `${columnName(columnIndexValue)}${rowIndex + 1}`;
      return sheet.formula?.row === rowIndex && sheet.formula.column === columnIndexValue
        ? `<c r="${reference}"><f>1+1</f><v>2</v></c>`
        : `<c r="${reference}" t="inlineStr"><is><t>${xml(value)}</t></is></c>`;
    }).join("")}</row>`).join("");
    files.push({ name: `xl/worksheets/sheet${sheetIndex + 1}.xml`, body: `<?xml version="1.0" encoding="UTF-8"?><worksheet><sheetData>${rows}</sheetData></worksheet>` });
  }
  return zip(files);
}

function xlsxInput(rows: unknown[][], formula?: { row: number; column: number }): ProfileFileInput {
  const bytes = workbookBytes([{ name: "Synthetic", rows, ...(formula ? { formula } : {}) }]);
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
  const legacyHeaders = ["NOM", "PRÉNOM", "TÉLÉPHONE", "EMAIL", "NIVEAU", "SPÉCIALITÉ", "FORMATION SOUHAITÉE", "DATE RÉCEPTION", "DATE TRAITEMENT", "DÉLAI (jours)", "SOURCE", "STATUT", "COMMENTAIRE 1", "QUALIFICATION", "COMMENTAIRE 2", "rdv", "PROCHAINE ACTION", "RESPONSABLE", "PAYS", "Part 1er (%)", "Lien WhatsApp", "VILLE"];
  const bytes = workbookBytes([{ name: "DASHBOARD", rows: [["Indicateur"], [1]] }, { name: "LEADS YNOV.MA", rows: [legacyHeaders] }]);
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
  const input = xlsxInput([headers, ["SYN-005", "2026-08-23", "Prénom", "Synthétique", "", "+212600000005", "BAC", "Programme", ""]], { row: 1, column: 2 });
  const result = new ImportProfileService().profile(input);
  assert.equal(result.accepted, false); assert.equal(result.formulaCount, 1); assert.equal(result.reasons.includes("formula_detected"), true);
});
