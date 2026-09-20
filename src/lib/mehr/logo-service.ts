import "server-only";
import { randomUUID } from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { BRANDING_BUCKET, validateBrandingUpload } from "@/lib/branding/config";

/**
 * MEHR 365+ rasmiy logotipi.
 *
 * NEGA SOZLAMADA, REPODA EMAS.
 *
 * Logotip fayl sifatida repoga qo'yilsa, uni almashtirish
 * uchun har safar deploy kerak bo'lardi. Sozlamada bo'lsa,
 * admin uni panelning o'zidan yuklaydi va sayt darhol
 * yangilanadi.
 *
 * Eng muhimi: fayl bo'lmasa, kod logotipni TAXMIN QILIB
 * chizmaydi — tipografik yozuv ko'rsatiladi va u rasmiy
 * belgiga o'xshamaydi ham.
 */

export const MEHR_LOGO_SETTING_KEY = "mehr.logo_url";

/** Brending bucket'i ichidagi alohida papka. */
const MEHR_LOGO_PREFIX = "mehr";

export type LogoResult =
  | { ok: true; url: string }
  | { ok: false; error: string };

export async function getMehrLogoUrl(): Promise<string | null> {
  const db = createSupabaseAdminClient();

  const { data, error } = await db
    .from("site_settings")
    .select("value")
    .eq("key", MEHR_LOGO_SETTING_KEY)
    .maybeSingle();

  if (error) return null;

  const url = data?.value?.trim();
  if (!url) return null;

  /*
   * Faqat HTTPS. Sozlamaga qo'lda `javascript:` yoki `data:`
   * yozib qo'yilsa, u to'g'ridan-to'g'ri `<img src>` ga
   * tushardi.
   */
  try {
    return new URL(url).protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

/**
 * Logotipni yuklaydi.
 *
 * ESKISI O'CHIRILMAYDI. Yangi fayl yangi nom bilan yoziladi
 * va sozlama unga ko'chadi. Sabab: eski manzil keshlarda,
 * ijtimoiy tarmoq oldindan ko'rinishlarida va chop etilgan
 * materiallarda qolgan bo'lishi mumkin — uni birdan
 * o'chirish sindirilgan rasmlar qoldirardi.
 */
export async function setMehrLogo(
  file: { bytes: Uint8Array; mimeType: string; size: number; name: string },
  actorId: string,
): Promise<LogoResult> {
  const verdict = validateBrandingUpload({ mimeType: file.mimeType, size: file.size });
  if (!verdict.ok) return { ok: false, error: verdict.error };

  const db = createSupabaseAdminClient();

  const extension =
    file.mimeType === "image/svg+xml"
      ? "svg"
      : file.mimeType === "image/png"
        ? "png"
        : file.mimeType === "image/webp"
          ? "webp"
          : "jpg";

  // Fayl nomi foydalanuvchidan OLINMAYDI: unda bo'shliq,
  // kirill harf yoki `../` bo'lishi mumkin.
  const path = `${MEHR_LOGO_PREFIX}/${randomUUID()}.${extension}`;

  const { error: uploadError } = await db.storage
    .from(BRANDING_BUCKET)
    .upload(path, file.bytes, { contentType: file.mimeType, upsert: false });

  if (uploadError) {
    console.error("MEHR_LOGO_UPLOAD_FAILED", { message: uploadError.message });
    return { ok: false, error: "Faylni yuklab bo'lmadi." };
  }

  const url = db.storage.from(BRANDING_BUCKET).getPublicUrl(path).data.publicUrl;

  const { error: settingError } = await db.from("site_settings").upsert(
    {
      key: MEHR_LOGO_SETTING_KEY,
      value: url,
      updated_by: actorId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "key" },
  );

  if (settingError) {
    console.error("MEHR_LOGO_SETTING_FAILED", { code: settingError.code });
    return { ok: false, error: "Sozlamani saqlab bo'lmadi." };
  }

  await logAudit({
    actorId,
    action: "mehr.logo.updated",
    entityType: "site_setting",
    entityId: MEHR_LOGO_SETTING_KEY,
    newValue: { url },
    severity: "info",
  });

  return { ok: true, url };
}

/**
 * Logotipni olib tashlaydi.
 *
 * FAYL O'CHIRILMAYDI, faqat sozlama tozalanadi. Sayt
 * tipografik yozuvga qaytadi. Faylni o'chirish eski
 * havolalarni ham sindirardi.
 */
export async function clearMehrLogo(actorId: string): Promise<{ ok: boolean }> {
  const db = createSupabaseAdminClient();

  const { error } = await db
    .from("site_settings")
    .upsert(
      {
        key: MEHR_LOGO_SETTING_KEY,
        value: "",
        updated_by: actorId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "key" },
    );

  if (error) {
    console.error("MEHR_LOGO_CLEAR_FAILED", { code: error.code });
    return { ok: false };
  }

  await logAudit({
    actorId,
    action: "mehr.logo.cleared",
    entityType: "site_setting",
    entityId: MEHR_LOGO_SETTING_KEY,
    severity: "info",
  });

  return { ok: true };
}
