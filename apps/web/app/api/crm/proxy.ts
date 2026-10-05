import { NextResponse } from "next/server";
import { MAX_BODY_BYTES, safePath } from "./proxy-policy";
import { relayApiResponse } from "./proxy-response";

const METHODS_WITH_BODY = new Set(["POST", "PUT", "PATCH"]);

export interface ProxyDependencies {
  apiOrigin: () => string;
  fetch: typeof fetch;
  getSession: () => Promise<string | undefined>;
  getServiceAuthorization?: (audience: string) => Promise<string | undefined>;
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
      const isInvitationCompletion = request.method === "POST" && path.join("/") === "invitations/completions";
      const isFirstLoginChange = request.method === "POST" && path.join("/") === "first-login/change-secret";
      const isRecoveryRequest = request.method === "POST" && path.join("/") === "access-recovery/requests";
      const isRecoveryCompletion = request.method === "POST" && path.join("/") === "access-recovery/completions";
      if (!isLogin && !isInvitationCompletion && !isRecoveryRequest && !isRecoveryCompletion && !session) return NextResponse.json({ code: "authentication_required" }, { status: 401 });

      const correlationId = dependencies.randomId();
      const headers = new Headers({ accept: "application/json", "x-correlation-id": correlationId });
      if (session && !isRecoveryRequest && !isRecoveryCompletion) headers.set("authorization", `Bearer ${session}`);
      const serviceAuthorization = await dependencies.getServiceAuthorization?.(dependencies.apiOrigin());
      if (serviceAuthorization) headers.set("x-serverless-authorization", serviceAuthorization);
      let body: ArrayBuffer | undefined;
      if (METHODS_WITH_BODY.has(request.method)) {
        body = await request.arrayBuffer();
        if (body.byteLength > MAX_BODY_BYTES) return NextResponse.json({ code: "request_too_large" }, { status: 413 });
        headers.set("content-type", "application/json");
      }
      const upstream = await dependencies.fetch(target, { method: request.method, headers, ...(body ? { body } : {}), cache: "no-store", redirect: "error" });
      return await relayApiResponse(upstream, { isLogin, isFirstLoginChange, isRecoveryCompletion, production: dependencies.production, correlationId });
    } catch {
      return NextResponse.json({ code: "api_proxy_unavailable" }, { status: 503 });
    }
  };
}
