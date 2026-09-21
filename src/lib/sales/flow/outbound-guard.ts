/**
 * OUTBOUND RUXSATI — 0.2 dagi eng nozik nuqta.
 *
 * 0.1 da mijozga xabar yuborishning KOD YO'LI umuman yo'q edi. 0.2 da
 * u kerak bo'ldi, lekin "blokni olib tashlash" yaramaydi: shunda har
 * qanday kod bo'lagi mijozga yozib yuborishi mumkin bo'lardi.
 *
 * YECHIM — QOBILIYAT (capability) usuli. Transport funksiyasi oddiy
 * parametr emas, MUHRLANGAN ruxsat obyektini talab qiladi. Muhr —
 * shu modulga xos `Symbol`, uni tashqaridan yasab bo'lmaydi. Demak
 * xabar yuborishning yagona yo'li — shu yerdagi tekshiruvlardan
 * o'tish. `sendMessage` ni to'g'ridan-to'g'ri chaqirib bo'lmaydi.
 *
 * Tekshiruvlar (texnik topshiriq 24-band):
 *   · avto-javob sozlamada yoqilganmi;
 *   · suhbatni inson qo'lga olmaganmi (human takeover);
 *   · ulanish faol va javob yozish huquqi bormi;
 *   · suhbat KUTILGAN bosqichdami;
 *   · matn bo'sh emasmi.
 *
 * SOF MODUL — hamma qoida testda tekshiriladi.
 */

import type { SalesStage } from "./stages.ts";
import { decideRollout, type RolloutSettings } from "./rollout.ts";

/**
 * Muhr. Modul ichida yaratiladi va eksport QILINMAYDI, shuning uchun
 * boshqa fayl uni takrorlay olmaydi.
 */
const OUTBOUND_SEAL: unique symbol = Symbol("sales.outbound.authorized");

export type OutboundKind = "template" | "knowledge_reply" | "followup";

export interface OutboundAuthorization {
  readonly seal: typeof OUTBOUND_SEAL;
  readonly conversationId: string;
  readonly businessConnectionId: string;
  readonly chatId: number;
  readonly stage: SalesStage;
  readonly kind: OutboundKind;
  readonly templateKey: string | null;
  /** true — Telegram'ga chiqmaydi, faqat jurnalga yoziladi. */
  readonly simulated: boolean;
}

export const OUTBOUND_REFUSAL_REASONS = [
  "auto_reply_disabled",
  "human_takeover",
  "connection_disabled",
  "no_reply_rights",
  "unexpected_stage",
  "empty_body",
  "missing_chat",
  // Mijoz "boshqa yozmang" degan — bu HAMMA NARSADAN ustun.
  "opted_out",
  // Chiqarish bosqichi (28-band): kod yoqiq, lekin bu suhbat hali
  // qamrovda emas.
  "rollout_off",
  "rollout_test_only",
  "rollout_not_allowlisted",
  "rollout_outside_percentage",
] as const;
export type OutboundRefusalReason = (typeof OUTBOUND_REFUSAL_REASONS)[number];

export const OUTBOUND_REFUSAL_LABELS: Record<OutboundRefusalReason, string> = {
  auto_reply_disabled: "Avto-javob sozlamada o‘chirilgan",
  human_takeover: "Suhbatni inson qo‘lga olgan",
  connection_disabled: "Business ulanishi faol emas",
  no_reply_rights: "Telegram javob yozish huquqi bermagan",
  unexpected_stage: "Suhbat kutilgan bosqichda emas",
  empty_body: "Xabar matni bo‘sh",
  missing_chat: "Chat yoki ulanish identifikatori yo‘q",
  opted_out: "Mijoz avtomatik aloqadan chiqqan",
  rollout_off: "Chiqarish o‘chiq",
  rollout_test_only: "Faqat sinov rejimi",
  rollout_not_allowlisted: "Bu chat tanlangan ro‘yxatda yo‘q",
  rollout_outside_percentage: "Bu suhbat foizli qamrovga kirmagan",
};

/**
 * NIMA QILISH KERAK — sabab bilan birga ko'rsatiladi.
 *
 * Yorliqning o'zi yetarli emas edi: "Bu chat tanlangan
 * ro'yxatda yo'q" ni o'qigan admin keyingi qadamni bilmaydi va
 * sozlamalar sahifasida qidirib yuradi.
 */
export const OUTBOUND_REFUSAL_FIXES: Record<OutboundRefusalReason, string> = {
  auto_reply_disabled:
    "Sozlamalar sahifasida «Avto-javob» kalitini yoqing.",
  human_takeover:
    "Suhbat inson nazoratida. Shu sahifadagi boshqaruvdan AI ni qaytadan yoqing.",
  connection_disabled:
    "Telegram Business ulanishi o‘chirilgan. Telegram ilovasida botni biznes yordamchisi sifatida qayta ulang.",
  no_reply_rights:
    "Telegram Business sozlamasida botga «xabar yuborish» huquqini bering.",
  opted_out:
    "Mijoz «boshqa yozmang» degan. Bu qaror — avtomatik javob qaytarilmaydi.",
  unexpected_stage: "Texnik holat — tahlil uchun jurnalga qarang.",
  empty_body: "Texnik holat — shablon matni bo‘sh.",
  missing_chat: "Texnik holat — chat identifikatori yo‘q.",
  rollout_off:
    "Chiqarish bosqichi «O‘chiq». Sozlamalarda «To‘liq» yoki «Tanlangan chatlar» ni tanlang.",
  rollout_test_only:
    "Chiqarish «Faqat sinov» rejimida — jonli chatlarga xabar ketmaydi.",
  rollout_not_allowlisted:
    "Rejim «Tanlangan chatlar». Yuqoridagi «Ro‘yxatga qo‘shish» tugmasini bosing yoki hammaga javob berish uchun sozlamalarda «To‘liq» ni tanlang.",
  rollout_outside_percentage:
    "Foizli qamrov bu suhbatni o‘z ichiga olmagan. Foizni oshiring yoki «To‘liq» ni tanlang.",
};

/*
 * RAD ETISHNING IKKI TURI — BOSQICH UCHUN HAL QILUVCHI FARQ.
 *
 * QAROR: `human_takeover`, `opted_out`, `unexpected_stage`,
 * `empty_body`. Mijoz xabar olmadi, lekin suhbat holati
 * HAQIQIY — biz aynan shu holatda ataylab jim qoldik.
 *
 * QAMROV: `rollout_*`, `auto_reply_disabled`, `connection_*`,
 * `no_reply_rights`, `missing_chat`. Bularning suhbatga aloqasi
 * YO'Q — sozlama shunday turibdi. Mijoz salomlashuvni ham,
 * narxni ham KO'RMAGAN, demak u hali eski bosqichda.
 *
 * NEGA MUHIM: bosqich shunday oldinga surilib qolsa, qamrov
 * ochilgandan keyin ham o'sha mijoz salomlashuv, foyda va narx
 * xabarlarini UMUMAN olmaydi — ssenariy uning uchun o'rtasidan
 * boshlanadi. Amalda shu sodir bo'ldi: `new -> offer_sent`
 * o'tishi yozildi, lekin `rollout_not_allowlisted` sababli
 * hech narsa yuborilmadi.
 */
export const COVERAGE_REFUSAL_REASONS = [
  "auto_reply_disabled",
  "connection_disabled",
  "no_reply_rights",
  "missing_chat",
  "rollout_off",
  "rollout_test_only",
  "rollout_not_allowlisted",
  "rollout_outside_percentage",
] as const;

/** Qolganlari — ongli qaror; holat o'zgarmaydi. */
export const DELIBERATE_REFUSAL_REASONS = [
  "human_takeover",
  "opted_out",
  "unexpected_stage",
  "empty_body",
] as const;

/** Sabab sozlama/qamrovdanmi (ha) yoki suhbat qaroridanmi (yo'q). */
export function isCoverageRefusal(reason: OutboundRefusalReason): boolean {
  return (COVERAGE_REFUSAL_REASONS as readonly string[]).includes(reason);
}

export interface OutboundContext {
  conversationId: string;
  businessConnectionId: string | null;
  chatId: number | null;
  stage: SalesStage;
  /** Shu bosqichlardan birida bo'lishi shart. Bo'sh — bosqich muhim emas. */
  expectedStages: readonly SalesStage[];
  kind: OutboundKind;
  templateKey: string | null;
  body: string;
  /** Sozlamadagi global kalit. Standart qiymati — o'chiq. */
  autoReplyEnabled: boolean;
  /** Suhbatdagi `ai_enabled`. false — inson qo'lga olgan. */
  aiEnabled: boolean;
  connectionEnabled: boolean;
  connectionCanReply: boolean;
  /** Sinov rejimi: hamma tekshiruv ishlaydi, lekin Telegram'ga chiqmaydi. */
  simulated?: boolean;
  /** Chiqarish bosqichi. */
  rollout: RolloutSettings;
  /** Suhbatga bir marta berilgan barqaror raqam (foizli chiqarish uchun). */
  rolloutBucket: number | null;
  /** Mijoz avtomatik aloqadan chiqqanmi. */
  optedOut: boolean;
}

export type OutboundDecision =
  | { allowed: true; authorization: OutboundAuthorization }
  | { allowed: false; reason: OutboundRefusalReason };

export function authorizeOutbound(context: OutboundContext): OutboundDecision {
  const simulated = context.simulated === true;

  if (context.body.trim() === "") return { allowed: false, reason: "empty_body" };

  /*
   * OPT-OUT ENG BIRINCHI — hatto sinov rejimidan ham oldin.
   *
   * "Boshqa yozmang" degan odamga yozish sozlama masalasi emas.
   * Bu tekshiruv pastda tursa, sinov rejimidagi chaqiruv uni
   * chetlab o'tardi va amalda bu jonli chatga chiqib ketishi mumkin
   * edi (sinov va jonli yo'l bitta funksiyadan o'tadi).
   */
  if (context.optedOut) return { allowed: false, reason: "opted_out" };

  // Inson nazorati: sozlama yoqiq bo'lsa ham AI jim.
  if (!context.aiEnabled) return { allowed: false, reason: "human_takeover" };

  if (
    context.expectedStages.length > 0 &&
    !context.expectedStages.includes(context.stage)
  ) {
    return { allowed: false, reason: "unexpected_stage" };
  }

  // Sinov rejimida Telegram bilan bog'liq tekshiruvlar o'tkazib
  // yuboriladi — u yerda ulanish ham, sozlama ham bo'lmasligi mumkin.
  if (simulated) {
    return {
      allowed: true,
      authorization: seal(context, true),
    };
  }

  if (!context.autoReplyEnabled) return { allowed: false, reason: "auto_reply_disabled" };

  /*
   * CHIQARISH BOSQICHI (28-band).
   *
   * Ikki kalit ataylab: `autoReplyEnabled` — "avto-javob umuman
   * ruxsatmi" (favqulodda to'xtatish shu yerdan), `rollout` — "kimga".
   * Bittasi bo'lganda favqulodda to'xtatish rollout sozlamasini
   * yo'q qilardi va qayta yoqishda uni eslab qolish kerak bo'lardi.
   */
  const rollout = decideRollout({
    settings: context.rollout,
    chatId: context.chatId,
    bucket: context.rolloutBucket,
    simulated: false,
  });
  if (!rollout.allowed) return { allowed: false, reason: rollout.reason };

  if (!context.businessConnectionId || context.chatId == null) {
    return { allowed: false, reason: "missing_chat" };
  }
  if (!context.connectionEnabled) return { allowed: false, reason: "connection_disabled" };
  if (!context.connectionCanReply) return { allowed: false, reason: "no_reply_rights" };

  return { allowed: true, authorization: seal(context, false) };
}

function seal(context: OutboundContext, simulated: boolean): OutboundAuthorization {
  return {
    seal: OUTBOUND_SEAL,
    conversationId: context.conversationId,
    businessConnectionId: context.businessConnectionId ?? "",
    chatId: context.chatId ?? 0,
    stage: context.stage,
    kind: context.kind,
    templateKey: context.templateKey,
    simulated,
  };
}

/**
 * Ruxsat haqiqatan shu moduldan chiqqanmi.
 * Transport har yuborishdan oldin shuni chaqiradi.
 */
export function isOutboundAuthorized(value: unknown): value is OutboundAuthorization {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { seal?: unknown }).seal === OUTBOUND_SEAL
  );
}
