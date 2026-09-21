/**
 * ODDIY MULOQOTGA ODDIY JAVOB (9-band).
 *
 * "Assalomu alaykum", "Rahmat", "Hop" — bularga javob berish
 * uchun bilim bazasi ham, model ham KERAK EMAS. Ilgari ular
 * modelga yuborilardi, model bilim topmasdi va savol
 * "Javobsiz savollar" ga yozilardi.
 *
 * Bu modul javobni SUHBAT HOLATIDAN quradi: mijozdan nima
 * kutilayotgani ma'lum bo'lsa, javob o'sha qadamni eslatadi —
 * ya'ni voronka qaytadan boshlanmaydi (19-band).
 *
 * SOF MODUL. Model chaqirilmaydi (36-band).
 */

import type { MessageIntent, PendingUserAction } from "./message-intent.ts";

export interface ConversationalInput {
  intent: MessageIntent;
  pendingUserAction: PendingUserAction;
  /** Suhbatda oldin xabar bo'lganmi. */
  hasHistory: boolean;
  /** Shu suhbatda allaqachon salomlashganmizmi. */
  alreadyGreeted: boolean;
}

/** Kutilayotgan qadamni bir jumlada eslatadi. */
function pendingReminder(action: PendingUserAction): string | null {
  switch (action) {
    case "send_full_name":
      return "To‘liq ism-familiyangizni yozib yuboring.";
    case "send_payment_receipt":
      return "To‘lov chekini shu yerga yuboring.";
    case "submit_intake":
      return "Havoladagi savollarga javob yozib yuboring.";
    case "review_offer":
      return "Shartlar bilan tanishib chiqqach ayting.";
    case "decide_article":
      return "Sizga ham biografik maqola yozamizmi?";
    default:
      return null;
  }
}

/**
 * Muloqot javobini quradi.
 *
 * `null` — javob shart emas (masalan mazmunsiz shovqin va
 * kutilayotgan qadam ham yo'q). Jim qolish bu yerda TO'G'RI:
 * "." ga javob yozish suhbatni g'alati qiladi.
 */
export function buildConversationalReply(input: ConversationalInput): string | null {
  const reminder = pendingReminder(input.pendingUserAction);

  switch (input.intent) {
    case "greeting": {
      /*
       * SUHBAT O'RTASIDA QAYTA SALOMLASHMAYMIZ (25-band).
       *
       * "Assalomu alaykum, sizga qanday yordam beray?" deb
       * qayta boshlash mijozning oldingi qadamini o'chirib
       * tashlaydi.
       */
      const hello = input.alreadyGreeted ? "Ha, eshitaman." : "Va alaykum assalom!";
      return reminder ? `${hello} ${reminder}` : `${hello} Sizga qanday yordam bera olaman?`;
    }

    case "thanks":
      return reminder ? `Arzimaydi. ${reminder}` : "Arzimaydi 😊";

    case "confirmation":
      /*
       * "TANISHDIM" GA "TANISHIB CHIQQACH AYTING" DEB JAVOB
       * BERISH — botning mijozni o'qimaganini ko'rsatadi.
       *
       * Shu sababli bu yerda eslatma TAKRORLANMAYDI. Keyingi
       * qadamni ssenariy jadvali o'zi yuradi; bu javob faqat
       * jadvalda qadam bo'lmagan holat uchun.
       */
      return "Yaxshi, rahmat.";

    case "acknowledgement":
    case "affirmation":
      // Tan olishga uzun javob kerak emas — faqat keyingi qadam.
      return reminder ?? "Yaxshi.";

    case "action_confirmation":
      /*
       * "Yubordim" — TASDIQ EMAS.
       *
       * Bot buni "ko'rdim, qabul qildim" deb aytishi mumkin,
       * lekin "tekshirildi" deya OLMAYDI: tekshirish alohida
       * jarayon (18-band).
       */
      return "Qabul qildim, ko‘rib chiqamiz.";

    case "attachment_reference":
      return "Rahmat, oldim.";

    case "payment_receipt_reference":
      // ATAYLAB "to'lov tasdiqlandi" EMAS.
      return "Chek qabul qilindi, tekshirib chiqamiz va tasdiqlagach xabar beramiz.";

    case "identity_data":
      return "Rahmat. Sizga qanday yordam bera olaman?";

    case "continuation":
      return reminder ?? "Keyingi qadamni ayting — qaysi bosqichda to‘xtadingiz?";

    case "clarification":
      return reminder ?? "Savolingizni aniqroq yozib yuborsangiz, javob beraman.";

    case "spam_or_noise":
      // Kutilayotgan qadam bo'lsa eslatamiz, aks holda jim.
      return reminder;

    default:
      return null;
  }
}
