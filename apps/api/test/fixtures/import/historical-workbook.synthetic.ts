import { HISTORICAL_SHEETS } from "../../../src/bootstrap-import/bootstrap-import.contract.js";
export function syntheticZip(parts: Array<[string, string]>): Buffer {
  const local: Buffer[] = []; const central: Buffer[] = []; let offset = 0;
  const crc32 = (value: Buffer): number => { let crc = 0xffffffff; for (const byte of value) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); } return (crc ^ 0xffffffff) >>> 0; };
  for (const [path, text] of parts) {
    const name = Buffer.from(path); const bytes = Buffer.from(text); const crc = crc32(bytes);
    const header = Buffer.alloc(30); header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt32LE(crc, 14); header.writeUInt32LE(bytes.length, 18); header.writeUInt32LE(bytes.length, 22); header.writeUInt16LE(name.length, 26);
    local.push(header, name, bytes);
    const directory = Buffer.alloc(46); directory.writeUInt32LE(0x02014b50); directory.writeUInt16LE(20, 4); directory.writeUInt16LE(20, 6); directory.writeUInt32LE(crc, 16); directory.writeUInt32LE(bytes.length, 20); directory.writeUInt32LE(bytes.length, 24); directory.writeUInt16LE(name.length, 28); directory.writeUInt32LE(offset, 42);
    central.push(directory, name); offset += header.length + name.length + bytes.length;
  }
  const directory = Buffer.concat(central); const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(parts.length, 8); end.writeUInt16LE(parts.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}
export function syntheticHistoricalParts(options: { row?: string; workbookExtra?: string; extra?: Array<[string, string]> } = {}): Array<[string, string]> {
  const text = (column: string, row: number, value: string): string => `<c r="${column}${row}" t="inlineStr"><is><t>${value}</t></is></c>`;
  const header = `<row r="6">${[["A", "NOM"], ["B", "PRÉNOM"], ["C", "EMAIL"], ["D", "NIVEAU"], ["E", "PROGRAMME"], ["F", "SOURCE"], ["G", "STATUT"], ["H", "RESPONSABLE"], ["I", "COMMENTAIRE"], ["J", "TEMPÉRATURE"]].map(([column, value]) => text(column!, 6, value!)).join("")}</row>`;
  const row = options.row ?? `<row r="9">${[["A", "Synthétique"], ["B", "Exemple"], ["C", "synthetic@example.invalid"], ["D", "Bac"], ["E", "PROGRAM_SYNTHETIC"], ["F", "appel entrant"], ["G", "À contacter"], ["H", "Conseiller synthétique"], ["I", "Note exacte\navec accents é &amp; espaces  "], ["J", "Froid"]].map(([column, value]) => text(column!, 9, value!)).join("")}</row>`;
  return [
    ["xl/workbook.xml", `<workbook>${options.workbookExtra ?? ""}<sheets>${HISTORICAL_SHEETS.map((name, index) => `<sheet name="${name}" r:id="rId${index + 1}"/>`).join("")}</sheets></workbook>`],
    ["xl/_rels/workbook.xml.rels", `<Relationships>${HISTORICAL_SHEETS.map((_, index) => `<Relationship Id="rId${index + 1}" Target="worksheets/sheet${index + 1}.xml"/>`).join("")}</Relationships>`],
    ...HISTORICAL_SHEETS.map((_, index): [string, string] => [`xl/worksheets/sheet${index + 1}.xml`, `<worksheet><sheetData>${header}${row}</sheetData></worksheet>`]),
    ...(options.extra ?? []),
  ];
}
export function syntheticHistoricalWorkbook(options: Parameters<typeof syntheticHistoricalParts>[0] = {}): Buffer { return syntheticZip(syntheticHistoricalParts(options)); }
