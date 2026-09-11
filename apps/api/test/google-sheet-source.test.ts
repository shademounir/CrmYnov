import assert from "node:assert/strict";
import { generateKeyPairSync, verify } from "node:crypto";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { GoogleAdcImpersonatedTokens, GoogleServiceAccountTokens, readPrivateGoogleJson } from "../src/sheet-import/google-sheets-auth.js";
import { GoogleSheetsAdapter, validateSheetRange } from "../src/sheet-import/google-sheets-adapter.js";
import { createSheetSource, parseGoogleAllowlist, RoutedSheetSource } from "../src/sheet-import/google-sheet-source.js";
import { SyntheticSheetSource } from "../src/sheet-import/synthetic-sheet-source.js";
import type { SheetConfiguration } from "../src/sheet-import/sheet-import-configuration.js";

function config(): SheetConfiguration {
  return { assignment: { strategy: "UNASSIGNED" }, context: { source: "WEB_FORM", technicalSystem: "FORMINATOR_ZAPIER", originalSource: "FORMINATOR" },
    mapping: { id: "synthetic", mappingKey: "synthetic", name: "Synthétique", profile: "FORMINATOR_ZAPIER", version: 1, columns: [],
      builtIn: false, createdAt: "2026-09-07T00:00:00Z", createdBy: "synthetic" } };
}

test("Disabled factory never discovers credentials or contacts Google", async () => {
  const source = await createSheetSource({ GOOGLE_APPLICATION_CREDENTIALS: "must-not-be-read" }, ".", (): Promise<Response> => { throw new Error("network_forbidden"); });
  assert.throws(() => source.validateSelection("synthetic_workbook", "Fixture", { mode: "GOOGLE", identityMode: "LOCAL_ROW", sheetId: 0, range: "A1:C6" }), /sheet_real_source_disabled/u);
});

test("Worker capability separates simulated and Google execution before a lease is claimed", () => {
  const googleConfiguration: SheetConfiguration = { ...config(), source: { mode: "GOOGLE", identityMode: "LOCAL_ROW", sheetId: 0, range: "A1:C6" } };
  const simulatedConfiguration: SheetConfiguration = { ...config(), source: { mode: "SIMULATED", identityMode: "LOCAL_ROW", sheetId: 0, range: "A1:C6" } };
  const simulatedOnly = new RoutedSheetSource(new SyntheticSheetSource());
  const googleCapable = new RoutedSheetSource(new SyntheticSheetSource(),
    new GoogleSheetsAdapter({ accessToken: (): Promise<string> => Promise.resolve("synthetic") }, (): Promise<Response> => { throw new Error("network_forbidden"); }));
  assert.equal(simulatedOnly.canProcess(simulatedConfiguration), true);
  assert.equal(simulatedOnly.canProcess(googleConfiguration), false);
  assert.equal(googleCapable.canProcess(googleConfiguration), true);
});

test("Exact allowlist rejects broadened range, tab and numeric identity without a network call", () => {
  const adapter = new GoogleSheetsAdapter({ accessToken: (): Promise<string> => Promise.resolve("synthetic") }, (): Promise<Response> => { throw new Error("network_forbidden"); });
  const allowed = parseGoogleAllowlist({ sources: [{ workbookId: "synthetic_workbook", tab: "Fixture", sheetId: 0, range: "A1:C6" }] });
  const source = new RoutedSheetSource(new SyntheticSheetSource(), adapter, allowed);
  const selection = { mode: "GOOGLE", identityMode: "LOCAL_ROW", sheetId: 0, range: "A1:C6" } as const;
  source.validateSelection("synthetic_workbook", "Fixture", selection);
  for (const change of [{ range: "A1:C7" }, { sheetId: 1 }]) {
    assert.throws(() => source.validateSelection("synthetic_workbook", "Fixture", { ...selection, ...change }), /sheet_source_not_authorized/u);
  }
  assert.throws(() => source.validateSelection("synthetic_workbook", "Fixture", { mode: "GOOGLE", identityMode: "LOCAL_ROW", sheetId: 0 }), /sheet_source_not_authorized/u);
  assert.throws(() => source.validateSelection("synthetic_workbook", "Other", selection), /sheet_source_not_authorized/u);
});

test("Only bounded rectangular ranges are accepted", () => {
  for (const range of ["A1:K6", "B3:D10"]) validateSheetRange(range);
  for (const range of ["A:K", "A1", "A0:C6", "D6:A1", "A1:ZZ6", "A1:A999999", "A1:C1", "A1:C6!Other"]) assert.throws(() => validateSheetRange(range), /sheet_range_invalid/u);
});

test("Bounded source preserves interior empty rows and exact physical columns", async () => {
  const adapter = new GoogleSheetsAdapter({ accessToken: (): Promise<string> => Promise.resolve("synthetic") }, (url): Promise<Response> => {
    assert.ok(decodeURIComponent(url.pathname).endsWith("'Fixture'!A1:C6"));
    return Promise.resolve(Response.json({ values: [["id", "name", "value"], ["one"], [], ["two", "", "three"]] }));
  });
  const result = await adapter.values("synthetic_workbook", "Fixture", "A1:C6", 0);
  assert.deepEqual(result.observation, { sheetId: 0, range: "A1:C6", values: [["id", "name", "value"], ["one"], [], ["two", "", "three"]] });
  assert.deepEqual(result.rows[1], { id: "", name: "", value: "" });
});

test("Service account uses signed readonly assertion, fixed endpoint, single concurrent exchange and cached token", async () => {
  const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
  let calls = 0;
  const tokens = new GoogleServiceAccountTokens({ type: "service_account", client_email: "synthetic@synthetic.iam.gserviceaccount.com", token_uri: "https://oauth2.googleapis.com/token",
    private_key: keys.privateKey.export({ type: "pkcs8", format: "pem" }) }, (url, init): Promise<Response> => {
    calls++;
    assert.equal(url.href, "https://oauth2.googleapis.com/token");
    assert.equal(init.redirect, "error");
    assert.equal(init.method, "POST");
    assert.equal(typeof init.body, "string");
    if (typeof init.body !== "string") throw new Error("body_required");
    const assertion = new URLSearchParams(init.body).get("assertion") ?? "";
    const [header, payload, signature] = assertion.split(".");
    assert.ok(header && payload && signature);
    const claims: unknown = JSON.parse(Buffer.from(payload, "base64url").toString());
    assert.deepEqual(claims, { iss: "synthetic@synthetic.iam.gserviceaccount.com", scope: "https://www.googleapis.com/auth/spreadsheets.readonly", aud: url.href, iat: 1000, exp: 4600 });
    assert.ok(verify("RSA-SHA256", Buffer.from(`${header}.${payload}`), keys.publicKey, Buffer.from(signature, "base64url")));
    return Promise.resolve(Response.json({ access_token: "synthetic-access-token", token_type: "Bearer", expires_in: 3600 }));
  }, () => 1_000_000);
  assert.deepEqual(await Promise.all([tokens.accessToken(), tokens.accessToken()]), ["synthetic-access-token", "synthetic-access-token"]);
  assert.equal(await tokens.accessToken(), "synthetic-access-token");
  assert.equal(calls, 1);
});

test("ADC impersonation requires the exact service account and readonly Sheets scope", async () => {
  const principal = "synthetic-reader@synthetic-project.iam.gserviceaccount.com";
  let loads = 0;
  let tokenCalls = 0;
  const tokens = new GoogleAdcImpersonatedTokens(principal, (targetPrincipal, scopes): Promise<{
    readonly targetPrincipal: string;
    accessToken(): Promise<string>;
  }> => {
    loads++;
    assert.equal(targetPrincipal, principal);
    assert.deepEqual(scopes, ["https://www.googleapis.com/auth/spreadsheets.readonly"]);
    return Promise.resolve({
      targetPrincipal: principal,
      accessToken: (): Promise<string> => {
        tokenCalls++;
        return Promise.resolve("synthetic-impersonated-token");
      }
    });
  });
  assert.deepEqual(await Promise.all([tokens.accessToken(), tokens.accessToken()]),
    ["synthetic-impersonated-token", "synthetic-impersonated-token"]);
  assert.equal(loads, 1);
  assert.equal(tokenCalls, 1);
});

test("ADC impersonation refuses a different effective identity without exposing a token", async () => {
  const tokens = new GoogleAdcImpersonatedTokens("expected@synthetic-project.iam.gserviceaccount.com", (): Promise<{
    readonly targetPrincipal: string;
    accessToken(): Promise<string>;
  }> => Promise.resolve({
    targetPrincipal: "other@synthetic-project.iam.gserviceaccount.com",
    accessToken: (): Promise<string> => Promise.resolve("must-not-be-returned")
  }));
  await assert.rejects(tokens.accessToken(), /sheet_auth_identity_mismatch/u);
});

test("Real factory selects explicit ADC impersonation without a private key", async () => {
  const directory = await mkdtemp(join(resolve(__dirname, "../../../.."), "crm-google-adc-test-"));
  try {
    const allowlistPath = join(directory, "allowlist.json");
    await writeFile(allowlistPath, JSON.stringify({
      sources: [{ workbookId: "synthetic_workbook", tab: "Fixture", sheetId: 0, range: "A1:C6" }]
    }), { flag: "wx" });
    const principal = "synthetic-reader@synthetic-project.iam.gserviceaccount.com";
    const source = await createSheetSource({
      CRM_GOOGLE_SHEETS_ENABLED: "true",
      CRM_GOOGLE_SHEETS_AUTH_MODE: "ADC_IMPERSONATION",
      CRM_GOOGLE_SHEETS_IMPERSONATE_SERVICE_ACCOUNT: principal,
      CRM_GOOGLE_SHEETS_ALLOWLIST_FILE: allowlistPath
    }, process.cwd(), (url, init): Promise<Response> => {
      assert.equal(url.origin, "https://sheets.googleapis.com");
      assert.equal(new Headers(init.headers).get("authorization"), "Bearer synthetic-adc-token");
      return Promise.resolve(Response.json({ sheets: [{ properties: { sheetId: 0, title: "Fixture" }, data: [{}] }] }));
    }, (targetPrincipal, scopes): Promise<{
      readonly targetPrincipal: string;
      accessToken(): Promise<string>;
    }> => {
      assert.equal(targetPrincipal, principal);
      assert.deepEqual(scopes, ["https://www.googleapis.com/auth/spreadsheets.readonly"]);
      return Promise.resolve({ targetPrincipal: principal, accessToken: (): Promise<string> => Promise.resolve("synthetic-adc-token") });
    });
    const result = await source.read("synthetic_workbook", "Fixture", {
      ...config(), source: { mode: "GOOGLE", identityMode: "LOCAL_ROW", sheetId: 0, range: "A1:C6" }
    });
    assert.deepEqual(result.rows, []);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("Real factory refuses ambiguous or implicit authentication modes", async () => {
  const directory = await mkdtemp(join(resolve(__dirname, "../../../.."), "crm-google-auth-mode-test-"));
  try {
    const allowlistPath = join(directory, "allowlist.json");
    await writeFile(allowlistPath, JSON.stringify({
      sources: [{ workbookId: "synthetic_workbook", tab: "Fixture", sheetId: 0, range: "A1:C6" }]
    }), { flag: "wx" });
    const base = { CRM_GOOGLE_SHEETS_ENABLED: "true", CRM_GOOGLE_SHEETS_ALLOWLIST_FILE: allowlistPath };
    await assert.rejects(createSheetSource(base, process.cwd()), /sheet_server_configuration_invalid/u);
    await assert.rejects(createSheetSource({ ...base, CRM_GOOGLE_SHEETS_AUTH_MODE: "ADC_IMPERSONATION",
      CRM_GOOGLE_SHEETS_IMPERSONATE_SERVICE_ACCOUNT: "reader@synthetic.iam.gserviceaccount.com",
      CRM_GOOGLE_SHEETS_CREDENTIALS_FILE: allowlistPath }, process.cwd()), /sheet_server_configuration_invalid/u);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("Invalid credentials never leak provider or private values", () => {
  assert.throws(() => new GoogleServiceAccountTokens({ type: "authorized_user", private_key: "sensitive-test-marker" }, (): Promise<Response> => { throw new Error(); }), /sheet_auth_configuration_invalid/u);
  assert.throws(() => parseGoogleAllowlist({ sources: [{ workbookId: "../escape" }] }), /sheet_allowlist_invalid/u);
});

test("Real route checks numeric tab identity and never substitutes synthetic content on Google failure", async () => {
  const allowed = [{ workbookId: "synthetic_workbook", tab: "Fixture", sheetId: 0, range: "A1:C6" }];
  for (const status of [200, 403, 429, 503]) {
    let calls = 0;
    const adapter = new GoogleSheetsAdapter({ accessToken: (): Promise<string> => Promise.resolve("synthetic") }, (): Promise<Response> => {
      calls++;
      return Promise.resolve(status === 200 ? Response.json({ sheets: [{ properties: { sheetId: 99, title: "Fixture" } }] }) : new Response("must-not-escape", { status }));
    });
    const source = new RoutedSheetSource(new SyntheticSheetSource(), adapter, allowed);
    await assert.rejects(source.read("synthetic_workbook", "Fixture", { ...config(), source: { mode: "GOOGLE", identityMode: "LOCAL_ROW", sheetId: 0, range: "A1:C6" } }), status === 200 ? /sheet_tab_identity_changed/u : /sheet_source_unavailable/u);
    assert.equal(calls, 1);
  }
});

test("Real route reads only exact authorized range with identity in the same response", async () => {
  const paths: string[] = [];
  const adapter = new GoogleSheetsAdapter({ accessToken: (): Promise<string> => Promise.resolve("synthetic") }, (url): Promise<Response> => {
    paths.push(decodeURIComponent(url.pathname));
    assert.equal(url.searchParams.get("ranges"), "'Fixture'!A1:C6");
    assert.ok(url.searchParams.get("fields")?.includes("formattedValue"));
    return Promise.resolve(Response.json({ sheets: [{ properties: { sheetId: 0, title: "Fixture" }, data: [{ rowData: [
      { values: [{ formattedValue: "id" }] }, { values: [{ formattedValue: "synthetic-one" }] }
    ] }] }] }));
  });
  const source = new RoutedSheetSource(new SyntheticSheetSource(), adapter, [{ workbookId: "synthetic_workbook", tab: "Fixture", sheetId: 0, range: "A1:C6" }]);
  const result = await source.read("synthetic_workbook", "Fixture", { ...config(), source: { mode: "GOOGLE", identityMode: "LOCAL_ROW", sheetId: 0, range: "A1:C6" } });
  assert.deepEqual(result.rows, []);
  assert.deepEqual(result.observation?.values, [["id"], ["synthetic-one"]]);
  assert.equal(paths.length, 1);
  assert.equal(paths[0], "/v4/spreadsheets/synthetic_workbook");
});

test("Explicit private configuration files must be outside every Git worktree and are bounded", async () => {
  // The Windows account's temp directory can itself be inside an unrelated Git worktree.
  const directory = await mkdtemp(join(resolve(__dirname, "../../../.."), "crm-google-config-test-"));
  try {
    const path = join(directory, "synthetic.json");
    await writeFile(path, JSON.stringify({ fixture: "synthetic" }), { flag: "wx" });
    assert.deepEqual(await readPrivateGoogleJson(path, process.cwd()), { fixture: "synthetic" });
    await assert.rejects(readPrivateGoogleJson("relative.json", process.cwd()), /sheet_server_configuration_invalid/u);
    await assert.rejects(readPrivateGoogleJson(join(process.cwd(), "package.json"), process.cwd()), /sheet_server_configuration_invalid/u);
    await writeFile(path, " ".repeat(65 * 1024));
    await assert.rejects(readPrivateGoogleJson(path, process.cwd()), /sheet_server_configuration_invalid/u);
    await writeFile(path, "invalid-synthetic-json");
    await assert.rejects(readPrivateGoogleJson(path, process.cwd()), /sheet_server_configuration_invalid/u);
    await mkdir(join(directory, ".git"));
    await writeFile(path, "{}");
    await assert.rejects(readPrivateGoogleJson(path, process.cwd()), /sheet_server_configuration_invalid/u);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("Token errors are expurgated without retries or cached success", async () => {
  const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
  for (const body of [new Response("sensitive-provider-detail", { status: 403 }), Response.json({ access_token: "bad token", token_type: "Bearer", expires_in: 3600 }),
    new Response(" ".repeat(16_385)), new Response("not-json")]) {
    let calls = 0;
    const tokens = new GoogleServiceAccountTokens({ type: "service_account", client_email: "synthetic@synthetic.iam.gserviceaccount.com", token_uri: "https://oauth2.googleapis.com/token",
      private_key: keys.privateKey.export({ type: "pkcs8", format: "pem" }) }, (): Promise<Response> => { calls++; return Promise.resolve(body); });
    await assert.rejects(tokens.accessToken(), (error: unknown): boolean => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, "sheet_auth_unavailable");
      assert.equal(JSON.stringify(error).includes("sensitive"), false);
      return true;
    });
    assert.equal(calls, 1);
  }
});

test("Single-response bounded reads refuse different offsets and excess cells", async () => {
  for (const data of [[{ startRow: 1 }], [{ startColumn: 1 }], [{ rowData: Array.from({ length: 7 }, () => ({})) }],
    [{ rowData: [{ values: [{}, {}, {}, {}] }] }], []]) {
    const adapter = new GoogleSheetsAdapter({ accessToken: (): Promise<string> => Promise.resolve("synthetic") }, (): Promise<Response> => Promise.resolve(Response.json({
      sheets: [{ properties: { sheetId: 0, title: "Fixture" }, data }]
    })));
    await assert.rejects(adapter.boundedValues("synthetic_workbook", "Fixture", "A1:C6", 0), /sheet_(response_invalid|row_limit_exceeded|columns_invalid)/u);
  }
});

test("LOCAL_ROW preserves invalid headers for ledger reconciliation without fabricating keyed rows", async () => {
  for (const headers of [["", "name"], ["id", "id"], []]) {
    const adapter = new GoogleSheetsAdapter({ accessToken: (): Promise<string> => Promise.resolve("synthetic") }, (): Promise<Response> => Promise.resolve(Response.json({
      sheets: [{ properties: { sheetId: 0, title: "Fixture" }, data: [{ rowData: [
        { values: headers.map((formattedValue) => ({ formattedValue })) },
        { values: [{ formattedValue: "synthetic-one" }] }
      ] }] }]
    })));
    const observed = await adapter.boundedValues("synthetic_workbook", "Fixture", "A1:C6", 0, "LOCAL_ROW");
    assert.deepEqual(observed.columns, headers);
    assert.deepEqual(observed.rows, []);
    assert.deepEqual(observed.observation?.values, [headers, ["synthetic-one"]]);
    await assert.rejects(adapter.boundedValues("synthetic_workbook", "Fixture", "A1:C6", 0, "EXTERNAL_ID"), /sheet_columns_invalid/u);
  }
});
