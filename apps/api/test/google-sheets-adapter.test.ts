import assert from "node:assert/strict";
import test from "node:test";
import { GoogleSheetsAdapter, SheetsSourceError, workbookId, type SheetLiteralIdentityContract, type SheetsTransport } from "../src/sheet-import/google-sheets-adapter.js";

const id = "synthetic_workbook_001";
const tokens = { accessToken: (): Promise<string> => Promise.resolve("synthetic-test-only") };
function adapter(body: unknown): GoogleSheetsAdapter {
  return new GoogleSheetsAdapter(tokens, (): Promise<Response> => Promise.resolve(Response.json(body)));
}

test("Workbook link extracts only a Google document identity, never an arbitrary fetch URL", () => {
  assert.equal(workbookId(`https://docs.google.com/spreadsheets/d/${id}/edit?gid=0#gid=0`), id);
  for (const link of ["http://127.0.0.1/sheet", `https://docs.google.com.evil.invalid/spreadsheets/d/${id}/edit`,
    `https://user:pass@docs.google.com/spreadsheets/d/${id}/edit`, `https://docs.google.com:444/spreadsheets/d/${id}/edit`,
    `https://docs.google.com/spreadsheets/d/${id}/export`, "not-a-url"]) assert.throws(() => workbookId(link), /sheet_workbook_link_invalid/u);
});

test("Only allowlisted GET requests are made with server token and redirects disabled", async () => {
  const seen: string[] = [];
  const transport: SheetsTransport = (url, init): Promise<Response> => {
    seen.push(url.origin);
    assert.equal(init.method, "GET");
    assert.equal(init.redirect, "error");
    assert.equal(new Headers(init.headers).get("authorization"), "Bearer synthetic-test-only");
    assert.ok(init.signal);
    return Promise.resolve(Response.json({ sheets: [{ properties: { sheetId: 0, title: "Synthétique" } }] }));
  };
  assert.deepEqual(await new GoogleSheetsAdapter(tokens, transport).tabs(id), [{ id: 0, title: "Synthétique" }]);
  assert.deepEqual(seen, ["https://sheets.googleapis.com"]);
});

test("Apostrophes in tab names are escaped and values keep positional empty cells", async () => {
  const transport: SheetsTransport = (url): Promise<Response> => {
    assert.ok(decodeURIComponent(url.pathname).endsWith("'L''onglet'!A1:CW10002"));
    assert.equal(url.searchParams.get("majorDimension"), "ROWS");
    return Promise.resolve(Response.json({ values: [["Submission ID", "Programme"], ["synthetic-001"], ["synthetic-002", "Programme synthétique"]] }));
  };
  const result = await new GoogleSheetsAdapter(tokens, transport).values(id, "L'onglet");
  assert.deepEqual(result.rows[0], { "Submission ID": "synthetic-001", Programme: "" });
  assert.equal(result.rows.length, 2);
});

test("Empty sheet is distinct from malformed headers", async () => {
  assert.deepEqual(await adapter({}).values(id, "Synthétique"), { columns: [], rows: [] });
  for (const values of [[["id", "id"]], [[""]], [["id"], ["one", "unexpected"]]]) {
    await assert.rejects(adapter({ values }).values(id, "Synthétique"), SheetsSourceError);
  }
});

test("Google errors retain only status and Retry-After, never provider details", async () => {
  for (const status of [401, 403, 429, 500, 503]) {
    const source = new GoogleSheetsAdapter(tokens, (): Promise<Response> => Promise.resolve(new Response("synthetic confidential detail", { status, headers: { "retry-after": "60" } })));
    await assert.rejects(source.tabs(id), (error: unknown): boolean => {
      assert.ok(error instanceof SheetsSourceError);
      assert.equal(error.status, status);
      assert.equal(error.retryAfter, "60");
      assert.equal(error.message, "sheet_source_unavailable");
      assert.equal(JSON.stringify(error).includes("confidential"), false);
      return true;
    });
  }
});

test("Network and malformed JSON errors are expurgated", async () => {
  const broken = new GoogleSheetsAdapter(tokens, (): Promise<Response> => Promise.reject(new Error("synthetic credential must not escape")));
  await assert.rejects(broken.tabs(id), /sheet_network_unavailable/u);
  const invalid = new GoogleSheetsAdapter(tokens, (): Promise<Response> => Promise.resolve(new Response("not-json")));
  await assert.rejects(invalid.tabs(id), /sheet_response_invalid/u);
});

test("Oversized response and excess rows fail instead of producing a partial import", async () => {
  const large = new GoogleSheetsAdapter(tokens, (): Promise<Response> => Promise.resolve(new Response(" ".repeat(4 * 1024 * 1024 + 1))));
  await assert.rejects(large.tabs(id), /sheet_response_too_large/u);
  await assert.rejects(adapter({ values: Array.from({ length: 10_002 }, () => ["synthetic"]) }).values(id, "Synthétique"), /sheet_row_limit_exceeded/u);
});

test("Invalid workbook identities and tab names never call transport", async () => {
  const source = new GoogleSheetsAdapter(tokens, (): Promise<Response> => { throw new Error("transport_must_not_run"); });
  await assert.rejects(source.tabs("../outside"), /sheet_workbook_id_invalid/u);
  await assert.rejects(source.values(id, "bad\ntab"), /sheet_tab_invalid/u);
});

const literalContract: SheetLiteralIdentityContract = { externalIdColumn: "Submission ID", originalArrivalColumn: "Original UTC" };
const originalUtc = "2026-10-09T09:00:00Z";
type TestCell = { formattedValue?: string; userEnteredValue?: Record<string, unknown>; effectiveValue?: Record<string, unknown> };
function literal(value: string): TestCell {
  return { formattedValue: value, userEnteredValue: { stringValue: value }, effectiveValue: { stringValue: value } };
}
function grid(rows: TestCell[][], columns = ["Submission ID", "Original UTC", "Name"]): unknown {
  return { sheets: [{ properties: { sheetId: 0, title: "Fixture" }, data: [{ startRow: 2, startColumn: 1,
    rowData: [{ values: columns.map(literal) }, ...rows.map((values) => ({ values }))] }] }] };
}
function readLiterals(body: unknown): ReturnType<GoogleSheetsAdapter["boundedValues"]> {
  return adapter(body).boundedValues(id, "Fixture", "B3:D10", 0, "EXTERNAL_ID", literalContract);
}

test("Literal opt-in reads ONE enriched bounded response and returns only two-column evidence", async () => {
  let calls = 0;
  const body = grid([
    [literal("=literal-not-a-formula"), literal(originalUtc), { formattedValue: "Synthetic", userEnteredValue: { formulaValue: "=PRIVATE_OTHER_COLUMN()" }, effectiveValue: { stringValue: "Synthetic" } }],
    [],
    [literal("Case-Exact"), literal("2026-10-09T09:00:00.123Z")],
    [literal("case-exact"), literal("2026-10-09T09:00:00.000Z"), {}],
  ]);
  const transport: SheetsTransport = (url, init): Promise<Response> => {
    calls++;
    assert.equal(init.method, "GET"); assert.equal(init.redirect, "error");
    assert.equal(url.searchParams.get("ranges"), "'Fixture'!B3:D10");
    assert.equal(url.searchParams.get("fields"), "sheets(properties(sheetId,title),data(startRow,startColumn,rowData(values(formattedValue,userEnteredValue,effectiveValue))))");
    return Promise.resolve(Response.json(body));
  };
  const result = await new GoogleSheetsAdapter(tokens, transport).boundedValues(id, "Fixture", "B3:D10", 0, "EXTERNAL_ID", literalContract);
  assert.equal(calls, 1);
  const legacy = await adapter(body).boundedValues(id, "Fixture", "B3:D10", 0);
  const { literalEvidence, ...projection } = result;
  assert.deepEqual(projection, legacy);
  assert.deepEqual(result.rows[1], { "Submission ID": "", "Original UTC": "", Name: "" });
  assert.deepEqual(literalEvidence, { kind: "LITERAL_IDENTITY_COLUMNS", producerAttested: false, ...literalContract,
    rows: [{ rowNumber: 4, externalId: "=literal-not-a-formula", originalArrivedAt: originalUtc },
      { rowNumber: 6, externalId: "Case-Exact", originalArrivedAt: "2026-10-09T09:00:00.123Z" },
      { rowNumber: 7, externalId: "case-exact", originalArrivedAt: "2026-10-09T09:00:00.000Z" }] });
  assert.equal(JSON.stringify(result).includes("PRIVATE_OTHER_COLUMN"), false);
  assert.equal(JSON.stringify(literalEvidence).includes("Synthetic"), false);
});

test("Absent literal contract keeps legacy field mask and LOCAL_ROW observations unchanged", async () => {
  const body = grid([[{ formattedValue: "derived", userEnteredValue: { formulaValue: "=ROW()" } }, { formattedValue: "local date" }]]);
  const source = new GoogleSheetsAdapter(tokens, (url): Promise<Response> => {
    assert.equal(url.searchParams.get("fields"), "sheets(properties(sheetId,title),data(startRow,startColumn,rowData(values(formattedValue))))");
    return Promise.resolve(Response.json(body));
  });
  const ordinary = await source.boundedValues(id, "Fixture", "B3:D10", 0);
  const local = await source.boundedValues(id, "Fixture", "B3:D10", 0, "LOCAL_ROW");
  assert.equal(Object.hasOwn(ordinary, "literalEvidence"), false);
  assert.equal(Object.hasOwn(local, "literalEvidence"), false);
  assert.deepEqual(local.observation, ordinary.observation);
  assert.deepEqual(local.rows, []);
});

test("Invalid or LOCAL_ROW literal contracts fail before credentials or transport", async () => {
  let calls = 0;
  const source = new GoogleSheetsAdapter({ accessToken: (): Promise<string> => { calls++; return Promise.resolve("must-not-run"); } },
    (): Promise<Response> => { calls++; throw new Error("must-not-run"); });
  for (const contract of [null, {}, { ...literalContract, originalArrivalColumn: "Submission ID" },
    { ...literalContract, externalIdColumn: " Submission ID" }, { ...literalContract, externalIdColumn: "x".repeat(201) },
    { ...literalContract, externalIdColumn: "bad\nname" }, { ...literalContract, producerAttested: true, kind: "GOOGLE_ATTESTED" }]) {
    await assert.rejects(source.boundedValues(id, "Fixture", "B3:D10", 0, "EXTERNAL_ID", contract as SheetLiteralIdentityContract), /sheet_literal_contract_invalid/u);
  }
  await assert.rejects(source.boundedValues(id, "Fixture", "B3:D10", 0, "LOCAL_ROW", literalContract), /sheet_literal_contract_invalid/u);
  assert.equal(calls, 0);
});

test("Inherited column names with two unrelated own properties are refused before any I/O", async () => {
  let calls = 0;
  const source = new GoogleSheetsAdapter({ accessToken: (): Promise<string> => { calls++; return Promise.resolve("must-not-run"); } },
    (): Promise<Response> => { calls++; throw new Error("must-not-run"); });
  const inherited = Object.assign(Object.create(literalContract) as Record<string, unknown>, { unrelatedOne: true, unrelatedTwo: true });
  await assert.rejects(source.boundedValues(id, "Fixture", "B3:D10", 0, "EXTERNAL_ID", inherited as unknown as SheetLiteralIdentityContract), /sheet_literal_contract_invalid/u);
  assert.equal(calls, 0);
});

test("Caller mutation during I/O cannot replace the validated column snapshot or attestation sentinel", async () => {
  const contract = { ...literalContract };
  const source = new GoogleSheetsAdapter(tokens, (): Promise<Response> => {
    Object.assign(contract, { externalIdColumn: "Name", originalArrivalColumn: "Submission ID", producerAttested: true, kind: "GOOGLE_ATTESTED" });
    return Promise.resolve(Response.json(grid([[literal("initial-id"), literal(originalUtc), literal("Synthetic")]])));
  });
  const result = await source.boundedValues(id, "Fixture", "B3:D10", 0, "EXTERNAL_ID", contract);
  assert.deepEqual(result.literalEvidence, { kind: "LITERAL_IDENTITY_COLUMNS", producerAttested: false, ...literalContract,
    rows: [{ rowNumber: 4, externalId: "initial-id", originalArrivedAt: originalUtc }] });
});

test("Literal identity requires both unambiguous header names, even on an empty sheet", async () => {
  await assert.rejects(readLiterals(grid([], ["Submission ID", "Not UTC"])), /sheet_literal_columns_required/u);
  await assert.rejects(readLiterals(grid([], ["Submission ID", "Original UTC", "Submission ID"])), /sheet_columns_invalid/u);
  await assert.rejects(readLiterals(grid([], ["Submission ID", "Original UTC", ""])), /sheet_columns_invalid/u);
  const result = await readLiterals(grid([]));
  assert.deepEqual(result.literalEvidence?.rows, []);
});

test("The two identity headers must themselves be literal strings, not formula or effective-only labels", async () => {
  for (const value of [
    { formattedValue: "Submission ID", userEnteredValue: { formulaValue: '="Submission ID"' }, effectiveValue: { stringValue: "Submission ID" } },
    { formattedValue: "Submission ID", effectiveValue: { stringValue: "Submission ID" } },
    { formattedValue: "Submission ID", userEnteredValue: { stringValue: "Submission ID" }, effectiveValue: { stringValue: "OTHER" } },
  ]) {
    const body = { sheets: [{ properties: { sheetId: 0, title: "Fixture" }, data: [{ startRow: 2, startColumn: 1,
      rowData: [{ values: [value, literal("Original UTC"), { formattedValue: "Name" }] }] }] }] };
    await assert.rejects(readLiterals(body), /sheet_identity_(formula_refused|literal_required|literal_mismatch)/u);
  }
});

test("Submission ID stays exact and rejects empty, whitespace, controls, overflow and duplicates", async () => {
  for (const externalId of ["", " ", " leading", "trailing ", "bad\u0000id", "bad\u007fid", "x".repeat(129)]) {
    await assert.rejects(readLiterals(grid([[literal(externalId), literal(originalUtc)]])), /sheet_submission_literal_invalid/u);
  }
  await assert.rejects(readLiterals(grid([[literal("same"), literal(originalUtc)], [literal("same"), literal("2026-10-09T10:00:00Z")]])), /sheet_submission_literal_ambiguous/u);
  const result = await readLiterals(grid([[literal("x".repeat(128)), literal(originalUtc)]]));
  assert.equal(result.literalEvidence?.rows[0]?.externalId.length, 128);
});

test("Only calendar-valid original literal UTC instants are accepted, not spreadsheet dates or heuristics", async () => {
  for (const value of ["09/10/2026 09:00", "2026-10-09", "2026-10-09T09:00:00+01:00", "2026-10-09T09:00:00", "2026-10-09T09:00:00.1Z",
    "2026-02-29T09:00:00Z", "2026-04-31T09:00:00Z", "2026-13-01T09:00:00Z", "2026-10-09T24:00:00Z", "2026-10-09T09:60:00Z", "2026-10-09T09:00:60Z", "2026-10-09T09:00:00Z "]) {
    await assert.rejects(readLiterals(grid([[literal("synthetic-id"), literal(value)]])), /sheet_original_utc_literal_required/u);
  }
  await assert.rejects(readLiterals(grid([[literal("synthetic-id"), { formattedValue: originalUtc, userEnteredValue: { numberValue: 46204.375 }, effectiveValue: { numberValue: 46204.375 } }]])), /sheet_identity_literal_required/u);
  assert.equal((await readLiterals(grid([[literal("leap"), literal("2028-02-29T09:00:00Z")]]))).literalEvidence?.rows[0]?.originalArrivedAt, "2028-02-29T09:00:00Z");
});

test("Formula, nonstring, missing and ambiguous ExtendedValue never become literal proof", async () => {
  const invalid: TestCell[] = [
    { formattedValue: "synthetic-id", userEnteredValue: { formulaValue: '="synthetic-id"' }, effectiveValue: { stringValue: "synthetic-id" } },
    { formattedValue: "", userEnteredValue: { formulaValue: '=""' }, effectiveValue: { stringValue: "" } },
    { formattedValue: "0", userEnteredValue: { numberValue: 0 }, effectiveValue: { numberValue: 0 } },
    { formattedValue: "FALSE", userEnteredValue: { boolValue: false }, effectiveValue: { boolValue: false } },
    { formattedValue: "synthetic-id", effectiveValue: { stringValue: "synthetic-id" } },
    { formattedValue: "synthetic-id", userEnteredValue: { stringValue: "synthetic-id" } },
    { formattedValue: "synthetic-id", userEnteredValue: { stringValue: "synthetic-id", numberValue: 1 }, effectiveValue: { stringValue: "synthetic-id" } },
    { formattedValue: "synthetic-id", userEnteredValue: { stringValue: "synthetic-id" }, effectiveValue: { stringValue: "synthetic-id", boolValue: true } },
    { formattedValue: "#N/A", userEnteredValue: { stringValue: "synthetic-id" }, effectiveValue: { errorValue: { type: "N_A", message: "private test detail" } } },
  ];
  for (const entry of invalid) {
    await assert.rejects(readLiterals(grid([[entry, literal(originalUtc)]])), (error: unknown) => {
      assert.ok(error instanceof SheetsSourceError);
      assert.match(error.code, /^sheet_identity_(formula_refused|literal_required)$/u);
      assert.equal(JSON.stringify(error).includes("private test detail"), false);
      return true;
    });
  }
  await assert.rejects(readLiterals(grid([[invalid[1]!, {}]])), /sheet_identity_formula_refused/u);
  await assert.rejects(readLiterals(grid([[literal("synthetic-id"), { ...literal(originalUtc), userEnteredValue: { formulaValue: '="2026-10-09T09:00:00Z"' } }]])), /sheet_identity_formula_refused/u);
});

test("Effective and displayed identity values must exactly equal the literal, with no normalization", async () => {
  for (const entry of [
    { ...literal("synthetic-id"), effectiveValue: { stringValue: "OTHER" } },
    { ...literal("synthetic-id"), formattedValue: "SYNTHETIC-ID" },
    { userEnteredValue: { stringValue: "synthetic-id" }, effectiveValue: { stringValue: "synthetic-id" } },
  ]) await assert.rejects(readLiterals(grid([[entry, literal(originalUtc)]])), /sheet_identity_literal_mismatch/u);
  await assert.rejects(readLiterals(grid([[literal("synthetic-id"), { ...literal(originalUtc), effectiveValue: { stringValue: "2026-10-09T09:00:00.000Z" } }]])), /sheet_identity_literal_mismatch/u);
});

test("Missing positional identity cells are not shifted from a later row or invented", async () => {
  await assert.rejects(readLiterals(grid([[literal("first"), literal(originalUtc)], [], [literal("third")]])), /sheet_identity_literal_required/u);
  await assert.rejects(readLiterals(grid([[{}, literal(originalUtc), literal("Synthetic")]])), /sheet_identity_literal_required/u);
  await assert.rejects(readLiterals(grid(Array.from({ length: 8 }, (_, index) => [literal(`id-${index}`), literal(originalUtc)]))), /sheet_row_limit_exceeded/u);
  await assert.rejects(readLiterals(grid([[literal("one"), literal(originalUtc), {}, {}]])), /sheet_columns_invalid/u);
});

test("Enriched envelope remains subject to the complete 4 MiB response limit", async () => {
  const body = grid([[literal("synthetic-id"), literal(originalUtc), { formattedValue: "Synthetic", userEnteredValue: { stringValue: "x".repeat(4 * 1024 * 1024) } }]]);
  await assert.rejects(readLiterals(body), /sheet_response_too_large/u);
});
