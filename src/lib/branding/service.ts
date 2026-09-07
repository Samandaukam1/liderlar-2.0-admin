import "server-only";
import { cache } from "react";
import sharp from "sharp";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import {
  ALL_BRANDING_KEYS,
  BRANDING_BUCKET,
  BRANDING_ICON_SIZES,
  BRANDING_KEYS,
  brandingObjectPath,
  EMPTY_BRANDING,
  parseBranding,
  type BrandingAssets,
} from "./config.ts";

/**
 * Brending xizmati: logotipni qabul qiladi, ikonkalarni hosil qiladi va
 * sozlamalarga yozadi.
 *
 * `sharp` allaqachon loyihada bor (post-studio uni ishlatadi) va
 * `serverExternalPackages` ro'yxatida — shuning uchun yangi bog'liqlik
 * qo'shilmadi.
 */

/**
 * Joriy brending.
 *
 * `cache()` — bitta so'rov ichida bir marta o'qiladi. Bu funksiya ildiz
 * layout'dan chaqiriladi, ya'ni HAR sahifada ishlaydi; keshsiz har
 * render qo'shimcha so'rov qilardi.
 *
 * Xatoni YUTADI: brending — bezak. Baza javob bermasa panel standart
 * belgisi bilan ochilaveradi, oq ekran bermaydi.
 */
export const getBranding = cache(async (): Promise<BrandingAssets> => {
  try {
    const admin = createSupabaseAdminClient();
    const { data } = await admin
      .from("site_settings")
      .select("key, value")
      .in("key", [...ALL_BRANDING_KEYS]);

    return parseBranding(
      Object.fromEntries(
        ((data ?? []) as Array<{ key: string; value: string }>).map((row) => [row.key, row.value]),
      ),
    );
  } catch {
    return EMPTY_BRANDING;
  }
});

/* ------------------------------ o‘rnatish ------------------------------- */

export interface ApplyBrandingResult {
  ok: boolean;
  error?: string;
  branding?: BrandingAssets;
}

/**
 * Yuklangan logotipdan barcha ikonkalarni hosil qiladi va saqlaydi.
 *
 * Bitta manba tasvirdan hammasi chiqariladi — admin beshta faylni
 * alohida tayyorlashi shart emas va o'lchamlar hech qachon bir-biriga
 * mos kelmay qolmaydi.
 */
export async function applyBrandingLogo(input: {
  buffer: Buffer;
  mimeType: string;
  actorId: string;
}): Promise<ApplyBrandingResult> {
  const admin = createSupabaseAdminClient();
  const version = Date.now().toString(36);

  let image: sharp.Sharp;
  try {
    // SVG ham qabul qilinadi: sharp uni rasterlashtiradi. `density`
    // yuqori olinadi, aks holda kichik SVG kattalashtirilganda xiralashadi.
    image = sharp(input.buffer, { density: 384 });
    await image.metadata();
  } catch {
    return { ok: false, error: "Tasvirni o‘qib bo‘lmadi — fayl buzuq bo‘lishi mumkin." };
  }

  const settings: Array<{ key: string; value: string }> = [];

  /* --- asl logotip (panel uchun) --- */
  // Panelda logotip kichik ko'rsatiladi, lekin Retina ekran uchun
  // kattaroq saqlanadi.
  try {
    const logo = await sharp(input.buffer, { density: 384 })
      .resize(512, 512, { fit: "inside", withoutEnlargement: true })
      .png()
      .toBuffer();

    const path = brandingObjectPath(version, "logo.png");
    const { error } = await admin.storage
      .from(BRANDING_BUCKET)
      .upload(path, logo, { contentType: "image/png", upsert: true });
    if (error) return { ok: false, error: uploadError(error.message) };

    settings.push({
      key: BRANDING_KEYS.logo,
      value: admin.storage.from(BRANDING_BUCKET).getPublicUrl(path).data.publicUrl,
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Logotip tayyorlanmadi." };
  }

  /* --- ikonkalar --- */
  for (const icon of BRANDING_ICON_SIZES) {
    try {
      const png = await sharp(input.buffer, { density: 384 })
        // `contain` + shaffof fon: kvadrat bo'lmagan logotip
        // cho'zilmaydi, kesilmaydi.
        .resize(icon.size, icon.size, {
          fit: "contain",
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        })
        .png()
        .toBuffer();

      const path = brandingObjectPath(version, `icon-${icon.size}.png`);
      const { error } = await admin.storage
        .from(BRANDING_BUCKET)
        .upload(path, png, { contentType: "image/png", upsert: true });
      if (error) return { ok: false, error: uploadError(error.message) };

      settings.push({
        key: icon.key,
        value: admin.storage.from(BRANDING_BUCKET).getPublicUrl(path).data.publicUrl,
      });
    } catch (err) {
      return {
        ok: false,
        error: `${icon.size}px ikonka tayyorlanmadi: ${err instanceof Error ? err.message : ""}`,
      };
    }
  }

  const now = new Date().toISOString();
  settings.push({ key: BRANDING_KEYS.version, value: version });
  settings.push({ key: BRANDING_KEYS.updatedAt, value: now });

  const { error } = await admin.from("site_settings").upsert(
    settings.map((row) => ({ ...row, updated_by: input.actorId, updated_at: now })),
    { onConflict: "key" },
  );
  if (error) return { ok: false, error: error.message };

  await logAudit({
    actorId: input.actorId,
    action: "branding.update",
    entityType: "site_settings",
    entityId: "branding",
    newValue: { version, sizes: BRANDING_ICON_SIZES.map((i) => i.size) },
  });

  return { ok: true, branding: await readFresh() };
}

/**
 * Standart belgiga qaytaradi.
 *
 * Fayllar O'CHIRILMAYDI — ular versiyalangan yo'lda va hech kimga
 * xalaqit bermaydi; sozlama tozalanishi kifoya. Bu yana ortga qaytarish
 * imkonini ham qoldiradi.
 */
export async function resetBranding(actorId: string): Promise<ApplyBrandingResult> {
  const admin = createSupabaseAdminClient();
  const now = new Date().toISOString();

  const { error } = await admin.from("site_settings").upsert(
    ALL_BRANDING_KEYS.map((key) => ({
      key,
      value: "",
      updated_by: actorId,
      updated_at: now,
    })),
    { onConflict: "key" },
  );
  if (error) return { ok: false, error: error.message };

  await logAudit({
    actorId,
    action: "branding.reset",
    entityType: "site_settings",
    entityId: "branding",
  });

  return { ok: true, branding: EMPTY_BRANDING };
}

/** `cache()` ni chetlab o'tib, yangi qiymatni o'qiydi. */
async function readFresh(): Promise<BrandingAssets> {
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("site_settings")
    .select("key, value")
    .in("key", [...ALL_BRANDING_KEYS]);
  return parseBranding(
    Object.fromEntries(
      ((data ?? []) as Array<{ key: string; value: string }>).map((row) => [row.key, row.value]),
    ),
  );
}

function uploadError(message: string): string {
  if (/bucket not found/i.test(message)) {
    return `Saqlash joyi ("${BRANDING_BUCKET}" bucket) topilmadi — brending migratsiyasi hali qo‘llanmagan.`;
  }
  return message;
}
