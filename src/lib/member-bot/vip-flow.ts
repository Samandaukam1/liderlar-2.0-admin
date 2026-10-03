import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { recordAudit } from "@/lib/vip/audit-log";
import {
  ENTRY_RULES,
  type EntryKind,
} from "@/lib/profile-editor/field-policy";
import {
  buildDate,
  checkText,
  confirmSummary,
  MONTHS_UZ,
  nextStep,
  parseDay,
  parseMonth,
  parseYear,
  savedMessage,
  TEXT_PROBLEM_TEXT,
  type ConversationDraft,
  type ConversationStep,
} from "./conversation";
import {
  clearConversation,
  loadConversation,
  setConversation,
  type Conversation,
} from "./conversation-store";
import type { BotMessage } from "./messages";

/**
 * TELEGRAM ORQALI PROFILNI TAHRIRLASH (§19–§22).
 *
 * MAVJUD MENYUGA TEGILMAYDI: bu modul alohida oqimlarni boshqaradi
 * va router ularni faol suhbat bo'lgandagina chaqiradi.
 *
 * SHAXS HAR QADAMDA TEKSHIRILADI. Telegram id dan profilga o'tish
 * router'da bajariladi va natija bu yerga beriladi — bu modul
 * `telegram_username` ga HECH QACHON tayanmaydi (§19: "Never
 * identify a user by Telegram @username alone"), chunki username
 * o'zgaradi va boshqa odam uni olishi mumkin.
 */

/* ========================================================================= *
 * AMAL KALITLARI
 * ========================================================================= */

export const VIP_ACTIONS = {
  vip: "m:vip",
  editProfile: "m:vip:edit",
  bio: "m:vip:bio",
  entry: "m:vip:entry",
  confirm: "m:vip:ok",
  cancel: "m:vip:no",
} as const;

/** Bo'lim tanlash kaliti: `m:vip:entry:education`. */
export function entryAction(kind: EntryKind): string {
  return `${VIP_ACTIONS.entry}:${kind}`;
}

export function parseEntryAction(data: string): EntryKind | null {
  if (!data.startsWith(`${VIP_ACTIONS.entry}:`)) return null;
  const kind = data.slice(`${VIP_ACTIONS.entry}:`.length);
  return Object.hasOwn(ENTRY_RULES, kind) ? (kind as EntryKind) : null;
}

/* ========================================================================= *
 * MENYULAR
 * ========================================================================= */

export function vipMenu(): BotMessage {
  return {
    text:
      "👑 *Liderlar VIP*\n\n" +
      "Profilingizni shu yerdan to'ldirishingiz mumkin. " +
      "Ta'lim, ish tajribasi va yutuqlar tahririyat tekshiruvidan o'tadi.",
    buttons: [
      [{ text: "✏️ Profilni tahrirlash", callback_data: VIP_ACTIONS.editProfile }],
      /*
       * Rasm oqimi ALOHIDA modulda (`photo-flow.ts`) va kaliti shu
       * yerda qo'lda yozilgan: `photo-flow` bu modulni import qiladi,
       * teskari import esa aylanma bog'lanish yasardi.
       */
      [{ text: "🖼 Rasmlar", callback_data: "m:vip:photo" }],
      [{ text: "🏠 Asosiy menyu", callback_data: "m:home" }],
    ],
  };
}

export function editMenu(): BotMessage {
  /*
   * BO'LIMLAR RO'YXATI REYESTRDAN OLINADI.
   *
   * Qo'lda sanash saytdagi ro'yxat bilan ajralib ketishga olib
   * kelardi: saytda yangi bo'lim paydo bo'lsa, botda ko'rinmasdi.
   */
  const rows = (Object.keys(ENTRY_RULES) as EntryKind[]).map((kind) => [
    {
      text: ENTRY_RULES[kind].label,
      callback_data: entryAction(kind),
    },
  ]);

  return {
    text: "Qaysi bo'limga qo'shmoqchisiz?",
    buttons: [
      [{ text: "📝 Qisqa ma'lumot", callback_data: VIP_ACTIONS.bio }],
      ...rows,
      [{ text: "👑 VIP", callback_data: VIP_ACTIONS.vip }],
    ],
  };
}

/* ========================================================================= *
 * OQIMNI BOSHLASH
 * ========================================================================= */

export async function startEntryFlow(
  telegramUserId: number,
  profileId: string,
  kind: EntryKind,
): Promise<BotMessage> {
  const rule = ENTRY_RULES[kind];

  const draft: ConversationDraft = { kind, hasDates: rule.hasDates };
  const saved = await setConversation({
    telegramUserId,
    profileId,
    step: "entry_title",
    draft,
  });

  if (!saved) {
    return {
      text: "Hozir boshlab bo'lmadi. Birozdan so'ng urinib ko'ring.",
      buttons: [[{ text: "👑 VIP", callback_data: VIP_ACTIONS.vip }]],
    };
  }

  return {
    text:
      `*${rule.label}*\n\nNomini yozib yuboring.\n\n` +
      "Masalan: Toshkent davlat universiteti\n\n" +
      "_Bekor qilish uchun /bekor deb yozing._",
    buttons: [],
  };
}

export async function startBioFlow(
  telegramUserId: number,
  profileId: string,
): Promise<BotMessage> {
  await setConversation({
    telegramUserId,
    profileId,
    step: "bio_text",
    draft: {},
  });

  return {
    text:
      "*Qisqa ma'lumot*\n\nO'zingiz haqida qisqacha yozib yuboring (600 belgigacha).\n\n" +
      "_Bu matn profilingizga DARHOL joylanadi._\n\n" +
      "_Bekor qilish uchun /bekor deb yozing._",
    buttons: [],
  };
}

/* ========================================================================= *
 * MATNLI JAVOBLAR
 * ========================================================================= */

/**
 * Faol suhbatdagi matnni qabul qiladi.
 *
 * `null` qaytsa — bu matn suhbatga tegishli emas va router o'z
 * odatdagi ishini qiladi (menyu ko'rsatadi).
 */
export async function handleConversationText(
  telegramUserId: number,
  profileId: string,
  text: string,
): Promise<BotMessage | null> {
  const conversation = await loadConversation(telegramUserId);
  if (!conversation) return null;

  /*
   * SUHBAT BOSHQA PROFILGA TEGISHLI BO'LSA — TASHLANADI.
   *
   * Telegram akkaunti boshqa profilga qayta bog'langan bo'lishi
   * mumkin. Eski suhbatni davom ettirish yozuvni BOSHQA ODAMNING
   * profiliga qo'shib qo'yardi (§62 AB-bandi).
   */
  if (conversation.profileId !== profileId) {
    await clearConversation(telegramUserId);
    return null;
  }

  // Bekor qilish har qadamda ishlaydi.
  if (/^\/bekor/i.test(text.trim())) {
    await clearConversation(telegramUserId);
    return { text: "Bekor qilindi.", buttons: editMenu().buttons };
  }

  switch (conversation.step) {
    case "entry_title":
      return stepTitle(conversation, text);
    case "entry_subtitle":
      return stepSubtitle(conversation, text);
    case "entry_year":
      return stepYear(conversation, text);
    case "entry_month":
      return stepMonth(conversation, text);
    case "entry_day":
      return stepDay(conversation, text);
    case "bio_text":
      return stepBio(conversation, text);
    case "entry_confirm":
      /*
       * Tasdiq TUGMA bilan beriladi, matn bilan emas: "ha" deb
       * yozilgan xabarni tasdiq deb qabul qilish tasodifiy
       * saqlashga olib kelardi.
       */
      return {
        text: "Tasdiqlash uchun tugmani bosing.",
        buttons: confirmButtons(),
      };
    case "photo_wait":
      return { text: "Rasm yuboring yoki /bekor deb yozing.", buttons: [] };
  }
}

async function advance(
  conversation: Conversation,
  draft: ConversationDraft,
  step: ConversationStep,
): Promise<void> {
  await setConversation({
    telegramUserId: conversation.telegramUserId,
    profileId: conversation.profileId!,
    step,
    draft,
  });
}

async function stepTitle(conversation: Conversation, text: string): Promise<BotMessage> {
  const check = checkText(text);
  if (!check.ok) return { text: TEXT_PROBLEM_TEXT[check.problem], buttons: [] };

  const draft = { ...conversation.draft, title: check.value };
  await advance(conversation, draft, "entry_subtitle");

  return {
    text:
      "Qo'shimcha ma'lumot yozing (lavozim, yo'nalish va h.k.).\n\n" +
      "_Kerak bo'lmasa, `-` yuboring._",
    buttons: [],
  };
}

async function stepSubtitle(conversation: Conversation, text: string): Promise<BotMessage> {
  /*
   * `-` — "o'tkazib yuborish".
   *
   * Bo'sh xabar yuborish Telegram'da mumkin emas, shuning uchun
   * o'tkazib yuborish uchun belgi kerak.
   */
  const skipped = text.trim() === "-";
  const draft = { ...conversation.draft };

  if (!skipped) {
    const check = checkText(text);
    if (!check.ok) return { text: TEXT_PROBLEM_TEXT[check.problem], buttons: [] };
    draft.subtitle = check.value;
  }

  const step = nextStep("entry_subtitle", draft);
  if (step === "entry_confirm") {
    await advance(conversation, draft, step);
    return confirmMessage(draft);
  }

  await advance(conversation, draft, "entry_year");
  return { text: "Yilni yozing. Masalan: 2015", buttons: [] };
}

async function stepYear(conversation: Conversation, text: string): Promise<BotMessage> {
  const year = parseYear(text, new Date());
  if (year === null) {
    return {
      text: `Yil noto'g'ri. 1900 dan ${new Date().getFullYear()} gacha son yozing.`,
      buttons: [],
    };
  }

  const draft = { ...conversation.draft, year };
  await advance(conversation, draft, "entry_month");

  return {
    text: "Oyni raqam bilan yozing (1–12).\n\n_Kerak bo'lmasa, `-` yuboring._",
    buttons: [],
  };
}

async function stepMonth(conversation: Conversation, text: string): Promise<BotMessage> {
  const draft = { ...conversation.draft };

  if (text.trim() === "-") {
    /*
     * OYSIZ SANA — FAQAT YIL.
     *
     * Ensiklopediyada "2015 yilda tamomlagan" odatiy yozuv va aniq
     * kunni talab qilish odamni taxminiy sana kiritishga majbur
     * qilardi.
     */
    await advance(conversation, draft, "entry_confirm");
    return confirmMessage(draft);
  }

  const month = parseMonth(text);
  if (month === null) return { text: "Oy 1 dan 12 gacha son bo'lsin.", buttons: [] };

  draft.month = month;
  await advance(conversation, draft, "entry_day");

  return {
    text: `${MONTHS_UZ[month - 1]}. Kunni yozing.\n\n_Kerak bo'lmasa, \`-\` yuboring._`,
    buttons: [],
  };
}

async function stepDay(conversation: Conversation, text: string): Promise<BotMessage> {
  const draft = { ...conversation.draft };

  if (text.trim() === "-") {
    await advance(conversation, draft, "entry_confirm");
    return confirmMessage(draft);
  }

  const { year, month } = draft;
  if (!year || !month) {
    // Holat buzilgan — oqimni qaytadan boshlashni so'raymiz.
    await clearConversation(conversation.telegramUserId);
    return { text: "Qaytadan boshlang.", buttons: editMenu().buttons };
  }

  const day = parseDay(text, year, month);
  if (day === null) {
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return {
      text: `Kun 1 dan ${lastDay} gacha bo'lsin (${MONTHS_UZ[month - 1]} ${year}).`,
      buttons: [],
    };
  }

  draft.day = day;
  await advance(conversation, draft, "entry_confirm");
  return confirmMessage(draft);
}

async function stepBio(conversation: Conversation, text: string): Promise<BotMessage> {
  const check = checkText(text, 600);
  if (!check.ok) return { text: TEXT_PROBLEM_TEXT[check.problem], buttons: [] };

  const db = createSupabaseAdminClient();

  /*
   * NOMZOD PROFILGA BOG'LANGANMI.
   *
   * Bog'lanmagan bo'lsa yozishga joy yo'q. Bu holat kamdan-kam,
   * lekin xabar tushunarli bo'lishi kerak.
   */
  const { data: candidate, error: candidateError } = await db
    .from("candidates")
    .select("id, short_bio")
    .eq("user_id", conversation.profileId!)
    .is("deleted_at", null)
    .maybeSingle();

  /*
   * O'QISH XATOSI "PROFIL YO'Q" EMAS.
   *
   * Avval ikkalasi bir xil javob berardi va odam baza uzilganda
   * "Sizda ensiklopediya profili yo'q" degan qo'rqinchli xabarni
   * olardi. Suhbat O'CHIRILMAYDI: matn saqlanib turadi va qayta
   * yuborish mumkin.
   */
  if (candidateError) {
    console.error("[bot] nomzod o'qilmadi:", candidateError.message);
    return { text: "Saqlab bo'lmadi. Keyinroq urinib ko'ring.", buttons: [] };
  }

  if (!candidate) {
    await clearConversation(conversation.telegramUserId);
    return {
      text: "Sizda ensiklopediya profili yo'q. Tahririyatga murojaat qiling.",
      buttons: editMenu().buttons,
    };
  }

  const { error } = await db
    .from("candidates")
    .update({ short_bio: check.value, last_updated_at: new Date().toISOString() })
    .eq("id", candidate.id);

  await clearConversation(conversation.telegramUserId);

  if (error) {
    console.error("[bot] qisqa ma'lumot saqlanmadi:", error.message);
    return { text: "Saqlab bo'lmadi. Keyinroq urinib ko'ring.", buttons: editMenu().buttons };
  }

  await recordAudit("telegram.profile.bio_updated", {
    actorId: conversation.profileId,
    entityId: candidate.id as string,
    before: { short_bio: (candidate.short_bio as string | null) ?? null },
    after: { short_bio: check.value },
    metadata: { channel: "telegram" },
  });

  /*
   * QISQA MA'LUMOT DARHOL NASHR BO'LADI.
   *
   * Saytdagi siyosat bilan bir xil (`field-policy.ts`): unda
   * tekshirib bo'ladigan da'vo yo'q.
   */
  return { text: savedMessage(false), buttons: editMenu().buttons };
}

/* ========================================================================= *
 * TASDIQ — §22
 * ========================================================================= */

function confirmButtons() {
  return [
    [
      { text: "✅ Tasdiqlash", callback_data: VIP_ACTIONS.confirm },
      { text: "❌ Bekor qilish", callback_data: VIP_ACTIONS.cancel },
    ],
  ];
}

function confirmMessage(draft: ConversationDraft): BotMessage {
  const kind = draft.kind as EntryKind | undefined;
  const rule = kind ? ENTRY_RULES[kind] : null;

  const needsReview = rule?.policy === "review";

  return {
    text:
      `*${rule?.label ?? "Yozuv"}*\n\n${confirmSummary(draft)}\n\n` +
      (needsReview
        ? "_Tasdiqlagandan keyin tahririyat tekshiruviga yuboriladi._"
        : "_Tasdiqlagandan keyin profilingizga joylanadi._"),
    buttons: confirmButtons(),
  };
}

/**
 * Tasdiqlangan yozuvni saqlaydi.
 *
 * `review_state` SIYOSATDAN olinadi, suhbatdan emas: foydalanuvchi
 * uni o'zgartira olmasligi kerak (§43).
 */
export async function confirmEntry(
  telegramUserId: number,
  profileId: string,
): Promise<BotMessage> {
  const conversation = await loadConversation(telegramUserId);

  if (!conversation || conversation.profileId !== profileId) {
    return { text: "Suhbat muddati tugadi. Qaytadan boshlang.", buttons: editMenu().buttons };
  }
  if (conversation.step !== "entry_confirm") {
    return { text: "Hozir tasdiqlash kerak emas.", buttons: editMenu().buttons };
  }

  const draft = conversation.draft;
  const kind = draft.kind as EntryKind | undefined;

  if (!kind || !Object.hasOwn(ENTRY_RULES, kind) || !draft.title) {
    await clearConversation(telegramUserId);
    return { text: "Ma'lumot to'liq emas. Qaytadan boshlang.", buttons: editMenu().buttons };
  }

  const db = createSupabaseAdminClient();

  const { data: candidate, error: candidateError } = await db
    .from("candidates")
    .select("id")
    .eq("user_id", profileId)
    .is("deleted_at", null)
    .maybeSingle();

  // Xato "profil yo'q" emas; suhbat saqlanadi, tasdiqni qayta bosish mumkin.
  if (candidateError) {
    console.error("[bot] nomzod o'qilmadi:", candidateError.message);
    return { text: "Saqlab bo'lmadi. Keyinroq urinib ko'ring.", buttons: confirmButtons() };
  }

  if (!candidate) {
    await clearConversation(telegramUserId);
    return {
      text: "Sizda ensiklopediya profili yo'q. Tahririyatga murojaat qiling.",
      buttons: editMenu().buttons,
    };
  }

  const rule = ENTRY_RULES[kind];
  const reviewState = rule.policy === "review" ? "pending_review" : "published";

  const dateFrom =
    draft.year && draft.month && draft.day
      ? buildDate(draft.year, draft.month, draft.day)
      : draft.year && draft.month
        ? buildDate(draft.year, draft.month, 1)
        : draft.year
          ? buildDate(draft.year, 1, 1)
          : null;

  const { data: inserted, error } = await db
    .from(kind)
    .insert({
      candidate_id: candidate.id,
      title: draft.title,
      subtitle: draft.subtitle ?? null,
      ...(rule.hasDates ? { date_from: dateFrom } : {}),
      submitted_by: profileId,
      review_state: reviewState,
    })
    .select("id")
    .single();

  await clearConversation(telegramUserId);

  if (error) {
    console.error("[bot] yozuv saqlanmadi:", { kind, message: error.message });
    return { text: "Saqlab bo'lmadi. Keyinroq urinib ko'ring.", buttons: editMenu().buttons };
  }

  await recordAudit("telegram.profile.entry_submitted", {
    actorId: profileId,
    entityId: candidate.id as string,
    after: { title: draft.title, review_state: reviewState },
    metadata: { channel: "telegram", kind, entry_id: (inserted?.id as string | undefined) ?? null },
  });

  return {
    text: savedMessage(reviewState === "pending_review"),
    buttons: editMenu().buttons,
  };
}

export async function cancelFlow(telegramUserId: number): Promise<BotMessage> {
  await clearConversation(telegramUserId);
  return { text: "Bekor qilindi.", buttons: editMenu().buttons };
}
