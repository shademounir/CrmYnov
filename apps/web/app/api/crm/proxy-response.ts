import { NextResponse } from "next/server";

const RESPONSE_HEADERS = ["content-type", "retry-after", "x-correlation-id", "x-request-id", "www-authenticate"] as const;

function functionalHeaders(upstream: Headers, correlationId: string): Headers {
  const connectionHeaders = new Set((upstream.get("connection") ?? "").split(",").map((name) => name.trim().toLowerCase()));
  const headers = new Headers();
  for (const name of RESPONSE_HEADERS) {
    const value = upstream.get(name);
    if (value !== null && !connectionHeaders.has(name)) headers.set(name, value);
  }
  if (!headers.has("x-correlation-id") && !connectionHeaders.has("x-correlation-id")) headers.set("x-correlation-id", correlationId);
  // Authenticated responses must not become shared cache entries.
  headers.set("cache-control", "no-store");
  return headers;
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function jsonObject(bytes: ArrayBuffer): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return isJsonObject(value) ? value : undefined;
  } catch { return undefined; }
}

/** Relay the original bytes unless the existing authentication contract needs redaction. */
export async function relayApiResponse(upstream: Response, options: Readonly<{ isLogin: boolean; production: boolean; correlationId: string }>): Promise<Response> {
  const headers = functionalHeaders(upstream.headers, options.correlationId);
  const bytes = await upstream.arrayBuffer();
  if (bytes.byteLength === 0) return new Response(null, { status: upstream.status, headers });
  const object = jsonObject(bytes);
  if (options.isLogin && upstream.ok && typeof object?.token === "string" && typeof object.sessionId === "string") {
    const response = new NextResponse(JSON.stringify({ sessionId: object.sessionId }), { status: upstream.status, headers });
    response.cookies.set("crm_session", object.token, { httpOnly: true, sameSite: "strict", secure: options.production, path: "/", maxAge: 3600 });
    return response;
  }
  if (object && Object.hasOwn(object, "token")) {
    // Preserve the pre-existing top-level token redaction without coercing JSON roots.
    const safe = { ...object };
    delete safe.token;
    return new Response(JSON.stringify(safe), { status: upstream.status, headers });
  }
  return new Response(bytes, { status: upstream.status, headers });
}
