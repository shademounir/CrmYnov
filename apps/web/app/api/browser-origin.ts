const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export interface BrowserOriginRefusal {
  status: 403 | 503;
  code: "browser_origin_refused" | "browser_origin_unavailable";
}

function canonicalPublicOrigin(raw: string): string {
  const value = raw.trim();
  const url = new URL(value);
  const localHttp = url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if ((!localHttp && url.protocol !== "https:") || url.hostname.includes("*") || url.username || url.password || url.search || url.hash || url.pathname !== "/" || url.origin !== value.replace(/\/$/u, "")) {
    throw new Error("crm_public_origin_invalid");
  }
  return url.origin;
}

/** Runtime configuration, never inferred from client-controlled proxy/Host headers. */
export function publicOrigin(environment: Readonly<Record<string, string | undefined>> = process.env): string {
  return canonicalPublicOrigin(environment.CRM_PUBLIC_ORIGIN ?? "");
}

function sourceMatches(headers: Headers, expected: string): boolean {
  const origin = headers.get("origin");
  if (origin !== null) return origin === expected;
  const referer = headers.get("referer");
  if (!referer) return false;
  try {
    const url = new URL(referer);
    return !url.username && !url.password && url.origin === expected;
  } catch { return false; }
}

/** Route Handlers do not inherit Next Server Actions' CSRF checks. */
export function browserOriginRefusal(request: Request, configuredOrigin: () => string): BrowserOriginRefusal | undefined {
  if (!MUTATING_METHODS.has(request.method)) return undefined;
  let expected: string;
  try { expected = canonicalPublicOrigin(configuredOrigin()); }
  catch { return { status: 503, code: "browser_origin_unavailable" }; }
  const site = request.headers.get("sec-fetch-site");
  if ((site !== null && site !== "same-origin" && site !== "none") || !sourceMatches(request.headers, expected)) {
    return { status: 403, code: "browser_origin_refused" };
  }
  return undefined;
}

export function jsonContentType(headers: Headers): boolean {
  return /^application\/json(?:\s*;\s*charset\s*=\s*(?:utf-8|"utf-8"))?\s*$/iu.test(headers.get("content-type") ?? "");
}
