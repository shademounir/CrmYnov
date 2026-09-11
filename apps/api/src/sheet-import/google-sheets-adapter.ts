/** Server-only Google Sheets read port. Supplying a workbook link never supplies authorization. */
export interface SheetsAccessTokenProvider {
  accessToken(): Promise<string>;
}

export type SheetsTransport = (url: URL, init: RequestInit) => Promise<Response>;
export interface SheetTab { id: number; title: string }
export interface SheetValues { columns: string[]; rows: Array<Record<string, string>>; observation?: { sheetId: number; range: string; values: string[][] } }

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
  async boundedValues(id: string, tab: string, range: string, sheetId: number, identityMode: "EXTERNAL_ID" | "LOCAL_ROW" = "EXTERNAL_ID"): Promise<SheetValues> {
    validateSheetRange(range);
    if (!Number.isSafeInteger(sheetId) || sheetId < 0 || !tab.length || tab.length > 100 || /[\p{Cc}]/u.test(tab)) {
      throw new SheetsSourceError("sheet_tab_invalid", 400);
    }
    const url = this.endpoint(id);
    url.searchParams.set("ranges", `'${tab.replaceAll("'", "''")}'!${range}`);
    url.searchParams.set("fields", "sheets(properties(sheetId,title),data(startRow,startColumn,rowData(values(formattedValue))))");
    const raw = object(await this.read(url));
    if (!Array.isArray(raw.sheets) || raw.sheets.length !== 1) throw new SheetsSourceError("sheet_response_invalid", 502);
    const sheet = object(raw.sheets[0]), properties = object(sheet.properties);
    if (properties.sheetId !== sheetId || properties.title !== tab) throw new SheetsSourceError("sheet_tab_identity_changed", 409);
    const values = gridValues(sheet.data, range);
    // The local-row ledger needs unmodified header positions to retain an invalid observation for reconciliation.
    // No key projection is manufactured from empty or duplicate headers in this mode.
    const projection = identityMode === "LOCAL_ROW" ? { columns: values[0] ?? [], rows: [] } : parseValues({ values });
    return { ...projection, observation: { sheetId, range, values } };
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
