/**
 * IMTIYOZLI YO'NALISH — tanish orqali kelgan nomzod.
 *
 * Ba'zi odamlar bizga tanish nomidan yozadi: "Diyorbek
 * Niyatullayevich nomidan yozayapman", "Shohruh Kamolovdanman",
 * "O'zak jamoasidanman". Bunday odamdan PUL SO'RALMAYDI va unga
 * pulga oid hech narsa yuborilmaydi — undan faqat ism so'raladi
 * va havola beriladi.
 *
 * NEGA ALOHIDA MODUL: bu qoidani ssenariy jadvaliga qo'shib
 * qo'yish yetarli emas edi. Narx va to'lov matni suhbatga UCH
 * yo'ldan chiqishi mumkin — ssenariy o'tishidan, bilim
 * bazasidagi javobdan va follow-up'dan. Shuning uchun taniqlash
 * bir joyda, taqiq esa yuborishning o'zida turadi.
 *
 * SOF MODUL — baza ham, Telegram ham yo'q.
 */

import { normalizeForIntent } from "../text-normalize.ts";
import type { SalesStage } from "./stages.ts";

interface ReferralMarker {
  id: string;
  pattern: RegExp;
  /**
   * Bu belgi manbani O'ZI ko'rsatadimi.
   *
   * "jamoa" so'zi o'zi hech kimni ko'rsatmaydi — u faqat
   * "o'zak" bilan birga ma'no beradi. Shuning uchun kamida
   * bitta ko'rsatuvchi belgi bo'lishi SHART.
   */
  identifying: boolean;
}

export interface ReferralSource {
  key: string;
  /** Panelda ko'rinadigan nom. */
  label: string;
  markers: readonly ReferralMarker[];
}

/**
 * AYNAN SHU IBORA KUTILMAYDI.
 *
 * Odam "Diyorbek Niyatullayevich nomidan yozayapman" deb to'liq
 * yozishi kam. Amalda "Diyorbek aka aytdi", "Niyatullayevichdan
 * keldim", "Kamolov yubordi", "o'zakdanman" deb yozadi. Shuning
 * uchun qat'iy ibora emas, BELGILAR sanaladi:
 *
 *   · ikkita belgi topilsa (ism + familiya, "o'zak" + "jamoa")
 *     — kontekstsiz ham yetarli;
 *   · bitta belgi topilsa — yoniga yo'llanma so'zi kerak
 *     ("aytdi", "yubordi", "nomidan", "keldim" va h.k.).
 *
 * Bir belgini kontekstsiz qabul qilish xato bo'lardi: "men
 * Aziz Niyatullayevichman" degan nomzod begona odam bo'la turib
 * bepul maqola olib ketardi.
 */
export const REFERRAL_SOURCES: readonly ReferralSource[] = [
  {
    key: "diyorbek_niyatullayevich",
    label: "Diyorbek Niyatullayevich",
    markers: [
      // diyorbek / diyarbek / dieorbek — yozuv xatolari bilan.
      { id: "ism", pattern: /di[yj]?[oae]r?bek/u, identifying: true },
      // niyatulla / niyatullayev / niyatullaevich / niatulla.
      { id: "familiya", pattern: /n[ie][yj]?atulla/u, identifying: true },
      // "diyorbekdan", "niyatullayevdan" — chiqish kelishigi
      // o'zi yo'llanma ma'nosini beradi.
      {
        id: "dan",
        pattern: /(?:di[yj]?[oae]r?bek|n[ie][yj]?atulla)[\p{L}']*(?:dan|niki)/u,
        identifying: false,
      },
    ],
  },
  {
    key: "shohruh_kamolov",
    label: "Shohruh Kamolov",
    markers: [
      // shohruh / shohrux / shoxruh / shoxrux / shahrux / shorux.
      { id: "ism", pattern: /sh[oa]h?x?r[uo]h?x?/u, identifying: true },
      // kamolov / kamalov / komolov / kamolovich.
      { id: "familiya", pattern: /k[ao]m[oa]l[oa]v/u, identifying: true },
      {
        id: "dan",
        pattern: /(?:sh[oa]h?x?r[uo]h?x?|k[ao]m[oa]l[oa]v)[\p{L}']*(?:dan|niki)/u,
        identifying: false,
      },
    ],
  },
  {
    key: "ozak_jamoasi",
    label: "O'zak jamoasi",
    markers: [
      { id: "nom", pattern: /(?:^|[^\p{L}])(?:o'zak|ozak|uzak|o'zaq|ozaq)/u, identifying: true },
      // O'zi hech kimni ko'rsatmaydi — faqat "o'zak" bilan birga.
      { id: "jamoa", pattern: /jamoa|guruh|komanda|jamoasi|loyiha/u, identifying: false },
      {
        id: "dan",
        pattern: /(?:o'zak|ozak|uzak|o'zaq|ozaq)[\p{L}']*(?:dan|chi|niki)/u,
        identifying: false,
      },
    ],
  },
];

/**
 * YO'LLANMA SO'ZLARI — "meni kimdir yubordi" ma'nosi.
 *
 * Ro'yxat keng: odam "aytdi", "yubordi", "nomidan", "tanish",
 * "keldim" — istalgan birini ishlatishi mumkin va bittasi
 * tushib qolsa qoida jimgina ishlamay qolardi.
 */
const REFERRAL_CONTEXT: readonly RegExp[] = [
  /nomidan|nomdan|nomida/u,
  /tarafidan|tomonidan|tomondan/u,
  /ayt(di|gan|ishdi|uvdi|di-?ku)/u,
  /de(di|yishdi|b ayt)/u,
  /yubor(di|gan|ishdi|di-?ku)|jo'?nat(di|gan)|yo'?lla(di|gan)/u,
  /tavsiya|tanishtir|bog'?lan/u,
  /keldim|kelganman|kelyapman|murojaat/u,
  /orqali|tanish(im|imiz)?|do'?st(im)?|ustoz(im)?|rahbar(im)?/u,
  /jamoasidan|guruhidan|tomonidan/u,
  /aka(m|ngiz)?\b|opa(m|ngiz)?\b/u,
];

/**
 * ISM ATAB AYTILGANINING BELGISI.
 *
 * "Shohruh ismli tanishim bor" — bu yo'llanma emas, shunchaki
 * ism tilga olingan. Bitta belgi + yo'llanma so'zi yo'lida
 * shunday jumlalar tutilib qolardi, shuning uchun bu naqshlar
 * o'sha eng zaif yo'lni bekor qiladi.
 *
 * Ikki belgi topilgan holatga (ism + familiya) ta'sir qilmaydi:
 * u yerda shubha yo'q.
 */
const NAMING_PATTERNS: readonly RegExp[] = [
  /isml[ie]|ismim|ismi\b|degan (?:odam|yigit|qiz|kishi)/u,
];

export const REFERRAL_SOURCE_LABELS: Readonly<Record<string, string>> =
  Object.fromEntries(REFERRAL_SOURCES.map((source) => [source.key, source.label]));

export function isReferralSourceKey(value: unknown): value is string {
  return typeof value === "string" && value in REFERRAL_SOURCE_LABELS;
}

export interface ReferralDetection {
  source: string;
  label: string;
  /** Nima asosida topilgani — panelda va jurnalda ko'rinadi. */
  matched: string;
}

/**
 * Matnda tanish nomi bormi. Topilmasa null.
 *
 * DIQQAT: bu funksiya suhbatning FAQAT boshida chaqirilishi
 * kerak (`canDetectReferral`). Keyinroq mijozning o'z ismi
 * so'raladi va "Aziz Niyatullayevich" degan javob shu qoidani
 * noto'g'ri ishga tushirib yuborardi.
 */
export function detectReferral(text: string | null | undefined): ReferralDetection | null {
  const normalized = normalizeForIntent(text ?? "").trim();
  if (normalized === "") return null;

  const hasContext = REFERRAL_CONTEXT.some((pattern) => pattern.test(normalized));

  for (const source of REFERRAL_SOURCES) {
    const found = source.markers.filter((marker) => marker.pattern.test(normalized));
    if (!found.some((marker) => marker.identifying)) continue;

    if (found.length >= 2) {
      return {
        source: source.key,
        label: source.label,
        matched: found.map((marker) => marker.id).join("+"),
      };
    }
    if (hasContext && !NAMING_PATTERNS.some((pattern) => pattern.test(normalized))) {
      return {
        source: source.key,
        label: source.label,
        matched: `${found[0].id}+yo'llanma`,
      };
    }
  }
  return null;
}

/**
 * Shu bosqichda tanish nomi izlanadimi.
 *
 * NEGA CHEKLOV: `need_full_name` dan boshlab mijoz O'Z ISMINI
 * yozadi. Familiyasi "Niyatullayev" bo'lgan oddiy nomzod shu
 * yerda imtiyozli deb belgilanib qolardi va unga to'lov
 * ma'lumoti umuman yuborilmasdi — ya'ni u to'lay olmasdi.
 *
 * Tanish nomini odam birinchi xabarlarida aytadi, shuning
 * uchun bu cheklov amalda hech narsani yo'qotmaydi.
 */
export const REFERRAL_DETECTION_STAGES: readonly SalesStage[] = [
  "new",
  "application_confirm",
  "benefits_question",
  "benefits_sent",
  "offer_sent",
  "waiting_offer_review",
  "article_decision",
  "followup_later",
];

export function canDetectReferral(stage: SalesStage): boolean {
  return REFERRAL_DETECTION_STAGES.includes(stage);
}

/* ========================================================================= *
 * PULGA OID NARSALAR
 * ========================================================================= */

/**
 * Narx yoki to'lov so'raydigan shablonlar.
 *
 * `payment_received` ("chek qabul qilindi") bu ro'yxatda EMAS:
 * u pul so'ramaydi, kelgan chekni tasdiqlaydi. Uni bloklash
 * to'lagan odamni javobsiz qoldirardi.
 */
export const MONEY_TEMPLATE_KEYS: readonly string[] = [
  "price_offer",
  "price_offer_inbound",
  "payment_details",
  "payment_note",
];

export function isMoneyTemplate(key: string | null | undefined): boolean {
  return key != null && MONEY_TEMPLATE_KEYS.includes(key);
}

/**
 * Pulga oid so'zlar — BUTUN SO'Z sifatida.
 *
 * "bepul" ichida "pul" bor, lekin uning ma'nosi TESKARI: bu
 * xizmat tekin degani va uni bloklash foydalar matnini
 * yo'qotardi. Shuning uchun qism-satr emas, so'z chegarasi.
 */
const MONEY_WORDS: readonly string[] = [
  "pul",
  "pullar",
  "to'lov",
  "to'lang",
  "to'lash",
  "to'laysiz",
  "narx",
  "narxi",
  "badal",
  "chegirma",
  "karta",
  "kartaga",
  "uzcard",
  "humo",
  "hisob raqam",
  "so'm",
  "som",
];

/** Karta raqami va "38 ming", "100 000 so'm" kabi summalar. */
const MONEY_PATTERNS: readonly RegExp[] = [
  /\d{4}\s?\d{4}\s?\d{4}\s?\d{4}/,
  /\d[\d\s.,]*\s*(?:ming|000)/u,
];

/**
 * Matnda pul gapi bormi.
 *
 * Bu tekshiruv MODEL YOZGAN javobga qo'llanadi: shablonlarni
 * kalit bo'yicha bloklash yetarli emas edi, chunki bilim
 * bazasidan kelgan javob ham narxni aytib qo'yishi mumkin.
 */
export function mentionsMoney(text: string | null | undefined): boolean {
  const normalized = normalizeForIntent(text ?? "");
  if (normalized.trim() === "") return false;

  for (const word of MONEY_WORDS) {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`(?:^|[^\\p{L}\\p{N}])${escaped}(?:[^\\p{L}\\p{N}]|$)`, "u").test(normalized)) {
      return true;
    }
  }
  return MONEY_PATTERNS.some((pattern) => pattern.test(normalized));
}
