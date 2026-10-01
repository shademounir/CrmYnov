import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { apiOrigin } from "../proxy-policy";
import { createProxy } from "../proxy";
import { serviceAuthorization } from "../service-identity";

const proxy = createProxy({
  apiOrigin,
  fetch: globalThis.fetch,
  getSession: async () => (await cookies()).get("crm_session")?.value,
  getServiceAuthorization: serviceAuthorization,
  production: process.env.NODE_ENV === "production",
  randomId: randomUUID,
});

export const dynamic = "force-dynamic";
export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
