import { NextResponse, type NextRequest } from "next/server";

import { wwwRedirectTarget } from "./lib/seo/canonical";

// Collapse the www host onto the canonical apex with a permanent (308) redirect
// so search engines index a single origin (see #126). HTTP→HTTPS is handled at
// the ingress; this only handles www→non-www. A 308 preserves method and body,
// so form posts / server actions that land on www are re-issued to the apex.
export function middleware(request: NextRequest) {
  const target = wwwRedirectTarget(
    request.headers.get("host"),
    request.nextUrl.pathname,
    request.nextUrl.search,
  );
  return target ? NextResponse.redirect(target, 308) : NextResponse.next();
}

export const config = {
  // Run on page/route requests; skip Next internals so asset serving is untouched.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
