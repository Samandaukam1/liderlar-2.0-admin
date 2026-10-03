import "server-only";
import { randomUUID } from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { recordAudit } from "@/lib/vip/audit-log";
import { downloadMemberFile, getMemberFileInfo } from "./bot-api";
import { clearConversation, loadConversation, setConversation } from "./conversation-store";
import { editMenu } from "./vip-flow";
import {
  detectImageType,
  isPhotoTarget,
  PHOTO_TARGETS,
  type IncomingPhoto,
  type PhotoTarget,
} from "./photo-rules";
import type { BotMessage } from "./messages";

/**
 * TELEGRAM ORQALI RASM YUKLASH — I/O QISMI (§21).
 *
 * OQIM: maqsad tanlanadi -> bot rasm so'raydi -> Telegram fayli
 * olinadi -> TEKSHIRILADI -> o'z saqlash joyimizga KO'CHIRILADI ->
 * egalik reyestrga yoziladi.
 *
 * TELEGRAM HAVOLASIGA TAYANILMAYDI. Telegram faylni ~1 soat saqlaydi
 * va to'liq havolada BOT TOKENI bo'ladi — uni bazaga yozish tokenni
 * oshkor qilardi, havola esa baribir eskirardi.
 *
 * Qoidalar (maqsadlar, o'lcham tanlash, tur aniqlash) `photo-rules.ts`
 * da: ular test talab qiladi va testlar `@/` taxallusini yecha
 * olmaydi.
 */

/* Qoidalar qayta eksport qilinadi — chaqiruvchilar bitta modulga qaraydi. */
export { isPhotoTarget, PHOTO_TARGETS, pickLargestPhoto } from "./photo-rules";
export type { IncomingPhoto, PhotoTarget } from "./photo-rules";

export const PHOTO_ACTIONS = {
  menu: "m:vip:photo",
  avatar: "m:vip:photo:avatar",
  gallery: "m:vip:photo:gallery",
} as const;

export function parsePhotoAction(data: string): PhotoTarget | null {
  if (data === PHOTO_ACTIONS.avatar) return "avatar";
  if (data === PHOTO_ACTIONS.gallery) return "gallery";
  return null;
}

export function photoMenu(): BotMessage {
  return {
    text: "🖼 Qaysi rasmni yuklamoqchisiz?",
    buttons: [
      [{ text: "Profil rasmi", callback_data: PHOTO_ACTIONS.avatar }],
      [{ text: "Galereya rasmi", callback_data: PHOTO_ACTIONS.gallery }],
      [{ text: "👑 VIP", callback_data: "m:vip" }],
    ],
  };
}

/* ========================================================================= *
 * OQIMNI BOSHLASH
 * ========================================================================= */

export async function startPhotoFlow(
  telegramUserId: number,
  profileId: string,
  target: PhotoTarget,
): Promise<BotMessage> {
  const rule = PHOTO_TARGETS[target];

  await setConversation({
    telegramUserId,
    profileId,
    step: "photo_wait",
    draft: { kind: target },
  });

  return {
    text:
      `*${rule.label}*\n\nRasmni yuboring.\n\n` +
      `_Hajmi ${Math.round(rule.maxBytes / 1024 / 1024)} MB dan oshmasin._\n` +
      "_Rasmni fayl sifatida emas, oddiy rasm sifatida yuboring._\n\n" +
      "_Bekor qilish uchun /bekor deb yozing._",
    buttons: [],
  };
}

/* ========================================================================= *
 * RASMNI QABUL QILISH
 * ========================================================================= */

/**
 * Yuborilgan rasmni saqlaydi.
 *
 * `null` qaytsa — faol rasm oqimi yo'q va router o'z odatdagi ishini
 * qiladi.
 */
export async function handleIncomingPhoto(
  telegramUserId: number,
  profileId: string,
  photo: IncomingPhoto,
): Promise<BotMessage | null> {
  const conversation = await loadConversation(telegramUserId);
  if (!conversation || conversation.step !== "photo_wait") return null;

  /*
   * SUHBAT BOSHQA PROFILGA TEGISHLI BO'LSA — TASHLANADI.
   *
   * Telegram akkaunti boshqa profilga qayta bog'langan bo'lishi
   * mumkin va rasm BOSHQA ODAMNING profiliga tushib ketardi.
   */
  if (conversation.profileId !== profileId) {
    await clearConversation(telegramUserId);
    return null;
  }

  const target = conversation.draft.kind;
  if (!isPhotoTarget(target)) {
    await clearConversation(telegramUserId);
    return { text: "Qaytadan boshlang.", buttons: photoMenu().buttons };
  }

  const rule = PHOTO_TARGETS[target];

  /*
   * HAJM AVVAL TELEGRAM BERGAN QIYMAT BO'YICHA tekshiriladi.
   *
   * Yuklab olishdan oldin rad etish tarmoq va xotirani tejaydi.
   * Yuklagandan keyin ham qayta tekshiriladi — bu qiymatga yakka
   * ishonib bo'lmaydi.
   */
  if (photo.sizeBytes !== null && photo.sizeBytes > rule.maxBytes) {
    return {
      text: `Rasm juda katta (${Math.round(rule.maxBytes / 1024 / 1024)} MB gacha). Kichikroq rasm yuboring.`,
      buttons: [],
    };
  }

  const db = createSupabaseAdminClient();

  const { data: candidate, error: candidateError } = await db
    .from("candidates")
    .select("id")
    .eq("user_id", profileId)
    .is("deleted_at", null)
    .maybeSingle();

  // O'qish xatosi "profil yo'q" emas: suhbat saqlanadi, rasmni qayta yuborish mumkin.
  if (candidateError) {
    console.error("[bot] nomzod o'qilmadi:", candidateError.message);
    return { text: "Rasmni saqlab bo'lmadi. Keyinroq urinib ko'ring.", buttons: [] };
  }

  if (!candidate) {
    await clearConversation(telegramUserId);
    return {
      text: "Sizda ensiklopediya profili yo'q. Tahririyatga murojaat qiling.",
      buttons: editMenu().buttons,
    };
  }

  const info = await getMemberFileInfo(photo.fileId);
  if (!info) {
    return { text: "Rasmni olib bo'lmadi. Qaytadan yuboring.", buttons: [] };
  }

  const file = await downloadMemberFile(info.filePath, rule.maxBytes);
  if (!file) {
    return {
      text: "Rasm yuklanmadi yoki juda katta. Kichikroq rasm yuboring.",
      buttons: [],
    };
  }

  /*
   * TUR HAQIQIY MAZMUN BO'YICHA TEKSHIRILADI.
   *
   * Telegram bergan `content-type` ga yakka ishonib bo'lmaydi:
   * `.jpg` deb nomlangan boshqa fayl ommaviy profilga tushmasligi
   * kerak.
   */
  const detected = detectImageType(file.bytes);
  if (!detected) {
    return {
      text: "Bu rasm emas yoki qo'llab-quvvatlanmaydigan turda. JPG, PNG yoki WebP yuboring.",
      buttons: [],
    };
  }

  /*
   * MANZIL SERVERDA YASALADI.
   *
   * Telegram bergan fayl nomi ishlatilmaydi: unda `../` yoki boshqa
   * belgilar bo'lishi mumkin va u yo'l in'ektsiyasiga olib kelardi.
   */
  const path = `candidates/${candidate.id}/${randomUUID()}.${detected.ext}`;

  const { error: uploadError } = await db.storage
    .from(rule.bucket)
    .upload(path, file.bytes, {
      contentType: detected.mime,
      // Ustiga yozish imkonsiz: har yuklash yangi manzil oladi.
      upsert: false,
    });

  if (uploadError) {
    console.error("[bot] rasm saqlanmadi:", uploadError.message);
    return { text: "Rasmni saqlab bo'lmadi. Keyinroq urinib ko'ring.", buttons: [] };
  }

  const { data: publicUrl } = db.storage.from(rule.bucket).getPublicUrl(path);
  const url = publicUrl.publicUrl;

  /*
   * EGALIK REYESTRGA YOZILADI.
   *
   * Busiz fayl bucketda "egasiz" qolardi va keyin uni kimga
   * tegishliligini aniqlash mumkin bo'lmasdi.
   */
  const { error: mediaError } = await db.from("candidate_media").insert({
    bucket: rule.bucket,
    path,
    file_name: `telegram-${target}.${detected.ext}`,
    mime_type: detected.mime,
    size_bytes: file.bytes.byteLength,
    candidate_id: candidate.id,
    kind: target,
    uploaded_by: profileId,
  });

  if (mediaError) {
    console.error("[bot] rasm reyestrga yozilmadi:", mediaError.message);
    /*
     * EGASIZ FAYL QOLDIRILMAYDI.
     *
     * Reyestrga tushmagan fayl bucketda hech kimga bog'lanmagan holda
     * qolardi va uni keyin topib bo'lmasdi.
     */
    const { error: removeError } = await db.storage.from(rule.bucket).remove([path]);
    if (removeError) {
      console.error("[bot] egasiz rasm o'chirilmadi:", { path, message: removeError.message });
    }
    return { text: "Rasmni saqlab bo'lmadi. Keyinroq urinib ko'ring.", buttons: [] };
  }

  if (target === "avatar") {
    const { error: avatarError } = await db
      .from("candidates")
      .update({ avatar_url: url, last_updated_at: new Date().toISOString() })
      .eq("id", candidate.id);

    if (avatarError) {
      console.error("[bot] avatar yozilmadi:", avatarError.message);
      return { text: "Profil rasmini o'rnatib bo'lmadi.", buttons: [] };
    }
  }

  await clearConversation(telegramUserId);

  await recordAudit("telegram.profile.photo_uploaded", {
    actorId: profileId,
    entityId: candidate.id as string,
    after: { kind: target, path },
    metadata: { channel: "telegram", bucket: rule.bucket, size_bytes: file.bytes.byteLength },
  });

  /*
   * RASM DARHOL KO'RINADI.
   *
   * Saytdagi siyosat bilan bir xil: rasm o'zini taqdim etish va unda
   * tekshirib bo'ladigan da'vo yo'q. "Tekshiruvga yuborildi" deb
   * aytish YOLG'ON bo'lardi (§22).
   */
  return {
    text:
      target === "avatar"
        ? "✅ Profil rasmi almashtirildi."
        : "✅ Rasm galereyaga qo'shildi.",
    buttons: photoMenu().buttons,
  };
}
