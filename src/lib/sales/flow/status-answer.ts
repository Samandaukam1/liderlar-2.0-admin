/**
 * HOLAT SAVOLIGA TIZIM MA'LUMOTIDAN JAVOB (28-band).
 *
 * "To'lovim tushdimi?", "Anketam qabul bo'ldimi?" — bunday
 * savolning javobi bilim bazasida YO'Q va bo'lishi ham kerak
 * emas. Javob aynan shu mijozning yozuvlarida.
 *
 * QAT'IY CHEGARA: bu modul FAQAT tasdiqlangan yozuvdan gapiradi.
 * Bilmagan narsasini taxmin qilmaydi va `null` qaytaradi — u
 * holda savol odamga topshiriq bo'lib boradi (11-band).
 *
 * MAQOLA VA SERTIFIKAT holati ATAYLAB yo'q: bu qiymatlar
 * suhbat xotirasida turadi, xotira esa modelning xulosasi
 * bo'lishi mumkin. Model xulosasini "maqolangiz chiqdi" deb
 * aytish — o'ylab topilgan fakt (16-band).
 *
 * SOF MODUL.
 */

import type { IntakeState, PaymentState } from "../memory/conversation-memory.ts";
import type { ReferencedObject } from "./message-intent.ts";

export interface VerifiedStatusFacts {
  /** `sales_conversations.payment_status` — jadval ustuni, xotira emas. */
  payment: PaymentState;
  /** Anketa havolasi yaratilganmi (intake_id bor). */
  intakeCreated: boolean;
  /** Anketa xotiradagi holati. */
  intake: IntakeState;
}

export interface StatusAnswer {
  /** Mijozga aytiladigan matn. null — tasdiqlangan javob yo'q. */
  answer: string | null;
  /** Nega javob yo'q — topshiriq sababi sifatida ishlatiladi. */
  reason: string;
}

/**
 * Jadval ustunini xotira lug'atiga o'giradi.
 *
 * IKKI LUG'AT BOR va ular bir xil emas: `sales_conversations.
 * payment_status` da to'langan holat "paid", suhbat xotirasida
 * esa "confirmed". Ularni solishtirmasdan ishlatish "to'lovingiz
 * tasdiqlangan" degan javobni TO'LAMAGAN mijozga yuborishi
 * mumkin edi.
 */
export function paymentStateFromColumn(value: string | null | undefined): PaymentState {
  switch ((value ?? "").trim().toLowerCase()) {
    case "paid":
    case "confirmed":
      return "confirmed";
    case "evidence_received":
      return "evidence_received";
    case "under_review":
      return "under_review";
    case "customer_claimed":
      return "customer_claimed";
    case "rejected":
      return "rejected";
    case "requested":
      return "requested";
    default:
      return "none";
  }
}

export function answerStatusQuestion(
  object: ReferencedObject,
  facts: VerifiedStatusFacts,
): StatusAnswer {
  switch (object) {
    case "payment":
      return paymentAnswer(facts.payment);
    case "intake":
    case "identity":
      return intakeAnswer(facts);
    case "article":
      return { answer: null, reason: "maqola holati tizimda tasdiqlanmagan" };
    case "certificate":
      return { answer: null, reason: "sertifikat holati tizimda tasdiqlanmagan" };
    default:
      return { answer: null, reason: "savol nimaga tegishli ekani aniq emas" };
  }
}

function paymentAnswer(state: PaymentState): StatusAnswer {
  switch (state) {
    case "confirmed":
      return { answer: "To‘lovingiz tasdiqlangan.", reason: "" };
    case "under_review":
    case "evidence_received":
      return {
        answer: "Chekingiz bizga kelgan, hozir tekshirilmoqda. Tasdiqlangach xabar beramiz.",
        reason: "",
      };
    case "customer_claimed":
      /*
       * "To'ladim" DEGANI TO'LOV EMAS (18-band).
       *
       * Bu javob mijozning aytganini takrorlaydi, tasdiqlamaydi.
       */
      return {
        answer: "To‘laganingizni yozgansiz, lekin chek hali qayd etilmagan. Chek (skrinshot)ni yuborsangiz tez tekshiramiz.",
        reason: "",
      };
    case "rejected":
      // Rad etilgan to'lovni bot o'zi tushuntirmaydi — odam kerak.
      return { answer: null, reason: "to‘lov rad etilgan — sababini odam tushuntirishi kerak" };
    case "requested":
      return {
        answer: "To‘lov hali qayd etilmagan. Chekni yuborsangiz, tekshirib tasdiqlaymiz.",
        reason: "",
      };
    case "none":
      return { answer: null, reason: "to‘lov bosqichi boshlanmagan" };
  }
}

function intakeAnswer(facts: VerifiedStatusFacts): StatusAnswer {
  if (facts.intake === "submitted") {
    return { answer: "Anketangiz to‘ldirilgan, javoblaringiz bizda.", reason: "" };
  }
  if (facts.intakeCreated || facts.intake === "link_sent" || facts.intake === "started") {
    return {
      answer: "Anketa havolasi yuborilgan, lekin javoblar hali to‘liq kelmagan. Havolani to‘ldirib yuboring.",
      reason: "",
    };
  }
  return { answer: null, reason: "anketa hali yaratilmagan" };
}
