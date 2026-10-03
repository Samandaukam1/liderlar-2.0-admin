import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { recordAudit } from "@/lib/vip/audit-log";
import type { AuditEventKey } from "@/lib/vip/audit-events";
import {
  editorCan,
  nextState,
  requiresNote,
  slugify,
  uniqueSlug,
  type ArticleState,
  type EditorAction,
} from "./state";

/**
 * A'ZO MAQOLALARI — TAHRIRIYAT NAVBATI.
 *
 * Mavjud `/articles` bo'limi NOMZOD BIOGRAFIYASI uchun va unga
 * tegilmaydi. Bu yerdagi maqolani a'zoning O'ZI yozadi va u
 * "Liderlar Online" nashrida chiqadi.
 *
 * NASHR IKKI QADAM: tasdiqlash, keyin nashr qilish. Bitta tugmaga
 * yig'ilsa, "kim tasdiqladi" degan savol javobsiz qolardi (§27).
 */

export interface QueueArticle {
  id: string;
  candidateId: string;
  candidateName: string;
  candidateSlug: string;
  title: string;
  subtitle: string | null;
  excerpt: string | null;
  content: string;
  heroUrl: string | null;
  heroAlt: string | null;
  state: ArticleState;
  reviewNote: string | null;
  submittedAt: string | null;
  slug: string | null;
}

/**
 * Tahririyat navbati.
 *
 * `submitted` va `in_review` — ishlanishi kerak bo'lganlar.
 * `approved` ham kiradi: u nashr qilishni kutib turadi va ro'yxatdan
 * tushib qolsa, tasdiqlangan maqola nashrsiz qolib ketardi.
 */
export async function loadArticleQueue(limit = 100): Promise<QueueArticle[]> {
  const db = createSupabaseAdminClient();

  const { data, error } = await db
    .from("member_articles")
    .select(
      "id, candidate_id, title, subtitle, excerpt, content, hero_url, hero_alt, state, review_note, submitted_at, slug, candidates(full_name, slug)",
    )
    .in("state", ["submitted", "in_review", "approved"])
    .order("submitted_at", { ascending: true })
    .limit(limit);

  if (error) {
    console.error("[maqola-korik] navbat o'qilmadi:", error.message);
    return [];
  }

  return (data ?? []).map((row) => {
    const candidate = row.candidates as { full_name?: string; slug?: string } | null;
    return {
      id: row.id as string,
      candidateId: row.candidate_id as string,
      candidateName: candidate?.full_name?.trim() || "(nomsiz)",
      candidateSlug: candidate?.slug ?? "",
      title: (row.title as string) ?? "",
      subtitle: (row.subtitle as string | null) ?? null,
      excerpt: (row.excerpt as string | null) ?? null,
      content: (row.content as string) ?? "",
      heroUrl: (row.hero_url as string | null) ?? null,
      heroAlt: (row.hero_alt as string | null) ?? null,
      state: row.state as ArticleState,
      reviewNote: (row.review_note as string | null) ?? null,
      submittedAt: (row.submitted_at as string | null) ?? null,
      slug: (row.slug as string | null) ?? null,
    };
  });
}

export type EditorialResult = { ok: true } | { ok: false; error: string };

/**
 * Tahririyat amali -> audit hodisasi.
 *
 * Har amal uchun ALOHIDA nom va u qo'lda yozilgan: test koddagi har
 * bir audit nomini katalogdan qidiradi, yig'ilgan qatorni esa ko'ra
 * olmaydi.
 */
const EDITOR_AUDIT: Readonly<Record<EditorAction, AuditEventKey>> = {
  start_review: "article.review_started",
  request_changes: "article.changes_requested",
  approve: "article.approved",
  publish: "article.published",
  reject: "article.rejected",
  archive: "article.archived",
  unpublish: "article.unpublished",
};

/**
 * Tahririyat amalini bajaradi.
 *
 * BITTA KIRISH NUQTASI: har amal uchun alohida funksiya bo'lsa,
 * izoh talabi yoki holat tekshiruvi biror joyda esdan chiqib
 * ketardi.
 */
export async function applyEditorialAction(input: {
  articleId: string;
  action: EditorAction;
  reviewerId: string;
  note: string;
}): Promise<EditorialResult> {
  const db = createSupabaseAdminClient();

  const { data: current, error: readError } = await db
    .from("member_articles")
    .select("id, state, title, slug, candidate_id")
    .eq("id", input.articleId)
    .maybeSingle();

  if (readError || !current) {
    console.error("[maqola-korik] maqola o'qilmadi:", readError?.message);
    return { ok: false, error: "Maqola topilmadi." };
  }

  const state = current.state as ArticleState;

  if (!editorCan(input.action, state)) {
    return {
      ok: false,
      error: "Bu amal maqolaning hozirgi holatida mumkin emas. Sahifani yangilang.",
    };
  }

  const note = input.note.trim();
  if (requiresNote(input.action) && note.length < 3) {
    /*
     * §27: muallif NIMA tuzatish kerakligini bilishi kerak.
     * Izohsiz "tuzatish kerak" odamni qorong'uda qoldirardi.
     */
    return { ok: false, error: "Izoh yozing — muallif uni ko'radi." };
  }

  const target = nextState(input.action);

  const patch: Record<string, unknown> = {
    state: target,
    reviewed_by: input.reviewerId,
    reviewed_at: new Date().toISOString(),
    /*
     * IZOH FAQAT TALAB QILINGAN AMALLARDA SAQLANADI.
     *
     * Tasdiqlashdagi ixtiyoriy izohni ham saqlasak, u muallif
     * ekranida "tuzatish kerak" xabari kabi ko'rinardi.
     */
    review_note: requiresNote(input.action) ? note : null,
  };

  if (input.action === "publish") {
    const prepared = await preparePublish(current.title as string, current.slug as string | null);
    if (!prepared.ok) return prepared;

    patch.slug = prepared.slug;
    patch.published_at = new Date().toISOString();
  }

  if (input.action === "unpublish") {
    /*
     * SLUG SAQLANADI.
     *
     * O'chirilsa, maqola qayta nashr qilinganda boshqa manzil olardi
     * va tashqaridan kelgan eski havolalar yo'qolardi.
     */
    patch.published_at = null;
  }

  const { data: updated, error } = await db
    .from("member_articles")
    .update(patch)
    .eq("id", input.articleId)
    /*
     * HOLAT SHARTI YOZISHDA HAM.
     *
     * Yuqoridagi o'qish va bu yozish orasida boshqa muharrir
     * holatni o'zgartirgan bo'lishi mumkin.
     */
    .eq("state", state)
    .select("id")
    .maybeSingle();

  if (error) {
    /*
     * Bazadagi nashr qo'riqchisi (`member_article_publish_guard`)
     * bannersiz yoki qisqa matnli maqolani to'sadi. Uning xatosini
     * foydalanuvchiga ko'rsatmaymiz, lekin sababini aytamiz.
     */
    if (error.code === "23514" || /banner|mazmuni|slug/.test(error.message)) {
      console.error("[maqola-korik] nashr sharti buzildi:", error.message);
      return {
        ok: false,
        error: "Maqolada banner rasmi yoki yetarli matn yo'q — nashr qilib bo'lmaydi.",
      };
    }
    console.error("[maqola-korik] saqlanmadi:", error.message);
    return { ok: false, error: "Amalni bajarib bo'lmadi." };
  }

  /*
   * HECH QANDAY QATOR YANGILANMADI — boshqa muharrir ulgurgan.
   *
   * Avval bu holat tekshirilmasdi va muharrir "bajarildi" degan
   * javob olardi, holbuki uning amali bazaga tushmagan edi.
   */
  if (!updated) {
    return {
      ok: false,
      error: "Maqolaning holati boshqa joyda o'zgargan. Sahifani yangilang.",
    };
  }

  if (input.action === "publish") {
    await openChannels(input.articleId);
  }

  await recordAudit(EDITOR_AUDIT[input.action], {
    actorId: input.reviewerId,
    entityId: input.articleId,
    reason: requiresNote(input.action) ? note : null,
    before: { state },
    after: { state: target },
    metadata: {
      candidate_id: current.candidate_id as string,
      title: (current.title as string) ?? null,
      ...(patch.slug ? { slug: patch.slug as string } : {}),
    },
  });

  return { ok: true };
}

/* ========================================================================= *
 * NASHR TAYYORGARLIGI
 * ========================================================================= */

/**
 * Nashr uchun manzil tayyorlaydi.
 *
 * MAVJUD SLUG QAYTA ISHLATILADI: maqola nashrdan qaytarilib, qayta
 * nashr qilinsa, manzil o'zgarmasligi kerak — aks holda tashqaridan
 * kelgan havolalar yo'qolardi.
 */
async function preparePublish(
  title: string,
  existingSlug: string | null,
): Promise<{ ok: true; slug: string } | { ok: false; error: string }> {
  if (existingSlug) return { ok: true, slug: existingSlug };

  const db = createSupabaseAdminClient();
  const base = slugify(title);

  /*
   * BAND MANZILLAR RO'YXATI.
   *
   * Faqat shu asosdan boshlanadiganlar o'qiladi, hammasi emas:
   * maqolalar ko'payganda butun ro'yxatni yuklash ma'nosiz bo'lardi.
   */
  const { data, error } = await db
    .from("member_articles")
    .select("slug")
    .not("slug", "is", null)
    .like("slug", `${base}%`);

  if (error) {
    console.error("[maqola-korik] manzillar o'qilmadi:", error.message);
    return { ok: false, error: "Manzilni tayyorlab bo'lmadi." };
  }

  const taken = new Set((data ?? []).map((row) => row.slug as string));
  return { ok: true, slug: uniqueSlug(base, taken) };
}

/**
 * Nashr kanallarini ochadi (§25).
 *
 * `liderlar_online` DARHOL `synced`: bu bizning saytimiz va maqola
 * nashr qilinishi bilan ko'rinadi — alohida sinxronizatsiya yo'q.
 *
 * `adabiyotx` esa `pending`: u tashqi tizim va unga yuborish alohida
 * vazifa. Hozircha yozish API'si yo'q, shuning uchun qator
 * "kutilmoqda" holatida qoladi va yo'qolmaydi (§25 "never silently
 * lose publication").
 */
async function openChannels(articleId: string): Promise<void> {
  const db = createSupabaseAdminClient();

  const { error } = await db.from("member_article_channels").upsert(
    [
      {
        article_id: articleId,
        channel: "liderlar_online",
        state: "synced",
        synced_at: new Date().toISOString(),
      },
      { article_id: articleId, channel: "adabiyotx", state: "pending" },
    ],
    { onConflict: "article_id,channel" },
  );

  if (error) {
    /*
     * KANAL XATOSI NASHRNI YIQITMAYDI.
     *
     * Maqola allaqachon nashr qilingan va Liderlar Online uni
     * ko'rsatadi. Kanal qatorini keyin tiklash mumkin; nashrni
     * qaytarish esa o'quvchi uchun yomonroq.
     */
    console.error("[maqola-korik] kanallar ochilmadi:", {
      articleId,
      message: error.message,
    });
  }
}

/* ========================================================================= *
 * SANOQ
 * ========================================================================= */

export interface ArticleCounts {
  submitted: number;
  inReview: number;
  approved: number;
  published: number;
}

export async function loadArticleCounts(): Promise<ArticleCounts> {
  const db = createSupabaseAdminClient();
  const head = { count: "exact" as const, head: true };

  const [submitted, inReview, approved, published] = await Promise.all([
    db.from("member_articles").select("*", head).eq("state", "submitted"),
    db.from("member_articles").select("*", head).eq("state", "in_review"),
    db.from("member_articles").select("*", head).eq("state", "approved"),
    db.from("member_articles").select("*", head).eq("state", "published"),
  ]);

  return {
    submitted: submitted.count ?? 0,
    inReview: inReview.count ?? 0,
    approved: approved.count ?? 0,
    published: published.count ?? 0,
  };
}
