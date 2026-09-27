import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { checkPermission } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { groupByPromoCode, type PromoApplicant } from "@/lib/applications/promo-similarity";
import { buildPromoReportPdf } from "@/lib/applications/promo-report-pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/export/promo-report?q=ALI
 *
 * Promo kodlar bo'yicha arizalar ro'yxati — PDF.
 *
 * NEGA ALOHIDA ROUTE: mavjud `/api/export/[entity]` CSV qaytaradi
 * va uning shakli qat'iy (header + qatorlar). PDF hujjat esa
 * guruhlangan tuzilma — uni o'sha qolipga tiqish ikkalasini ham
 * buzardi.
 *
 * ARIZA MA'LUMOTI SHAXSIY: telefon va Telegram bor, shuning uchun
 * `applications.view` ruxsati talab qilinadi va har yuklab olish
 * audit jurnaliga tushadi.
 */
export async function GET(request: NextRequest) {
  const ctx = await checkPermission("applications.view");
  if (!ctx) return NextResponse.json({ error: "Ruxsat yo‘q" }, { status: 403 });

  const query = (request.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 64);

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("applications")
    .select("id, full_name, phone, telegram, age_range, promo_code, created_at")
    .not("promo_code", "is", null)
    .neq("promo_code", "")
    .order("created_at", { ascending: false })
    .limit(5000);

  if (error) {
    console.error("[promo-report] o‘qib bo‘lmadi:", error.message);
    return NextResponse.json({ error: "Ma’lumot o‘qilmadi" }, { status: 500 });
  }

  const applicants: PromoApplicant[] = (data ?? []).map((row) => ({
    id: row.id as string,
    fullName: (row.full_name as string) ?? "",
    promoCode: (row.promo_code as string) ?? "",
    phone: (row.phone as string | null) ?? null,
    telegram: (row.telegram as string | null) ?? null,
    ageRange: (row.age_range as string | null) ?? null,
    createdAt: (row.created_at as string | null) ?? null,
  }));

  const groups = groupByPromoCode(applicants, query);

  const pdf = await buildPromoReportPdf({
    groups,
    query: query === "" ? null : query,
    generatedAt: new Date(),
    totalApplications: applicants.length,
  });

  await logAudit({
    actorId: ctx.userId,
    action: "applications.promo_report_exported",
    entityType: "applications",
    // Qidiruv matni yoziladi, nomzod ma'lumoti EMAS.
    metadata: { query: query || null, groups: groups.length },
  });

  const stamp = new Date().toISOString().slice(0, 10);
  const name = query ? `promo-${query}-${stamp}.pdf` : `promo-kodlar-${stamp}.pdf`;

  return new NextResponse(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${name}"`,
      // Shaxsiy ma'lumot — hech qayerda keshlanmasin.
      "Cache-Control": "no-store, private",
    },
  });
}
