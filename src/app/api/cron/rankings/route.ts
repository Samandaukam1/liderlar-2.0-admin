import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * GET /api/cron/rankings
 *
 * Reytingni qayta hisoblaydi.
 *
 * AVVAL BU HECH QACHON AVTOMATIK BAJARILMASDI: funksiya bor
 * edi, lekin uni faqat admin qo'lda tugma bosib chaqirardi.
 * Ya'ni profil ko'rishlari to'planib borardi-yu, reyting
 * o'zgarmasdi va foydalanuvchi buni tushunmasdi.
 *
 * Hisob butunlay `recalculate_rankings()` ichida — bu yerda
 * biznes mantiq YO'Q. Uni JS'da takrorlash ikkita formula
 * paydo qilardi.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("[cron] CRON_SECRET sozlanmagan — reyting hisoblanmadi");
    return NextResponse.json({ error: "CRON_SECRET sozlanmagan" }, { status: 503 });
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Ruxsat yo'q" }, { status: 401 });
  }

  const db = createSupabaseAdminClient();
  const { data, error } = await db.rpc("recalculate_rankings");

  if (error) {
    /*
     * Faol davr bo'lmasa funksiya xato beradi — bu odatiy
     * holat, nosozlik emas. Uni xato sifatida qaytarsak,
     * Vercel cron'i muvaffaqiyatsiz deb belgilanib, keraksiz
     * ogohlantirish berardi.
     */
    const noPeriod = error.message?.includes("reyting davri");
    console[noPeriod ? "warn" : "error"]("RANKING_RECALC", {
      code: error.code,
      message: error.message,
    });
    return NextResponse.json(
      { ok: false, reason: noPeriod ? "no_open_period" : "error" },
      { status: 200 },
    );
  }

  return NextResponse.json({ ok: true, scored: data ?? 0 });
}
