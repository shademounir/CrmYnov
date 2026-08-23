import { BadRequestException, Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import * as XLSX from "@e965/xlsx";

export type ImportProfile = "LEGACY_CRM" | "FORMINATOR_ZAPIER" | "CUSTOM";
export type ProfileFileType = "CSV" | "XLSX";

export interface ProfileFileInput {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  contentBase64: string;
  expectedProfile: ImportProfile;
}

export interface ProfileColumn {
  index: number;
  name: string;
  inferredType: "EMPTY" | "TEXT" | "NUMBER" | "DATE" | "BOOLEAN" | "MIXED";
  emptyCount: number;
}

export interface ProfileSheet {
  name: string;
  rowCount: number;
  columns: ProfileColumn[];
}

export interface ImportProfileResult {
  profileId: string;
  fileType: ProfileFileType;
  expectedProfile: ImportProfile;
  sheets: ProfileSheet[];
  formulaCount: number;
  macroDetected: boolean;
  unknownColumns: string[];
  missingColumns: string[];
  accepted: boolean;
  requiresMapping: boolean;
  reasons: string[];
  mutated: false;
}

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_UNCOMPRESSED_BYTES = 25 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 200;
const MAX_ROWS = 50_000;
const LEGACY_HEADERS = ["NOM", "PRÉNOM", "TÉLÉPHONE", "EMAIL", "NIVEAU", "SPÉCIALITÉ", "FORMATION SOUHAITÉE", "DATE RÉCEPTION", "DATE TRAITEMENT", "DÉLAI (jours)", "SOURCE", "STATUT", "COMMENTAIRE 1", "QUALIFICATION", "COMMENTAIRE 2", "rdv", "PROCHAINE ACTION", "RESPONSABLE", "PAYS", "Part 1er (%)", "Lien WhatsApp", "VILLE"] as const;
const FORMINATOR_HEADERS = ["Submission ID", "Submission Time", "Nom - Prénom", "Nom - Nom", "Adresse éléctronique", "Numéro de téléphone", "Niveau d'étude", "Formation choisie", "Webhook Info"] as const;
const MIME_BY_TYPE = {
  CSV: new Set(["text/csv", "application/csv"]),
  XLSX: new Set(["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"]),
} as const;

@Injectable()
export class ImportProfileService {
  profile(input: ProfileFileInput): ImportProfileResult {
    const fileType = this.validateEnvelope(input);
    const bytes = this.decodeBase64(input.contentBase64);
    if (bytes.length !== input.sizeBytes || bytes.length > MAX_FILE_BYTES) this.refuse("file_size_invalid");
    const sheets = fileType === "CSV" ? this.profileCsv(bytes) : this.profileWorkbook(bytes);
    const formulaCount = sheets.formulaCount;
    const mapping = this.compareHeaders(input.expectedProfile, sheets.items);
    const reasons = [...sheets.reasons, ...mapping.reasons];
    const profileId = `profile-${createHash("sha256").update(bytes).digest("hex").slice(0, 24)}`;
    return {
      profileId,
      fileType,
      expectedProfile: input.expectedProfile,
      sheets: sheets.items,
      formulaCount,
      macroDetected: sheets.macroDetected,
      unknownColumns: mapping.unknown,
      missingColumns: mapping.missing,
      accepted: reasons.length === 0,
      requiresMapping: input.expectedProfile === "CUSTOM" || mapping.unknown.length > 0 || mapping.missing.length > 0,
      reasons: [...new Set(reasons)].sort(),
      mutated: false,
    };
  }

  private validateEnvelope(input: ProfileFileInput): ProfileFileType {
    if (!input || typeof input.fileName !== "string" || typeof input.mimeType !== "string" || typeof input.contentBase64 !== "string") this.refuse("request_invalid");
    if (!Number.isInteger(input.sizeBytes) || input.sizeBytes < 1 || input.sizeBytes > MAX_FILE_BYTES) this.refuse("file_size_invalid");
    if (!(["LEGACY_CRM", "FORMINATOR_ZAPIER", "CUSTOM"] as const).includes(input.expectedProfile)) this.refuse("profile_invalid");
    if (input.fileName.includes("\0") || input.fileName.includes(":") || input.fileName.includes("/") || input.fileName.includes("\\") || input.fileName === "." || input.fileName === "..") this.refuse("file_name_invalid");
    const extension = input.fileName.toLocaleLowerCase("en-US").split(".").pop();
    if (extension !== "csv" && extension !== "xlsx") this.refuse(extension === "xlsm" ? "macro_file_refused" : "file_extension_refused");
    const fileType: ProfileFileType = extension === "csv" ? "CSV" : "XLSX";
    if (!MIME_BY_TYPE[fileType].has(input.mimeType as never)) this.refuse("mime_type_mismatch");
    return fileType;
  }

  private decodeBase64(value: string): Buffer {
    if (value.length === 0 || value.length > Math.ceil(MAX_FILE_BYTES / 3) * 4 + 4 || value.length % 4 !== 0) this.refuse("base64_invalid");
    for (let index = 0; index < value.length; index += 1) {
      const code = value.charCodeAt(index);
      const base64Character = (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || (code >= 48 && code <= 57) || code === 43 || code === 47 || code === 61;
      if (!base64Character) this.refuse("base64_invalid");
    }
    const bytes = Buffer.from(value, "base64");
    if (bytes.toString("base64") !== value) this.refuse("base64_invalid");
    return bytes;
  }

  private profileCsv(bytes: Buffer): { items: ProfileSheet[]; formulaCount: number; macroDetected: boolean; reasons: string[] } {
    if (bytes[0] === 0x50 && bytes[1] === 0x4b) this.refuse("mime_type_mismatch");
    let text: string;
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { this.refuse("encoding_invalid"); }
    const rows = this.parseCsv(text!);
    if (rows.length === 0 || rows.length > MAX_ROWS + 1) this.refuse(rows.length === 0 ? "empty_file" : "row_limit_exceeded");
    const headers = rows[0]!.map((value) => value.trim());
    if (headers.length === 0 || headers.some((value) => value.length === 0) || new Set(headers).size !== headers.length) this.refuse("headers_invalid");
    const data = rows.slice(1).filter((row) => row.some((value) => value.trim().length > 0));
    let formulaCount = 0;
    for (const row of data) for (const value of row) if (this.looksLikeFormula(value)) formulaCount += 1;
    const columns = headers.map((name, index) => this.describeColumn(name, index, data.map((row) => row[index] ?? "")));
    return { items: [{ name: "CSV", rowCount: data.length, columns }], formulaCount, macroDetected: false, reasons: formulaCount ? ["formula_detected"] : [] };
  }

  private profileWorkbook(bytes: Buffer): { items: ProfileSheet[]; formulaCount: number; macroDetected: boolean; reasons: string[] } {
    if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) this.refuse("xlsx_signature_invalid");
    const zip = this.inspectZip(bytes);
    let workbook: XLSX.WorkBook;
    try { workbook = XLSX.read(bytes, { type: "buffer", cellDates: true, cellFormula: true, bookVBA: true }); } catch { this.refuse("xlsx_parse_failed"); }
    const macroDetected = zip.macroDetected || Boolean(workbook.vbaraw);
    let formulaCount = 0;
    const items: ProfileSheet[] = [];
    for (const name of workbook.SheetNames) {
      const sheet = workbook.Sheets[name];
      if (!sheet) continue;
      for (const rawCell of Object.values(sheet) as unknown[]) {
        const cell = rawCell as Partial<XLSX.CellObject>;
        if (cell && typeof cell === "object" && typeof cell.f === "string") formulaCount += 1;
      }
      const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: "", blankrows: false });
      if (rows.length > MAX_ROWS + 1) this.refuse("row_limit_exceeded");
      const headerIndex = rows.findIndex((row) => Array.isArray(row) && row.some((value) => this.cellText(value).trim().length > 0));
      if (headerIndex < 0) { items.push({ name, rowCount: 0, columns: [] }); continue; }
      const headers = rows[headerIndex]!.map((value) => this.cellText(value).trim());
      if (headers.some((value) => value.length === 0) || new Set(headers).size !== headers.length) this.refuse("headers_invalid");
      const data = rows.slice(headerIndex + 1).filter((row) => row.some((value) => this.cellText(value).trim().length > 0));
      items.push({ name, rowCount: data.length, columns: headers.map((column, index) => this.describeColumn(column, index, data.map((row) => row[index] ?? ""))) });
    }
    const reasons = [...(macroDetected ? ["macro_detected"] : []), ...(formulaCount ? ["formula_detected"] : []), ...(items.length === 0 ? ["empty_file"] : [])];
    return { items, formulaCount, macroDetected, reasons };
  }

  private inspectZip(bytes: Buffer): { macroDetected: boolean } {
    let eocd = -1;
    for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65_557); offset -= 1) {
      if (bytes.readUInt32LE(offset) === 0x06054b50) { eocd = offset; break; }
    }
    if (eocd < 0 || eocd + 22 > bytes.length) this.refuse("xlsx_zip_invalid");
    const entries = bytes.readUInt16LE(eocd + 10);
    let offset = bytes.readUInt32LE(eocd + 16);
    if (entries < 1 || entries > MAX_ZIP_ENTRIES) this.refuse("xlsx_entry_limit_exceeded");
    let uncompressed = 0;
    let macroDetected = false;
    for (let index = 0; index < entries; index += 1) {
      if (offset + 46 > bytes.length || bytes.readUInt32LE(offset) !== 0x02014b50) this.refuse("xlsx_zip_invalid");
      if ((bytes.readUInt16LE(offset + 8) & 1) !== 0) this.refuse("encrypted_workbook_refused");
      uncompressed += bytes.readUInt32LE(offset + 24);
      if (uncompressed > MAX_UNCOMPRESSED_BYTES) this.refuse("xlsx_uncompressed_limit_exceeded");
      const nameLength = bytes.readUInt16LE(offset + 28); const extraLength = bytes.readUInt16LE(offset + 30); const commentLength = bytes.readUInt16LE(offset + 32);
      if (offset + 46 + nameLength + extraLength + commentLength > bytes.length) this.refuse("xlsx_zip_invalid");
      const entryName = bytes.subarray(offset + 46, offset + 46 + nameLength).toString("utf8").replaceAll("\\", "/");
      if (entryName.includes("\0") || entryName.startsWith("/") || entryName.split("/").includes("..")) this.refuse("xlsx_entry_path_invalid");
      const normalized = entryName.toLocaleLowerCase("en-US");
      if (normalized.endsWith("vbaproject.bin") || normalized.includes("/activex/")) macroDetected = true;
      if (normalized.startsWith("xl/externallinks/")) this.refuse("external_link_refused");
      offset += 46 + nameLength + extraLength + commentLength;
    }
    return { macroDetected };
  }

  private parseCsv(text: string): string[][] {
    const firstBreak = Math.min(...[text.indexOf("\n"), text.indexOf("\r")].filter((value) => value >= 0));
    const firstLine = firstBreak === Infinity ? text : text.slice(0, firstBreak);
    const delimiter = this.countOutsideQuotes(firstLine, ";") > this.countOutsideQuotes(firstLine, ",") ? ";" : ",";
    const rows: string[][] = []; let row: string[] = []; let value = ""; let quoted = false;
    for (let index = 0; index < text.length; index += 1) {
      const character = text[index]!;
      if (character === '"') {
        if (quoted && text[index + 1] === '"') { value += '"'; index += 1; } else quoted = !quoted;
      } else if (character === delimiter && !quoted) { row.push(value); value = ""; }
      else if ((character === "\n" || character === "\r") && !quoted) {
        if (character === "\r" && text[index + 1] === "\n") index += 1;
        row.push(value); rows.push(row); row = []; value = "";
      } else value += character;
    }
    if (quoted) this.refuse("csv_quotes_invalid");
    if (value.length > 0 || row.length > 0) { row.push(value); rows.push(row); }
    return rows;
  }

  private countOutsideQuotes(value: string, target: string): number {
    let count = 0; let quoted = false;
    for (let index = 0; index < value.length; index += 1) {
      if (value[index] === '"') { if (quoted && value[index + 1] === '"') index += 1; else quoted = !quoted; }
      else if (!quoted && value[index] === target) count += 1;
    }
    return count;
  }

  private looksLikeFormula(value: string): boolean {
    const trimmed = value.trimStart(); const first = trimmed[0];
    if (first === "=" || first === "@") return true;
    if (first !== "+" && first !== "-") return false;
    const second = trimmed.charCodeAt(1);
    return !(second >= 48 && second <= 57);
  }

  private describeColumn(name: string, index: number, values: unknown[]): ProfileColumn {
    const types = new Set<Exclude<ProfileColumn["inferredType"], "EMPTY" | "MIXED">>(); let emptyCount = 0;
    for (const raw of values) {
      const text = this.cellText(raw);
      if (text.trim().length === 0) { emptyCount += 1; continue; }
      if (raw instanceof Date || this.isIsoLikeDate(text)) types.add("DATE");
      else if (typeof raw === "number") types.add("NUMBER"); else if (typeof raw === "boolean") types.add("BOOLEAN"); else types.add("TEXT");
    }
    const inferredType = types.size === 0 ? "EMPTY" : types.size === 1 ? [...types][0]! : "MIXED";
    return { index, name, inferredType, emptyCount };
  }

  private isIsoLikeDate(value: string): boolean {
    if (value.length < 8 || value.length > 30) return false;
    const separator = value[4];
    return (separator === "-" && value[7] === "-") || (value[2] === "/" && value[5] === "/");
  }

  private cellText(value: unknown): string {
    if (value === null || value === undefined) return "";
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return value.toString();
    if (value instanceof Date) return value.toISOString();
    this.refuse("cell_type_unsupported");
  }

  private compareHeaders(profile: ImportProfile, sheets: ProfileSheet[]): { unknown: string[]; missing: string[]; reasons: string[] } {
    if (profile === "CUSTOM") return { unknown: sheets.flatMap((sheet) => sheet.columns.map((column) => column.name)), missing: [], reasons: ["mapping_required"] };
    const selected = profile === "LEGACY_CRM" ? sheets.find((sheet) => sheet.name === "LEADS YNOV.MA") ?? (sheets.length === 1 ? sheets[0] : undefined) : sheets.length === 1 ? sheets[0] : undefined;
    if (!selected) return { unknown: [], missing: [], reasons: [profile === "LEGACY_CRM" ? "canonical_sheet_missing" : "single_sheet_required"] };
    const headers = selected.columns.map((column) => column.name);
    const expected = profile === "LEGACY_CRM" ? LEGACY_HEADERS : FORMINATOR_HEADERS;
    const expectedSet = new Set<string>(expected);
    const actualSet = new Set(headers);
    const unknown = headers.filter((header) => !expectedSet.has(header));
    const missing = expected.filter((header) => !actualSet.has(header));
    const orderMismatch = unknown.length === 0 && missing.length === 0 && headers.some((header, index) => header !== expected[index]);
    return { unknown, missing, reasons: [...(unknown.length ? ["unknown_columns"] : []), ...(missing.length ? ["missing_columns"] : []), ...(orderMismatch ? ["column_order_mismatch"] : [])] };
  }

  private refuse(code: string): never { throw new BadRequestException({ code }); }
}
