import "server-only";
import { createHash } from "crypto";
import { NextResponse } from "next/server";

/** JSON response with the public-form security headers always attached. */
export function noStoreJson(data: unknown, status = 200): NextResponse {
  const res = NextResponse.json(data, { status });
  res.headers.set("Cache-Control", "no-store, max-age=0");
  res.headers.set("Referrer-Policy", "no-referrer");
  res.headers.set("X-Robots-Tag", "noindex, nofollow");
  return res;
}

export function jsonError(status: number, error: string, extra?: Record<string, unknown>): NextResponse {
  return noStoreJson({ ok: false, error, ...extra }, status);
}

/** Best-effort client IP from proxy headers. */
export function clientIp(headers: Headers): string {
  const xff = headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return headers.get("x-real-ip") ?? "0.0.0.0";
}

/**
 * One-way IP hash for consent records and rate-limit keys. Keyed by
 * CANDIDATE_LINK_SECRET so the raw IP is never recoverable or stored.
 */
export function clientIpHash(headers: Headers): string {
  const salt = process.env.CANDIDATE_LINK_SECRET ?? "";
  return createHash("sha256").update(clientIp(headers) + "|" + salt).digest("hex");
}

/** Same-origin / allowed-origin guard for state-changing public requests. */
export function originAllowed(headers: Headers): boolean {
  const origin = headers.get("origin");
  if (!origin) return true; // non-browser clients (sendBeacon may omit) — token still gates
  const allowed = [
    process.env.NEXT_PUBLIC_ADMIN_URL,
    process.env.NEXT_PUBLIC_INTAKE_BASE_URL?.replace(/\/anketa\/?$/, ""),
  ].filter(Boolean) as string[];
  try {
    const host = new URL(origin).host;
    return allowed.some((a) => {
      try {
        return new URL(a).host === host;
      } catch {
        return false;
      }
    });
  } catch {
    return false;
  }
}

/** Tolerant body reader: JSON, or text (sendBeacon) parsed as JSON. */
export async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const text = await request.text();
    if (!text) return {};
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return {};
  }
}
