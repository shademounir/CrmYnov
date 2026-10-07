import assert from "node:assert/strict";
import test from "node:test";
import { parseHistoricalWorkbook } from "../src/bootstrap-import/historical-workbook.js";
import { assertMapping, bytesHash, CHUNK_BYTES, decodeChunk, HISTORICAL_SHEETS } from "../src/bootstrap-import/bootstrap-import.contract.js";
import { historicalSourceCoverage, mapHistoricalRow } from "../src/bootstrap-import/bootstrap-import.service.js";
import { syntheticHistoricalParts, syntheticHistoricalWorkbook, syntheticZip } from "./fixtures/import/historical-workbook.synthetic.js";

test("historical profile keeps four sheets, physical row9, exact notes, raw dates and epoch metadata", () => {
  const workbook = parseHistoricalWorkbook(syntheticHistoricalWorkbook({ workbookExtra: '<workbookPr date1904="1"/>', extra: [["xl/styles.xml", '<styleSheet><cellXfs><xf numFmtId="14"/></cellXfs></styleSheet>']] }));
  assert.deepEqual(workbook.sheets.map((sheet) => sheet.name), HISTORICAL_SHEETS);
  assert.equal(workbook.sheets[0]!.rows[0]!.rowNumber, 9); assert.equal(workbook.sheets[0]!.columns[0]!.name, "NOM");
  assert.equal(workbook.sheets[0]!.rows[0]!.cells.I!.value, "Note exacte\navec accents é & espaces  "); assert.equal(workbook.workbookProperties.date1904, true); assert.ok(workbook.stylesXml?.includes("numFmtId"));
});
test("shared/array/missing formula caches preserved but never treated as certain business fields", () => {
  const workbook = parseHistoricalWorkbook(syntheticHistoricalWorkbook({ row: '<row r="9"><c r="A9" t="inlineStr"><is><t>Synthétique</t></is></c><c r="B9" t="inlineStr"><is><t>Exemple</t></is></c><c r="C9" t="str"><f t="shared" si="4"/><v>cache@example.invalid</v></c><c r="D9"><f t="array" ref="D9:D10">1+1</f></c><c r="I9" t="inlineStr"><is><t>   </t></is></c></row>' }));
  assert.equal(workbook.formulaCount, 8); const row = workbook.sheets[0]!.rows[0]!;
  assert.deepEqual(row.cells.C!.formula, { text: "", attributes: { t: "shared", si: "4" } }); assert.equal(row.cells.D!.value, null);
  const mapping = { name: HISTORICAL_SHEETS[0], campaign: "SYNTHETIC", fields: { firstName: "B", lastName: "A", email: "C", educationLevel: "D" }, commentColumns: ["I"], ownerAliases: {} };
  const mapped = mapHistoricalRow(row, mapping); assert.ok(mapped.reasons.includes("FORMULA_REVIEW:email")); assert.equal(mapped.comments[0]!.text, "   "); assert.equal(mapped.values.educationLevel, null);
});
test("replacement owner is authoritative even unknown; no fallback to certain original owner", () => {
  const cell = (value: string): { value: string; raw: null; type: string } => ({ value, raw: null, type: "inlineStr" });
  const original = "00000000-0000-4000-8000-000000000061";
  const mapped = mapHistoricalRow({ rowNumber: 9, cells: { R: cell("Original"), S: cell("Unknown replacement") } }, { name: HISTORICAL_SHEETS[2], campaign: "SYNTHETIC", fields: { owner: "R", replacementOwner: "S" }, commentColumns: [], ownerAliases: { Original: original } });
  assert.equal(mapped.values.ownerId, null); assert.equal(mapped.sourceOwner, "Original"); assert.equal(mapped.replacementOwner, "Unknown replacement"); assert.ok(mapped.reasons.includes("OWNER_UNKNOWN"));
});
test("terminal historical status requires review, comments never synthesize status/owner/dates", () => {
  const source = parseHistoricalWorkbook(syntheticHistoricalWorkbook()).sheets[0]!.rows[0]!;
  const mapped = mapHistoricalRow({ ...source, cells: { ...source.cells, G: { value: "Inscrit", raw: null, type: "inlineStr" } } }, { name: HISTORICAL_SHEETS[0], campaign: "SYNTHETIC", fields: { status: "G" }, commentColumns: ["I"], ownerAliases: {} });
  assert.equal(mapped.values.status, "ENROLLED"); assert.ok(mapped.reasons.includes("HISTORICAL_TERMINAL_STATUS_REVIEW")); assert.equal(mapped.comments.length, 1);
});
test("48KiB chunk canonical base64, bytes and SHA enforced independently", () => {
  const bytes = Buffer.alloc(CHUNK_BYTES, 61); assert.equal(decodeChunk({ index: 0, contentBase64: bytes.toString("base64"), sha256: bytesHash(bytes) }).length, CHUNK_BYTES);
  assert.throws(() => decodeChunk({ index: 0, contentBase64: Buffer.alloc(CHUNK_BYTES + 1).toString("base64"), sha256: "a".repeat(64) }));
  assert.throws(() => decodeChunk({ index: 0, contentBase64: bytes.toString("base64"), sha256: "a".repeat(64) }));
});
for (const [label, row] of [
  ["mismatched physical coordinates", '<row r="9"><c r="A10" t="inlineStr"><is><t>x</t></is></c></row>'],
  ["duplicate coordinates", '<row r="9"><c r="A9"/><c r="A9"/></row>'],
  ["column 101", '<row r="9"><c r="CW9"/></row>'],
  ["cell text 4001", `<row r="9"><c r="A9" t="inlineStr"><is><t>${"x".repeat(4001)}</t></is></c></row>`],
] as const) test(`historical parser refuses ${label}`, () => assert.throws(() => parseHistoricalWorkbook(syntheticHistoricalWorkbook({ row }))));
test("zip duplicate normalized names, macro, DTD and missing selected sheets refused", () => {
  assert.throws(() => parseHistoricalWorkbook(syntheticHistoricalWorkbook({ extra: [["XL/WORKBOOK.XML", "duplicate"]] })));
  assert.throws(() => parseHistoricalWorkbook(syntheticHistoricalWorkbook({ extra: [["xl/vbaProject.bin", "macro"]] })));
  assert.throws(() => parseHistoricalWorkbook(syntheticHistoricalWorkbook({ workbookExtra: '<!DOCTYPE foo [<!ENTITY x "bad">]>' })));
  const parts = syntheticHistoricalParts(); parts[0]![1] = parts[0]![1].replace('name="JOBINTECH REACT"', 'name="UNSELECTED"'); assert.throws(() => parseHistoricalWorkbook(syntheticZip(parts)));
});
test("native annotations and hyperlink targets preserved as metadata only", () => {
  const parts = syntheticHistoricalParts({ extra: [
    ["xl/worksheets/_rels/sheet1.xml.rels", '<Relationships><Relationship Id="comment" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="../comments/comment1.xml"/><Relationship Id="link" TargetMode="External" Target="https://example.invalid/never-fetched"/></Relationships>'],
    ["xl/comments/comment1.xml", '<comments><authors><author>Auteur source</author></authors><commentList><comment ref="I9" authorId="0"><text><t>Annotation native exacte</t></text></comment></commentList></comments>'],
  ] });
  parts[2]![1] = parts[2]![1].replace("</worksheet>", '<hyperlinks><hyperlink ref="I9" r:id="link"/></hyperlinks></worksheet>');
  const workbook = parseHistoricalWorkbook(syntheticZip(parts)); assert.equal(workbook.sheets[0]!.annotations.length, 1); assert.equal(workbook.sheets[0]!.hyperlinks[0]!.target, "https://example.invalid/never-fetched");
});

test("XML comments cannot manufacture rows, CDATA is literal, quoted greater-than is parsed", () => {
  const parts = syntheticHistoricalParts();
  parts[2]![1] = parts[2]![1].replace("</sheetData>", '<!--<row r="10"><c r="A10" t="inlineStr"><is><t>COMMENT_NOT_A_CELL</t></is></c></row>--></sheetData>');
  parts[2]![1] = parts[2]![1].replace('<row r="9">', '<row r="9" custom="greater>than">');
  const source = parseHistoricalWorkbook(syntheticZip(parts)); assert.deepEqual(source.sheets[0]!.rows.map((row) => row.rowNumber), [9]);
  const cdata = parseHistoricalWorkbook(syntheticHistoricalWorkbook({ row: '<row r="9"><c r="A9" t="inlineStr"><is><t><![CDATA[<row r="10">not markup</row>]]></t></is></c></row>' }));
  assert.equal(cdata.sheets[0]!.rows[0]!.cells.A!.value, '<row r="10">not markup</row>'); assert.equal(cdata.sheets[0]!.rows.length, 1);
});
test("XML malformed quoting, duplicate attributes and wrong row/cell parents are controlled refusals", () => {
  for (const row of ['<row r="9" r="10"><c r="A9"/></row>', '<row r="9"><x><c r="A9"/></x></row>', '<x><row r="9"><c r="A9"/></row></x>', '<row r="9" custom="broken><c r="A9"/></row>']) assert.throws(() => parseHistoricalWorkbook(syntheticHistoricalWorkbook({ row })));
});
test("mapping malformed objects fail closed rather than TypeError; exclusion must be explicit", () => {
  const mapping = { expectedVersion: 2, mappingVersion: "R8-v1" as const, sheets: HISTORICAL_SHEETS.map((name) => ({ name, campaign: "SYNTHETIC", fields: { firstName: "B", lastName: "A", email: "C" }, commentColumns: ["I"], ownerAliases: {} })) };
  assertMapping(mapping);
  for (const sheets of [[null, ...mapping.sheets.slice(1)], [{ ...mapping.sheets[0], fields: [] }, ...mapping.sheets.slice(1)], [{ ...mapping.sheets[0], excludedColumns: [{ column: "I", reason: "Exclusion motivée" }] }, ...mapping.sheets.slice(1)]]) assert.throws(() => assertMapping({ ...mapping, sheets } as never), (error: Error) => error.name !== "TypeError");
});
test("source coverage counts unmapped formulas and native annotations, never silently accepts omitted facts", () => {
  const sheet = parseHistoricalWorkbook(syntheticHistoricalWorkbook()).sheets[0]!;
  sheet.rows[0]!.cells.J = { value: "HOT", raw: "HOT", type: "str", formula: { text: '"HOT"', attributes: {} } };
  const mapping = { name: sheet.name, campaign: "SYNTHETIC", fields: { firstName: "B", lastName: "A", email: "C", educationLevel: "D", program: "E", source: "F", status: "G", owner: "H" }, commentColumns: ["I"], ownerAliases: {} };
  const coverage = historicalSourceCoverage(sheet, mapping); assert.equal(coverage.sourceCandidates, 1); assert.equal(coverage.formulaCells, 1); assert.equal(coverage.unmappedCells, 1); assert.equal(coverage.ledgerRows, 1);
  const excluded = historicalSourceCoverage(sheet, { ...mapping, excludedColumns: [{ column: "J", reason: "Température calculée non retenue" }] }); assert.equal(excluded.unmappedCells, 0); assert.equal(excluded.excludedCells, 1);
});
test("OPC relative sibling customXml stays in archive root; escape and duplicate ignored relationship IDs refuse", () => {
  const parts = syntheticHistoricalParts(); parts[1]![1] = parts[1]![1].replace("</Relationships>", '<Relationship Id="custom" Type="customXml" Target="../customXml/item1.xml"/></Relationships>');
  parts.push(["customXml/item1.xml", "<data/>"]); assert.equal(parseHistoricalWorkbook(syntheticZip(parts)).sheets.length, 4);
  const escaped = parts.map(([path, xml]) => [path, xml.replace("../customXml/item1.xml", "../../outside.xml")] as [string, string]); assert.throws(() => parseHistoricalWorkbook(syntheticZip(escaped)));
  parts[1]![1] = parts[1]![1].replace("</Relationships>", '<Relationship Id="custom" TargetMode="External" Target="https://example.invalid"/></Relationships>'); assert.throws(() => parseHistoricalWorkbook(syntheticZip(parts)));
});
test("threaded + legacy same-cell occurrences and reply IDs preserved without implicit deduplication", () => {
  const workbook = parseHistoricalWorkbook(syntheticHistoricalWorkbook({ extra: [
    ["xl/worksheets/_rels/sheet1.xml.rels", '<Relationships><Relationship Id="legacy" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="../comments/comment1.xml"/><Relationship Id="thread" Type="http://schemas.microsoft.com/office/2017/10/relationships/threadedComment" Target="../threadedComments/threadedComment1.xml"/></Relationships>'],
    ["xl/comments/comment1.xml", '<comments><authors><author>Auteur source</author></authors><commentList><comment ref="I9" authorId="0"><text><t>Même texte source</t></text></comment></commentList></comments>'],
    ["xl/threadedComments/threadedComment1.xml", '<ThreadedComments><threadedComment ref="I9" id="thread-1" personId="person-1" dT="2025-07-02T09:30:00Z"><text>Même texte source</text></threadedComment><threadedComment ref="I9" id="thread-2" parentId="thread-1" personId="person-1"><text>Réponse distincte</text></threadedComment></ThreadedComments>'],
    ["xl/persons/person.xml", '<personList><person id="person-1" displayName="Auteur source" providerId="SOURCE" userId="source@example.invalid"/></personList>'],
  ] }));
  const notes = workbook.sheets[0]!.annotations; assert.equal(notes.length, 3); assert.equal(new Set(notes.map((item) => item.annotationId)).size, 3);
  assert.equal(notes[1]!.text, notes[0]!.text); assert.equal(notes[1]!.author, "Auteur source"); assert.equal(notes[1]!.sourceDate, "2025-07-02T09:30:00Z"); assert.equal(notes[2]!.parentAnnotationId, "thread-1");
});
test("malformed selected threads and overlong relationship IDs refuse; unrelated sheets are not imported", () => {
  assert.throws(() => parseHistoricalWorkbook(syntheticHistoricalWorkbook({ extra: [["xl/worksheets/_rels/sheet1.xml.rels", '<Relationships><Relationship Id="tc" Type="http://schemas.microsoft.com/office/2017/10/relationships/threadedComment" Target="../notes.xml"/></Relationships>'], ["xl/notes.xml", '<ThreadedComments><threadedComment ref="I9" personId="person-1"><text>No stable id</text></threadedComment></ThreadedComments>']] })));
  const parts = syntheticHistoricalParts(); parts[1]![1] = parts[1]![1].replace('Id="rId1"', `Id="${"x".repeat(81)}"`); assert.throws(() => parseHistoricalWorkbook(syntheticZip(parts)));
  assert.equal(parseHistoricalWorkbook(syntheticHistoricalWorkbook({ extra: [["xl/threadedComments/unselected.xml", '<ThreadedComments><threadedComment ref="I9" id="unselected" personId="person"><text>Not from selected sheet</text></threadedComment></ThreadedComments>']] })).sheets.reduce((count, sheet) => count + sheet.annotations.length, 0), 0);
});
test("bounded synthetic historical volume: 2944 occurrences across 86/350/2479/29 physical rows", () => {
  const counts = [86, 350, 2479, 29]; const parts = syntheticHistoricalParts();
  for (let index = 0; index < 4; index++) {
    const part = parts[index + 2]!; const template = /<row r="9">[\s\S]*?<\/row>/.exec(part[1])![0];
    const rows = Array.from({ length: counts[index]! }, (_, offset) => template.replace('r="9"', `r="${offset + 9}"`).replace(/r="([A-Z]{1,2})9"/g, `r="$1${offset + 9}"`)).join("");
    part[1] = part[1].replace(template, rows);
  }
  const bytes = syntheticZip(parts); assert.ok(bytes.length <= 5 * 1024 * 1024);
  const workbook = parseHistoricalWorkbook(bytes); assert.deepEqual(workbook.sheets.map((sheet) => sheet.rows.length), counts);
  assert.equal(workbook.sheets.reduce((total, sheet) => total + sheet.rows.length, 0), 2944);
  for (let index = 0; index < 4; index++) {
    const sheet = workbook.sheets[index]!; assert.equal(sheet.rows[0]!.rowNumber, 9); assert.equal(sheet.rows[sheet.rows.length - 1]!.rowNumber, counts[index]! + 8);
    assert.equal(sheet.rows[sheet.rows.length - 1]!.cells.I!.value, "Note exacte\navec accents é & espaces  ");
  }
});
