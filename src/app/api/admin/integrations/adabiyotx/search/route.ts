import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { checkPermission } from "@/lib/auth";
import { adabiyotXError } from "@/lib/adabiyotx/api";
import { searchAdabiyotXCatalog } from "@/lib/adabiyotx/adapter";
import { sanitizeAdabiyotXQuery } from "@/lib/adabiyotx/core";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const context = await checkPermission("candidates.edit");
  if (!context) {
    return adabiyotXError("FORBIDDEN", "Ruxsat yo‘q.", 403);
  }

  const query = sanitizeAdabiyotXQuery(
    request.nextUrl.searchParams.get("q") ?? "",
  );
  if (query.length < 2) {
    return adabiyotXError(
      "QUERY_TOO_SHORT",
      "Qidiruv so‘rovi kamida 2 belgidan iborat bo‘lishi kerak.",
      400,
    );
  }

  const result = await searchAdabiyotXCatalog(query, {
    signal: request.signal,
  });
  if (!result.ok) {
    return adabiyotXError(
      result.code,
      result.error,
      result.code === "ADABIYOTX_SEARCH_NOT_CONFIGURED" ? 503 : 502,
    );
  }
  return NextResponse.json({ ok: true, items: result.items });
}
