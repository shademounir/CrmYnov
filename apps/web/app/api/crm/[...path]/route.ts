import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { apiOrigin, MAX_BODY_BYTES, safePath } from "../proxy-policy";

const METHODS_WITH_BODY = new Set(["POST", "PUT", "PATCH"]);

interface ProxyDependencies {
  apiOrigin: () => string;
  fetch: typeof fetch;
  getSession: () => Promise<string | undefined>;
  production: boolean;
  randomId: () => string;
}

export function createProxy(dependencies: Readonly<ProxyDependencies>) {
  return async function proxy(request: Request, context: { params: Promise<{ path: string[] }> }): Promise<Response> {
  try {
    const { path } = await context.params;
    const requestUrl = new URL(request.url);
    const target = new URL(`${dependencies.apiOrigin()}/${safePath(path)}`);
    target.search = requestUrl.search;
    const session = await dependencies.getSession();
    const isLogin = request.method === "POST" && path.length === 1 && path[0] === "sessions";
    if (!isLogin && !session) return NextResponse.json({ code: "authentication_required" }, { status: 401 });

    const headers = new Headers({ accept: "application/json", "x-correlation-id": dependencies.randomId() });
    if (session) headers.set("authorization", `Bearer ${session}`);
    let body: ArrayBuffer | undefined;
    if (METHODS_WITH_BODY.has(request.method)) {
      body = await request.arrayBuffer();
      if (body.byteLength > MAX_BODY_BYTES) return NextResponse.json({ code: "request_too_large" }, { status: 413 });
      headers.set("content-type", "application/json");
    }
    const upstream = await dependencies.fetch(target, { method: request.method, headers, ...(body ? { body } : {}), cache: "no-store", redirect: "error" });
    const payload = await upstream.json().catch(() => ({ code: "invalid_api_response" })) as Record<string, unknown>;
    if (isLogin && upstream.ok && typeof payload.token === "string" && typeof payload.sessionId === "string") {
      const response = NextResponse.json({ sessionId: payload.sessionId }, { status: upstream.status });
      response.cookies.set("crm_session", payload.token, { httpOnly: true, sameSite: "strict", secure: dependencies.production, path: "/", maxAge: 3600 });
      return response;
    }
    const safePayload = Object.fromEntries(Object.entries(payload).filter(([key]) => key !== "token"));
    return NextResponse.json(safePayload, { status: upstream.status });
  } catch {
    return NextResponse.json({ code: "api_proxy_unavailable" }, { status: 503 });
  }
  };
}

const proxy = createProxy({
  apiOrigin,
  fetch: globalThis.fetch,
  getSession: async () => (await cookies()).get("crm_session")?.value,
  production: process.env.NODE_ENV === "production",
  randomId: randomUUID,
});

export const dynamic = "force-dynamic";
export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
