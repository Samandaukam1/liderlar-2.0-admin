/**
 * A'ZO MAQOLASI — HOLAT MASHINASI VA NASHR SHARTLARI. SOF MODUL.
 *
 * Hech narsa import qilinmaydi: testlar `@/` taxallusini yecha olmaydi.
 *
 * MUHIM: bu modul mavjud `articles` (biografiya) jadvaliga TEGMAYDI.
 * Ikkisi boshqa mazmun va boshqa oqim.
 */

/* ========================================================================= *
 * HOLATLAR — §23
 * ========================================================================= */

export const ARTICLE_STATES = [
  "draft",
  "submitted",
  "in_review",
  "changes_requested",
  "approved",
  "published",
  "rejected",
  "archived",
] as const;

export type ArticleState = (typeof ARTICLE_STATES)[number];

export const STATE_TEXT: Record<ArticleState, string> = {
  draft: "Qoralama",
  submitted: "Yuborilgan",
  in_review: "Ko'rilmoqda",
  changes_requested: "Tuzatish kerak",
  approved: "Tasdiqlangan",
  published: "Nashr qilindi",
  rejected: "Rad etilgan",
  archived: "Arxivlangan",
};

/**
 * Muallif TAHRIRLASHI mumkin bo'lgan holatlar.
 *
 * `in_review` KIRMAYDI: tahririyat o'qiyotgan matn ostidan
 * o'zgartirilsa, muharrir allaqachon yo'q matnni ko'rib chiqqan
 * bo'lardi.
 *
 * `published` ham kirmaydi — nashr qilingan matnni jimgina
 * o'zgartirish o'quvchi ko'rgan narsadan boshqasini qoldirardi.
 * Tuzatish kerak bo'lsa, tahririyat orqali boradi.
 */
const AUTHOR_EDITABLE: ReadonlySet<ArticleState> = new Set([
  "draft",
  "changes_requested",
  "rejected",
]);

export function authorCanEdit(state: ArticleState): boolean {
  return AUTHOR_EDITABLE.has(state);
}

/** Muallif YUBORISHI mumkin bo'lgan holatlar. */
const AUTHOR_SUBMITTABLE: ReadonlySet<ArticleState> = new Set([
  "draft",
  "changes_requested",
  "rejected",
]);

export function authorCanSubmit(state: ArticleState): boolean {
  return AUTHOR_SUBMITTABLE.has(state);
}

/** Ommaviy sahifada ko'rinadigan yagona holat. */
export function isPublic(state: ArticleState): boolean {
  return state === "published";
}

/* ========================================================================= *
 * TAHRIRIYAT O'TISHLARI — §27
 * ========================================================================= */

export type EditorAction =
  | "start_review"
  | "request_changes"
  | "approve"
  | "publish"
  | "reject"
  | "archive"
  | "unpublish";

/**
 * Qaysi amal qaysi holatdan mumkin.
 *
 * `publish` FAQAT `approved` dan: tasdiqlashni o'tkazib yuborib
 * to'g'ridan-to'g'ri nashr qilish ikki qadamni bitta tugmaga
 * yig'ardi va "kim tasdiqladi" degan savol javobsiz qolardi.
 */
const EDITOR_ALLOWED: Readonly<Record<EditorAction, readonly ArticleState[]>> = {
  start_review: ["submitted"],
  request_changes: ["submitted", "in_review"],
  approve: ["submitted", "in_review"],
  publish: ["approved"],
  reject: ["submitted", "in_review"],
  /*
   * ARXIVLASH NASHRDAGIDAN ham mumkin: eskirgan maqolani ro'yxatdan
   * olib tashlash kerak bo'ladi. Maqolaning o'zi o'chirilmaydi.
   */
  archive: ["published", "rejected", "approved"],
  /*
   * NASHRDAN QAYTARISH — ALOHIDA amal.
   *
   * `archive` dan farqi: arxiv "eskirgan" degani, bu esa "xato
   * chiqdi, qaytarib ol" degani va maqola tahrirga qaytadi.
   */
  unpublish: ["published"],
};

export function editorCan(action: EditorAction, state: ArticleState): boolean {
  return EDITOR_ALLOWED[action].includes(state);
}

export function nextState(action: EditorAction): ArticleState {
  switch (action) {
    case "start_review":
      return "in_review";
    case "request_changes":
      return "changes_requested";
    case "approve":
      return "approved";
    case "publish":
      return "published";
    case "reject":
      return "rejected";
    case "archive":
      return "archived";
    case "unpublish":
      return "draft";
  }
}

/**
 * Amal uchun izoh majburiymi.
 *
 * §27: muallif tahririyat fikrini ko'rishi kerak. "Tuzatish kerak" va
 * "rad etildi" sababsiz bo'lsa, odam nima qilishini bilmaydi.
 */
export function requiresNote(action: EditorAction): boolean {
  return action === "request_changes" || action === "reject";
}

/* ========================================================================= *
 * NASHR SHARTLARI — §23
 * ========================================================================= */

export const CONTENT_MIN_LENGTH = 200;
export const TITLE_MIN_LENGTH = 5;
export const TITLE_MAX_LENGTH = 300;

export interface ArticleDraft {
  title?: unknown;
  subtitle?: unknown;
  excerpt?: unknown;
  content?: unknown;
  heroUrl?: unknown;
  heroAlt?: unknown;
}

export type SubmitProblem = "title" | "hero" | "content";

export const SUBMIT_PROBLEM_TEXT: Record<SubmitProblem, string> = {
  title: `Sarlavha kamida ${TITLE_MIN_LENGTH} belgidan bo'lsin.`,
  hero: "Maqolaga banner rasmi yuklang — u ro'yxatda va maqola tepasida ko'rinadi.",
  content: `Maqola matni kamida ${CONTENT_MIN_LENGTH} belgidan bo'lsin.`,
};

/**
 * Maqola YUBORISHGA tayyormi.
 *
 * Uch shart §23 dan: sarlavha, banner rasmi va ma'noli matn.
 * Qoralamada ular bo'lmasligi mumkin — shart faqat yuborishda.
 *
 * HAMMA MUAMMO QAYTARILADI, birinchisi emas: odam formani
 * to'ldirib yuborganda "sarlavha qisqa" degan xabarni tuzatib,
 * keyin "rasm yo'q" ni ko'rib, keyin "matn qisqa" ni ko'rsa, uch
 * marta urinishga majbur bo'lardi.
 */
export function checkSubmittable(draft: ArticleDraft): {
  ok: boolean;
  problems: SubmitProblem[];
} {
  const problems: SubmitProblem[] = [];

  const title = typeof draft.title === "string" ? draft.title.trim() : "";
  if (title.length < TITLE_MIN_LENGTH) problems.push("title");

  const hero = typeof draft.heroUrl === "string" ? draft.heroUrl.trim() : "";
  if (hero === "") problems.push("hero");

  const content = typeof draft.content === "string" ? draft.content.trim() : "";
  if (content.length < CONTENT_MIN_LENGTH) problems.push("content");

  return { ok: problems.length === 0, problems };
}

/* ========================================================================= *
 * SLUG
 * ========================================================================= */

const CYRILLIC: Readonly<Record<string, string>> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "j",
  з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o",
  п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "x", ц: "ts",
  ч: "ch", ш: "sh", щ: "sh", ъ: "", ы: "i", ь: "", э: "e", ю: "yu",
  я: "ya", ғ: "g", қ: "q", ҳ: "h", ў: "o",
};

/**
 * Sarlavhadan manzil yasaydi.
 *
 * NASHR PAYTIDA chaqiriladi, yaratishda emas: qoralamaga manzil
 * berish uni band qilib qo'yardi va sarlavha o'zgarsa manzil
 * eskirardi.
 *
 * O'zbek apostrofi (`o'`, `g'`) olib tashlanadi: u manzilda
 * kodlanib, havolani o'qilmas qilardi.
 */
export function slugify(title: string): string {
  let out = "";
  for (const ch of title.toLowerCase().normalize("NFKC")) {
    out += CYRILLIC[ch] ?? ch;
  }

  return out
    .replace(/['''`ʻʼ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    // Qirqishdan keyin oxirida tire qolishi mumkin.
    .replace(/-+$/g, "");
}

/**
 * Band manzilga raqam qo'shadi.
 *
 * Sarlavhalar takrorlanadi ("Mening yo'lim") va manzil unikal
 * bo'lishi kerak. Raqam OXIRIGA qo'shiladi, boshiga emas: manzil
 * o'qiladigan qolishi kerak.
 */
export function uniqueSlug(base: string, taken: ReadonlySet<string>): string {
  const safe = base === "" ? "maqola" : base;
  if (!taken.has(safe)) return safe;

  for (let n = 2; n < 1000; n += 1) {
    const candidate = `${safe}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }

  /*
   * Bu yerga yetish amalda kutilmaydi. Yetilsa, vaqt belgisi
   * qo'shiladi — xato tashlash nashrni butunlay to'xtatardi.
   */
  return `${safe}-${Date.now()}`;
}

/* ========================================================================= *
 * O'QISH VAQTI
 * ========================================================================= */

/**
 * O'qish vaqti — daqiqada.
 *
 * §31 "reading time if accurately calculated" deydi, ya'ni taxminiy
 * son ko'rsatishdan ko'ra ko'rsatmaslik yaxshiroq. Shuning uchun
 * hisob so'z soniga asoslanadi va juda qisqa matn uchun `null`
 * qaytadi: "1 daqiqa" degan yozuv 50 so'zli matn uchun ma'nosiz.
 */
export function readingMinutes(content: string): number | null {
  const words = content.trim().split(/\s+/).filter((w) => w.length > 0).length;
  if (words < 100) return null;
  // 180 so'z/daqiqa — o'zbek matni uchun o'rtacha.
  return Math.max(1, Math.round(words / 180));
}
