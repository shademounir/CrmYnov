import { randomUUID } from "node:crypto";
import { apiOrigin } from "../../api/crm/proxy-policy";
import { serviceAuthorization } from "../../api/crm/service-identity";
import { createAgentProxy } from "../agent-proxy";

const proxy = createAgentProxy({
  apiOrigin,
  fetch: globalThis.fetch,
  getServiceAuthorization: serviceAuthorization,
  randomId: randomUUID,
});

export const dynamic = "force-dynamic";
export const POST = proxy;
