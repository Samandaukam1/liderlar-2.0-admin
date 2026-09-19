import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";

/**
 * NOMZODLAR HUDUDI — AUDIT VA XAVFSIZ TO'LDIRISH.
 *
 * QOIDA: erkin matndan hudud TAXMIN QILINMAYDI.
 *
 * Anketaning 3-savoli "Hozirgi yashash joyingiz (viloyat/tuman/
 * shahar)?" — erkin matn. Undan hudud chiqarish "Toshkent" so'zini
 * ko'rib shahar yoki viloyat ekanini bilmaslik, "Chirchiq" ni
 * qaysi viloyat ekanini taxmin qilish demak. Bitta xato nomzodni
 * umrbod noto'g'ri hududga yozib qo'yadi.
 *
 * Shuning uchun faqat TUZILMAVIY bog'lanish ishlatiladi:
 * `applications.region_id` — u ro'yxatdan tanlangan va aniq.
 */

export interface RegionAudit {
  totalCandidates: number;
  withRegion: number;
  withoutRegion: number;
  /** Arizasi orqali hududini aniq bilish mumkin bo'lganlar. */
  resolvableFromApplication: number;
  /** Arizasi bor, lekin unda ham hudud yo'q. */
  applicationWithoutRegion: number;
  /** Hech qanday ishonchli manba yo'q. */
  unresolvable: number;
}

export async function auditCandidateRegions(): Promise<RegionAudit> {
  const db = createSupabaseAdminClient();

  const { count: total } = await db
    .from("candidates")
    .select("id", { count: "exact", head: true })
    .is("deleted_at", null);

  const { count: withRegion } = await db
    .from("candidates")
    .select("id", { count: "exact", head: true })
    .is("deleted_at", null)
    .not("region_id", "is", null);

  // Hududsizlar.
  const { data: missing } = await db
    .from("candidates")
    .select("id")
    .is("deleted_at", null)
    .is("region_id", null)
    .limit(5000);

  const missingIds = (missing ?? []).map((r) => r.id as string);
  if (missingIds.length === 0) {
    return {
      totalCandidates: total ?? 0,
      withRegion: withRegion ?? 0,
      withoutRegion: 0,
      resolvableFromApplication: 0,
      applicationWithoutRegion: 0,
      unresolvable: 0,
    };
  }

  /*
   * Arizada hudud bormi — YAGONA ishonchli manba.
   *
   * `applications.candidate_id` bog'lanishi ariza nomzodga
   * aylantirilganda yoziladi.
   */
  const { data: applications } = await db
    .from("applications")
    .select("candidate_id, region_id")
    .in("candidate_id", missingIds);

  let resolvable = 0;
  let appWithoutRegion = 0;
  const seen = new Set<string>();
  for (const row of applications ?? []) {
    const candidateId = row.candidate_id as string | null;
    if (!candidateId || seen.has(candidateId)) continue;
    seen.add(candidateId);
    if (row.region_id) resolvable += 1;
    else appWithoutRegion += 1;
  }

  return {
    totalCandidates: total ?? 0,
    withRegion: withRegion ?? 0,
    withoutRegion: missingIds.length,
    resolvableFromApplication: resolvable,
    applicationWithoutRegion: appWithoutRegion,
    unresolvable: missingIds.length - resolvable - appWithoutRegion,
  };
}

export interface BackfillResult {
  updated: number;
  skipped: number;
}

/**
 * Hududni ARIZADAN to'ldiradi.
 *
 * FAQAT tuzilmaviy bog'lanish: ariza formasida hudud ro'yxatdan
 * tanlanadi, ya'ni u aniq. Erkin matnli javoblar bu yerga umuman
 * qatnashmaydi.
 *
 * Mavjud hudud USTIDAN YOZILMAYDI: `.is("region_id", null)` sharti
 * bilan — kimdir qo'lda to'g'irlagan bo'lsa, u saqlanadi.
 */
export async function backfillCandidateRegions(
  actorId: string | null,
  limit = 500,
): Promise<BackfillResult> {
  const db = createSupabaseAdminClient();
  const result: BackfillResult = { updated: 0, skipped: 0 };

  const { data: applications } = await db
    .from("applications")
    .select("candidate_id, region_id")
    .not("candidate_id", "is", null)
    .not("region_id", "is", null)
    .limit(limit);

  for (const row of applications ?? []) {
    const candidateId = row.candidate_id as string;
    const { data: updated } = await db
      .from("candidates")
      .update({ region_id: row.region_id })
      .eq("id", candidateId)
      // Faqat BO'SH bo'lganini to'ldiramiz.
      .is("region_id", null)
      .select("id");

    if ((updated?.length ?? 0) > 0) result.updated += 1;
    else result.skipped += 1;
  }

  if (result.updated > 0) {
    await logAudit({
      actorId,
      action: "candidates.region_backfilled",
      entityType: "candidates",
      metadata: { updated: result.updated, source: "applications.region_id" },
    });
  }

  return result;
}
