import "server-only";
import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

const NO_STORE = { "Cache-Control": "no-store" };

function apiKeyMatches(expected: string, provided: string | null): boolean {
  if (!provided) return false;
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(provided, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * `/api/public/adabiyotx/*` uchun kirish nazorati.
 *
 * Shu endpointlar hisoblarni bog'laydi va reytingga ball yozadi, shuning
 * uchun kalit MAJBURIY (ommaviy kontent API'sidan farqli o'laroq kalitsiz
 * rejim yo'q). Kalit — ikki loyiha allaqachon ulashadigan
 * LIDERLAR_PUBLIC_CONTENT_API_KEY; AdabiyotX serveri uni
 * `x-liderlar-api-key` sarlavhasida yuboradi.
 */
export function requireLiderlarApiKey(request: Request): NextResponse | null {
  const expected = process.env.LIDERLAR_PUBLIC_CONTENT_API_KEY?.trim() ?? "";
  if (!expected) {
    return NextResponse.json(
      { ok: false, code: "NOT_CONFIGURED", error: "LIDERLAR_PUBLIC_CONTENT_API_KEY sozlanmagan." },
      { status: 503, headers: NO_STORE },
    );
  }
  if (!apiKeyMatches(expected, request.headers.get("x-liderlar-api-key"))) {
    return NextResponse.json(
      { ok: false, code: "UNAUTHORIZED", error: "API kaliti noto‘g‘ri yoki yuborilmagan." },
      { status: 401, headers: { ...NO_STORE, Vary: "x-liderlar-api-key" } },
    );
  }
  return null;
}

export function partnerJson(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

export function partnerError(code: string, error: string, status: number): NextResponse {
  return partnerJson({ ok: false, code, error }, status);
}
