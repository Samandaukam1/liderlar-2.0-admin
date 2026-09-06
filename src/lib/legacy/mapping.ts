/**
 * Liderlar 1.0 CSV qatorini `legacy_posts` yozuviga aylantiradi — sof modul.
 *
 * CSV — Tilda feed eksporti, `;` ajratuvchi, 19 ustun. Bu yerda I/O yo'q:
 * import skripti ham, testlar ham AYNAN shu funksiyani chaqiradi, shuning
 * uchun dry-run natijasi bilan haqiqiy import o'rtasida farq bo'lishi mumkin
 * emas.
 *
 * ASOSIY QOIDA: faylda yo'q ma'lumot O'YLAB TOPILMAYDI. Sana bo'lmasa — null,
 * rasm bo'lmasa — null, kategoriya bo'lmasa — bo'sh massiv.
 */

import { buildLegacyPath, buildLegacySlug } from "./slug.ts";
import { sanitizeLegacyHtml } from "./sanitize-html.ts";

/** CSV sarlavhasi — eksportdagi ustunlar, o'sha tartibda. */
export const LEGACY_CSV_COLUMNS = [
  "Post ID",
  "Alias",
  "Title",
  "Category",
  "Media Type",
  "Media",
  "Description",
  "Text",
  "Date",
  "Visibility",
  "Thumb Image",
  "Author Name",
  "Author URL",
  "Author Image",
  "SEO Title",
  "SEO Description",
  "SEO Keywords",
  "Social Title",
  "Social Description",
] as const;

export const LEGACY_CSV_DELIMITER = ";";

export type LegacyCsvRow = Record<string, string>;

export interface LegacyPostRecord {
  legacy_source_id: string;
  legacy_slug: string;
  legacy_alias: string | null;
  legacy_path: string;
  title: string;
  summary: string | null;
  content_html: string;
  content_text: string;
  cover_image_url: string | null;
  /** Manbadagi HAQIQIY sana (ISO), yoki null. Import sanasi hech qachon emas. */
  legacy_created_at: string | null;
  legacy_status: "published" | "draft";
  legacy_categories: string[];
  legacy_author: string | null;
  seo_title: string | null;
  seo_description: string | null;
  seo_keywords: string | null;
}

/** Yozuvni import qilishga to'sqinlik qiladigan sabablar. */
export type LegacyBlockingIssue = "missing_post_id" | "missing_title" | "missing_slug";

/** Import qilishga to'sqinlik qilmaydigan, lekin hisobotda ko'rinadigan kamchiliklar. */
export type LegacyWarning = "missing_date" | "missing_image" | "missing_content";

export type LegacyMappingResult =
  | { ok: true; record: LegacyPostRecord; warnings: LegacyWarning[] }
  | { ok: false; issues: LegacyBlockingIssue[]; warnings: LegacyWarning[] };

const clean = (value: string | undefined): string => (value ?? "").trim();
const orNull = (value: string | undefined): string | null => clean(value) || null;

/**
 * "2026-08-02 01:53:00+05:00" → ISO.
 *
 * Eksportdagi 1991 qatorning hammasi shu shaklda, lekin qoida baribir qat'iy:
 * o'qib bo'lmagan qiymat null bo'ladi va hisobotda "missing date" bo'lib
 * sanaladi. Bu yerga hech qachon `new Date()` qo'yilmaydi — import sanasini
 * maqolaning sanasi deb ko'rsatish tarixni yo'q qilish bilan barobar.
 */
export function parseLegacyDate(raw: string | undefined): string | null {
  const value = clean(raw);
  if (!value) return null;
  // Bo'shliqni "T" ga almashtirish: Safari/JSC "YYYY-MM-DD HH:mm:ss+05:00" ni
  // o'qimaydi, ISO shaklini esa hamma o'qiydi.
  const iso = value.replace(" ", "T");
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

/** "Ta'lim;Tashkilotchilik" → ["Ta'lim", "Tashkilotchilik"]. */
export function parseLegacyCategories(raw: string | undefined): string[] {
  const value = clean(raw);
  if (!value) return [];
  const seen = new Set<string>();
  for (const part of value.split(";")) {
    const item = part.trim();
    if (item) seen.add(item);
  }
  return [...seen];
}

/**
 * Muqova rasmi.
 *
 * Eksportda rasm "Media" ustunida (1991 dan 1990 tasida); "Thumb Image" faqat
 * bitta qatorda to'ldirilgan, shuning uchun u zaxira sifatida ishlatiladi.
 * Faqat https qabul qilinadi — boshqasi `next/image` va CSP uchun yaroqsiz.
 */
export function pickLegacyImage(row: LegacyCsvRow): string | null {
  for (const key of ["Media", "Thumb Image"]) {
    const value = clean(row[key]);
    if (/^https:\/\//i.test(value)) return value;
  }
  return null;
}

/**
 * Tilda "Visibility" → bizning holat.
 *
 * Tanilmagan qiymat `draft` bo'ladi, `published` emas: tushunmagan narsani
 * ommaga chiqarishdan ko'ra ko'rsatmaslik xavfsizroq.
 */
export function parseLegacyStatus(raw: string | undefined): "published" | "draft" {
  return clean(raw).toLowerCase() === "published" ? "published" : "draft";
}

/**
 * Qator o'zgarganini aniqlash uchun barqaror "barmoq izi".
 *
 * Xesh'ning o'zi bu yerda hisoblanmaydi (sof modul node:crypto ni import
 * qilmasligi kerak) — skript shu satrdan sha256 oladi. Faqat manbadan kelgan
 * maydonlar kiradi, shuning uchun kodni o'zgartirish barcha 1991 qatorni
 * "o'zgargan" qilib ko'rsatmaydi.
 */
export function legacyRowFingerprint(row: LegacyCsvRow): string {
  return LEGACY_CSV_COLUMNS.map((c) => clean(row[c]).replace(/\s+/g, " ")).join("");
}

/** Bitta CSV qatori → yozuv, yoki nima uchun bo'lmasligi. */
export function mapLegacyRow(row: LegacyCsvRow): LegacyMappingResult {
  const postId = clean(row["Post ID"]);
  const title = clean(row["Title"]);
  const alias = clean(row["Alias"]);
  const slug = buildLegacySlug(postId, title, alias);

  const legacyCreatedAt = parseLegacyDate(row["Date"]);
  const coverImageUrl = pickLegacyImage(row);
  const { html, text } = sanitizeLegacyHtml(row["Text"]);

  const warnings: LegacyWarning[] = [];
  if (!legacyCreatedAt) warnings.push("missing_date");
  if (!coverImageUrl) warnings.push("missing_image");
  if (!text) warnings.push("missing_content");

  const issues: LegacyBlockingIssue[] = [];
  if (!postId) issues.push("missing_post_id");
  if (!title) issues.push("missing_title");
  // Slug — eski URL'ning o'zi. Usiz yozuvni import qilish ma'nosiz: uni
  // /nomzodlar/... orqali ochib bo'lmaydi.
  if (!slug) issues.push("missing_slug");
  if (issues.length > 0) return { ok: false, issues, warnings };

  return {
    ok: true,
    warnings,
    record: {
      legacy_source_id: postId,
      legacy_slug: slug,
      legacy_alias: alias || null,
      legacy_path: buildLegacyPath(slug),
      title,
      summary: orNull(row["Description"]),
      content_html: html,
      content_text: text,
      cover_image_url: coverImageUrl,
      legacy_created_at: legacyCreatedAt,
      legacy_status: parseLegacyStatus(row["Visibility"]),
      legacy_categories: parseLegacyCategories(row["Category"]),
      legacy_author: orNull(row["Author Name"]),
      seo_title: orNull(row["SEO Title"]),
      seo_description: orNull(row["SEO Description"]),
      seo_keywords: orNull(row["SEO Keywords"]),
    },
  };
}
