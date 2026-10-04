import { NextResponse } from "next/server";

export const POST: (request: Request) => Response = (): Response => {
  // The standalone request URL can expose the internal listening origin.
  const response = new NextResponse(null, { status: 303, headers: { location: "/" } });
  response.cookies.delete("crm_session");
  response.cookies.delete("crm_first_login");
  response.headers.set("cache-control", "no-store");
  return response;
};
