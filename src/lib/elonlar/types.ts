/**
 * REKLAMA MODULI — UMUMIY TIPLAR, DOIMIYLAR VA SOF QOIDALAR.
 *
 * Bu fayl HECH NARSA import qilmaydi: testlar `@/` taxallusini yecha olmaydi,
 * shuning uchun qoidalar I/O'dan ajratilgan (uy qoidasi). Admin bo'limi,
 * post bot integratsiyasi va Studio shu yerdan o'qiydi — bitta manba bo'lmasa
 * bir joyda 3 ta chegara, boshqa joyda 4 ta bo'lib qolardi.
 *
 * Ustun nomlari `supabase/migrations/20261109120000_ads.sql` bilan bir xil.
 * Sayt (liderlar-web) o'z nusxasini `src/lib/profile-highlight/rules.ts` da
 * saqlaydi va test bilan shu faylga solishtiradi.
 *
 * NOMLASH: ommaviy URL, CSS klass va bucket nomlarida "ads", "reklama",
 * "banner", "promo" so'zlari ishlatilmaydi — reklama bloklovchilar shu
 * so'zli yo'llarni to'sadi. Shu sababli bucket `elon-media`, admin yo'li
 * `/elonlar`. Jadval nomi (`ads`) faqat serverda ishlatiladi.
 */

/* ========================================================================= *
 * JOYLASHUV VA TUR
 * ========================================================================= */

export const AD_PLACEMENTS = ["bot_post", "profile_bar"] as const;
export type AdPlacement = (typeof AD_PLACEMENTS)[number];

export const PLACEMENT_LABELS: Record<AdPlacement, string> = {
  bot_post: "Bot postlari",
  profile_bar: "Biografik sahifa bari",
};

export const AD_KINDS = ["text", "image"] as const;
export type AdKind = (typeof AD_KINDS)[number];

export const KIND_LABELS: Record<AdKind, string> = {
  text: "Matn va tugma",
  image: "Faqat rasm",
};

/** Har joyda bir vaqtda yoqilgan reklamalar chegarasi (bazadagi trigger bilan bir xil). */
export const MAX_ACTIVE_ADS_PER_PLACEMENT = 3;

/** Logotip va rasmlar saqlanadigan ommaviy bucket. */
export const AD_MEDIA_BUCKET = "elon-media";

export const AD_TITLE_MAX = 80;
/** Bazadagi chegara. */
export const AD_TEXT_MAX = 160;
/**
 * Bot captioni uchun torroq chegara: caption 1024 belgidan oshsa reklama
 * tushib qoladi, shuning uchun uzun gapga yo'l qo'ymaymiz.
 */
export const BOT_AD_TEXT_MAX = 80;
export const AD_BUTTON_LABEL_MAX = 32;

/* ========================================================================= *
 * BAR KO'RINISHI (style jsonb)
 * ========================================================================= */

export const BAR_THEMES = ["glass-light", "glass-dark", "brand-gradient", "custom"] as const;
export type BarTheme = (typeof BAR_THEMES)[number];
export const THEME_LABELS: Record<BarTheme, string> = {
  "glass-light": "Muz shisha (och, standart)",
  "glass-dark": "To‘q ko‘k shisha",
  "brand-gradient": "Brend gradienti",
  custom: "O‘z ranglarim",
};

export const BAR_ENTRANCES = ["drop", "drop-bounce", "fade-down", "unfold"] as const;
export type BarEntrance = (typeof BAR_ENTRANCES)[number];
export const ENTRANCE_LABELS: Record<BarEntrance, string> = {
  drop: "Header ostidan sirg‘alib tushadi",
  "drop-bounce": "Tushib, yengil qo‘nadi",
  "fade-down": "Xiradan tiniqlashib tushadi",
  unfold: "Pardadek ochiladi",
};

export const BAR_ATTENTIONS = ["none", "shimmer", "pulse", "float", "marquee"] as const;
export type BarAttention = (typeof BAR_ATTENTIONS)[number];
export const ATTENTION_LABELS: Record<BarAttention, string> = {
  none: "Harakatsiz",
  shimmer: "Shisha ustidan nur o‘tadi",
  pulse: "Tugma puls uradi",
  float: "Yengil nafas oladi",
  marquee: "Uzun matn oqib o‘tadi",
};

export const BAR_LOGO_POSITIONS = ["left", "right"] as const;
export type BarLogoPosition = (typeof BAR_LOGO_POSITIONS)[number];

export interface BarStyle {
  theme: BarTheme;
  entrance: BarEntrance;
  attention: BarAttention;
  logoPosition: BarLogoPosition;
  /** Faqat theme = 'custom' uchun; #rrggbb. */
  bg: string | null;
  fg: string | null;
  accent: string | null;
}

export const DEFAULT_BAR_STYLE: BarStyle = {
  theme: "glass-light",
  entrance: "drop",
  attention: "shimmer",
  logoPosition: "left",
  bg: null,
  fg: null,
  accent: null,
};

export const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

function pick<T extends string>(allowed: readonly T[], value: unknown, fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function hex(value: unknown): string | null {
  return typeof value === "string" && HEX_COLOR.test(value) ? value.toLowerCase() : null;
}

/**
 * Bazadan kelgan `style` ni tekshiradi. Noma'lum kalit yoki qiymat jimgina
 * standartga tushadi — bazadagi bitta noto'g'ri qator butun sahifani
 * buzmasligi kerak.
 */
export function parseBarStyle(value: unknown): BarStyle {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const theme = pick(BAR_THEMES, raw.theme, DEFAULT_BAR_STYLE.theme);
  return {
    theme,
    entrance: pick(BAR_ENTRANCES, raw.entrance, DEFAULT_BAR_STYLE.entrance),
    attention: pick(BAR_ATTENTIONS, raw.attention, DEFAULT_BAR_STYLE.attention),
    logoPosition: pick(BAR_LOGO_POSITIONS, raw.logoPosition, DEFAULT_BAR_STYLE.logoPosition),
    bg: theme === "custom" ? hex(raw.bg) : null,
    fg: theme === "custom" ? hex(raw.fg) : null,
    accent: theme === "custom" ? hex(raw.accent) : null,
  };
}

/* ========================================================================= *
 * QATOR VA DTO
 * ========================================================================= */

/** `public.ads` dan o'qiladigan ustunlar — select ro'yxati shu bilan bir xil. */
export const AD_SELECT_COLUMNS =
  "id, placement, title, is_active, sort_order, text, url, kind, button_label, logo_url, image_url, " +
  "image_width, image_height, style, close_opens_link, starts_at, ends_at, shown_count, impressions, " +
  "clicks, last_shown_at, created_at, updated_at";

export interface AdRow {
  id: string;
  placement: string;
  title: string;
  is_active: boolean;
  sort_order: number;
  text: string | null;
  url: string;
  kind: string | null;
  button_label: string | null;
  logo_url: string | null;
  image_url: string | null;
  image_width: number | null;
  image_height: number | null;
  style: unknown;
  close_opens_link: boolean;
  starts_at: string | null;
  ends_at: string | null;
  shown_count: number | string | null;
  impressions: number | string | null;
  clicks: number | string | null;
  last_shown_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Ad {
  id: string;
  placement: AdPlacement;
  title: string;
  isActive: boolean;
  sortOrder: number;
  text: string | null;
  url: string;
  kind: AdKind | null;
  buttonLabel: string | null;
  logoUrl: string | null;
  imageUrl: string | null;
  imageWidth: number | null;
  imageHeight: number | null;
  style: BarStyle;
  closeOpensLink: boolean;
  startsAt: string | null;
  endsAt: string | null;
  shownCount: number;
  impressions: number;
  clicks: number;
  lastShownAt: string | null;
  createdAt: string;
  updatedAt: string;
}

function int(value: number | string | null | undefined): number {
  const n = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export function mapAdRow(row: AdRow): Ad {
  return {
    id: row.id,
    placement: pick(AD_PLACEMENTS, row.placement, "profile_bar"),
    title: row.title,
    isActive: row.is_active === true,
    sortOrder: int(row.sort_order),
    text: row.text ?? null,
    url: row.url,
    kind: row.kind === null ? null : pick(AD_KINDS, row.kind, "text"),
    buttonLabel: row.button_label ?? null,
    logoUrl: row.logo_url ?? null,
    imageUrl: row.image_url ?? null,
    imageWidth: row.image_width ?? null,
    imageHeight: row.image_height ?? null,
    style: parseBarStyle(row.style),
    closeOpensLink: row.close_opens_link !== false,
    startsAt: row.starts_at ?? null,
    endsAt: row.ends_at ?? null,
    shownCount: int(row.shown_count),
    impressions: int(row.impressions),
    clicks: int(row.clicks),
    lastShownAt: row.last_shown_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/* ========================================================================= *
 * SOZLAMALAR (ads_settings, bitta qator)
 * ========================================================================= */

export const BAR_ROTATIONS = ["sequential", "cycle", "random"] as const;
export type BarRotation = (typeof BAR_ROTATIONS)[number];
export const ROTATION_LABELS: Record<BarRotation, string> = {
  sequential: "Ketma-ket: har sahifa ko‘rishida navbatdagisi",
  cycle: "Aylanma: bitta sahifada har N soniyada almashadi",
  random: "Tasodifiy",
};

export const BOT_POST_POSITIONS = ["end", "before_footer"] as const;
export type BotPostPosition = (typeof BOT_POST_POSITIONS)[number];
export const BOT_POSITION_LABELS: Record<BotPostPosition, string> = {
  end: "Postning eng oxirida",
  before_footer: "Liderlar.uz | Instagram qatoridan oldin",
};

export const ADS_SETTINGS_SELECT_COLUMNS =
  "profile_bar_rotation, profile_bar_appear_delay_ms, profile_bar_cycle_seconds, " +
  "profile_bar_dismiss_hours, profile_bar_hide_on_scroll, bot_post_position";

export interface AdsSettingsRow {
  profile_bar_rotation: string | null;
  profile_bar_appear_delay_ms: number | null;
  profile_bar_cycle_seconds: number | null;
  profile_bar_dismiss_hours: number | null;
  profile_bar_hide_on_scroll: boolean | null;
  bot_post_position: string | null;
}

export interface AdsSettings {
  profileBarRotation: BarRotation;
  profileBarAppearDelayMs: number;
  profileBarCycleSeconds: number;
  profileBarDismissHours: number;
  profileBarHideOnScroll: boolean;
  botPostPosition: BotPostPosition;
}

export const DEFAULT_ADS_SETTINGS: AdsSettings = {
  profileBarRotation: "sequential",
  profileBarAppearDelayMs: 1200,
  profileBarCycleSeconds: 8,
  profileBarDismissHours: 12,
  profileBarHideOnScroll: true,
  botPostPosition: "end",
};

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

export function mapAdsSettingsRow(row: AdsSettingsRow | null | undefined): AdsSettings {
  if (!row) return DEFAULT_ADS_SETTINGS;
  return {
    profileBarRotation: pick(BAR_ROTATIONS, row.profile_bar_rotation, DEFAULT_ADS_SETTINGS.profileBarRotation),
    profileBarAppearDelayMs: clamp(row.profile_bar_appear_delay_ms, 0, 30_000, DEFAULT_ADS_SETTINGS.profileBarAppearDelayMs),
    profileBarCycleSeconds: clamp(row.profile_bar_cycle_seconds, 3, 120, DEFAULT_ADS_SETTINGS.profileBarCycleSeconds),
    profileBarDismissHours: clamp(row.profile_bar_dismiss_hours, 1, 720, DEFAULT_ADS_SETTINGS.profileBarDismissHours),
    profileBarHideOnScroll: row.profile_bar_hide_on_scroll !== false,
    botPostPosition: pick(BOT_POST_POSITIONS, row.bot_post_position, DEFAULT_ADS_SETTINGS.botPostPosition),
  };
}

/* ========================================================================= *
 * QOIDALAR
 * ========================================================================= */

/** Faol va muddati mos — aynan bazadagi RLS/navbat sharti bilan bir xil. */
export function isAdLive(ad: Pick<Ad, "isActive" | "startsAt" | "endsAt">, now: Date = new Date()): boolean {
  if (!ad.isActive) return false;
  const t = now.getTime();
  if (ad.startsAt && Date.parse(ad.startsAt) > t) return false;
  if (ad.endsAt && Date.parse(ad.endsAt) <= t) return false;
  return true;
}

export function countActive(ads: readonly Pick<Ad, "placement" | "isActive">[], placement: AdPlacement): number {
  return ads.filter((ad) => ad.placement === placement && ad.isActive).length;
}

/**
 * Yoqishga ruxsat bormi. Baza triggeri ham tekshiradi; bu yerdagi tekshiruv
 * foydalanuvchiga tushunarli xabarni bazaga bormasdan berish uchun.
 */
export function canActivate(
  ads: readonly Pick<Ad, "id" | "placement" | "isActive">[],
  placement: AdPlacement,
  excludeId: string | null,
): boolean {
  const others = ads.filter((ad) => ad.id !== excludeId);
  return countActive(others, placement) < MAX_ACTIVE_ADS_PER_PLACEMENT;
}

export const ACTIVE_LIMIT_MESSAGE =
  "Bir vaqtda ko‘pi bilan 3 ta reklama yoqilishi mumkin. Avval boshqasini o‘chiring.";

/** Faqat http(s) — bot captioni va saytdagi href uchun. */
export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}
