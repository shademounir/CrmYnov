import { NextResponse, type NextRequest } from "next/server";

/** UX routing only. The API remains authoritative for every permission. */
export function proxy(request: NextRequest): NextResponse {
  const pending = request.cookies.get("crm_first_login")?.value === "required";
  const path = request.nextUrl.pathname;
  if (pending && path !== "/first-login" && path !== "/api/logout" && !path.startsWith("/api/crm/")) {
    return NextResponse.redirect(new URL("/first-login", request.url));
  }
  if (!pending && path === "/first-login") return NextResponse.redirect(new URL("/", request.url));
  return NextResponse.next();
}

export const config = { matcher: ["/", "/leads/:path*", "/appointments/:path*", "/calls/:path*", "/imports/:path*", "/notifications/:path*", "/chat/:path*", "/manager/:path*", "/admin/:path*", "/first-login"] };
