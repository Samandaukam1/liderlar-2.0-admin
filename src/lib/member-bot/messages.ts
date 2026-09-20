/**
 * A'zo botining matnlari va menyulari — SOF MODUL.
 *
 * MAVJUD BO'LMAGAN NARSA "TAYYOR" DEB KO'RSATILMAYDI.
 *
 * Bo'lim hali ishlamasa, bot buni ochiq aytadi. Soxta raqam
 * yoki bo'sh ro'yxat ko'rsatish odamni ishontirib, keyin
 * aldaydi — va bu ishonchni qaytarish ancha qiyin.
 */

export interface InlineButton {
  text: string;
  callback_data?: string;
  url?: string;
  web_app?: { url: string };
}

export interface BotMessage {
  text: string;
  buttons: InlineButton[][];
}

export const MEMBER_MENU_ACTIONS = {
  profile: "m:profile",
  mehr: "m:mehr",
  rank: "m:rank",
  points: "m:points",
  certificates: "m:certs",
  referral: "m:ref",
  support: "m:support",
  security: "m:security",
  home: "m:home",
  mehrActivities: "m:mehr:list",
  mehrStart: "m:mehr:start",
  mehrJoin: "m:mehr:join",
  mehrMine: "m:mehr:mine",
  mehrRank: "m:mehr:rank",
} as const;

const A = MEMBER_MENU_ACTIONS;

export function mainMenu(displayName: string | null): BotMessage {
  const greeting = displayName ? `Assalomu alaykum, ${displayName}!` : "Assalomu alaykum!";

  return {
    text: `${greeting}\n\nLiderlar a'zolik xizmati. Kerakli bo'limni tanlang.`,
    buttons: [
      [{ text: "👤 Profilim", callback_data: A.profile }],
      [{ text: "❤️ Mehr 365+", callback_data: A.mehr }],
      [
        { text: "🏆 Reytingim", callback_data: A.rank },
        { text: "⭐ Ballarim", callback_data: A.points },
      ],
      [{ text: "🎓 Sertifikatlarim", callback_data: A.certificates }],
      [
        { text: "👥 Referral", callback_data: A.referral },
        { text: "📩 Murojaatlar", callback_data: A.support },
      ],
      [{ text: "🔐 Xavfsizlik", callback_data: A.security }],
    ],
  };
}

export function mehrMenu(miniAppUrl: string | null): BotMessage {
  const buttons: InlineButton[][] = [
    [{ text: "❤️ Ezgulik ishlari", callback_data: A.mehrActivities }],
  ];

  /*
   * Mini App havolasi bo'lmasa, tugma UMUMAN ko'rsatilmaydi.
   *
   * Bosilganda hech nima qilmaydigan tugma — buzuq mahsulot
   * belgisi. Yo'qligini aytish halolroq.
   */
  if (miniAppUrl) {
    buttons.push([
      { text: "➕ Volontyorlik harakatini boshlash", web_app: { url: miniAppUrl } },
    ]);
    buttons.push([{ text: "🙋 Tadbirga qo'shilish", web_app: { url: `${miniAppUrl}?mode=join` } }]);
  }

  buttons.push([{ text: "📊 Faoliyatim", callback_data: A.mehrMine }]);
  buttons.push([
    { text: "🏆 Reyting", callback_data: A.mehrRank },
    { text: "🎓 Sertifikatlarim", callback_data: A.certificates },
  ]);
  buttons.push([{ text: "⬅️ Orqaga", callback_data: A.home }]);

  return {
    text:
      "❤️ <b>MEHR 365+</b>\n\n" +
      "Ezgulik ishlari uchun ball va sertifikat beriladi.\n\n" +
      (miniAppUrl
        ? "Tadbir ochish yoki tadbirga qo'shilish uchun pastdagi tugmalardan foydalaning."
        : "⚠️ Tadbir ochish hozircha yopiq — tizim sozlanmoqda."),
    buttons,
  };
}

/**
 * Bog'lanmagan foydalanuvchi.
 *
 * Bot BOG'LANISH TOKENINI O'ZI YARATMAYDI: token saytdagi
 * autentifikatsiyalangan seansdan chiqadi. Aks holda Telegram
 * raqamini bilgan odam o'zini boshqa a'zo deb ko'rsatib,
 * uning hisobiga ulanib olardi.
 */
export function notLinkedMessage(loginUrl: string): BotMessage {
  return {
    text:
      "🔗 <b>Hisob bog'lanmagan</b>\n\n" +
      "Bu botdan foydalanish uchun avval Liderlar hisobingizga kiring va " +
      "shaxsiy kabinetdan <b>Telegramni bog'lash</b> tugmasini bosing.\n\n" +
      "Shundan keyin bot sizni taniydi.",
    buttons: [[{ text: "🔐 Kabinetga kirish", url: loginUrl }]],
  };
}

export function linkSuccessMessage(displayName: string | null): BotMessage {
  return {
    text:
      "✅ <b>Hisob bog'landi</b>\n\n" +
      (displayName ? `Xush kelibsiz, ${displayName}!\n\n` : "") +
      "Endi ball, sertifikat va ezgulik ishlaringizni shu yerdan kuzatasiz.",
    buttons: [[{ text: "🏠 Asosiy menyu", callback_data: A.home }]],
  };
}

export type LinkFailure = "not_found" | "already_used" | "expired" | "taken";

export function linkFailureMessage(reason: LinkFailure): BotMessage {
  const text =
    reason === "expired"
      ? "⌛️ Havolaning muddati tugagan.\n\nKabinetdan yangi havola oling — ular qisqa muddat amal qiladi."
      : reason === "already_used"
        ? "🔁 Bu havola allaqachon ishlatilgan.\n\nHar bir havola faqat bir marta ishlaydi. Kabinetdan yangisini oling."
        : reason === "taken"
          ? "⚠️ Bu Telegram hisobi boshqa Liderlar a'zosiga bog'langan.\n\nAgar bu xato bo'lsa, murojaat qiling."
          : "❌ Havola tanilmadi.\n\nKabinetdan yangi havola olib, qaytadan urinib ko'ring.";

  return { text, buttons: [] };
}

export interface PointsSummary {
  total: number;
  byCategory: { label: string; points: number }[];
  recent: { label: string; points: number; date: string }[];
}

export const CATEGORY_LABEL: Readonly<Record<string, string>> = {
  ijtimoiy_tasir: "Ijtimoiy ta'sir",
  yetakchilik: "Yetakchilik",
  intellektual: "Intellektual faoliyat",
  yutuqlar: "Yutuqlar",
  jamiyatga_hissa: "Jamiyatga hissa",
};

export function pointsMessage(summary: PointsSummary): BotMessage {
  /*
   * BALL YO'Q — BU XATO EMAS.
   *
   * "0" ko'rsatib qo'yish odamga nima qilishi kerakligini
   * aytmaydi. Shuning uchun keyingi qadam aytiladi.
   */
  if (summary.total === 0) {
    return {
      text:
        "⭐ <b>Ballarim</b>\n\n" +
        "Hozircha ball yo'q.\n\n" +
        "Ball tasdiqlangan ezgulik ishidan keyin qo'shiladi: " +
        "tadbirda qatnashing yoki o'zingiz tashkil qiling.",
      buttons: [
        [{ text: "❤️ MEHR 365+", callback_data: A.mehr }],
        [{ text: "🏠 Asosiy menyu", callback_data: A.home }],
      ],
    };
  }

  const lines = [`⭐ <b>Ballarim</b>\n`, `Jami: <b>${summary.total}</b> ball\n`];

  if (summary.byCategory.length > 0) {
    lines.push("<b>Yo'nalishlar bo'yicha:</b>");
    for (const c of summary.byCategory) lines.push(`• ${c.label} — ${c.points}`);
    lines.push("");
  }

  if (summary.recent.length > 0) {
    lines.push("<b>Oxirgi yozuvlar:</b>");
    for (const r of summary.recent) {
      const sign = r.points > 0 ? "+" : "";
      lines.push(`• ${r.date} — ${r.label}: ${sign}${r.points}`);
    }
  }

  return {
    text: lines.join("\n"),
    buttons: [[{ text: "🏠 Asosiy menyu", callback_data: A.home }]],
  };
}

export interface CertificateSummary {
  activityTitle: string;
  roleLabel: string;
  issuedDate: string;
  code: string;
  revoked: boolean;
  verifyUrl: string;
}

export function certificatesMessage(certs: readonly CertificateSummary[]): BotMessage {
  if (certs.length === 0) {
    return {
      text:
        "🎓 <b>Sertifikatlarim</b>\n\n" +
        "Hozircha sertifikat yo'q.\n\n" +
        "Sertifikat ezgulik ishi tasdiqlangandan keyin avtomatik beriladi.",
      buttons: [[{ text: "🏠 Asosiy menyu", callback_data: A.home }]],
    };
  }

  const lines = ["🎓 <b>Sertifikatlarim</b>\n"];
  const buttons: InlineButton[][] = [];

  for (const c of certs) {
    lines.push(
      `${c.revoked ? "❌" : "✅"} <b>${c.activityTitle}</b>\n` +
        `   ${c.roleLabel} · ${c.issuedDate}\n` +
        `   Kod: <code>${c.code}</code>` +
        (c.revoked ? "\n   <i>Bekor qilingan</i>" : ""),
    );
    lines.push("");
    buttons.push([{ text: `🔍 ${c.code}`, url: c.verifyUrl }]);
  }

  buttons.push([{ text: "🏠 Asosiy menyu", callback_data: A.home }]);
  return { text: lines.join("\n").trim(), buttons };
}

/**
 * Hali tayyor bo'lmagan bo'lim.
 *
 * Soxta ma'lumot o'rniga ochiq javob. Foydalanuvchi nimani
 * kutishini bilib tursin.
 */
export function notAvailableYet(section: string): BotMessage {
  return {
    text: `🚧 <b>${section}</b>\n\nBu bo'lim hali tayyor emas. Tez orada ishga tushadi.`,
    buttons: [[{ text: "🏠 Asosiy menyu", callback_data: A.home }]],
  };
}
