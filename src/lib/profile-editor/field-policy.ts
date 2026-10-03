/**
 * PROFILNI O'ZI TAHRIRLASH — MAYDON SIYOSATI. SOF MODUL.
 *
 * §6: "VIP does NOT mean unrestricted database editing."
 *
 * ENG MUHIM QAROR: bu RUXSAT RO'YXATI (allowlist), taqiq ro'yxati
 * emas.
 *
 * Taqiq ro'yxati bo'lganida, `status` ni ro'yxatga qo'shishni esdan
 * chiqarish foydalanuvchiga o'z profilini O'ZI NASHR QILISH imkonini
 * berardi — ya'ni tahririyat ko'rigini butunlay chetlab o'tardi.
 * Ruxsat ro'yxatida esa esdan chiqarilgan maydon shunchaki
 * tahrirlanmaydi: xato xavfsiz tomonga qarab yiqiladi.
 *
 * Hech narsa import qilinmaydi: testlar `@/` taxallusini yecha olmaydi.
 */

/* ========================================================================= *
 * SIYOSAT TURLARI
 * ========================================================================= */

export type FieldPolicy =
  /**
   * Darhol nashr bo'ladi.
   *
   * Faqat o'zini TAQDIM ETISH bilan bog'liq maydonlar: ularda
   * tekshirib bo'ladigan da'vo yo'q. Odam o'zi haqida qanday yozishini
   * o'zi hal qiladi.
   */
  | "direct"
  /**
   * Ko'rikka yuboriladi.
   *
   * Tekshirib bo'ladigan DA'VO bor: mukofot, lavozim, tashkilot nomi.
   * Bunday maydonni darhol nashr qilish platformaning tasdig'ini
   * bepul tarqatish bo'lardi.
   */
  | "review";

export interface FieldRule {
  policy: FieldPolicy;
  /** Foydalanuvchiga ko'rinadigan nom — texnik ustun nomi EMAS (§5). */
  label: string;
  maxLength?: number;
}

/* ========================================================================= *
 * NOMZOD JADVALIDAGI MAYDONLAR
 * ========================================================================= */

/**
 * `candidates` jadvalidan FAQAT shular tahrirlanadi.
 *
 * Ro'yxatda YO'Q va ataylab yo'q bo'lgan maydonlar:
 *
 *   slug             — o'zgarsa, ommaviy havola buziladi va tashqi
 *                      havolalar yo'qoladi (§11: dizayn o'zgarishi ham
 *                      slug'ga tegmasligi kerak).
 *   status           — o'zini nashr qilish tahririyatni chetlab o'tardi.
 *   is_top100,
 *   top100_position  — reyting natijasi, da'vo emas.
 *   user_id          — shaxs zanjiri. O'zgarishi profilni boshqa
 *                      odamga berib qo'yardi.
 *   seo_title,
 *   seo_description  — qidiruv natijasidagi matn; u tahririyat ishi.
 *   next_update_due_at,
 *   last_updated_at  — tizim yuritadigan sanalar.
 *   avatar_url       — rasm alohida oqimdan o'tadi (tekshirish,
 *                      o'lcham, egalik), oddiy matn maydoni emas.
 */
export const CANDIDATE_FIELDS: Readonly<Record<string, FieldRule>> = {
  short_bio: {
    policy: "direct",
    label: "Qisqa ma'lumot",
    maxLength: 600,
  },
  birth_date: {
    /*
     * TUG'ILGAN SANA KO'RIKKA BORADI.
     *
     * U shaxsni tasdiqlovchi ma'lumot va ensiklopediyada faktik
     * qiymatga ega. Darhol o'zgartirishga ruxsat berilsa, nashr
     * qilingan fakt jimgina boshqasiga aylanardi.
     */
    policy: "review",
    label: "Tug'ilgan sana",
  },
  region_id: {
    policy: "review",
    label: "Hudud",
  },
  category_id: {
    policy: "review",
    label: "Yo'nalish",
  },
  phone: {
    /*
     * ALOQA MA'LUMOTI — DARHOL.
     *
     * Bu nashr qilinadigan fakt emas, tahririyat bog'lanishi uchun.
     * Ko'rikka yuborish odamni o'z telefonini yangilash uchun
     * kutishga majbur qilardi.
     */
    policy: "direct",
    label: "Telefon",
    maxLength: 32,
  },
  email: {
    policy: "direct",
    label: "Email",
    maxLength: 160,
  },
};

/* ========================================================================= *
 * TUZILGAN YOZUVLAR — TA'LIM, ISH, YUTUQLAR…
 *
 * Bu jadvallar MAVJUD va hammasi BIR XIL shaklda (0003_content_schema.sql,
 * `execute format` halqasida yaratilgani uchun ularni jadval nomi bo'yicha
 * izlash topmaydi):
 *
 *   title, subtitle, description, date_from, date_to, url, sort_order
 *
 * Shuning uchun siyosat ham bitta: tur bo'yicha "darhol" yoki "ko'rikka".
 * ========================================================================= */

export const ENTRY_KINDS = [
  "education",
  "work_experiences",
  "achievements",
  "events",
  "books_read",
  "social_links",
] as const;

export type EntryKind = (typeof ENTRY_KINDS)[number];

export interface EntryKindRule {
  policy: FieldPolicy;
  label: string;
  /** Bu turda sana maydonlari ma'noga egami. */
  hasDates: boolean;
}

/**
 * Tur bo'yicha siyosat.
 *
 * §6 ning "HIGH-TRUST" ro'yxati aynan shu to'rtta turni sanaydi:
 * mukofotlar, sertifikatlar, tashkilot da'volari, tasdiqlangan
 * lavozimlar. Ularni darhol nashr qilish platformaning tasdig'ini
 * bepul tarqatish bo'lardi — odam o'ziga istalgan lavozim yoki
 * mukofot yozib qo'yardi va u ensiklopediyada fakt sifatida turardi.
 *
 * Qolgan ikkisida tekshirib bo'ladigan da'vo yo'q: o'qilgan kitob va
 * ijtimoiy tarmoq havolasi — o'zini taqdim etish.
 */
export const ENTRY_RULES: Readonly<Record<EntryKind, EntryKindRule>> = {
  education: { policy: "review", label: "Ta'lim", hasDates: true },
  work_experiences: { policy: "review", label: "Ish tajribasi", hasDates: true },
  achievements: { policy: "review", label: "Yutuqlar", hasDates: true },
  events: { policy: "review", label: "Tadbirlar", hasDates: true },
  books_read: { policy: "direct", label: "O'qilgan kitoblar", hasDates: false },
  social_links: { policy: "direct", label: "Ijtimoiy tarmoqlar", hasDates: false },
};

export const ENTRY_TITLE_MIN = 2;
export const ENTRY_TITLE_MAX = 300;

export interface EntryInput {
  title?: unknown;
  subtitle?: unknown;
  description?: unknown;
  date_from?: unknown;
  date_to?: unknown;
  url?: unknown;
}

export interface EntryCheck {
  ok: boolean;
  /** Yozishga tayyor, tozalangan qiymatlar. */
  value: Record<string, string | null>;
  errors: string[];
}

/**
 * Yozuvni tekshiradi va tozalaydi.
 *
 * `sort_order` QABUL QILINMAYDI: tartib alohida amal (qayta
 * tartiblash) va uni oddiy saqlash bilan birga qabul qilish
 * foydalanuvchiga boshqa yozuvlarning tartibini bilmasdan
 * o'zgartirish imkonini berardi.
 */
export function checkEntry(kind: EntryKind, input: EntryInput): EntryCheck {
  const rule = ENTRY_RULES[kind];
  const errors: string[] = [];
  const value: Record<string, string | null> = {};

  const title = asText(input.title);
  if (title === null) {
    errors.push("Nomini yozing.");
  } else if (title.length < ENTRY_TITLE_MIN) {
    errors.push("Nomi juda qisqa.");
  } else if (title.length > ENTRY_TITLE_MAX) {
    errors.push(`Nomi ${ENTRY_TITLE_MAX} belgidan oshmasin.`);
  } else {
    value.title = title;
  }

  value.subtitle = asText(input.subtitle);
  value.description = asText(input.description);

  const url = asText(input.url);
  if (url !== null && !isSafeUrl(url)) {
    /*
     * `javascript:` va boshqa sxemalar RAD ETILADI (§58).
     *
     * Havola ommaviy profilda `href` bo'lib chiqadi — ya'ni
     * tekshirilmagan sxema saqlangan XSS bo'lardi.
     */
    errors.push("Havola faqat https:// bilan boshlanishi kerak.");
  } else {
    value.url = url;
  }

  if (rule.hasDates) {
    const from = asDate(input.date_from);
    const to = asDate(input.date_to);

    if (input.date_from != null && from === null) errors.push("Boshlanish sanasi noto'g'ri.");
    if (input.date_to != null && to === null) errors.push("Tugash sanasi noto'g'ri.");

    /*
     * TUGASH BOSHLANISHDAN OLDIN BO'LMASIN.
     *
     * Bazada bunday shart yo'q, ya'ni tekshirmasak teskari oraliq
     * saqlanib, ommaviy profilda "2020–2015" ko'rinardi.
     */
    if (from && to && to < from) {
      errors.push("Tugash sanasi boshlanishdan oldin bo'lmasin.");
    }

    value.date_from = from;
    value.date_to = to;
  }

  return { ok: errors.length === 0, value, errors };
}

function asText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/** `YYYY-MM-DD` shakli. Boshqa shakl `null` — ya'ni xato. */
function asDate(value: unknown): string | null {
  const text = asText(value);
  if (text === null) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;

  // Shakl to'g'ri bo'lsa ham sana mavjud bo'lmasligi mumkin (2026-02-31).
  const parsed = new Date(`${text}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10) === text ? text : null;
}

/**
 * Havola xavfsizmi.
 *
 * FAQAT `https://`. `http://` ham rad etiladi: ommaviy sahifada
 * himoyalanmagan havola brauzer ogohlantirishiga olib keladi va
 * profil sifatiga soya tashlaydi.
 */
function isSafeUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

/* ========================================================================= *
 * ERKIN BO'LIMLAR
 * ========================================================================= */

/**
 * `candidate_sections` — erkin shakldagi bo'limlar.
 *
 * MAVJUD TUZILMA USTIDA ISHLAYDI. Spec `education`, `work_experiences`,
 * `achievements` jadvallarini taxmin qiladi, lekin bu loyihada ular
 * YO'Q: profil mazmuni erkin `title` + `content` bo'limlari va
 * `candidate_intake_*` anketasi orqali yuritiladi.
 *
 * Yangi tuzilgan jadvallar keyin QO'SHILISHI mumkin — bu qo'shimcha
 * qadam. Mavjud mazmunni ko'chirgandan keyin qaytarish esa qiyin.
 */
export const SECTION_TITLE_MAX = 240;
export const SECTION_CONTENT_MAX = 50_000;

/**
 * Bo'lim sarlavhasiga qarab siyosat.
 *
 * Sarlavha ERKIN matn, ya'ni ro'yxat to'liq bo'lishi mumkin emas.
 * Shuning uchun qoida teskari tomonga ishlaydi: TANILGAN
 * "taqdim etish" bo'limlari darhol nashr bo'ladi, QOLGANLARI
 * ko'rikka boradi.
 *
 * Bu ataylab ehtiyotkor: noma'lum sarlavhani darhol nashr qilish
 * "Mukofotlarim" deb nomlangan bo'limga tasdiqlanmagan da'vo
 * yozishga yo'l ochardi.
 */
const DIRECT_SECTION_PATTERNS: readonly RegExp[] = [
  /men\s+haqimda/i,
  /qisqacha/i,
  /qiziqish/i,
  /hobbi/i,
  /maqsad/i,
  /tavsif/i,
];

export function sectionPolicy(title: string | null | undefined): FieldPolicy {
  const value = (title ?? "").trim();
  if (value === "") return "review";
  return DIRECT_SECTION_PATTERNS.some((pattern) => pattern.test(value))
    ? "direct"
    : "review";
}

/* ========================================================================= *
 * O'ZGARISHNI FILTRLASH
 * ========================================================================= */

export interface FieldChange {
  field: string;
  label: string;
  policy: FieldPolicy;
  /** Eski qiymat — adminga ko'rsatish uchun (§22, §6). */
  before: unknown;
  after: unknown;
}

export interface FilterResult {
  /** Darhol yozilishi mumkin bo'lgan o'zgarishlar. */
  direct: FieldChange[];
  /** Ko'rikka yuboriladigan o'zgarishlar. */
  review: FieldChange[];
  /** Ruxsat ro'yxatida bo'lmagan maydonlar — JIM e'tiborsiz qoldirilmaydi. */
  rejected: string[];
  /** Qiymat qoidaga mos kelmagan maydonlar. */
  invalid: Array<{ field: string; error: string }>;
}

/**
 * Kelgan o'zgarishlarni siyosat bo'yicha ajratadi.
 *
 * `current` — bazadagi HOZIRGI qiymatlar. Ular kerak, chunki
 * o'zgarmagan maydon umuman yozilmasligi kerak: aks holda har
 * saqlash "ko'rikka yuborildi" holatini qayta yaratardi va
 * tasdiqlangan faktning tasdiqini bekor qilardi (§6).
 */
export function filterCandidateChanges(
  patch: Readonly<Record<string, unknown>>,
  current: Readonly<Record<string, unknown>>,
): FilterResult {
  const result: FilterResult = { direct: [], review: [], rejected: [], invalid: [] };

  for (const [field, after] of Object.entries(patch)) {
    const rule = CANDIDATE_FIELDS[field];

    if (!rule) {
      /*
       * RAD ETILGAN MAYDON RO'YXATGA TUSHADI.
       *
       * Jim tashlab ketish xavfli: chaqiruvchi o'zgarish saqlandi
       * deb o'ylardi. Ro'yxat chaqiruvchiga ham, logga ham boradi.
       */
      result.rejected.push(field);
      continue;
    }

    const before = current[field] ?? null;
    const normalized = normalizeValue(after);

    // O'ZGARMAGAN MAYDON — umuman tegilmaydi.
    if (sameValue(before, normalized)) continue;

    const problem = validate(rule, normalized);
    if (problem) {
      result.invalid.push({ field, error: problem });
      continue;
    }

    const change: FieldChange = {
      field,
      label: rule.label,
      policy: rule.policy,
      before,
      after: normalized,
    };

    if (rule.policy === "direct") result.direct.push(change);
    else result.review.push(change);
  }

  return result;
}

/** Bo'sh matnni `null` ga aylantiradi: "" va `null` bir xil ma'noda. */
function normalizeValue(value: unknown): unknown {
  if (typeof value !== "string") return value ?? null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function sameValue(before: unknown, after: unknown): boolean {
  if (before === null && after === null) return true;
  return String(before ?? "") === String(after ?? "");
}

function validate(rule: FieldRule, value: unknown): string | null {
  if (value === null) return null;

  if (typeof value !== "string") {
    return `${rule.label}: qiymat matn bo'lishi kerak.`;
  }
  if (rule.maxLength !== undefined && value.length > rule.maxLength) {
    return `${rule.label}: ${rule.maxLength} belgidan oshmasin.`;
  }
  return null;
}

/* ========================================================================= *
 * KO'RIK HOLATLARI
 * ========================================================================= */

export const EDIT_STATES = [
  "draft",
  "pending_review",
  "published",
  "rejected",
] as const;

export type EditState = (typeof EDIT_STATES)[number];

export const EDIT_STATE_TEXT: Record<EditState, string> = {
  draft: "Qoralama",
  pending_review: "Tekshiruvda",
  published: "Profilga joylandi",
  rejected: "Qaytarildi",
};

/**
 * Saqlashdan keyin foydalanuvchiga aytiladigan matn.
 *
 * §22: ko'rikka ketgan o'zgarish uchun "Profilga joylandi" deb
 * aytish YOLG'ON bo'lardi. Shuning uchun matn aynan nima
 * bo'lganini aytadi.
 */
export function saveMessage(result: FilterResult): string {
  const direct = result.direct.length;
  const review = result.review.length;

  if (direct > 0 && review > 0) {
    return `${direct} o'zgarish profilga joylandi, ${review} tasi tekshiruvga yuborildi.`;
  }
  if (review > 0) return "O'zgarishlar tekshiruvga yuborildi.";
  if (direct > 0) return "O'zgarishlar profilga joylandi.";
  return "O'zgarish kiritilmadi.";
}
