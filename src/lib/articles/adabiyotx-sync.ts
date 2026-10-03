import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { recordAudit } from "@/lib/vip/audit-log";

/**
 * MAQOLANI AdabiyotX'GA UZATISH (§25).
 *
 * AdabiyotX bizning o'z loyihamiz va unda `liderlar-article-publish`
 * edge funksiyasi turadi. U o'qish funksiyasi (`liderlar-catalog-search`)
 * bilan BIR XIL kalit bilan tasdiqlanadi — yangi maxfiy ma'lumot
 * kerak emas.
 *
 * KANAL HOLATI ALOHIDA JADVALDA (`member_article_channels`): maqola
 * Liderlar Online'da nashr bo'lib, AdabiyotX'ga yetib bormasligi
 * mumkin. §25 "never silently lose publication if AdabiyotX sync
 * fails" aynan shuni talab qiladi.
 *
 * IDEMPOTENT: funksiya `source_id` bo'yicha mavjud maqolani
 * yangilaydi, nusxa yaratmaydi. Shuning uchun qayta urinish xavfsiz.
 */

const CHANNEL = "adabiyotx" as const;

/** Necha martadan keyin urinish to'xtaydi. */
const MAX_ATTEMPTS = 5;

export type SyncResult =
  | { ok: true; url: string | null }
  | { ok: false; error: string; retryable: boolean };

function endpoint(): string | null {
  const base = process.env.ADABIYOTX_API_BASE_URL?.trim();
  if (!base) return null;
  return `${base.replace(/\/+$/, "")}/functions/v1/liderlar-article-publish`;
}

/**
 * Bitta maqolani uzatadi.
 *
 * MAQOLA NASHR QILINGAN BO'LISHI SHART. Tasdiqlanmagan matnni
 * AdabiyotX'ga yuborish uni ikki joyda boshqa holatda qoldirardi.
 */
export async function syncArticleToAdabiyotX(articleId: string): Promise<SyncResult> {
  const url = endpoint();
  const apiKey = process.env.ADABIYOTX_INTEGRATION_API_KEY?.trim();

  if (!url || !apiKey) {
    /*
     * SOZLAMA YO'Q — QAYTA URINISH MA'NOSIZ.
     *
     * `retryable: false`: cron har yurishda bir xil xatoga urilib,
     * log'ni to'ldirardi.
     */
    return {
      ok: false,
      error: "AdabiyotX integratsiyasi sozlanmagan.",
      retryable: false,
    };
  }

  const db = createSupabaseAdminClient();

  const { data: article, error } = await db
    .from("member_articles")
    .select(
      "id, title, subtitle, excerpt, content, hero_url, hero_alt, state, published_at, candidates(slug, full_name, avatar_url, short_bio, user_id)",
    )
    .eq("id", articleId)
    .maybeSingle();

  /*
   * BAZA XATOSI — QAYTA URINILADI; maqola yo'q — urinilmaydi.
   *
   * Avval ikkalasi ham "topilmadi, qayta urinma" edi: bir lahzalik
   * ulanish xatosi nashr qilingan maqolani AdabiyotX'ga hech qachon
   * yetib bormaydigan qilib qo'yardi.
   */
  if (error) {
    console.error("[adabiyotx] maqola o'qilmadi:", error.message);
    return { ok: false, error: "Maqolani o'qib bo'lmadi.", retryable: true };
  }
  if (!article) {
    return { ok: false, error: "Maqola topilmadi.", retryable: false };
  }

  if (article.state !== "published") {
    return { ok: false, error: "Maqola nashr qilinmagan.", retryable: false };
  }

  const candidate = article.candidates as {
    slug?: string;
    full_name?: string;
    avatar_url?: string | null;
    short_bio?: string | null;
    user_id?: string | null;
  } | null;

  if (!candidate?.slug || !candidate.full_name) {
    return { ok: false, error: "Muallif ma'lumoti to'liq emas.", retryable: false };
  }

  /*
   * LOGIN NOMI — AdabiyotX tomonida muallifni akkaunt bilan bog'lash
   * uchun. Majburiy emas: nomzodda login bo'lmasligi mumkin.
   */
  let username: string | null = null;
  if (candidate.user_id) {
    const { data: profile, error: profileError } = await db
      .from("profiles")
      .select("username")
      .eq("id", candidate.user_id)
      .maybeSingle();
    /*
     * O'qib bo'lmasa — keyinroq qayta. Loginsiz yuborish maqolani
     * AdabiyotX'da muallif akkauntidan uzib qo'yardi va sinxron
     * "muvaffaqiyatli" deb belgilanib, boshqa takrorlanmasdi.
     */
    if (profileError) {
      console.error("[adabiyotx] muallif logini o'qilmadi:", profileError.message);
      return { ok: false, error: "Muallif ma'lumotini o'qib bo'lmadi.", retryable: true };
    }
    username = (profile?.username as string | null) ?? null;
  }

  const payload = {
    source_id: article.id,
    title: article.title,
    subtitle: article.subtitle,
    excerpt: article.excerpt,
    body: article.content,
    hero_url: article.hero_url,
    hero_alt: article.hero_alt,
    published_at: article.published_at,
    author: {
      full_name: candidate.full_name,
      slug: candidate.slug,
      avatar_url: candidate.avatar_url,
      username,
      short_bio: candidate.short_bio,
    },
  };

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        // O'qish funksiyasi bilan bir xil sarlavha.
        "x-adabiyotx-api-key": apiKey,
      },
      body: JSON.stringify(payload),
      /*
       * VAQT CHEGARASI.
       *
       * Busiz serverless funksiya javob kutib turib, o'z muddatiga
       * yetib borardi va cron yurishi tugallanmay qolardi.
       */
      signal: AbortSignal.timeout(20_000),
    });

    const body = (await response.json().catch(() => null)) as
      | { ok?: boolean; url?: string; error?: string; code?: string }
      | null;

    if (!response.ok || !body?.ok) {
      /*
       * 4xx — BIZNING XATOMIZ, qayta urinish yordam bermaydi.
       * 5xx va tarmoq xatosi — vaqtinchalik, qayta urinish mumkin.
       */
      const retryable = response.status >= 500 || response.status === 429;
      console.error("[adabiyotx] nashr rad etildi:", {
        status: response.status,
        code: body?.code,
      });
      return {
        ok: false,
        error: body?.error ?? `AdabiyotX javobi: ${response.status}`,
        retryable,
      };
    }

    return { ok: true, url: body.url ?? null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[adabiyotx] so'rov yiqildi:", message);
    // Tarmoq yoki vaqt chegarasi — qayta urinish o'rinli.
    return { ok: false, error: "AdabiyotX javob bermadi.", retryable: true };
  }
}

/* ========================================================================= *
 * KANAL HOLATI
 * ========================================================================= */

/** Bitta maqolani uzatib, kanal holatini yangilaydi. */
export async function syncAndRecord(articleId: string): Promise<SyncResult> {
  const db = createSupabaseAdminClient();
  const result = await syncArticleToAdabiyotX(articleId);

  const patch = result.ok
    ? {
        state: "synced" as const,
        external_url: result.url,
        synced_at: new Date().toISOString(),
        last_error: null,
        last_attempt_at: new Date().toISOString(),
      }
    : {
        /*
         * QAYTA URINISH MUMKIN BO'LMASA — `disabled`.
         *
         * `failed` holatida qolsa, cron uni abadiy qayta urinib
         * ko'rardi. `disabled` esa "bu kanal bu maqola uchun
         * ishlamaydi" degan aniq holat.
         */
        state: result.retryable ? ("failed" as const) : ("disabled" as const),
        last_error: result.error,
        last_attempt_at: new Date().toISOString(),
      };

  /*
   * URINISHLAR SONI OSHIRILADI.
   *
   * PostgREST'da `attempts = attempts + 1` ni to'g'ridan-to'g'ri
   * yozib bo'lmaydi, shuning uchun avval o'qiymiz. Poyga xavfi
   * kichik: bitta maqolani bir vaqtda ikki cron yurishi uzatmaydi.
   */
  const { data: current, error: readError } = await db
    .from("member_article_channels")
    .select("attempts")
    .eq("article_id", articleId)
    .eq("channel", CHANNEL)
    .maybeSingle();

  if (readError) {
    /*
     * Sanoq o'qilmasa ham davom etamiz, lekin buni yashirmaymiz:
     * 0 dan sanash urinishlar chegarasini kechiktiradi, xolos.
     */
    console.error("[adabiyotx] urinishlar soni o'qilmadi:", readError.message);
  }

  const attempts = ((current?.attempts as number | undefined) ?? 0) + 1;

  const { error } = await db
    .from("member_article_channels")
    .upsert(
      { article_id: articleId, channel: CHANNEL, attempts, ...patch },
      { onConflict: "article_id,channel" },
    );

  if (error) {
    console.error("[adabiyotx] kanal holati yozilmadi:", error.message);
  }

  /*
   * JURNAL: muvaffaqiyat va YAKUNIY muvaffaqiyatsizlik.
   *
   * Har bir oraliq urinish yozilmaydi — cron har 15 daqiqada
   * yuradi va jurnal bir xil qatorlar bilan to'lib ketardi. Admin
   * uchun muhimi: maqola yetib bordimi yoki urinishlar tugadimi.
   */
  if (result.ok) {
    await recordAudit("article.adabiyotx_synced", {
      actorId: null,
      entityId: articleId,
      metadata: { attempts, external_url: result.url },
    });
  } else if (!result.retryable || attempts >= MAX_ATTEMPTS) {
    await recordAudit("article.adabiyotx_failed", {
      actorId: null,
      entityId: articleId,
      reason: result.error,
      metadata: { attempts, retryable: result.retryable },
    });
  }

  return result;
}

/* ========================================================================= *
 * QAYTA URINISH VAZIFASI — §73
 * ========================================================================= */

export interface SweepResult {
  attempted: number;
  synced: number;
  failed: number;
  givenUp: number;
}

/**
 * Kutayotgan va yiqilgan kanallarni uzatadi.
 *
 * IDEMPOTENT: AdabiyotX tomonidagi funksiya `source_id` bo'yicha
 * mavjud maqolani yangilaydi, ya'ni vazifa necha marta yurishining
 * ahamiyati yo'q.
 */
export async function sweepAdabiyotXChannels(limit = 20): Promise<SweepResult> {
  const db = createSupabaseAdminClient();

  const { data, error } = await db
    .from("member_article_channels")
    .select("article_id, attempts, state")
    .eq("channel", CHANNEL)
    .in("state", ["pending", "failed"])
    /*
     * URINISHLAR TUGAGANLARI OLINMAYDI.
     *
     * Cheksiz urinish yiqilgan integratsiyaga abadiy so'rov yuborib
     * turardi.
     */
    .lt("attempts", MAX_ATTEMPTS)
    .order("last_attempt_at", { ascending: true, nullsFirst: true })
    .limit(limit);

  if (error) {
    console.error("[adabiyotx] navbat o'qilmadi:", error.message);
    return { attempted: 0, synced: 0, failed: 0, givenUp: 0 };
  }

  const rows = data ?? [];
  const result: SweepResult = { attempted: rows.length, synced: 0, failed: 0, givenUp: 0 };

  for (const row of rows) {
    const outcome = await syncAndRecord(row.article_id as string);

    if (outcome.ok) {
      result.synced += 1;
      continue;
    }

    result.failed += 1;

    /*
     * OXIRGI URINISH BO'LGANINI ALOHIDA SANAYMIZ.
     *
     * Admin "nega bu maqola AdabiyotX'da yo'q" degan savolga javob
     * topishi uchun bu son kerak.
     */
    const attempts = ((row.attempts as number | undefined) ?? 0) + 1;
    if (!outcome.retryable || attempts >= MAX_ATTEMPTS) result.givenUp += 1;
  }

  return result;
}
