import "server-only";
import { randomInt } from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { recordAudit } from "@/lib/vip/audit-log";
import { buildCode, charPicker } from "./code";

/**
 * HAR AKKAUNTGA SHAXSIY TAVSIYA KODI.
 *
 * §75: kod VIP imtiyozi EMAS — har bir akkauntda bo'ladi. VIP faqat
 * uning tahlilini va ariza formasida ko'rinishini beradi.
 *
 * NEGA FON VAZIFASI, bir martalik migratsiya emas:
 *
 *   - Yangi akkauntlar ham kod olishi kerak. Bir martalik skript
 *     faqat o'tmishni yopardi va ertaga ro'yxatdan o'tgan odam
 *     kodsiz qolardi.
 *   - Qayta ishga tushirishga xavfsiz (§74 "restart-safe"): kodi
 *     bor profil o'tkazib yuboriladi.
 *
 * ARIZA FORMASIDA KOD MAJBURIY BO'LISHIDAN OLDIN bu vazifa kamida
 * bir marta to'liq o'tishi kerak — aks holda kodsiz odamlar
 * tavsiya qila olmaydi.
 */

const pickChar = charPicker((max) => randomInt(max));

/** Bitta profil uchun necha marta urinish. */
const MAX_ATTEMPTS = 6;

export interface SweepResult {
  /** Ko'rilgan profillar soni (kodsizlar). */
  checked: number;
  created: number;
  /** Urinishlar tugagan yoki xato — keyingi yurishda qayta ko'riladi. */
  failed: number;
  /** Yana kodsiz profil qoldimi: `true` bo'lsa vazifa yana chaqirilishi kerak. */
  hasMore: boolean;
}

/**
 * Kodsiz profillarga kod beradi.
 *
 * `limit` — bitta yurishda nechta. Serverless muhitda vaqt cheklangani
 * uchun hammasi bir yurishda qilinmaydi; `hasMore` qaytadi va vazifa
 * keyingi safar davom etadi.
 */
export async function sweepReferralCodes(limit = 200): Promise<SweepResult> {
  const db = createSupabaseAdminClient();

  /*
   * KODSIZ PROFILLARNI TOPISH.
   *
   * `not.in` bilan emas, LEFT JOIN mantig'i bilan: `referral_codes`
   * o'sib borgach, `not.in (hamma kod egasi)` so'rovi ro'yxatni
   * so'rov ichiga tiqib, chidab bo'lmas holga kelardi.
   *
   * PostgREST'da buni `referral_codes` tomonidan `is null` filtri
   * bilan ifodalaymiz.
   */
  const { data, error } = await db
    .from("profiles")
    /*
     * `!left` ANIQ yozilgan: PostgREST aks holda biriktirishni ichki
     * (inner) deb olishi mumkin va u holda kodsiz profillar
     * natijadan butunlay chiqib ketardi — ya'ni vazifa "hammasida
     * kod bor" degan yolg'on xulosaga kelardi.
     */
    .select("id, full_name, referral_codes!left(profile_id)")
    .eq("is_active", true)
    .is("referral_codes", null)
    .limit(limit);

  if (error) {
    console.error("[referral] kodsiz profillar o'qilmadi:", error.message);
    return { checked: 0, created: 0, failed: 0, hasMore: false };
  }

  const rows = data ?? [];
  const result: SweepResult = {
    checked: rows.length,
    created: 0,
    failed: 0,
    // Limit to'lgan bo'lsa, yana qolgan bo'lishi ehtimoli bor.
    hasMore: rows.length === limit,
  };

  for (const row of rows) {
    const created = await createCodeFor(row.id as string, (row.full_name as string) ?? null);
    if (created) result.created += 1;
    else result.failed += 1;
  }

  /*
   * BITTA YIG'MA JURNAL YOZUVI — har kod uchun emas.
   *
   * Yurish 200 tagacha kod beradi; har biriga alohida yozuv cron
   * vaqtini oshirar va jurnalni bir xil qatorlar bilan to'ldirardi.
   * Hech narsa qilinmagan yurish (hamma kodli) jurnalga tushmaydi.
   */
  if (result.created > 0 || result.failed > 0) {
    await recordAudit("referral.codes.swept", {
      actorId: null,
      entityId: null,
      metadata: {
        checked: result.checked,
        created: result.created,
        failed: result.failed,
        has_more: result.hasMore,
      },
    });
  }

  return result;
}

/**
 * Bitta profil uchun kod yaratadi.
 *
 * To'qnashuvda qaytadan urinadi: unikal indekslar (satr va fold
 * bo'yicha) 23505 qaytaradi va bu kutilgan holat, nosozlik emas.
 */
async function createCodeFor(profileId: string, fullName: string | null): Promise<boolean> {
  const db = createSupabaseAdminClient();

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const code = buildCode(fullName, pickChar);
    const { error } = await db.from("referral_codes").insert({ profile_id: profileId, code });

    if (!error) return true;

    if (error.code !== "23505") {
      console.error("[referral] kod yozilmadi:", { profileId, message: error.message });
      return false;
    }

    /*
     * `profile_id` unikal bo'lgani uchun yiqilgan bo'lishi mumkin:
     * bir vaqtda boshqa so'rov kod yaratgan. Bu MUVAFFAQIYAT —
     * profilda kod bor.
     */
    const { data: existing, error: existingError } = await db
      .from("referral_codes")
      .select("profile_id")
      .eq("profile_id", profileId)
      .maybeSingle();

    if (existingError) {
      console.error("[referral] mavjud kod tekshirilmadi:", {
        profileId,
        message: existingError.message,
      });
      return false;
    }
    if (existing) return true;
    // Kod band edi — keyingi urinish boshqa tasodif bilan ketadi.
  }

  console.error("[referral] urinishlar tugadi:", { profileId });
  return false;
}

/* ========================================================================= *
 * SANOQ — §74
 * ========================================================================= */

export interface ReferralCounts {
  activeProfiles: number;
  withCode: number;
  withoutCode: number;
  attributions: number;
  confirmedRewards: number;
}

/**
 * Haqiqiy sanoqlar.
 *
 * §74 migratsiyadan oldin sanoq chiqarishni va uni O'YLAB
 * CHIQARMASLIKNI talab qiladi. Shuning uchun bu funksiya faqat
 * bazadan o'qiydi; o'qilmasa, -1 qaytaradi va bu "bilmayman"
 * degani — 0 qaytarish "yo'q" degan yolg'on bo'lardi.
 */
export async function loadReferralCounts(): Promise<ReferralCounts> {
  const db = createSupabaseAdminClient();

  /** Xatoni -1 ga aylantiradi: "bilmayman" va "yo'q" aralashmasin. */
  function value(count: number | null, error: { message: string } | null, what: string): number {
    if (error) {
      console.error(`[referral] ${what} sanalmadi:`, error.message);
      return -1;
    }
    return count ?? 0;
  }

  const head = { count: "exact" as const, head: true };

  const profiles = await db.from("profiles").select("*", head).eq("is_active", true);
  const codes = await db.from("referral_codes").select("*", head).eq("is_active", true);
  const attrs = await db.from("referral_attributions").select("*", head);
  const rewards = await db
    .from("referral_rewards")
    .select("*", head)
    .eq("stage", "payment_confirmed");

  const activeProfiles = value(profiles.count, profiles.error, "profiles");
  const withCode = value(codes.count, codes.error, "referral_codes");
  const attributions = value(attrs.count, attrs.error, "referral_attributions");
  const confirmedRewards = value(rewards.count, rewards.error, "referral_rewards");

  return {
    activeProfiles,
    withCode,
    attributions,
    confirmedRewards,
    withoutCode:
      activeProfiles < 0 || withCode < 0 ? -1 : Math.max(0, activeProfiles - withCode),
  };
}
