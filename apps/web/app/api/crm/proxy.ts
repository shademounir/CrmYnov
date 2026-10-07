import { NextResponse } from "next/server";
import { MAX_BODY_BYTES, safePath } from "./proxy-policy";
import { relayApiResponse } from "./proxy-response";
import { browserOriginRefusal, jsonContentType } from "../browser-origin";

const METHODS_WITH_BODY = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export interface ProxyDependencies {
  apiOrigin: () => string;
  publicOrigin: () => string;
  fetch: typeof fetch;
  getSession: () => Promise<string | undefined>;
  getServiceAuthorization?: (audience: string) => Promise<string | undefined>;
  production: boolean;
  randomId: () => string;
}

function authenticationFlow(method: string, path: string[]): { isLogin: boolean; isFirstLoginChange: boolean; isRecoveryCompletion: boolean; isRecoveryRequest: boolean; anonymous: boolean } {
  const operation = method === "POST" ? path.join("/") : "";
  return {
    isLogin: operation === "sessions",
    isFirstLoginChange: operation === "first-login/change-secret",
    isRecoveryCompletion: operation === "access-recovery/completions",
    isRecoveryRequest: operation === "access-recovery/requests",
    anonymous: ["sessions", "invitations/completions", "access-recovery/requests", "access-recovery/completions"].includes(operation),
  };
}

async function mutationBody(request: Request): Promise<ArrayBuffer | Response | undefined> {
  if (!METHODS_WITH_BODY.has(request.method) || request.body === null) return undefined;
  // The Node adapter supplies an IncomingMessage stream even for bodyless mutations.
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value.byteLength === 0) continue;
      if (!jsonContentType(request.headers)) {
        await reader.cancel().catch(() => undefined);
        return NextResponse.json({ code: "request_json_required" }, { status: 415 });
      }
      byteLength += value.byteLength;
      if (byteLength > MAX_BODY_BYTES) {
        await reader.cancel().catch(() => undefined);
        return NextResponse.json({ code: "request_too_large" }, { status: 413 });
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (byteLength === 0) return undefined;
  const body = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  try { JSON.parse(new TextDecoder().decode(body)); }
  catch { return NextResponse.json({ code: "request_json_invalid" }, { status: 400 }); }
  return body.buffer;
}

export function createProxy(dependencies: Readonly<ProxyDependencies>) {
  return async function proxy(request: Request, context: { params: Promise<{ path: string[] }> }): Promise<Response> {
    try {
      const refusal = browserOriginRefusal(request, dependencies.publicOrigin);
      if (refusal) return NextResponse.json({ code: refusal.code }, { status: refusal.status, headers: { "cache-control": "no-store" } });
      const body = await mutationBody(request);
      if (body instanceof Response) return body;
      const { path } = await context.params;
      const requestUrl = new URL(request.url);
      const target = new URL(`${dependencies.apiOrigin()}/${safePath(path)}`);
      target.search = requestUrl.search;
      const session = await dependencies.getSession();
      const flow = authenticationFlow(request.method, path);
      if (!flow.anonymous && !session) return NextResponse.json({ code: "authentication_required" }, { status: 401 });

      const correlationId = dependencies.randomId();
      const headers = new Headers({ accept: "application/json", "x-correlation-id": correlationId });
      if (session && !flow.isRecoveryRequest && !flow.isRecoveryCompletion) headers.set("authorization", `Bearer ${session}`);
      if (body !== undefined) headers.set("content-type", "application/json");
      const serviceAuthorization = await dependencies.getServiceAuthorization?.(dependencies.apiOrigin());
      if (serviceAuthorization) headers.set("x-serverless-authorization", serviceAuthorization);
      const upstream = await dependencies.fetch(target, { method: request.method, headers, ...(body ? { body } : {}), cache: "no-store", redirect: "error" });
      return await relayApiResponse(upstream, { ...flow, production: dependencies.production, correlationId });
    } catch {
      return NextResponse.json({ code: "api_proxy_unavailable" }, { status: 503 });
    }
  };
}
