import { NextResponse } from "next/server";

export function POST(request: Request): Response {
  const response = NextResponse.redirect(new URL("/", request.url), 303);
  response.cookies.delete("crm_session");
  response.cookies.delete("crm_first_login");
  response.headers.set("cache-control", "no-store");
  return response;
}
