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
const PUBLIC_PATHS = ["/login", "/api/auth", "/api/public"];

/**
 * Callers with no cookie jar that cannot follow a redirect: Telegram reported
 * every webhook delivery as "Wrong response from the webhook: 307 Temporary
 * Redirect" until this existed, and Vercel Cron would have hit the same wall.
 * Each authenticates itself inside its route — X-Telegram-Bot-Api-Secret-Token
 * and CRON_SECRET respectively.
 *
 * /api/telegram-sales is the AI sales bot's own webhook (a second, separate
 * bot with its own token and secret). It is listed explicitly rather than left
 * to the "/api/telegram" prefix happening to cover it: a rename of either path
 * must not silently drop one of them back behind the session gate.
 */
/*
 * Telegram va cron chaqiruvlari — admin sessiyasidan ozod.
 *
 * `/api/telegram-coordinator` ALOHIDA yozilgan, garchi
 * `/api/telegram` prefiksi uni allaqachon qamrasa ham: bu
 * bog'liqlik jimgina. Kimdir keyin prefiksni `/api/telegram/`
 * qilib qo'ysa, koordinator boti xatosiz, sababsiz ishlamay
 * qolardi — Telegram esa faqat "Wrong response from the webhook"
 * derdi.
 */
const MACHINE_PATHS = [
  "/api/telegram",
  "/api/telegram-sales",
  "/api/telegram-coordinator",
  "/api/telegram-member",
  "/api/cron",
];

/*
 * Public by design, gated at the route layer rather than by an admin session.
 *
 * `/anketa` + `/api/intake` — candidate secure-link intake, gated by token.
 *
 * `/mehr-app` + `/api/mehr-app` — the MEHR Mini App, gated by Telegram's
 * `initData` HMAC signature. It runs inside Telegram for ordinary members,
 * who have no admin cookie at all: requiring one would 307 every organizer
 * and participant away from the check-in screen. Identity there comes from
 * the signature, which only the bot token can produce.
 */
const INTAKE_PUBLIC_PREFIXES = [
  "/anketa",
  "/api/intake",
  "/mehr-app",
  "/api/mehr-app",
  /*
   * `/api/mehr-cert` — a MEHR certificate PDF, gated by its own code.
   * The recipient is an ordinary member with no admin cookie, and the
   * code is what the QR on the certificate already carries.
   */
  "/api/mehr-cert",
];

/**
 * Refreshes the Supabase session cookie and gates every admin route.
 * Fine-grained role checks live in requirePermission (lib/auth.ts) and RLS.
 */
export async function proxy(request: NextRequest) {
  // Machine callers short-circuit before the Supabase session lookup: they can
  // never have a cookie to refresh, and putting an auth round-trip in front of
  // the Telegram webhook would make bot replies depend on Supabase auth being
  // reachable. Their own secrets are checked inside the route.
  if (MACHINE_PATHS.some((p) => request.nextUrl.pathname.startsWith(p))) {
    return NextResponse.next({ request });
  }

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
