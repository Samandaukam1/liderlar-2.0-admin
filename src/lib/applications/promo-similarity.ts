/**
 * PROMO KODLARNI O'XSHASHLIGI BO'YICHA GURUHLASH — SOF MODUL.
 *
 * MUAMMO: promo kodni nomzod QO'LDA ko'chirib yozadi. "ALI2026"
 * o'rniga "AL12026", "ALI2O26", "ali 2026" tushadi. Natijada
 * bitta koordinatorning kodi bazada bir nechta ko'rinishda yotadi
 * va ular alohida-alohida sanaladi — kim nechta nomzod olib
 * kelgani noto'g'ri chiqadi.
 *
 * SHUNING UCHUN IKKI DARAJA:
 *   · AYNAN BIR XIL — normallashtirilgandan keyin teng;
 *   · O'XSHASH — yozuvda adashish natijasi bo'lishi mumkin.
 *
 * "Harflarni kiritishga ko'ra o'xshash" aynan shu: klaviaturada
 * va ko'z bilan chalkashadigan belgilar (0/O, 1/I/l, 5/S) bir xil
 * deb qaraladi, keyin bitta-ikkita xato masofasi hisoblanadi.
 *
 * SOF MODUL — baza ham, PDF ham yo'q.
 */

import { normalizePromoCode } from "../coordinators/promo-code.ts";

/**
 * CHALKASHADIGAN BELGILAR.
 *
 * Bular BIR-BIRIGA almashtiriladi, ya'ni "AL1" va "ALI" bitta
 * shaklga tushadi. Ro'yxat qisqa va ataylab: har qo'shimcha juft
 * noto'g'ri birlashtirish xavfini oshiradi.
 */
const CONFUSABLES: ReadonlyArray<readonly [RegExp, string]> = [
  [/[0O]/g, "0"],
  [/[1IL]/g, "1"],
  [/[5S]/g, "5"],
  [/[8B]/g, "8"],
  [/[2Z]/g, "2"],
  [/[6G]/g, "6"],
];

/** Chalkashadigan belgilar bir shaklga keltirilgan ko'rinish. */
export function skeletonOf(code: string | null | undefined): string {
  let out = normalizePromoCode(code);
  for (const [pattern, replacement] of CONFUSABLES) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

/**
 * Damerau–Levenshtein masofasi (o'rin almashishni ham sanaydi).
 *
 * O'RIN ALMASHISH MUHIM: "ALI2026" ni shoshib yozganda "AIL2026"
 * chiqadi va bu bitta xato, ikkita emas. Oddiy Levenshtein uni
 * ikki deb hisoblab, o'xshashlikdan chiqarib tashlardi.
 */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const rows: number[][] = [];
  for (let i = 0; i <= a.length; i += 1) {
    rows.push(new Array<number>(b.length + 1).fill(0));
    rows[i][0] = i;
  }
  for (let j = 0; j <= b.length; j += 1) rows[0][j] = j;

  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      rows[i][j] = Math.min(
        rows[i - 1][j] + 1,
        rows[i][j - 1] + 1,
        rows[i - 1][j - 1] + cost,
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        rows[i][j] = Math.min(rows[i][j], rows[i - 2][j - 2] + cost);
      }
    }
  }
  return rows[a.length][b.length];
}

/**
 * Ruxsat etilgan xato soni — UZUNLIKKA QARAB.
 *
 * Qisqa kodda bitta xato ham uni BOSHQA kodga aylantirishi
 * mumkin ("AB1" va "AB2" — ikki boshqa kod). Uzun kodda esa
 * ikkita xato hali ham o'sha kod.
 */
export function toleranceFor(length: number): number {
  if (length <= 4) return 0;
  if (length <= 8) return 1;
  return 2;
}

/** Ikki kod yozuvda adashish natijasi bo'lishi mumkinmi. */
export function codesLookAlike(a: string, b: string): boolean {
  const left = skeletonOf(a);
  const right = skeletonOf(b);
  if (left === "" || right === "") return false;
  if (left === right) return true;

  // Uzunlik farqi chidamdan katta bo'lsa hisoblashning ma'nosi yo'q.
  const tolerance = toleranceFor(Math.min(left.length, right.length));
  if (tolerance === 0) return false;
  if (Math.abs(left.length - right.length) > tolerance) return false;

  return editDistance(left, right) <= tolerance;
}

/* ========================================================================= *
 * GURUHLASH
 * ========================================================================= */

export interface PromoApplicant {
  id: string;
  fullName: string;
  promoCode: string;
  phone: string | null;
  telegram: string | null;
  ageRange: string | null;
  createdAt: string | null;
}

export interface PromoVariant {
  /** Normallashtirilgan kod. */
  code: string;
  /** Nomzod arizada AYNAN qanday yozgani (birinchi uchragani). */
  raw: string;
  applicants: PromoApplicant[];
}

export interface PromoGroup {
  /** Guruhning asosiy kodi — eng ko'p uchragani. */
  code: string;
  /** Aynan shu kod bilan kelganlar. */
  exact: PromoApplicant[];
  /**
   * O'XSHASH, lekin aynan bir xil bo'lmagan yozuvlar.
   *
   * Ular ALOHIDA turadi: "bu ham o'sha kod" degan qaror ODAMNIKI.
   * Avtomatik birlashtirish noto'g'ri bo'lsa, ikki koordinatorning
   * nomzodi aralashib ketardi.
   */
  similar: PromoVariant[];
  /** Jami nomzodlar (aynan + o'xshash). */
  total: number;
}

function normalizeQuery(query: string | null | undefined): string {
  return skeletonOf(query);
}

/**
 * Arizalarni promo kod bo'yicha guruhlaydi.
 *
 * `query` berilsa, faqat shu harflar bilan BOSHLANADIGAN yoki
 * unga o'xshash kodlar qoladi — "harflarni kiritishga ko'ra".
 */
export function groupByPromoCode(
  applicants: readonly PromoApplicant[],
  query: string | null | undefined = null,
): PromoGroup[] {
  /* 1. Aynan bir xil kodlar bo'yicha yig'amiz. */
  const byCode = new Map<string, PromoVariant>();
  for (const applicant of applicants) {
    const code = normalizePromoCode(applicant.promoCode);
    if (code === "") continue;
    const variant = byCode.get(code);
    if (variant) variant.applicants.push(applicant);
    else byCode.set(code, { code, raw: applicant.promoCode, applicants: [applicant] });
  }

  /* 2. O'xshashlarni bitta guruhga tortamiz. */
  const variants = [...byCode.values()].sort(
    (a, b) => b.applicants.length - a.applicants.length || a.code.localeCompare(b.code),
  );

  const used = new Set<string>();
  const groups: PromoGroup[] = [];

  for (const variant of variants) {
    if (used.has(variant.code)) continue;
    used.add(variant.code);

    const similar = variants.filter(
      (other) =>
        !used.has(other.code) &&
        other.code !== variant.code &&
        codesLookAlike(variant.code, other.code),
    );
    for (const match of similar) used.add(match.code);

    groups.push({
      code: variant.code,
      exact: variant.applicants,
      similar,
      total: variant.applicants.length + similar.reduce((sum, s) => sum + s.applicants.length, 0),
    });
  }

  /* 3. Qidiruv. */
  const needle = normalizeQuery(query);
  const filtered =
    needle === ""
      ? groups
      : groups.filter(
          (group) =>
            skeletonOf(group.code).startsWith(needle) ||
            codesLookAlike(group.code, needle) ||
            group.similar.some((variant) => skeletonOf(variant.code).startsWith(needle)),
        );

  return filtered.sort((a, b) => b.total - a.total || a.code.localeCompare(b.code));
}
