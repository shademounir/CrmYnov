import { BadRequestException, Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import { inflateRawSync } from "node:zlib";

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

export interface LegacyQualitySummary {
  rowCount: number;
  emptyCellCount: number;
  duplicateEmailRows: number;
  duplicatePhoneRows: number;
  unknownStatusRows: number;
  invalidDateRows: number;
  populatedOwnerRows: number;
  distinctOwnerCount: number;
  commentedRows: number;
  cutoverBlocked: boolean;
  blockerReasons: string[];
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
  legacyQuality?: LegacyQualitySummary;
  mutated: false;
}

interface ZipEntry { name: string; compression: number; compressedSize: number; uncompressedSize: number; localOffset: number }

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
    const sheets = fileType === "CSV" ? this.profileCsv(bytes, input.expectedProfile) : this.profileWorkbook(bytes, input.expectedProfile);
    const formulaCount = sheets.formulaCount;
    const mapping = this.compareHeaders(input.expectedProfile, sheets.items);
    const reasons = [...sheets.reasons, ...mapping.reasons];
    const qualityBlockers = [...new Set([...(sheets.legacyQuality?.blockerReasons ?? []), ...reasons])].sort((left, right) => left.localeCompare(right));
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
      reasons: [...new Set(reasons)].sort((left, right) => left.localeCompare(right)),
      ...(sheets.legacyQuality ? { legacyQuality: { ...sheets.legacyQuality, cutoverBlocked: qualityBlockers.length > 0, blockerReasons: qualityBlockers } } : {}),
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
      const code = value.codePointAt(index) ?? -1;
      const base64Character = (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || (code >= 48 && code <= 57) || code === 43 || code === 47 || code === 61;
      if (!base64Character) this.refuse("base64_invalid");
    }
    const bytes = Buffer.from(value, "base64");
    if (bytes.toString("base64") !== value) this.refuse("base64_invalid");
    return bytes;
  }

  private profileCsv(bytes: Buffer, expectedProfile: ImportProfile): { items: ProfileSheet[]; formulaCount: number; macroDetected: boolean; reasons: string[]; legacyQuality?: LegacyQualitySummary } {
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
    return { items: [{ name: "CSV", rowCount: data.length, columns }], formulaCount, macroDetected: false, reasons: formulaCount ? ["formula_detected"] : [],
      ...(expectedProfile === "LEGACY_CRM" ? { legacyQuality: this.describeLegacyQuality(headers, data) } : {}) };
  }

  private profileWorkbook(bytes: Buffer, expectedProfile: ImportProfile): { items: ProfileSheet[]; formulaCount: number; macroDetected: boolean; reasons: string[]; legacyQuality?: LegacyQualitySummary } {
    if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) this.refuse("xlsx_signature_invalid");
    const zip = this.inspectZip(bytes);
    const archive = new Map(zip.entries.map((entry) => [entry.name.toLocaleLowerCase("en-US"), this.extractZipEntry(bytes, entry)]));
    const workbookXml = this.requiredXml(archive, "xl/workbook.xml");
    const relationsXml = this.requiredXml(archive, "xl/_rels/workbook.xml.rels");
    const sharedStrings = this.readSharedStrings(archive.get("xl/sharedstrings.xml"));
    const dateStyles = this.readDateStyles(archive.get("xl/styles.xml"));
    const relationTargets = new Map(this.openingTags(relationsXml, "Relationship").map((tag) => [this.attribute(tag, "Id"), this.attribute(tag, "Target")]));
    const workbookSheets = this.openingTags(workbookXml, "sheet").map((tag) => ({ name: this.decodeXml(this.attribute(tag, "name")), relationId: this.attribute(tag, "r:id") }));
    if (workbookSheets.length === 0) this.refuse("xlsx_parse_failed");
    const macroDetected = zip.macroDetected;
    let formulaCount = 0;
    const items: ProfileSheet[] = [];
    let legacyQuality: LegacyQualitySummary | undefined;
    for (const workbookSheet of workbookSheets) {
      const target = relationTargets.get(workbookSheet.relationId);
      if (!target) this.refuse("xlsx_relationship_invalid");
      const path = this.resolveWorkbookTarget(target);
      const sheetXml = this.requiredXml(archive, path);
      const parsed = this.readWorksheet(sheetXml, sharedStrings, dateStyles);
      formulaCount += parsed.formulaCount;
      const rows = parsed.rows;
      if (rows.length > MAX_ROWS + 1) this.refuse("row_limit_exceeded");
      const headerIndex = rows.findIndex((row) => Array.isArray(row) && row.some((value) => this.cellText(value).trim().length > 0));
      if (headerIndex < 0) { items.push({ name: workbookSheet.name, rowCount: 0, columns: [] }); continue; }
      const headers = rows[headerIndex]!.map((value) => this.cellText(value).trim());
      if (headers.some((value) => value.length === 0) || new Set(headers).size !== headers.length) this.refuse("headers_invalid");
      const data = rows.slice(headerIndex + 1).filter((row) => row.some((value) => this.cellText(value).trim().length > 0));
      items.push({ name: workbookSheet.name, rowCount: data.length, columns: headers.map((column, index) => this.describeColumn(column, index, data.map((row) => row[index] ?? ""))) });
      if (expectedProfile === "LEGACY_CRM" && (workbookSheet.name === "LEADS YNOV.MA" || workbookSheets.length === 1)) legacyQuality = this.describeLegacyQuality(headers, data);
    }
    const reasons = [...(macroDetected ? ["macro_detected"] : []), ...(formulaCount ? ["formula_detected"] : []), ...(items.length === 0 ? ["empty_file"] : [])];
    return { items, formulaCount, macroDetected, reasons, ...(legacyQuality ? { legacyQuality } : {}) };
  }

  private inspectZip(bytes: Buffer): { macroDetected: boolean; entries: ZipEntry[] } {
    const eocd = this.findEndOfCentralDirectory(bytes);
    const entries = bytes.readUInt16LE(eocd + 10);
    let offset = bytes.readUInt32LE(eocd + 16);
    if (entries < 1 || entries > MAX_ZIP_ENTRIES) this.refuse("xlsx_entry_limit_exceeded");
    let uncompressed = 0;
    let macroDetected = false;
    const zipEntries: ZipEntry[] = [];
    for (let index = 0; index < entries; index += 1) {
      const parsed = this.readCentralEntry(bytes, offset);
      uncompressed += parsed.entry.uncompressedSize;
      if (uncompressed > MAX_UNCOMPRESSED_BYTES) this.refuse("xlsx_uncompressed_limit_exceeded");
      if (parsed.macroDetected) macroDetected = true;
      zipEntries.push(parsed.entry); offset = parsed.nextOffset;
    }
    return { macroDetected, entries: zipEntries };
  }

  private findEndOfCentralDirectory(bytes: Buffer): number {
    for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65_557); offset -= 1) {
      if (bytes.readUInt32LE(offset) === 0x06054b50) return offset;
    }
    this.refuse("xlsx_zip_invalid");
  }

  private readCentralEntry(bytes: Buffer, offset: number): { entry: ZipEntry; nextOffset: number; macroDetected: boolean } {
    if (offset + 46 > bytes.length || bytes.readUInt32LE(offset) !== 0x02014b50) this.refuse("xlsx_zip_invalid");
    if ((bytes.readUInt16LE(offset + 8) & 1) !== 0) this.refuse("encrypted_workbook_refused");
    const compression = bytes.readUInt16LE(offset + 10); const compressedSize = bytes.readUInt32LE(offset + 20);
    const uncompressedSize = bytes.readUInt32LE(offset + 24); const localOffset = bytes.readUInt32LE(offset + 42);
    if (compression !== 0 && compression !== 8) this.refuse("xlsx_compression_refused");
    const nameLength = bytes.readUInt16LE(offset + 28); const extraLength = bytes.readUInt16LE(offset + 30); const commentLength = bytes.readUInt16LE(offset + 32);
    const nextOffset = offset + 46 + nameLength + extraLength + commentLength;
    if (nextOffset > bytes.length) this.refuse("xlsx_zip_invalid");
    const entryName = bytes.subarray(offset + 46, offset + 46 + nameLength).toString("utf8").replaceAll("\\", "/");
    if (entryName.includes("\0") || entryName.startsWith("/") || entryName.split("/").includes("..")) this.refuse("xlsx_entry_path_invalid");
    const name = entryName.toLocaleLowerCase("en-US");
    if (name.startsWith("xl/externallinks/")) this.refuse("external_link_refused");
    return { entry: { name, compression, compressedSize, uncompressedSize, localOffset }, nextOffset,
      macroDetected: name.endsWith("vbaproject.bin") || name.includes("/activex/") };
  }

  private extractZipEntry(archive: Buffer, entry: ZipEntry): Buffer {
    const offset = entry.localOffset;
    if (offset + 30 > archive.length || archive.readUInt32LE(offset) !== 0x04034b50) this.refuse("xlsx_zip_invalid");
    const nameLength = archive.readUInt16LE(offset + 26); const extraLength = archive.readUInt16LE(offset + 28);
    const start = offset + 30 + nameLength + extraLength; const end = start + entry.compressedSize;
    if (end > archive.length) this.refuse("xlsx_zip_invalid");
    let output: Buffer;
    try { output = entry.compression === 0 ? Buffer.from(archive.subarray(start, end)) : inflateRawSync(archive.subarray(start, end), { maxOutputLength: MAX_UNCOMPRESSED_BYTES }); }
    catch { this.refuse("xlsx_decompression_failed"); }
    if (output!.length !== entry.uncompressedSize) this.refuse("xlsx_uncompressed_size_mismatch");
    return output!;
  }

  private requiredXml(archive: Map<string, Buffer>, path: string): string {
    const bytes = archive.get(path.toLocaleLowerCase("en-US"));
    if (!bytes) this.refuse("xlsx_part_missing");
    try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { this.refuse("xlsx_xml_encoding_invalid"); }
  }

  private readSharedStrings(bytes: Buffer | undefined): string[] {
    if (!bytes) return [];
    let xml: string; try { xml = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { this.refuse("xlsx_xml_encoding_invalid"); }
    return this.elementBodies(xml, "si").map((body) => this.elementBodies(body, "t").map((value) => this.decodeXml(value)).join(""));
  }

  private readDateStyles(bytes: Buffer | undefined): Set<number> {
    const result = new Set<number>(); if (!bytes) return result;
    let xml: string; try { xml = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { this.refuse("xlsx_xml_encoding_invalid"); }
    const customFormats = new Map<number, string>();
    for (const tag of this.openingTags(xml, "numFmt")) {
      const id = Number(this.attribute(tag, "numFmtId")); const format = this.attribute(tag, "formatCode").toLocaleLowerCase("en-US");
      if (Number.isSafeInteger(id)) customFormats.set(id, format);
    }
    const cellXfs = this.elementBodies(xml, "cellXfs")[0] ?? "";
    for (const [index, tag] of this.openingTags(cellXfs, "xf").entries()) {
      const id = Number(this.attribute(tag, "numFmtId"));
      if (this.isDateFormatId(id) || this.isDateFormat(customFormats.get(id) ?? "")) result.add(index);
    }
    return result;
  }

  private readWorksheet(xml: string, sharedStrings: string[], dateStyles: Set<number>): { rows: unknown[][]; formulaCount: number } {
    const rows: unknown[][] = []; let formulaCount = 0;
    for (const body of this.elementBodies(xml, "row")) {
      const row: unknown[] = [];
      for (const cell of this.elements(body, "c")) {
        if (this.hasOpeningTag(cell.body, "f")) formulaCount += 1;
        const index = this.columnIndex(this.attribute(cell.opening, "r"));
        row[index] = this.readCellValue(cell, sharedStrings, dateStyles);
      }
      rows.push(row);
    }
    return { rows, formulaCount };
  }

  private readCellValue(cell: { opening: string; body: string }, sharedStrings: string[], dateStyles: Set<number>): unknown {
    const type = this.attribute(cell.opening, "t"); const style = Number(this.attribute(cell.opening, "s"));
    const raw = this.elementBodies(cell.body, type === "inlineStr" ? "t" : "v")[0] ?? ""; const decoded = this.decodeXml(raw);
    if (type === "s") {
      const shared = sharedStrings[Number(decoded)];
      if (shared === undefined) this.refuse("xlsx_shared_string_invalid");
      return shared;
    }
    if (type === "b") return decoded === "1";
    if (type === "str" || type === "inlineStr" || decoded.length === 0) return decoded;
    const numeric = Number(decoded);
    if (!Number.isFinite(numeric)) this.refuse("xlsx_cell_invalid");
    return dateStyles.has(style) ? this.excelDate(numeric) : numeric;
  }

  private resolveWorkbookTarget(target: string): string {
    const normalized = target.replaceAll("\\", "/");
    if (normalized.includes("\0") || normalized.startsWith("/") || normalized.split("/").includes("..")) this.refuse("xlsx_relationship_invalid");
    return normalized.startsWith("xl/") ? normalized.toLocaleLowerCase("en-US") : `xl/${normalized}`.toLocaleLowerCase("en-US");
  }

  private openingTags(xml: string, name: string): string[] { return this.elements(xml, name).map((element) => element.opening); }

  private elements(xml: string, name: string): Array<{ opening: string; body: string }> {
    const result: Array<{ opening: string; body: string }> = []; const marker = `<${name}`; let cursor = 0;
    while (cursor < xml.length) {
      const start = xml.indexOf(marker, cursor); if (start < 0) break;
      const boundary = xml[start + marker.length]; if (boundary !== " " && boundary !== "\t" && boundary !== "\r" && boundary !== "\n" && boundary !== ">" && boundary !== "/") { cursor = start + marker.length; continue; }
      const openingEnd = xml.indexOf(">", start + marker.length); if (openingEnd < 0) this.refuse("xlsx_xml_invalid");
      const opening = xml.slice(start, openingEnd + 1); if (opening.endsWith("/>")) { result.push({ opening, body: "" }); cursor = openingEnd + 1; continue; }
      const closing = `</${name}>`; const close = xml.indexOf(closing, openingEnd + 1); if (close < 0) this.refuse("xlsx_xml_invalid");
      result.push({ opening, body: xml.slice(openingEnd + 1, close) }); cursor = close + closing.length;
    }
    return result;
  }

  private elementBodies(xml: string, name: string): string[] { return this.elements(xml, name).map((element) => element.body); }

  private hasOpeningTag(xml: string, name: string): boolean { return this.elements(xml, name).length > 0; }

  private attribute(tag: string, name: string): string {
    const marker = `${name}="`; const start = tag.indexOf(marker); if (start < 0) return "";
    const valueStart = start + marker.length; const end = tag.indexOf('"', valueStart); if (end < 0) this.refuse("xlsx_xml_invalid");
    return tag.slice(valueStart, end);
  }

  private decodeXml(value: string): string {
    let result = "";
    for (let index = 0; index < value.length; index += 1) {
      if (value[index] !== "&") { result += value[index]; continue; }
      const end = value.indexOf(";", index + 1); if (end < 0 || end - index > 12) this.refuse("xlsx_xml_entity_invalid");
      const entity = value.slice(index + 1, end);
      if (entity === "amp") result += "&"; else if (entity === "lt") result += "<"; else if (entity === "gt") result += ">";
      else if (entity === "quot") result += '"'; else if (entity === "apos") result += "'";
      else if (entity.startsWith("#x")) result += this.codePoint(entity.slice(2), 16);
      else if (entity.startsWith("#")) result += this.codePoint(entity.slice(1), 10);
      else this.refuse("xlsx_xml_entity_invalid");
      index += end - index;
    }
    return result;
  }

  private codePoint(value: string, radix: number): string {
    if (value.length === 0 || value.length > 6) this.refuse("xlsx_xml_entity_invalid");
    const point = Number.parseInt(value, radix); if (!Number.isSafeInteger(point) || point < 0 || point > 0x10ffff) this.refuse("xlsx_xml_entity_invalid");
    return String.fromCodePoint(point);
  }

  private columnIndex(reference: string): number {
    let index = 0; let letters = 0;
    for (const character of reference) {
      const code = character.toUpperCase().codePointAt(0) ?? -1; if (code < 65 || code > 90) break;
      index = index * 26 + code - 64; letters += 1; if (letters > 3) this.refuse("xlsx_column_limit_exceeded");
    }
    if (letters === 0 || index > 16_384) this.refuse("xlsx_cell_reference_invalid");
    return index - 1;
  }

  private isDateFormatId(id: number): boolean { return (id >= 14 && id <= 22) || (id >= 27 && id <= 36) || (id >= 45 && id <= 47) || (id >= 50 && id <= 58); }

  private isDateFormat(format: string): boolean {
    const clean = format.replaceAll("\\", "").replaceAll('"', "");
    return clean.includes("yy") || clean.includes("dd") || (clean.includes("mm") && (clean.includes("/") || clean.includes("-"))) || clean.includes("hh:");
  }

  private excelDate(value: number): Date {
    const date = new Date(Date.UTC(1899, 11, 30) + value * 86_400_000);
    if (Number.isNaN(date.valueOf())) this.refuse("xlsx_date_invalid");
    return date;
  }

  private parseCsv(text: string): string[][] {
    const firstBreak = Math.min(...[text.indexOf("\n"), text.indexOf("\r")].filter((value) => value >= 0));
    const firstLine = firstBreak === Infinity ? text : text.slice(0, firstBreak);
    const delimiter = this.countOutsideQuotes(firstLine, ";") > this.countOutsideQuotes(firstLine, ",") ? ";" : ",";
    const rows: string[][] = []; let row: string[] = []; let value = ""; let quoted = false;
    let index = 0;
    while (index < text.length) {
      const character = text[index]!;
      if (character === '"') {
        if (quoted && text[index + 1] === '"') { value += '"'; index += 2; continue; }
        quoted = !quoted; index += 1; continue;
      }
      if (character === delimiter && !quoted) { row.push(value); value = ""; index += 1; continue; }
      if ((character === "\n" || character === "\r") && !quoted) {
        const width = character === "\r" && text[index + 1] === "\n" ? 2 : 1;
        row.push(value); rows.push(row); row = []; value = ""; index += width; continue;
      }
      value += character; index += 1;
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
    const second = trimmed.codePointAt(1) ?? -1;
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
    let inferredType: ProfileColumn["inferredType"] = "MIXED";
    if (types.size === 0) inferredType = "EMPTY";
    else if (types.size === 1) inferredType = [...types][0]!;
    return { index, name, inferredType, emptyCount };
  }

  private describeLegacyQuality(headers: string[], rows: unknown[][]): LegacyQualitySummary {
    const index = new Map(headers.map((header, position) => [header, position]));
    const values = (header: string): unknown[] => {
      const position = index.get(header);
      return position === undefined ? [] : rows.map((row) => row[position] ?? "");
    };
    const nonEmpty = (value: unknown): boolean => this.cellText(value).trim().length > 0;
    const normalized = (value: unknown): string => this.cellText(value).normalize("NFD").replace(/\p{Diacritic}/gu, "")
      .trim().toLocaleLowerCase("fr-FR").replaceAll(/\s+/g, " ");
    const duplicateRows = (items: unknown[], normalize: (value: unknown) => string): number => {
      const counts = new Map<string, number>();
      for (const item of items) {
        const key = normalize(item);
        if (key.length > 0) counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      return [...counts.values()].reduce((total, count) => total + Math.max(0, count - 1), 0);
    };
    const knownStatuses = new Set(["a contacter", "a qualifier", "contacte", "rdv planifie", "rdv effectue", "dossier ouvert", "inscrit", "sans suite",
      "injoignable", "injoignable / a relancer", "a relancer", "doublon"]);
    const statuses = values("STATUT");
    const dateValues = ["DATE RÉCEPTION", "DATE TRAITEMENT", "PROCHAINE ACTION"].flatMap((header) => values(header));
    const invalidDateRows = dateValues.filter((value) => nonEmpty(value) && !this.isStructuredDate(value)).length;
    const owners = values("RESPONSABLE").filter(nonEmpty);
    const commentsOne = values("COMMENTAIRE 1"); const commentsTwo = values("COMMENTAIRE 2");
    const blockerReasons = [...(statuses.some((value) => nonEmpty(value) && !knownStatuses.has(normalized(value))) ? ["historical_status_unknown"] : []),
      ...(invalidDateRows > 0 ? ["historical_date_invalid"] : [])];
    return {
      rowCount: rows.length,
      emptyCellCount: rows.reduce((total, row) => total + headers.filter((_header, position) => !nonEmpty(row[position] ?? "")).length, 0),
      duplicateEmailRows: duplicateRows(values("EMAIL"), normalized),
      duplicatePhoneRows: duplicateRows(values("TÉLÉPHONE"), (value) => this.cellText(value).replaceAll(/\D/g, "")),
      unknownStatusRows: statuses.filter((value) => nonEmpty(value) && !knownStatuses.has(normalized(value))).length,
      invalidDateRows,
      populatedOwnerRows: owners.length,
      distinctOwnerCount: new Set(owners.map(normalized)).size,
      commentedRows: rows.filter((_row, position) => nonEmpty(commentsOne[position] ?? "") || nonEmpty(commentsTwo[position] ?? "")).length,
      cutoverBlocked: blockerReasons.length > 0,
      blockerReasons,
    };
  }

  private isStructuredDate(value: unknown): boolean {
    if (value instanceof Date) return !Number.isNaN(value.valueOf());
    const text = this.cellText(value).trim();
    const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/.exec(text);
    const local = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text);
    const match = iso ?? local;
    if (!match) return false;
    const year = Number(iso ? match[1] : match[3]); const month = Number(match[2]); const day = Number(iso ? match[3] : match[1]);
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
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
    let selected: ProfileSheet | undefined;
    if (profile === "LEGACY_CRM") selected = sheets.find((sheet) => sheet.name === "LEADS YNOV.MA") ?? (sheets.length === 1 ? sheets[0] : undefined);
    else if (sheets.length === 1) selected = sheets[0];
    if (!selected) {
      const reason = profile === "LEGACY_CRM" ? "canonical_sheet_missing" : "single_sheet_required";
      return { unknown: [], missing: [], reasons: [reason] };
    }
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
