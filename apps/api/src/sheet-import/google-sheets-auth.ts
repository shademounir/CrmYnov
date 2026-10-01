import { createPrivateKey, sign } from "node:crypto";
import { access, readFile, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { GoogleAuth, Impersonated } from "google-auth-library";
import { SheetsSourceError, type SheetsAccessTokenProvider, type SheetsTransport } from "./google-sheets-adapter.js";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";
const SERVICE_ACCOUNT_EMAIL = /^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+\.iam\.gserviceaccount\.com$/u;
export async function readPrivateGoogleJson(path: string, repositoryRoot: string): Promise<unknown> {
  try {
    if (!isAbsolute(path)) throw new Error();
    const actual = await realpath(path), root = await realpath(repositoryRoot);
    const rel = relative(root, actual);
    if (!rel || (!rel.startsWith(`..${sep}`) && !isAbsolute(rel))) throw new Error();
    await rejectGitAncestor(dirname(actual));
    const info = await stat(actual);
    if (!info.isFile() || info.size > 64 * 1024) throw new Error();
    return JSON.parse(await readFile(actual, "utf8")) as unknown;
  } catch { throw new SheetsSourceError("sheet_server_configuration_invalid", 503); }
}

async function rejectGitAncestor(directory: string): Promise<void> {
  for (let current = directory; ; current = dirname(current)) {
    let gitExists = false;
    try { await access(join(current, ".git")); gitExists = true; } catch { /* Missing metadata is normal outside a worktree. */ }
    if (gitExists) throw new Error();
    if (dirname(current) === current) return;
  }
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new SheetsSourceError("sheet_auth_configuration_invalid", 503);
  return Object.fromEntries(Object.entries(value));
}

/** Dedicated service account only: no ADC, user impersonation, remote credential discovery or scope expansion. */
export class GoogleServiceAccountTokens implements SheetsAccessTokenProvider {
  private readonly email: string;
  private readonly key: ReturnType<typeof createPrivateKey>;
  private cached?: { token: string; expiresAt: number };
  private pending: Promise<string> | undefined;

  constructor(credentials: unknown, private readonly transport: SheetsTransport, private readonly now: () => number = Date.now) {
    try {
      const item = record(credentials);
      if (item.type !== "service_account" || typeof item.client_email !== "string"
        || !SERVICE_ACCOUNT_EMAIL.test(item.client_email)
        || typeof item.private_key !== "string" || item.private_key.length > 16_384
        || item.token_uri !== TOKEN_URL || item.subject !== undefined) throw new Error();
      this.email = item.client_email;
      this.key = createPrivateKey(item.private_key);
      if (this.key.asymmetricKeyType !== "rsa" || (this.key.asymmetricKeyDetails?.modulusLength ?? 0) < 2048) throw new Error();
    } catch { throw new SheetsSourceError("sheet_auth_configuration_invalid", 503); }
  }

  async accessToken(): Promise<string> {
    if (this.cached && this.cached.expiresAt > this.now() + 60_000) return this.cached.token;
    if (this.pending) return this.pending;
    this.pending = this.exchange();
    try { return await this.pending; } finally { this.pending = undefined; }
  }

  private assertion(): string {
    const issued = Math.floor(this.now() / 1000);
    const encode = (value: object): string => Buffer.from(JSON.stringify(value)).toString("base64url");
    const unsigned = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({ iss: this.email, scope: SCOPE, aud: TOKEN_URL, iat: issued, exp: issued + 3600 })}`;
    return `${unsigned}.${sign("RSA-SHA256", Buffer.from(unsigned), this.key).toString("base64url")}`;
  }

  private async exchange(): Promise<string> {
    try {
      const response = await this.transport(new URL(TOKEN_URL), { method: "POST", redirect: "error", signal: AbortSignal.timeout(10_000),
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: this.assertion() }).toString() });
      if (!response.ok) { await response.body?.cancel(); throw new Error(); }
      const data = record(await boundedTokenBody(response));
      if (typeof data.access_token !== "string" || !data.access_token || data.access_token.length > 8192 || /\s/u.test(data.access_token)
        || data.token_type !== "Bearer" || typeof data.expires_in !== "number" || !Number.isFinite(data.expires_in)
        || data.expires_in < 120 || data.expires_in > 3600) throw new Error();
      this.cached = { token: data.access_token, expiresAt: this.now() + data.expires_in * 1000 };
      return data.access_token;
    } catch { throw new SheetsSourceError("sheet_auth_unavailable", 401); }
  }
}

interface AdcImpersonatedClient {
  readonly targetPrincipal: string;
  accessToken(): Promise<string | null | undefined>;
}

export type AdcImpersonatedClientLoader = (targetPrincipal: string,
  scopes: readonly string[]) => Promise<AdcImpersonatedClient>;

async function loadAdcImpersonatedClient(targetPrincipal: string,
  scopes: readonly string[]): Promise<AdcImpersonatedClient> {
  const sourceClient = await new GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/cloud-platform"]
  }).getClient();
  if (sourceClient instanceof Impersonated && sourceClient.getTargetPrincipal() !== targetPrincipal) {
    throw new SheetsSourceError("sheet_auth_identity_mismatch", 401);
  }
  const client = sourceClient instanceof Impersonated ? sourceClient : new Impersonated({
    sourceClient,
    targetPrincipal,
    targetScopes: [...scopes],
    delegates: [],
    lifetime: 900
  });
  return {
    targetPrincipal: client.getTargetPrincipal(),
    accessToken: async (): Promise<string | null | undefined> => (await client.getAccessToken()).token
  };
}

/** Explicit ADC impersonation only; the final token identity must match the configured service account. */
export class GoogleAdcImpersonatedTokens implements SheetsAccessTokenProvider {
  private client: Promise<AdcImpersonatedClient> | undefined;
  private pending: Promise<string> | undefined;

  constructor(private readonly expectedPrincipal: string,
    private readonly loadClient: AdcImpersonatedClientLoader = loadAdcImpersonatedClient) {
    if (!SERVICE_ACCOUNT_EMAIL.test(expectedPrincipal)) throw new SheetsSourceError("sheet_auth_configuration_invalid", 503);
  }

  async accessToken(): Promise<string> {
    if (this.pending) return this.pending;
    this.pending = this.issue();
    try { return await this.pending; } finally { this.pending = undefined; }
  }

  private async issue(): Promise<string> {
    try {
      this.client ??= this.loadClient(this.expectedPrincipal, [SCOPE]);
      const client = await this.client;
      if (client.targetPrincipal !== this.expectedPrincipal) {
        throw new SheetsSourceError("sheet_auth_identity_mismatch", 401);
      }
      const token = await client.accessToken();
      if (typeof token !== "string" || !token || token.length > 8192 || /\s/u.test(token)) throw new Error();
      return token;
    } catch (error: unknown) {
      this.client = undefined;
      if (error instanceof SheetsSourceError) throw error;
      throw new SheetsSourceError("sheet_auth_unavailable", 401);
    }
  }
}

async function boundedTokenBody(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 16_384) throw new Error();
      chunks.push(part.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } finally { await reader.cancel(); reader.releaseLock(); }
}
