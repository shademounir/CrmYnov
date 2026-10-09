/** Server-only Google Sheets read port. Supplying a workbook link never supplies authorization. */
export interface SheetsAccessTokenProvider {
  accessToken(): Promise<string>;
}

export type SheetsTransport = (url: URL, init: RequestInit) => Promise<Response>;
export interface SheetTab { id: number; title: string }
/** Internal opt-in only. These column names do not attest their producer or immutability. */
export interface SheetLiteralIdentityContract { externalIdColumn: string; originalArrivalColumn: string }
export interface SheetLiteralIdentityEvidence extends SheetLiteralIdentityContract {
  kind: "LITERAL_IDENTITY_COLUMNS";
  producerAttested: false;
  /** Positions are observation provenance, never submission identities. */
  rows: Array<{ rowNumber: number; externalId: string; originalArrivedAt: string }>;
}
export interface SheetValues {
  columns: string[]; rows: Array<Record<string, string>>;
  observation?: { sheetId: number; range: string; values: string[][] };
  literalEvidence?: SheetLiteralIdentityEvidence;
}

export class SheetsSourceError extends Error {
  constructor(readonly code: string, readonly status: number | "NETWORK", readonly retryAfter?: string) {
    super(code);
    this.name = "SheetsSourceError";
  }
}

const ID = /^[A-Za-z0-9_-]{10,200}$/u;
const MAX_BYTES = 4 * 1024 * 1024;
const MAX_ROWS = 10_000;
const MAX_COLUMNS = 100;

export function workbookId(link: string): string {
  let url: URL;
  try { url = new URL(link); } catch { throw new Error("sheet_workbook_link_invalid"); }
  const match = /^\/spreadsheets\/d\/([A-Za-z0-9_-]+)(?:\/edit|\/view|\/)?$/u.exec(url.pathname);
  if (url.protocol !== "https:" || url.hostname !== "docs.google.com" || url.port || url.username || url.password || !match?.[1] || !ID.test(match[1])) {
    throw new Error("sheet_workbook_link_invalid");
  }
  return match[1];
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new SheetsSourceError("sheet_response_invalid", 502);
  return Object.fromEntries(Object.entries(value));
}

function cell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") throw new SheetsSourceError("sheet_cell_invalid", 502);
  const text = String(value);
  if (text.length > 4_000) throw new SheetsSourceError("sheet_cell_too_large", 502);
  return text;
}

function parseValues(value: unknown): SheetValues {
  const values = object(value).values;
  if (values === undefined) return { columns: [], rows: [] };
  if (!Array.isArray(values) || values.length > MAX_ROWS + 1) throw new SheetsSourceError("sheet_row_limit_exceeded", 502);
  if (!values.length) return { columns: [], rows: [] };
  const header: unknown = values[0];
  if (!Array.isArray(header) || !header.length || header.length > MAX_COLUMNS) throw new SheetsSourceError("sheet_columns_invalid", 502);
  const columns = header.map(cell);
  if (columns.some((name) => !name.trim()) || new Set(columns).size !== columns.length) throw new SheetsSourceError("sheet_columns_invalid", 502);
  const rows = values.slice(1).map((raw: unknown): Record<string, string> => {
    if (!Array.isArray(raw) || raw.length > columns.length) throw new SheetsSourceError("sheet_row_invalid", 502);
    return Object.fromEntries(columns.map((name, index) => [name, cell(raw[index])]));
  });
  return { columns, rows };
}

/** The transport is injected: tests cannot accidentally fall back to a real fetch. No write method exists. */
export class GoogleSheetsAdapter {
  constructor(private readonly tokens: SheetsAccessTokenProvider, private readonly transport: SheetsTransport) {}

  async tabs(id: string): Promise<SheetTab[]> {
    const url = this.endpoint(id);
    url.searchParams.set("fields", "sheets(properties(sheetId,title))");
    const response = object(await this.read(url));
    if (!Array.isArray(response.sheets) || response.sheets.length > 200) throw new SheetsSourceError("sheet_tabs_invalid", 502);
    return response.sheets.map((entry: unknown): SheetTab => {
      const properties = object(object(entry).properties);
      if (typeof properties.sheetId !== "number" || !Number.isSafeInteger(properties.sheetId) || properties.sheetId < 0
        || typeof properties.title !== "string" || !properties.title.length || properties.title.length > 100) throw new SheetsSourceError("sheet_tabs_invalid", 502);
      return { id: properties.sheetId, title: properties.title };
    });
  }

  async values(id: string, tab: string, boundedRange?: string, sheetId?: number): Promise<SheetValues> {
    if (!tab.length || tab.length > 100 || [...tab].some((character) => character.charCodeAt(0) < 32)) throw new Error("sheet_tab_invalid");
    // One extra row/column detects overflow rather than silently truncating an import.
    if (boundedRange !== undefined) validateSheetRange(boundedRange);
    const range = `'${tab.replaceAll("'", "''")}'!${boundedRange ?? "A1:CW10002"}`;
    const url = this.endpoint(id, `/values/${encodeURIComponent(range)}`);
    url.searchParams.set("majorDimension", "ROWS");
    url.searchParams.set("valueRenderOption", "FORMATTED_VALUE");
    const raw: unknown = await this.read(url);
    const parsed = parseValues(raw);
    if (boundedRange !== undefined && sheetId !== undefined) {
      const values: unknown = object(raw).values;
      parsed.observation = { sheetId, range: boundedRange, values: Array.isArray(values)
        ? values.map((row: unknown): string[] => { if (!Array.isArray(row)) throw new SheetsSourceError("sheet_row_invalid", 502); return row.map(cell); }) : [] };
    }
    return parsed;
  }

  /** Identity and requested cells originate in the same read response, avoiding a metadata/values rename race. */
  async boundedValues(id: string, tab: string, range: string, sheetId: number, identityMode: "EXTERNAL_ID" | "LOCAL_ROW" = "EXTERNAL_ID",
    literalContract?: SheetLiteralIdentityContract): Promise<SheetValues> {
    validateSheetRange(range);
    if (!Number.isSafeInteger(sheetId) || sheetId < 0 || !tab.length || tab.length > 100 || /[\p{Cc}]/u.test(tab)) {
      throw new SheetsSourceError("sheet_tab_invalid", 400);
    }
    const literalColumns = literalContract === undefined ? undefined : validateLiteralContract(literalContract, identityMode);
    const url = this.endpoint(id);
    url.searchParams.set("ranges", `'${tab.replaceAll("'", "''")}'!${range}`);
    // Google applies this mask to the entire rectangle in this ONE response.
    // Only the two opted-in columns are inspected/returned as literal evidence;
    // other columns' entered/effective metadata is neither retained nor logged.
    // The existing 4 MiB response bound also covers this enriched envelope.
    url.searchParams.set("fields", literalColumns === undefined
      ? "sheets(properties(sheetId,title),data(startRow,startColumn,rowData(values(formattedValue))))"
      : "sheets(properties(sheetId,title),data(startRow,startColumn,rowData(values(formattedValue,userEnteredValue,effectiveValue))))");
    const raw = object(await this.read(url));
    if (!Array.isArray(raw.sheets) || raw.sheets.length !== 1) throw new SheetsSourceError("sheet_response_invalid", 502);
    const sheet = object(raw.sheets[0]), properties = object(sheet.properties);
    if (properties.sheetId !== sheetId || properties.title !== tab) throw new SheetsSourceError("sheet_tab_identity_changed", 409);
    const values = gridValues(sheet.data, range);
    // The local-row ledger needs unmodified header positions to retain an invalid observation for reconciliation.
    // No key projection is manufactured from empty or duplicate headers in this mode.
    const projection = identityMode === "LOCAL_ROW" ? { columns: values[0] ?? [], rows: [] } : parseValues({ values });
    const literalEvidence = literalColumns === undefined ? undefined : literalIdentityEvidence(sheet.data, range, values, literalColumns);
    return { ...projection, observation: { sheetId, range, values }, ...(literalEvidence ? { literalEvidence } : {}) };
  }

  private endpoint(id: string, suffix = ""): URL {
    if (!ID.test(id)) throw new Error("sheet_workbook_id_invalid");
    return new URL(`https://sheets.googleapis.com/v4/spreadsheets/${id}${suffix}`);
  }

  private async read(url: URL): Promise<unknown> {
    const abort = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => { abort.abort(); reject(new SheetsSourceError("sheet_network_unavailable", "NETWORK")); }, 10_000);
    });
    try {
      return await Promise.race([this.authorizedRead(url, abort.signal), deadline]);
    } catch (error) {
      if (error instanceof SheetsSourceError) throw error;
      // Never propagate a Google response body, token, request URL or transport error text.
      throw new SheetsSourceError("sheet_network_unavailable", "NETWORK");
    } finally { clearTimeout(timeout); }
  }

  private async authorizedRead(url: URL, signal: AbortSignal): Promise<unknown> {
    const token = await this.tokens.accessToken();
    signal.throwIfAborted();
    if (!token || /\s/u.test(token)) throw new SheetsSourceError("sheet_auth_unavailable", 401);
    const response = await this.transport(url, { method: "GET", redirect: "error", signal, headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
    if (!response.ok) {
      await response.body?.cancel();
      throw new SheetsSourceError("sheet_source_unavailable", response.status, response.headers.get("retry-after") ?? undefined);
    }
    return readBoundedJson(response);
  }
}

/** Explicit rectangular range, header first, no whole-column reads or named ranges. */
export function validateSheetRange(range: string): void {
  const match = /^([A-Z]{1,2})([1-9][0-9]{0,5}):([A-Z]{1,2})([1-9][0-9]{0,5})$/u.exec(range);
  if (!match) throw new SheetsSourceError("sheet_range_invalid", 400);
  const column = (text: string): number => [...text].reduce((value, char) => value * 26 + char.charCodeAt(0) - 64, 0);
  const start = column(match[1] ?? ""), end = column(match[3] ?? "");
  const first = Number(match[2]), last = Number(match[4]);
  if (end < start || end - start + 1 > MAX_COLUMNS || last <= first || last - first > MAX_ROWS) {
    throw new SheetsSourceError("sheet_range_invalid", 400);
  }
}

function gridValues(data: unknown, range: string): string[][] {
  if (!Array.isArray(data) || data.length !== 1) throw new SheetsSourceError("sheet_response_invalid", 502);
  const grid = object(data[0]);
  const parts = /^([A-Z]+)([0-9]+):([A-Z]+)([0-9]+)$/u.exec(range);
  if (!parts) throw new SheetsSourceError("sheet_range_invalid", 400);
  const column = (text: string): number => [...text].reduce((value, char) => value * 26 + char.charCodeAt(0) - 64, 0);
  const firstColumn = column(parts[1] ?? ""), lastColumn = column(parts[3] ?? "");
  const firstRow = Number(parts[2]), lastRow = Number(parts[4]);
  if ((grid.startRow ?? 0) !== firstRow - 1 || (grid.startColumn ?? 0) !== firstColumn - 1) throw new SheetsSourceError("sheet_response_invalid", 502);
  const rows: unknown = grid.rowData ?? [];
  if (!Array.isArray(rows) || rows.length > lastRow - firstRow + 1) throw new SheetsSourceError("sheet_row_limit_exceeded", 502);
  return rows.map((raw: unknown): string[] => {
    const values: unknown = object(raw).values ?? [];
    if (!Array.isArray(values) || values.length > lastColumn - firstColumn + 1) throw new SheetsSourceError("sheet_columns_invalid", 502);
    return values.map((entry: unknown): string => cell(object(entry).formattedValue));
  });
}

/** Copy the two validated strings before any I/O; caller mutation cannot rebind the read. */
function validateLiteralContract(contract: SheetLiteralIdentityContract, identityMode: "EXTERNAL_ID" | "LOCAL_ROW"): SheetLiteralIdentityContract {
  if (identityMode !== "EXTERNAL_ID" || !contract || typeof contract !== "object" || Array.isArray(contract)
    || Object.keys(contract).length !== 2 || !Object.hasOwn(contract, "externalIdColumn") || !Object.hasOwn(contract, "originalArrivalColumn")) {
    throw new SheetsSourceError("sheet_literal_contract_invalid", 400);
  }
  const externalIdColumn = contract.externalIdColumn, originalArrivalColumn = contract.originalArrivalColumn;
  if (![externalIdColumn, originalArrivalColumn].every((name) => typeof name === "string" && name.length > 0
    && name.length <= 200 && name === name.trim() && !/[\p{Cc}]/u.test(name)) || externalIdColumn === originalArrivalColumn) {
    throw new SheetsSourceError("sheet_literal_contract_invalid", 400);
  }
  return { externalIdColumn, originalArrivalColumn };
}

function emptyLiteralCell(value: unknown): boolean {
  const item = object(value ?? {});
  return item.userEnteredValue === undefined && item.effectiveValue === undefined
    && (item.formattedValue === undefined || item.formattedValue === "");
}

/** ExtendedValue is a oneof. Missing/derived/effective-only is not literal evidence. */
function literalString(value: unknown): string {
  const item = object(value ?? {}), entered = object(item.userEnteredValue ?? {}), effective = object(item.effectiveValue ?? {});
  if (Object.hasOwn(entered, "formulaValue")) throw new SheetsSourceError("sheet_identity_formula_refused", 409);
  if (Object.keys(entered).length !== 1 || typeof entered.stringValue !== "string"
    || Object.keys(effective).length !== 1 || typeof effective.stringValue !== "string") {
    throw new SheetsSourceError("sheet_identity_literal_required", 409);
  }
  if (entered.stringValue !== effective.stringValue || entered.stringValue !== item.formattedValue) {
    throw new SheetsSourceError("sheet_identity_literal_mismatch", 409);
  }
  return entered.stringValue;
}

function literalOriginalUtc(value: string): void {
  // Same strict calendar round-trip as cutoverInstant, without coupling the
  // Google transport to the cutover/Nest feature or accepting Date.parse heuristics.
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value)) {
    throw new SheetsSourceError("sheet_original_utc_literal_required", 409);
  }
  const instant = new Date(value);
  if (!Number.isFinite(instant.valueOf()) || instant.toISOString().replace(".000Z", "Z") !== value.replace(".000Z", "Z")) {
    throw new SheetsSourceError("sheet_original_utc_literal_required", 409);
  }
}

function literalIdentityEvidence(data: unknown, range: string, values: string[][], contract: SheetLiteralIdentityContract): SheetLiteralIdentityEvidence {
  const columns = values[0] ?? [], idColumn = columns.indexOf(contract.externalIdColumn), dateColumn = columns.indexOf(contract.originalArrivalColumn);
  if (idColumn < 0 || dateColumn < 0) throw new SheetsSourceError("sheet_literal_columns_required", 409);
  // gridValues already checked the range, offsets, grids and row/cell bounds.
  const grid = object((data as unknown[])[0]), rawRows = (grid.rowData ?? []) as unknown[];
  const headerCells = (object(rawRows[0]).values ?? []) as unknown[];
  if (literalString(headerCells[idColumn]) !== contract.externalIdColumn || literalString(headerCells[dateColumn]) !== contract.originalArrivalColumn) {
    throw new SheetsSourceError("sheet_literal_columns_required", 409);
  }
  const firstRow = Number(/^[A-Z]+([0-9]+):/u.exec(range)?.[1]), seen = new Set<string>();
  const rows: SheetLiteralIdentityEvidence["rows"] = [];
  for (let index = 1; index < values.length; index++) {
    const cells = (object(rawRows[index]).values ?? []) as unknown[];
    // Preserve original row alignment. Only genuinely empty rows have no submission;
    // a formula returning empty or an entered empty identity is not inferred away.
    if (values[index]!.every((value) => !value.trim()) && emptyLiteralCell(cells[idColumn]) && emptyLiteralCell(cells[dateColumn])) continue;
    const externalId = literalString(cells[idColumn]), originalArrivedAt = literalString(cells[dateColumn]);
    if (!externalId.length || externalId.length > 128 || externalId !== externalId.trim()
      || [...externalId].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) {
      throw new SheetsSourceError("sheet_submission_literal_invalid", 409);
    }
    if (seen.has(externalId)) throw new SheetsSourceError("sheet_submission_literal_ambiguous", 409);
    literalOriginalUtc(originalArrivedAt); seen.add(externalId);
    rows.push({ rowNumber: firstRow + index, externalId, originalArrivedAt });
  }
  return { kind: "LITERAL_IDENTITY_COLUMNS", producerAttested: false,
    externalIdColumn: contract.externalIdColumn, originalArrivalColumn: contract.originalArrivalColumn, rows };
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new SheetsSourceError("sheet_response_invalid", 502);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > MAX_BYTES) throw new SheetsSourceError("sheet_response_too_large", 502);
      chunks.push(part.value);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown; }
    catch { throw new SheetsSourceError("sheet_response_invalid", 502); }
  } finally { await reader.cancel(); reader.releaseLock(); }
}
