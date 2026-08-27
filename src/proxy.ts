import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// /api/public/* is a server-to-server public content API (own x-liderlar-api-key
// check + is_visible filtering in the route itself) — it must never require an
// admin session cookie, since callers like liderlar-web have none.
//
// /api/telegram/* and /api/cron/* are machine callers with no cookie jar and no
// ability to follow a login redirect: Telegram reported every delivery as
// "Wrong response from the webhook: 307 Temporary Redirect" until they were
// listed here, and Vercel Cron would have hit the same wall. Both carry their
// own auth inside the route (X-Telegram-Bot-Api-Secret-Token and CRON_SECRET),
// so exempting them from the session gate does not open anything up.
const PUBLIC_PATHS = [
  "/login",
  "/api/auth",
  "/api/public",
  "/api/telegram",
  "/api/cron",
];

// Candidate secure-link intake is public by design (token-gated at the route
// layer). Only these paths are exempt from the admin session requirement.
const INTAKE_PUBLIC_PREFIXES = ["/anketa", "/api/intake"];

/**
 * Refreshes the Supabase session cookie and gates every admin route.
 * Fine-grained role checks live in requirePermission (lib/auth.ts) and RLS.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isIntakePublic = INTAKE_PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));
  const isPublic = isIntakePublic || PUBLIC_PATHS.some((p) => pathname.startsWith(p));

  // Harden the public secure-link surface: never indexed, never cached, no
  // referrer leakage of the token-bearing URL.
  if (isIntakePublic) {
    response.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
    response.headers.set("Referrer-Policy", "no-referrer");
    response.headers.set("Cache-Control", "no-store, max-age=0");
  }

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (user && pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
