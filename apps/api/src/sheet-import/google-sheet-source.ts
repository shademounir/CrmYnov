import { GoogleSheetsAdapter, SheetsSourceError, validateSheetRange, type SheetValues, type SheetsTransport } from "./google-sheets-adapter.js";
import { GoogleAdcImpersonatedTokens, GoogleServiceAccountTokens, readPrivateGoogleJson,
  type AdcImpersonatedClientLoader } from "./google-sheets-auth.js";
import { SheetSource, SyntheticSheetSource } from "./synthetic-sheet-source.js";
import type { SheetConfiguration } from "./sheet-import-configuration.js";

export interface SheetSourceSelection {
  mode: "SIMULATED" | "GOOGLE";
  identityMode: "EXTERNAL_ID" | "LOCAL_ROW";
  sheetId?: number;
  range?: string;
}
export interface GoogleAllowedSource { workbookId: string; sheetId: number; tab: string; range: string }

export function parseGoogleAllowlist(input: unknown): readonly GoogleAllowedSource[] {
  if (!input || typeof input !== "object" || !("sources" in input) || !Array.isArray(input.sources) || input.sources.length > 100) {
    throw new SheetsSourceError("sheet_allowlist_invalid", 503);
  }
  return input.sources.map((value: unknown): GoogleAllowedSource => {
    if (!value || typeof value !== "object") throw new SheetsSourceError("sheet_allowlist_invalid", 503);
    const row = Object.fromEntries(Object.entries(value));
    if (typeof row.workbookId !== "string" || !/^[A-Za-z0-9_-]{10,200}$/u.test(row.workbookId)
      || typeof row.sheetId !== "number" || !Number.isSafeInteger(row.sheetId) || row.sheetId < 0
      || typeof row.tab !== "string" || !row.tab.length || row.tab.length > 100 || /[\p{Cc}]/u.test(row.tab)
      || typeof row.range !== "string") throw new SheetsSourceError("sheet_allowlist_invalid", 503);
    validateSheetRange(row.range);
    return { workbookId: row.workbookId, sheetId: row.sheetId, tab: row.tab, range: row.range };
  });
}

/** Real sources are exact server-owned capabilities; no Google error falls back to simulation. */
export class RoutedSheetSource extends SheetSource {
  constructor(private readonly synthetic: SheetSource, private readonly google?: GoogleSheetsAdapter,
    private readonly allowed: readonly GoogleAllowedSource[] = []) { super(); }

  get googleReady(): boolean { return this.google !== undefined; }

  override canProcess(configuration: SheetConfiguration): boolean {
    return configuration.source?.mode !== "GOOGLE" || this.googleReady;
  }

  validateSelection(workbookId: string, tab: string, source?: SheetSourceSelection): void {
    if (!source || source.mode === "SIMULATED") {
      if (!/^synthetic_[a-z0-9_-]{1,60}$/u.test(workbookId)) throw new SheetsSourceError("sheet_real_source_disabled", 403);
      return;
    }
    if (!this.google) throw new SheetsSourceError("sheet_real_source_disabled", 403);
    if (!this.allowed.some((entry) => entry.workbookId === workbookId && entry.tab === tab && entry.sheetId === source.sheetId && entry.range === source.range)) {
      throw new SheetsSourceError("sheet_source_not_authorized", 403);
    }
  }

  async read(workbookId: string, tab: string, configuration: SheetConfiguration & { source?: SheetSourceSelection }): Promise<SheetValues> {
    const source = configuration.source;
    this.validateSelection(workbookId, tab, source);
    if (!source || source.mode === "SIMULATED") return this.synthetic.read(workbookId, tab, configuration);
    const google = this.google;
    if (!google) throw new SheetsSourceError("sheet_real_source_disabled", 403);
    if (source.range === undefined || source.sheetId === undefined) throw new SheetsSourceError("sheet_source_not_authorized", 403);
    return google.boundedValues(workbookId, tab, source.range, source.sheetId, source.identityMode);
  }
}

/** Opt-in is literal true. No environment credential discovery, network, or file access when disabled. */
export async function createSheetSource(environment: Readonly<Record<string, string | undefined>>, repositoryRoot: string,
  transport: SheetsTransport = (url, init): Promise<Response> => fetch(url, init),
  adcClientLoader?: AdcImpersonatedClientLoader): Promise<RoutedSheetSource> {
  const synthetic = new SyntheticSheetSource();
  if (environment.CRM_GOOGLE_SHEETS_ENABLED !== "true") return new RoutedSheetSource(synthetic);
  const credentialsPath = environment.CRM_GOOGLE_SHEETS_CREDENTIALS_FILE;
  const allowlistPath = environment.CRM_GOOGLE_SHEETS_ALLOWLIST_FILE;
  const authMode = environment.CRM_GOOGLE_SHEETS_AUTH_MODE;
  const impersonatedPrincipal = environment.CRM_GOOGLE_SHEETS_IMPERSONATE_SERVICE_ACCOUNT;
  if (!allowlistPath) throw new SheetsSourceError("sheet_server_configuration_invalid", 503);
  const allowed = parseGoogleAllowlist(await readPrivateGoogleJson(allowlistPath, repositoryRoot));
  if (authMode === "ADC_IMPERSONATION") {
    if (!impersonatedPrincipal || credentialsPath) throw new SheetsSourceError("sheet_server_configuration_invalid", 503);
    return new RoutedSheetSource(synthetic,
      new GoogleSheetsAdapter(new GoogleAdcImpersonatedTokens(impersonatedPrincipal, adcClientLoader), transport), allowed);
  }
  if (authMode === "SERVICE_ACCOUNT_JSON") {
    if (!credentialsPath || impersonatedPrincipal) throw new SheetsSourceError("sheet_server_configuration_invalid", 503);
    const credentials = await readPrivateGoogleJson(credentialsPath, repositoryRoot);
    return new RoutedSheetSource(synthetic, new GoogleSheetsAdapter(new GoogleServiceAccountTokens(credentials, transport), transport), allowed);
  }
  throw new SheetsSourceError("sheet_server_configuration_invalid", 503);
}
