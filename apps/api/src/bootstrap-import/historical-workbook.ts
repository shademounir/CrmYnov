import { inflateRawSync } from "node:zlib";
import { posix } from "node:path";
import { SaxesParser } from "saxes";
import { HISTORICAL_SHEETS, refuse } from "./bootstrap-import.contract.js";

export interface HistoricalCell { value: string | number | boolean | null; raw: string | null; type: string; formula?: { text: string; attributes: Record<string, string> }; style?: string }
export interface HistoricalSourceRow { rowNumber: number; cells: Record<string, HistoricalCell> }
export interface HistoricalAnnotation { annotationId: string; reference: string; text: string; author: string | null; relationshipId: string; format: "LEGACY" | "THREADED"; sourceDate: string | null; parentAnnotationId?: string; personId?: string }
export interface HistoricalSheet { name: string; relationId: string; rows: HistoricalSourceRow[]; columns: Array<{ letter: string; name: string }>; hyperlinks: Record<string, string>[]; annotations: HistoricalAnnotation[] }
export interface HistoricalWorkbook { sheets: HistoricalSheet[]; formulaCount: number; workbookProperties: { date1904: boolean }; stylesXml: string | null }
const MAX_INFLATED = 25 * 1024 * 1024;
type Element = { name: string; attrs: Record<string, string>; children: Element[]; text: string };
function xml(bytes: Buffer): string {
  let source: string; try { source = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { refuse("historical_xml_encoding_invalid"); }
  if (/<!DOCTYPE|<!ENTITY|<\?xml-stylesheet/i.test(source!)) refuse("historical_xml_entity_refused");
  return source!;
}
/** Well-formed XML, never substring scanning. Comments cannot create cells;
 * CDATA is literal text. Extraction below is by direct parent, not descendants. */
function document(source: string, expectedRoot: string): Element {
  const parser = new SaxesParser({ xmlns: false }); const stack: Element[] = [];
  let root: Element | undefined; let count = 0;
  parser.on("doctype", () => refuse("historical_xml_entity_refused"));
  parser.on("error", () => refuse("historical_xml_invalid"));
  parser.on("opentag", (tag) => {
    if (++count > 400000 || stack.length > 32) refuse("historical_xml_structure_limit");
    const node: Element = { name: tag.name, attrs: { ...tag.attributes }, children: [], text: "" };
    if (stack.length) stack[stack.length - 1]!.children.push(node); else root = node;
    stack.push(node);
  });
  const append = (text: string): void => { if (stack.length) stack[stack.length - 1]!.text += text; };
  parser.on("text", append); parser.on("cdata", append); parser.on("closetag", () => { stack.pop(); });
  parser.write(source).close();
  if (!root || root.name !== expectedRoot || stack.length) refuse("historical_xml_root_invalid");
  return root;
}
function children(node: Element, name: string): Element[] { return node.children.filter((child) => child.name === name); }
function single(node: Element, name: string): Element | undefined { const items = children(node, name); if (items.length > 1) refuse("historical_xml_structure_invalid"); return items[0]; }
function richText(node: Element): string {
  return node.children.flatMap((part) => part.name === "t" ? [part.text] : part.name === "r" ? children(part, "t").map((item) => item.text) : []).join("");
}
function rejectMisplaced(node: Element, name: string, allowedParent: string): void {
  for (const child of node.children) { if (child.name === name && node.name !== allowedParent) refuse("historical_xml_structure_invalid"); rejectMisplaced(child, name, allowedParent); }
}
function safePath(path: string): string {
  const normalized = path.replaceAll("\\", "/").toLowerCase();
  if (!normalized || normalized.includes("\0") || normalized.startsWith("/") || normalized.includes(":") || normalized.split("/").some((part) => part === ".." || part === ".")) refuse("historical_archive_path_invalid");
  return normalized;
}
function relationshipPath(parent: string, target: string): string {
  if (!target || target.includes("\\") || target.includes(":")) refuse("historical_relationship_invalid");
  return safePath(target.startsWith("/") ? target.slice(1) : posix.normalize(posix.join(posix.dirname(parent), target)));
}
function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}
function archive(bytes: Buffer): Map<string, Buffer> {
  if (bytes.length < 22 || bytes.length > 5 * 1024 * 1024 || bytes.readUInt32LE(0) !== 0x04034b50) refuse("historical_xlsx_signature_invalid");
  let eocd = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65557); offset--) if (bytes.readUInt32LE(offset) === 0x06054b50 && offset + 22 + bytes.readUInt16LE(offset + 20) === bytes.length) { eocd = offset; break; }
  if (eocd < 0 || bytes.readUInt16LE(eocd + 4) !== 0 || bytes.readUInt16LE(eocd + 6) !== 0 || bytes.readUInt16LE(eocd + 8) !== bytes.readUInt16LE(eocd + 10)) refuse("historical_zip_invalid");
  const count = bytes.readUInt16LE(eocd + 10); if (!count || count > 200) refuse("historical_zip_entry_limit");
  let cursor = bytes.readUInt32LE(eocd + 16); const directoryEnd = cursor + bytes.readUInt32LE(eocd + 12);
  if (directoryEnd !== eocd) refuse("historical_zip_directory_invalid");
  const result = new Map<string, Buffer>(); const localRanges: Array<[number, number]> = []; let inflated = 0;
  for (let index = 0; index < count; index++) {
    if (cursor + 46 > directoryEnd || bytes.readUInt32LE(cursor) !== 0x02014b50) refuse("historical_zip_invalid");
    const flags = bytes.readUInt16LE(cursor + 8); const compression = bytes.readUInt16LE(cursor + 10);
    const crc = bytes.readUInt32LE(cursor + 16); const compressed = bytes.readUInt32LE(cursor + 20); const length = bytes.readUInt32LE(cursor + 24);
    const nameLength = bytes.readUInt16LE(cursor + 28); const extra = bytes.readUInt16LE(cursor + 30); const comment = bytes.readUInt16LE(cursor + 32); const local = bytes.readUInt32LE(cursor + 42);
    if (flags & 1 || ![0, 8].includes(compression) || length > MAX_INFLATED || cursor + 46 + nameLength + extra + comment > directoryEnd) refuse("historical_zip_compression_refused");
    const rawName = bytes.subarray(cursor + 46, cursor + 46 + nameLength); const name = safePath(rawName.toString("utf8"));
    if (result.has(name)) refuse("historical_zip_duplicate_part");
    if (/vbaproject|\/activex\/|^xl\/externallinks\//i.test(name)) refuse("historical_active_content_refused");
    if (local + 30 > directoryEnd || bytes.readUInt32LE(local) !== 0x04034b50 || bytes.readUInt16LE(local + 6) !== flags || bytes.readUInt16LE(local + 8) !== compression) refuse("historical_zip_local_mismatch");
    const localNameLength = bytes.readUInt16LE(local + 26); const localExtra = bytes.readUInt16LE(local + 28);
    if (localNameLength !== nameLength || !bytes.subarray(local + 30, local + 30 + localNameLength).equals(rawName)) refuse("historical_zip_local_mismatch");
    if (!(flags & 8) && (bytes.readUInt32LE(local + 14) !== crc || bytes.readUInt32LE(local + 18) !== compressed || bytes.readUInt32LE(local + 22) !== length)) refuse("historical_zip_local_mismatch");
    const start = local + 30 + localNameLength + localExtra; const end = start + compressed;
    if (end > bytes.readUInt32LE(eocd + 16) || localRanges.some(([left, right]) => local < right && end > left)) refuse("historical_zip_bounds_invalid");
    localRanges.push([local, end]); let content: Buffer;
    try { content = compression === 0 ? Buffer.from(bytes.subarray(start, end)) : inflateRawSync(bytes.subarray(start, end), { maxOutputLength: MAX_INFLATED - inflated }); } catch { refuse("historical_zip_inflation_refused"); }
    inflated += content!.length; if (inflated > MAX_INFLATED || content!.length !== length || crc32(content!) !== crc) refuse("historical_zip_size_invalid");
    result.set(name, content!); cursor += 46 + nameLength + extra + comment;
  }
  if (cursor !== directoryEnd) refuse("historical_zip_directory_invalid");
  return result;
}
function column(reference: string): { letter: string; row: number } {
  const match = /^([A-Z]{1,2})([1-9]\d{0,5})$/.exec(reference); if (!match) refuse("historical_cell_coordinate_invalid");
  let index = 0; for (const char of match[1]!) index = index * 26 + char.charCodeAt(0) - 64;
  if (index > 100) refuse("historical_column_limit");
  return { letter: match[1]!, row: Number(match[2]) };
}
function cellValue(cell: Element, strings: string[]): HistoricalCell {
  const attrs = cell.attrs; const type = attrs.t ?? "n"; const raw = single(cell, "v")?.text ?? null;
  let value: HistoricalCell["value"] = null;
  if (type === "inlineStr") value = single(cell, "is") ? richText(single(cell, "is")!) : "";
  else if (type === "s") { if (raw === null || !/^\d+$/.test(raw) || strings[Number(raw)] === undefined) refuse("historical_shared_string_invalid"); value = strings[Number(raw)]!; }
  else if (type === "str" || type === "e" || type === "d") value = raw;
  else if (type === "b") { if (raw !== "0" && raw !== "1" && raw !== null) refuse("historical_boolean_invalid"); value = raw === null ? null : raw === "1"; }
  else if (type === "n") { if (raw !== null && raw !== "") { const number = Number(raw); if (!Number.isFinite(number)) refuse("historical_number_invalid"); value = number; } }
  else refuse("historical_cell_type_invalid");
  if (String(value ?? "").length > 4000 || (raw?.length ?? 0) > 4000) refuse("historical_cell_length_limit");
  const formulas = children(cell, "f"); if (formulas.length > 1) refuse("historical_formula_invalid");
  if ((formulas[0]?.text.length ?? 0) > 4000) refuse("historical_formula_length_limit");
  return { value, raw, type, ...(attrs.s ? { style: attrs.s } : {}), ...(formulas[0] ? { formula: { text: formulas[0].text, attributes: formulas[0].attrs } } : {}) };
}
function required(parts: Map<string, Buffer>, name: string): string { const bytes = parts.get(name); if (!bytes) refuse("historical_xlsx_part_missing"); return xml(bytes); }

/** Dedicated historical contract; it does not loosen the generic profiler.
 * Dates remain raw civil/style evidence. No formula, macro or link is executed. */
export function parseHistoricalWorkbook(bytes: Buffer): HistoricalWorkbook {
  const parts = archive(bytes); const workbook = document(required(parts, "xl/workbook.xml"), "workbook"); const relationships = document(required(parts, "xl/_rels/workbook.xml.rels"), "Relationships");
  const relationTargets = new Map<string, string>(); const relationIds = new Set<string>();
  for (const relation of children(relationships, "Relationship")) {
    const attrs = relation.attrs; if (!attrs.Id || attrs.Id.length > 80 || !attrs.Target || relationIds.has(attrs.Id)) refuse("historical_relationship_invalid");
    relationIds.add(attrs.Id);
    if (attrs.TargetMode === "External") continue;
    relationTargets.set(attrs.Id, relationshipPath("xl/workbook.xml", attrs.Target));
  }
  const strings = parts.has("xl/sharedstrings.xml") ? children(document(required(parts, "xl/sharedstrings.xml"), "sst"), "si").map(richText) : [];
  if (strings.length > 100000 || strings.some((value) => value.length > 4000)) refuse("historical_shared_string_limit");
  const sheets: HistoricalSheet[] = []; let formulaCount = 0; let totalRows = 0;
  const people = new Map<string, string>();
  for (const [path, content] of parts) if (/^xl\/persons\/[^/]+\.xml$/.test(path)) {
    const list = document(xml(content), "personList");
    for (const person of children(list, "person")) {
      const id = person.attrs.id; const label = person.attrs.displayName ?? "";
      if (!id || id.length > 120 || label.length > 4000 || people.has(id)) refuse("historical_person_metadata_invalid");
      people.set(id, label);
    }
  }
  rejectMisplaced(workbook, "sheet", "sheets");
  const sheetContainer = single(workbook, "sheets"); if (!sheetContainer) refuse("historical_four_sheets_required");
  for (const sheet of children(sheetContainer, "sheet")) {
    const attrs = sheet.attrs; const name = attrs.name!;
    if (!(HISTORICAL_SHEETS as readonly string[]).includes(name)) continue;
    if (sheets.some((item) => item.name === name)) refuse("historical_sheet_duplicate");
    const relationId = attrs["r:id"]!; const path = relationTargets.get(relationId); if (!path) refuse("historical_relationship_invalid");
    const worksheet = document(required(parts, path), "worksheet"); const rows: HistoricalSourceRow[] = []; const seenRows = new Set<number>(); let header: HistoricalSourceRow | undefined;
    rejectMisplaced(worksheet, "row", "sheetData"); rejectMisplaced(worksheet, "c", "row");
    const data = single(worksheet, "sheetData"); if (!data) refuse("historical_header_row6_missing");
    for (const row of children(data, "row")) {
      const rowNumber = Number(row.attrs.r); if (!Number.isSafeInteger(rowNumber) || rowNumber < 1 || rowNumber > 50000 || seenRows.has(rowNumber)) refuse("historical_row_invalid");
      seenRows.add(rowNumber); if (++totalRows > 50000) refuse("historical_row_limit");
      const cells: Record<string, HistoricalCell> = {};
      for (const cell of children(row, "c")) {
        const coordinate = column(cell.attrs.r ?? "");
        if (coordinate.row !== rowNumber || Object.hasOwn(cells, coordinate.letter)) refuse("historical_cell_coordinate_invalid");
        cells[coordinate.letter] = cellValue(cell, strings); if (cells[coordinate.letter]!.formula) formulaCount++;
      }
      const source = { rowNumber, cells }; if (rowNumber === 6) header = source;
      else if (rowNumber > 6 && Object.values(cells).some((cell) => cell.value !== null && cell.value !== "" || cell.formula)) rows.push(source);
    }
    if (!header || !Object.values(header.cells).some((cell) => typeof cell.value === "string" && cell.value.trim())) refuse("historical_header_row6_missing");
    // A physical column can carry source facts even when row 6 has no label.
    // Keep it selectable for mapping/reasoned exclusion, without inventing a
    // header that could accidentally turn it into an identity column.
    const columnLetters = new Set(Object.entries(header.cells).filter(([, cell]) => cell.value !== null && String(cell.value).trim()).map(([letter]) => letter));
    for (const row of rows) for (const [letter, cell] of Object.entries(row.cells)) if (cell.value !== null && cell.value !== "" || cell.formula) columnLetters.add(letter);
    const columns = [...columnLetters].sort((left, right) => left.length - right.length || (left < right ? -1 : left > right ? 1 : 0)).map((letter) => ({ letter, name: String(header.cells[letter]?.value ?? "").trim() }));
    const sheetRelsPath = `${posix.dirname(path)}/_rels/${posix.basename(path)}.rels`; const sheetRels = parts.get(sheetRelsPath);
    const linkTargets = new Map<string, Record<string, string>>(); const annotations: HistoricalAnnotation[] = [];
    if (sheetRels) for (const relation of children(document(xml(sheetRels), "Relationships"), "Relationship")) {
      const attrs = relation.attrs; if (!attrs.Id || attrs.Id.length > 80 || !attrs.Target || linkTargets.has(attrs.Id)) refuse("historical_relationship_invalid");
      linkTargets.set(attrs.Id, attrs);
      if (attrs.Type?.endsWith("/comments")) {
        if (attrs.TargetMode === "External") refuse("historical_comment_relationship_invalid");
        const commentPath = safePath(posix.normalize(posix.join(posix.dirname(path), attrs.Target))); if (!commentPath.startsWith("xl/")) refuse("historical_comment_relationship_invalid");
        const commentXml = document(required(parts, commentPath), "comments"); const authorContainer = single(commentXml, "authors"); const list = single(commentXml, "commentList");
        const authors = authorContainer ? children(authorContainer, "author").map((item) => item.text) : [];
        let annotationIndex = 0;
        for (const comment of list ? children(list, "comment") : []) {
          const attributesValue = comment.attrs; const coordinate = column(attributesValue.ref ?? "");
          const authorId = Number(attributesValue.authorId); const content = single(comment, "text"); const noteText = content ? richText(content) : "";
          if (noteText.length > 4000 || coordinate.row > 50000 || !Number.isInteger(authorId) || authors[authorId] === undefined) refuse("historical_annotation_invalid");
          const reference = `${coordinate.letter}${coordinate.row}`;
          annotations.push({ annotationId: `legacy:${attrs.Id}:${++annotationIndex}:${reference}`, reference, text: noteText, author: authors[authorId] || null, relationshipId: attrs.Id, format: "LEGACY", sourceDate: null });
        }
      }
      if (/\/threadedcomment$/i.test(attrs.Type ?? "")) {
        if (attrs.TargetMode === "External") refuse("historical_comment_relationship_invalid");
        const threadPath = relationshipPath(path, attrs.Target); if (!threadPath.startsWith("xl/")) refuse("historical_comment_relationship_invalid");
        const threads = document(required(parts, threadPath), "ThreadedComments"); const ids = new Set<string>();
        for (const comment of children(threads, "threadedComment")) {
          const coordinate = column(comment.attrs.ref ?? ""); const id = comment.attrs.id; const personId = comment.attrs.personId; const content = single(comment, "text");
          if (!id || id.length > 120 || ids.has(id) || !personId || personId.length > 120 || coordinate.row > 50000 || !content || content.children.length) refuse("historical_threaded_annotation_invalid");
          ids.add(id); const noteText = content.text; const sourceDate = comment.attrs.dT ?? null; const parent = comment.attrs.parentId;
          if (noteText.length > 4000 || (sourceDate?.length ?? 0) > 80 || (parent?.length ?? 0) > 120) refuse("historical_threaded_annotation_invalid");
          annotations.push({ annotationId: id, reference: `${coordinate.letter}${coordinate.row}`, text: noteText, author: people.get(personId) || null, relationshipId: attrs.Id, format: "THREADED", sourceDate, personId,
            ...(parent ? { parentAnnotationId: parent } : {}) });
        }
      }
    }
    const hyperlinks = (single(worksheet, "hyperlinks") ? children(single(worksheet, "hyperlinks")!, "hyperlink") : []).map((item) => {
      const attrs = item.attrs; const target = attrs["r:id"] ? linkTargets.get(attrs["r:id"]) : undefined;
      return { ...attrs, ...(target ? { target: target.Target!, targetMode: target.TargetMode ?? "Internal" } : {}) };
    });
    if (annotations.length > 10000) refuse("historical_annotation_limit");
    sheets.push({ name, relationId, rows, columns, hyperlinks, annotations });
  }
  if (sheets.length !== 4 || new Set(sheets.map((sheet) => sheet.relationId)).size !== 4) refuse("historical_four_sheets_required");
  const properties = single(workbook, "workbookPr");
  return { sheets, formulaCount, workbookProperties: { date1904: properties ? ["1", "true"].includes(properties.attrs.date1904 ?? "") : false },
    stylesXml: parts.has("xl/styles.xml") ? required(parts, "xl/styles.xml") : null };
}
