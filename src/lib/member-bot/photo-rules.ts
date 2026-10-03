/**
 * RASM QOIDALARI — SOF MODUL.
 *
 * Hech narsa import qilinmaydi. Sabab: testlar `@/` taxallusini
 * yecha olmaydi, ya'ni `@/lib/supabase/admin` ni import qiladigan
 * modulni testdan chaqirib bo'lmaydi.
 *
 * Bu yerdagi uch narsa eng nozik va aynan test talab qiladi:
 * maqsad ro'yxati (bucket nomini belgilaydi), o'lcham tanlash va
 * fayl turini imzo bo'yicha aniqlash.
 */

/* ========================================================================= *
 * MAQSADLAR
 * ========================================================================= */

/**
 * Rasm qayerga qo'yilishi.
 *
 * RO'YXAT QAT'IY: maqsad callback ma'lumotidan keladi va u BUCKET
 * nomini belgilaydi. Erkin qiymat qabul qilinsa, ixtiyoriy bucketga
 * yozish imkoni paydo bo'lardi (§21 "Do not allow arbitrary storage
 * path injection").
 */
export const PHOTO_TARGETS = {
  avatar: {
    label: "Profil rasmi",
    bucket: "candidate-avatars",
    maxBytes: 4 * 1024 * 1024,
  },
  gallery: {
    label: "Galereya rasmi",
    bucket: "candidate-gallery",
    maxBytes: 8 * 1024 * 1024,
  },
} as const;

export type PhotoTarget = keyof typeof PHOTO_TARGETS;

export function isPhotoTarget(value: unknown): value is PhotoTarget {
  return typeof value === "string" && Object.hasOwn(PHOTO_TARGETS, value);
}

/* ========================================================================= *
 * O'LCHAM TANLASH
 * ========================================================================= */

export interface IncomingPhoto {
  fileId: string;
  sizeBytes: number | null;
}

/**
 * Telegram `photo` massividan eng katta variantni tanlaydi.
 *
 * Telegram bir rasmni bir necha o'lchamda yuboradi va ular KICHIKDAN
 * KATTAGA tartiblangan. Birinchisini olsak, profilga 90 piksellik
 * rasm tushardi.
 */
export function pickLargestPhoto(
  photos: ReadonlyArray<{ file_id?: string; file_size?: number }> | undefined,
): IncomingPhoto | null {
  if (!photos || photos.length === 0) return null;

  const largest = photos[photos.length - 1];
  if (!largest?.file_id) return null;

  return { fileId: largest.file_id, sizeBytes: largest.file_size ?? null };
}

/* ========================================================================= *
 * TUR ANIQLASH
 * ========================================================================= */

/**
 * Fayl boshidagi imzo bo'yicha turni aniqlaydi.
 *
 * MIME SARLAVHASIGA ISHONMAYDI: u yuboruvchi aytgan qiymat va
 * almashtirilishi mumkin. Imzo esa faylning o'zida.
 *
 * SVG RO'YXATDA YO'Q — ataylab. Unda skript bo'lishi mumkin va u
 * ommaviy profilda saqlangan XSS bo'lardi (§58).
 */
export function detectImageType(
  bytes: Uint8Array,
): { mime: string; ext: string } | null {
  if (bytes.length < 12) return null;

  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { mime: "image/jpeg", ext: "jpg" };
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return { mime: "image/png", ext: "png" };
  }

  // WebP: "RIFF" .... "WEBP"
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return { mime: "image/webp", ext: "webp" };
  }

  return null;
}
