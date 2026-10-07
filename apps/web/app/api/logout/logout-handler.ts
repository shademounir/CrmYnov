import { NextResponse } from "next/server";
import { browserOriginRefusal } from "../browser-origin";

export function createLogout(configuredOrigin: () => string): (request: Request) => Response {
  return (request: Request): Response => {
    const refusal = browserOriginRefusal(request, configuredOrigin);
    if (refusal) return NextResponse.json({ code: refusal.code }, { status: refusal.status, headers: { "cache-control": "no-store" } });
    // The standalone request URL can expose the internal listening origin.
    const response = new NextResponse(null, { status: 303, headers: { location: "/" } });
    response.cookies.delete("crm_session");
    response.cookies.delete("crm_first_login");
    response.headers.set("cache-control", "no-store");
    return response;
  };
}
