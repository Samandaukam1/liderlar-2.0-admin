import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { uuidSchema } from "@/lib/adabiyotx/validation";
import {
  mapPublicCandidateAdabiyotXRow,
  type PublicCandidateAdabiyotXRow,
} from "@/lib/adabiyotx/types";

export const dynamic = "force-dynamic";

const PUBLIC_ITEM_SELECT =
  "id, candidate_integration_key, external_id, relationship_type, content_type, title, author_name, description, cover_url, external_url, published_at, sort_order, is_visible, created_at";

type PublicRouteContext = {
  params: Promise<{ integrationKey: string }>;
};

function apiKeyMatches(expected: string, provided: string | null): boolean {
  if (!provided) return false;
  const expectedBytes = Buffer.from(expected, "utf8");
  const providedBytes = Buffer.from(provided, "utf8");
  return (
    expectedBytes.length === providedBytes.length &&
    timingSafeEqual(expectedBytes, providedBytes)
  );
}

function responseHeaders(isProtected: boolean): HeadersInit {
  if (isProtected) {
    return {
      "Cache-Control": "private, max-age=60, stale-while-revalidate=300",
      Vary: "x-liderlar-api-key",
    };
  }
  return {
    "Cache-Control":
      "public, max-age=60, s-maxage=300, stale-while-revalidate=600",
  };
}

export async function GET(
  request: Request,
  context: PublicRouteContext,
) {
  const configuredApiKey =
    process.env.LIDERLAR_PUBLIC_CONTENT_API_KEY?.trim() ?? "";
  const isProtected = configuredApiKey.length > 0;
  const { integrationKey } = await context.params;
  if (!uuidSchema.safeParse(integrationKey).success) {
    return NextResponse.json(
      {
        ok: false,
        code: "INVALID_INTEGRATION_KEY",
        error: "integrationKey UUID formatida bo‘lishi kerak.",
      },
      {
        status: 400,
        headers: {
          "Cache-Control": "no-store",
          ...(isProtected ? { Vary: "x-liderlar-api-key" } : {}),
        },
      },
    );
  }

  if (
    isProtected &&
    !apiKeyMatches(
      configuredApiKey,
      request.headers.get("x-liderlar-api-key"),
    )
  ) {
    return NextResponse.json(
      {
        ok: false,
        code: "UNAUTHORIZED",
        error: "API kaliti noto‘g‘ri yoki yuborilmagan.",
      },
      {
        status: 401,
        headers: {
          "Cache-Control": "no-store",
          Vary: "x-liderlar-api-key",
        },
      },
    );
  }

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("candidate_adabiyotx_items")
    .select(PUBLIC_ITEM_SELECT)
    .eq("candidate_integration_key", integrationKey)
    .eq("is_visible", true)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json(
      {
        ok: false,
        code: "PUBLIC_ITEMS_LOAD_FAILED",
        error: "Materiallarni yuklab bo‘lmadi.",
      },
      {
        status: 500,
        headers: {
          "Cache-Control": "no-store",
          ...(isProtected ? { Vary: "x-liderlar-api-key" } : {}),
        },
      },
    );
  }

  const items = ((data ?? []) as unknown as PublicCandidateAdabiyotXRow[]).map(
    mapPublicCandidateAdabiyotXRow,
  );
  return NextResponse.json(
    { ok: true, items },
    { headers: responseHeaders(isProtected) },
  );
}
