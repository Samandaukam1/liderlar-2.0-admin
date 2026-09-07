/**
 * Brending (logo va favicon) sozlamalari.
 *
 * SOF MODUL — `site_settings` dagi kalitlar, o'lchamlar va o'qish
 * qoidalari shu yerda. Baza ham, `sharp` ham yo'q, shuning uchun
 * qoidalar testda to'liq tekshiriladi.
 *
 * NEGA `site_settings`: bu jadvalni public sayt (liderlar-web) ham
 * o'qiydi. Brendingni shu yerda saqlash bir kun kelib saytning ham
 * logotipini shu paneldan boshqarish imkonini beradi — alohida
 * sozlama joyi ochilmaydi.
 */

/** Har o'lcham nima uchun kerakligi — tasodifiy raqamlar emas. */
export interface IconSize {
  size: number;
  key: string;
  purpose: string;
}

export const BRANDING_ICON_SIZES: readonly IconSize[] = [
  { size: 16, key: "branding_icon_16_url", purpose: "Brauzer yorlig‘i (kichik)" },
  { size: 32, key: "branding_icon_32_url", purpose: "Brauzer yorlig‘i" },
  { size: 180, key: "branding_icon_180_url", purpose: "iOS “Home screen”" },
  { size: 192, key: "branding_icon_192_url", purpose: "Android / PWA" },
  { size: 512, key: "branding_icon_512_url", purpose: "PWA splash" },
];

export const BRANDING_KEYS = {
  /** Asl yuklangan tasvir — panel logotipi sifatida ishlatiladi. */
  logo: "branding_logo_url",
  /** Kesh buzish uchun: o'zgarganda URL ham o'zgaradi. */
  version: "branding_version",
  updatedAt: "branding_updated_at",
} as const;

/** Sozlamalarda saqlanadigan barcha kalitlar — tozalash uchun ham kerak. */
export const ALL_BRANDING_KEYS: readonly string[] = [
  BRANDING_KEYS.logo,
  BRANDING_KEYS.version,
  BRANDING_KEYS.updatedAt,
  ...BRANDING_ICON_SIZES.map((icon) => icon.key),
];

export const BRANDING_BUCKET = "branding";

/** Logotip uchun ruxsat etilgan formatlar va hajm. */
export const BRANDING_MAX_BYTES = 5 * 1024 * 1024;
export const BRANDING_MIME_TYPES: readonly string[] = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/svg+xml",
];

export interface BrandingAssets {
  /** Panel logotipi. `null` — standart "L" belgisi ishlatiladi. */
  logoUrl: string | null;
  /** O'lcham -> URL. Bo'sh bo'lsa standart favicon qoladi. */
  icons: Record<number, string>;
  version: string | null;
  updatedAt: string | null;
}

export const EMPTY_BRANDING: BrandingAssets = {
  logoUrl: null,
  icons: {},
  version: null,
  updatedAt: null,
};

/**
 * `site_settings` qatorlaridan brendingni o'qiydi.
 *
 * Bo'sh satr YO'Q deb qaraladi: sozlama tozalanganda qator o'chirilmay,
 * qiymati bo'shatilishi mumkin va u "logo bor" deb hisoblanmasligi kerak.
 */
export function parseBranding(values: Record<string, string | null | undefined>): BrandingAssets {
  const read = (key: string): string | null => {
    const value = values[key];
    return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
  };

  const icons: Record<number, string> = {};
  for (const icon of BRANDING_ICON_SIZES) {
    const url = read(icon.key);
    if (url) icons[icon.size] = url;
  }

  return {
    logoUrl: read(BRANDING_KEYS.logo),
    icons,
    version: read(BRANDING_KEYS.version),
    updatedAt: read(BRANDING_KEYS.updatedAt),
  };
}

/** Maxsus brending o'rnatilganmi (ikonkalar bo'yicha). */
export function hasCustomIcons(branding: BrandingAssets): boolean {
  return Object.keys(branding.icons).length > 0;
}

/**
 * Kesh buzuvchi qo'shimchali URL.
 *
 * NEGA KERAK: brauzer favicon'ni juda uzoq keshlaydi. Yangi logo
 * yuklangach eski belgi haftalab qolib ketmasligi uchun URL ga versiya
 * qo'shiladi — Supabase URL o'zgarmasa ham, `?v=` o'zgaradi.
 */
export function versioned(url: string, version: string | null): string {
  if (!version) return url;
  return url.includes("?") ? `${url}&v=${version}` : `${url}?v=${version}`;
}

/**
 * Saqlash yo'li. Versiya yo'lning O'ZIDA — shu sababli har yuklash
 * yangi obyekt yaratadi va Supabase CDN eski faylni qaytarmaydi.
 */
export function brandingObjectPath(version: string, name: string): string {
  const safe = name.replace(/[^a-z0-9._-]/gi, "").slice(0, 60) || "asset";
  return `${version}/${safe}`;
}

/** Yuklangan faylni tekshiradi. */
export function validateBrandingUpload(input: {
  mimeType: string;
  size: number;
}): { ok: true } | { ok: false; error: string } {
  if (!BRANDING_MIME_TYPES.includes(input.mimeType)) {
    return { ok: false, error: "Faqat PNG, JPEG, WebP yoki SVG qabul qilinadi." };
  }
  if (!Number.isFinite(input.size) || input.size <= 0) {
    return { ok: false, error: "Fayl bo‘sh." };
  }
  if (input.size > BRANDING_MAX_BYTES) {
    return { ok: false, error: "Fayl hajmi 5 MB dan oshmasligi kerak." };
  }
  return { ok: true };
}
