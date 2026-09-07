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
};

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
}

export type OutboundDecision =
  | { allowed: true; authorization: OutboundAuthorization }
  | { allowed: false; reason: OutboundRefusalReason };

export function authorizeOutbound(context: OutboundContext): OutboundDecision {
  const simulated = context.simulated === true;

  if (context.body.trim() === "") return { allowed: false, reason: "empty_body" };

  // Inson nazorati HAR NARSADAN ustun: sozlama yoqiq bo'lsa ham AI jim.
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
