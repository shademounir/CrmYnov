import { MAX_BODY_BYTES, safePath } from "../api/crm/proxy-policy";

const SIMPLE_AGENT_ACTIONS = new Set(["pair", "status", "poll", "events", "free-calls"]);
const COMMAND_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const RESPONSE_LIMIT_BYTES = 1_048_576;

export interface AgentProxyDependencies {
  apiOrigin: () => string;
  fetch: typeof fetch;
  getServiceAuthorization?: (audience: string) => Promise<string | undefined>;
  randomId: () => string;
}

export function agentApiPath(parts: string[]): string {
  const relative = safePath(parts);
  const prefix = "integrations/telephony/agent/v1/";
  const suffix = relative.startsWith(prefix) ? relative.slice(prefix.length) : "";
  const segments = suffix.split("/");
  const allowed = SIMPLE_AGENT_ACTIONS.has(suffix) || (
    segments.length === 3 && segments[0] === "commands" && COMMAND_ID.test(segments[1] ?? "") && segments[2] === "claim"
  );
  if (!allowed) {
    throw new Error("agent_api_path_forbidden");
  }
  return relative;
}

export function createAgentProxy(dependencies: Readonly<AgentProxyDependencies>) {
  return async function proxy(request: Request, context: { params: Promise<{ path: string[] }> }): Promise<Response> {
    try {
      if (request.method !== "POST") return Response.json({ code: "method_not_allowed" }, { status: 405 });
      const { path } = await context.params;
      const target = new URL(`${dependencies.apiOrigin()}/${agentApiPath(path)}`);
      const body = await request.arrayBuffer();
      if (body.byteLength > MAX_BODY_BYTES) return Response.json({ code: "request_too_large" }, { status: 413 });
      const correlationId = dependencies.randomId();
      const headers = new Headers({ accept: "application/json", "content-type": "application/json", "x-correlation-id": correlationId });
      const agentToken = request.headers.get("x-telephony-agent-token");
      if (agentToken) headers.set("x-telephony-agent-token", agentToken);
      const audience = dependencies.apiOrigin();
      const serviceAuthorization = await dependencies.getServiceAuthorization?.(audience);
      if (serviceAuthorization) headers.set("x-serverless-authorization", serviceAuthorization);
      const upstream = await dependencies.fetch(target, { method: "POST", headers, body, cache: "no-store", redirect: "error" });
      const responseBody = await upstream.arrayBuffer();
      if (responseBody.byteLength > RESPONSE_LIMIT_BYTES) return Response.json({ code: "agent_response_too_large" }, { status: 502 });
      const responseHeaders = new Headers({ "cache-control": "no-store", "x-correlation-id": correlationId });
      const contentType = upstream.headers.get("content-type");
      if (contentType) responseHeaders.set("content-type", contentType);
      return new Response(responseBody, { status: upstream.status, headers: responseHeaders });
    } catch {
      return Response.json({ code: "agent_gateway_unavailable" }, { status: 503 });
    }
  };
}
