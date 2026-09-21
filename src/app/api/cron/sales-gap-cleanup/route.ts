import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { gapCounts, reclassifyKnowledgeGaps } from "@/lib/sales/gaps/reclassify-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/cron/sales-gap-cleanup
 *
 * "Javobsiz savollar" navbatini tasniflaydi va savol
 * bo'lmaganlarni arxivga o'tkazadi (23-band).
 *
 * NEGA CRON: tozalash bir martalik ish emas. Tarixiy yozuvlar
 * birinchi yurishda tasniflanadi, keyin esa har yurish
 * tasniflanmagan yangi yozuvlarni oladi — ya'ni navbat o'zidan
 * o'zi toza qoladi.
 *
 * IDEMPOTENT: tasniflangan yozuv qayta ishlanmaydi, shuning
 * uchun takroriy chaqiruv sanoqni ikkilantirmaydi.
 *
 * Mavjud cron'lar kabi YOPIQ: `CRON_SECRET` bo'lmasa ishlamaydi.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("[gap-cleanup] CRON_SECRET sozlanmagan — cron o‘chirilgan");
    return NextResponse.json({ ok: false }, { status: 503 });
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  try {
    const result = await reclassifyKnowledgeGaps({ note: "cron" });

    /*
     * SANOQLAR LOG'GA CHIQADI.
     *
     * Savol matni EMAS — faqat raqamlar (37-band). Hisobot
     * uchun shu yetarli va mijoz yozishmasi log'ga tushmaydi.
     */
    console.log(
      `[gap-cleanup] tekshirildi=${result.scanned} arxivlandi=${result.archived} ` +
        `haqiqiy=${result.counts.real_knowledge_gap} shaxsiy=${result.counts.case_specific} ` +
        `muloqot=${result.counts.conversational} anketa=${result.counts.form_data} ` +
        `shovqin=${result.counts.noise} korib_chiqish=${result.counts.unknown_review}` +
        (result.error ? ` XATO=${result.error}` : ""),
    );

    /*
     * JORIY HOLAT HAM YOZILADI, faqat shu yurishning natijasi
     * emas.
     *
     * NEGA: ish idempotent — birinchi yurish hammasini
     * tasniflaydi, keyingilari nol qaytaradi. Faqat delta
     * yozilsa, "navbat hozir qanday?" degan savolga javob
     * birinchi yurishdan keyin abadiy yo'qolardi.
     */
    const totals = await gapCounts();
    console.log(
      `[gap-cleanup] holat: navbat=${totals.open} arxiv=${totals.archived} ` +
        `odam_kerak=${totals.escalationsOpen} taqsimot=` +
        Object.entries(totals.byClassification)
          .map(([key, value]) => `${key}:${value}`)
          .join(","),
    );

    return NextResponse.json({ ok: result.error === null, ...result, totals });
  } catch (err) {
    console.error(
      "[gap-cleanup] xato:",
      err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    );
    return NextResponse.json({ ok: false }, { status: 200 });
  }
}
