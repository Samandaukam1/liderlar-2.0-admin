import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { generateRawToken, hashToken, buildUpdateLink } from "@/lib/tokens";
import { logAudit } from "@/lib/audit";

/**
 * OYLIK HAVOLALAR — AVTOMATIK.
 *
 * "Oylik havola" bu loyihada YANGI tushuncha emas: u
 * `monthly_update_tokens` — nomzod o'z oylik yangilanishini
 * yuboradigan havola. Avval admin uni qo'lda yaratib,
 * qo'lda yuborardi.
 *
 * MUHIM CHEKLOV: bazada faqat token HASH'i saqlanadi, xom
 * token emas. Bu ataylab — hash bo'lsa, bazaga kirish
 * huquqiga ega odam ham havolani ishlata olmaydi.
 *
 * Shuning uchun cron havolani "yuborib" qo'ya olmaydi.
 * Dizayn shunga moslashtirildi:
 *
 *   cron  → davr uchun YOZUV yaratadi ("havola tayyor")
 *         → bildirishnoma yozadi
 *   nomzod → kabinetda "Ochish" bosadi
 *          → o'sha payt YANGI xom token chiqariladi
 *
 * Yon foyda: har ochishda havola yangilanadi, ya'ni eski
 * nusxa (masalan ekran suratida qolgan) ishlamay qoladi.
 */

/** Toshkent vaqti bo'yicha davr kaliti: YYYY-MM. */
export function periodKey(now: Date = new Date()): string {
  const tashkent = new Date(now.getTime() + 5 * 60 * 60 * 1000);
  const month = String(tashkent.getUTCMonth() + 1).padStart(2, "0");
  return `${tashkent.getUTCFullYear()}-${month}`;
}

/** O'qiladigan oy nomi. */
const MONTHS = [
  "Yanvar", "Fevral", "Mart", "Aprel", "May", "Iyun",
  "Iyul", "Avgust", "Sentabr", "Oktabr", "Noyabr", "Dekabr",
];

export function periodLabel(key: string): string {
  const [year, month] = key.split("-");
  const index = Number(month) - 1;
  return index >= 0 && index < 12 ? `${MONTHS[index]} ${year}` : key;
}

/** Havola necha kun amal qiladi. */
const TTL_DAYS = 45;

export interface MonthlyRunResult {
  ok: boolean;
  period: string;
  generated: number;
  skippedExisting: number;
  notified: number;
  notifyFailed: number;
  reason: "done" | "disabled" | "error";
}

async function isEnabled(): Promise<boolean> {
  const db = createSupabaseAdminClient();
  const { data, error } = await db
    .from("site_settings")
    .select("value")
    .eq("key", "member.monthly_links_enabled")
    .maybeSingle();

  // O'qib bo'lmasa — yopiq. Minglab odamga bildirishnoma
  // yuboradigan ish uchun bu ayniqsa muhim.
  if (error) return false;
  return data?.value?.trim().toLowerCase() === "true";
}

/**
 * Joriy davr uchun havolalarni tayyorlaydi.
 *
 * IDEMPOTENT: `(candidate_id, period_key)` unikal indeksi
 * ikkinchi yugurishda takror yaratilishiga yo'l qo'ymaydi.
 * "Avval bormi deb qarab, keyin yozish" ikki yugurish bir
 * vaqtda kelganda ikkalasiga ham "yo'q ekan" deb ko'rinardi.
 */
export async function runMonthlyLinks(now: Date = new Date()): Promise<MonthlyRunResult> {
  const period = periodKey(now);
  const empty = {
    period, generated: 0, skippedExisting: 0, notified: 0, notifyFailed: 0,
  };

  if (!(await isEnabled())) {
    return { ok: false, ...empty, reason: "disabled" as const };
  }

  const db = createSupabaseAdminClient();

  const { data: run } = await db
    .from("monthly_link_runs")
    .insert({ period_key: period })
    .select("id")
    .maybeSingle();

  const runId = (run?.id as string | undefined) ?? null;

  /*
   * KIMGA: faqat NASHR QILINGAN nomzodlar. Qoralama profil
   * egasidan oylik yangilanish so'rash ma'nosiz.
   */
  const { data: candidates, error: listError } = await db
    .from("candidates")
    .select("id, user_id")
    .eq("status", "published")
    .is("deleted_at", null);

  if (listError) {
    console.error("MONTHLY_LINKS_LIST_FAILED", { code: listError.code });
    if (runId) {
      await db
        .from("monthly_link_runs")
        .update({
          completed_at: new Date().toISOString(),
          error_summary: "Nomzodlar ro'yxatini o'qib bo'lmadi",
        })
        .eq("id", runId);
    }
    return { ok: false, ...empty, reason: "error" as const };
  }

  const rows = (candidates ?? []) as { id: string; user_id: string | null }[];
  const expiresAt = new Date(now.getTime() + TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();

  let generated = 0;
  let skipped = 0;
  let notified = 0;
  let notifyFailed = 0;

  for (const candidate of rows) {
    /*
     * Boshlang'ich hash — xom tokeni ATAYLAB tashlab
     * yuboriladi. Yozuv "bu davr uchun havola tayyor"
     * degan ma'noni bildiradi; ishlaydigan havola nomzod
     * kabinetda ochganda chiqariladi.
     */
    const { error } = await db.from("monthly_update_tokens").insert({
      candidate_id: candidate.id,
      token_hash: hashToken(generateRawToken()),
      period_key: period,
      expires_at: expiresAt,
    });

    if (error) {
      // 23505 — bu davr uchun allaqachon bor.
      if (error.code === "23505") {
        skipped += 1;
        continue;
      }
      console.error("MONTHLY_LINK_INSERT_FAILED", { code: error.code });
      notifyFailed += 1;
      continue;
    }

    generated += 1;

    /*
     * Bildirishnoma FAQAT hisobi bor odamga:
     * `notifications.recipient_id` auth foydalanuvchiga
     * ishora qiladi. Hisobsiz nomzodning havolasi baribir
     * yaratildi va admin uni ko'ra oladi.
     */
    if (candidate.user_id) {
      const { error: notifyError } = await db.from("notifications").insert({
        recipient_id: candidate.user_id,
        title: `${periodLabel(period)} oyi uchun havolangiz tayyor`,
        body: "Shaxsiy kabinetingizdagi «Oylik havolalar» bo'limidan oching.",
        kind: "monthly_link",
        link: "/kabinet",
      });

      if (notifyError) notifyFailed += 1;
      else notified += 1;
    }
  }

  if (runId) {
    await db
      .from("monthly_link_runs")
      .update({
        completed_at: new Date().toISOString(),
        generated,
        skipped_existing: skipped,
        delivery_success: notified,
        delivery_failed: notifyFailed,
      })
      .eq("id", runId);
  }

  await logAudit({
    actorId: null,
    action: "monthly_links.generated",
    entityType: "monthly_link_run",
    entityId: runId,
    severity: "info",
    newValue: { period, generated, skipped },
  });

  return {
    ok: true,
    period,
    generated,
    skippedExisting: skipped,
    notified,
    notifyFailed,
    reason: "done",
  };
}

export type IssueResult =
  | { ok: true; url: string; expiresAt: string }
  | { ok: false; reason: "not_found" | "expired" | "revoked" | "used" | "error" };

/**
 * Nomzodga o'sha davr uchun ISHLAYDIGAN havolani beradi.
 *
 * HAR CHAQIRUVDA YANGI XOM TOKEN. Eskisi shu zahoti ishlamay
 * qoladi — ekran suratida yoki nusxa buferida qolgan havola
 * keyin ishlatilmasin.
 *
 * `candidateId` CHAQIRUVCHI tomonidan tekshirilgan bo'lishi
 * SHART: u seansdagi foydalanuvchining nomzodi bo'lishi
 * kerak.
 */
export async function issueMonthlyLink(
  candidateId: string,
  period: string,
): Promise<IssueResult> {
  const db = createSupabaseAdminClient();
  const nowIso = new Date().toISOString();

  const raw = generateRawToken();

  /*
   * SHARTLI UPDATE: faqat amaldagi, ishlatilmagan yozuv.
   * Avval o'qib keyin yozsak, shu orada admin uni bekor
   * qilgan bo'lsa ham havola berilardi.
   */
  const { data, error } = await db
    .from("monthly_update_tokens")
    .update({
      token_hash: hashToken(raw),
      opened_at: nowIso,
    })
    .eq("candidate_id", candidateId)
    .eq("period_key", period)
    .eq("status", "active")
    .gt("expires_at", nowIso)
    .select("expires_at")
    .maybeSingle();

  if (error) {
    console.error("MONTHLY_LINK_ISSUE_FAILED", { code: error.code });
    return { ok: false, reason: "error" };
  }

  if (!data) {
    // Nega bo'lmadi — aniq javob berish uchun.
    const { data: existing } = await db
      .from("monthly_update_tokens")
      .select("status, expires_at")
      .eq("candidate_id", candidateId)
      .eq("period_key", period)
      .maybeSingle();

    if (!existing) return { ok: false, reason: "not_found" };
    if (existing.status === "used") return { ok: false, reason: "used" };
    if (existing.status === "revoked") return { ok: false, reason: "revoked" };
    return { ok: false, reason: "expired" };
  }

  return {
    ok: true,
    url: buildUpdateLink(raw),
    expiresAt: data.expires_at as string,
  };
}
