import assert from "node:assert/strict";
import test from "node:test";
import { GoogleSheetsAdapter, SheetsSourceError, workbookId, type SheetsTransport } from "../src/sheet-import/google-sheets-adapter.js";

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
