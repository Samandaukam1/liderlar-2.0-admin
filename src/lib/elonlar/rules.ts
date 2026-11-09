/**
 * REKLAMA MODULI — FORMA VA SERVIS QOIDALARI (sof).
 *
 * `types.ts` dagi umumiy tiplarga tayanadi, lekin o'zi ham HECH QANDAY
 * `@/` import qilmaydi: testlar taxallusni yecha olmaydi, shuning uchun
 * qoidalar I/O'dan ajratilgan (uy qoidasi). Server action faqat FormData'ni
 * satrlarga aylantiradi va shu yerdagi funksiyalarga beradi — natijada
 * "matn juda uzun", "rasm yuklanmagan", "tugash boshlanishdan oldin" kabi
 * har bir qaror testda to'liq tekshiriladi.
 */

import { parseTashkentDateTime, tashkentOffsetMinutes } from "../tashkent-day.ts";
import {
  ACTIVE_LIMIT_MESSAGE,
  AD_BUTTON_LABEL_MAX,
  AD_KINDS,
  AD_PLACEMENTS,
  AD_TEXT_MAX,
  AD_TITLE_MAX,
  BAR_ROTATIONS,
  BOT_AD_TEXT_MAX,
  BOT_POST_POSITIONS,
  isAdLive,
  isHttpUrl,
  parseBarStyle,
  type Ad,
  type AdKind,
  type AdPlacement,
  type BarLogoPosition,
  type BarRotation,
  type BarStyle,
  type BotPostPosition,
} from "./types.ts";

/* ========================================================================= *
 * XATOLARNI TANISH
 * ========================================================================= */

/** Admin sahifasi va yuklash route'i ko'rsatadigan yagona xabar. */
export const MIGRATION_NOTICE =
  "Baza migratsiyasi hali qo‘llanmagan: supabase/migrations/20261109120000_ads.sql";

export interface DbErrorLike {
  code?: string | null;
  message?: string | null;
}

/**
 * Jadval yoki ustun hali yo'q — migratsiya qo'llanmagan.
 *
 * Postgres `42P01` (relation yo'q) / `42703` (ustun yo'q), PostgREST esa
 * sxema keshidan topa olmaganda `PGRST204/205` beradi. Ikkalasi ham bir
 * sabab: deploy bazadan oldin chiqqan. Admin buni xom xato o'rniga aniq
 * yo'riqnoma sifatida ko'rishi kerak.
 */
export function isMissingRelationError(error: DbErrorLike | null | undefined): boolean {
  if (!error) return false;
  const code = (error.code ?? "").toUpperCase();
  if (code === "42P01" || code === "42703" || code === "PGRST204" || code === "PGRST205") return true;
  const message = error.message ?? "";
  return /schema cache|does not exist/i.test(message) && /\bads(_settings)?\b|telegram_ad/i.test(message);
}

/** Bazadagi trigger "ko'pi bilan 3 ta" qoidasini buzganda shunday yozadi. */
export function isActiveLimitDbError(message: string | null | undefined): boolean {
  return typeof message === "string" && message.includes("3 ta reklama");
}

/** Supabase xatosini admin tushunadigan o'zbekcha xabarga aylantiradi. */
export function describeDbError(error: DbErrorLike | null | undefined): string {
  if (!error) return "Noma’lum xatolik";
  if (isActiveLimitDbError(error.message)) return ACTIVE_LIMIT_MESSAGE;
  if (isMissingRelationError(error)) return MIGRATION_NOTICE;
  return error.message?.trim() || "Noma’lum xatolik";
}

/** Saqlash joyi (bucket) hali yaratilmagan — xuddi shu migratsiya. */
export function isMissingBucketError(message: string | null | undefined): boolean {
  return typeof message === "string" && /bucket not found/i.test(message);
}

/* ========================================================================= *
 * MATN VA HAVOLA
 * ========================================================================= */

/**
 * Bir qatorli matn: qator uzilishlari va ketma-ket bo'shliqlar bitta
 * bo'shliqqa tushadi. Caption qatori ham, bar sarlavhasi ham bir qator —
 * ko'p qatorli matn Telegram'da `[*...*](...)` havolasini buzadi.
 */
export function singleLine(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

/**
 * Havola: faqat http(s), bo'shliqsiz (bazadagi `~* '^https?://\S+$'`
 * sharti bilan bir xil). Asl yozilgan ko'rinish saqlanadi — `URL`
 * normallashtirishi "https://t.me" ni "https://t.me/" qilib qo'yardi.
 */
export function normalizeHttpUrl(raw: string | null | undefined): string | null {
  const value = (raw ?? "").trim();
  if (!value || /\s/.test(value) || !isHttpUrl(value)) return null;
  return value;
}

/** Ro'yxatda ko'rsatish uchun: "www." siz host. */
export function urlHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, "");
  } catch {
    return url;
  }
}

/** Bot captioniga qo'shiladigan qator — migratsiya izohidagi shakl. */
export function botCaptionLine(text: string, url: string): string {
  return `[*${singleLine(text)}*](${url.trim()})`;
}

/* ========================================================================= *
 * JADVAL (starts_at / ends_at)
 * ========================================================================= */

/**
 * ISO lahza -> `datetime-local` qiymati (Toshkent devor soati).
 *
 * `iso.slice(0, 16)` UTC'ni ko'rsatardi: admin 18:00 deb saqlagan vaqt
 * tahrirda 13:00 bo'lib chiqar va qayta saqlanganda besh soat surilardi.
 */
export function toTashkentDateTimeInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  const instant = new Date(ms);
  const shifted = new Date(ms + tashkentOffsetMinutes(instant) * 60_000);
  return shifted.toISOString().slice(0, 16);
}

export type ScheduleResult =
  | { ok: true; startsAt: string | null; endsAt: string | null }
  | { ok: false; error: string };

/** Ikkala maydon ham ixtiyoriy; berilsa haqiqiy sana va to'g'ri tartibda bo'lsin. */
export function parseSchedule(input: { startsAt: string; endsAt: string }): ScheduleResult {
  const startsRaw = input.startsAt.trim();
  const endsRaw = input.endsAt.trim();
  const startsAt = startsRaw ? parseTashkentDateTime(startsRaw) : null;
  if (startsRaw && !startsAt) return { ok: false, error: "Boshlanish vaqti noto‘g‘ri" };
  const endsAt = endsRaw ? parseTashkentDateTime(endsRaw) : null;
  if (endsRaw && !endsAt) return { ok: false, error: "Tugash vaqti noto‘g‘ri" };
  if (startsAt && endsAt && Date.parse(endsAt) <= Date.parse(startsAt)) {
    return { ok: false, error: "Tugash vaqti boshlanish vaqtidan keyin bo‘lishi kerak" };
  }
  return { ok: true, startsAt, endsAt };
}

/* ========================================================================= *
 * BAR KO'RINISHI
 * ========================================================================= */

export const LOGO_POSITION_LABELS: Record<BarLogoPosition, string> = {
  left: "Chapda",
  right: "O‘ngda",
};

export interface BarStyleFormInput {
  theme: string;
  entrance: string;
  attention: string;
  logoPosition: string;
  bg: string;
  fg: string;
  accent: string;
}

/**
 * Formadan kelgan satrlardan `style` yig'adi. Ro'yxatda yo'q qiymat
 * `parseBarStyle` orqali standartga tushadi — bazaga faqat oq ro'yxatdagi
 * kalitlar yoziladi, brauzerdan kelgan ixtiyoriy satr emas.
 */
export function barStyleFromForm(input: BarStyleFormInput): BarStyle {
  return parseBarStyle({
    theme: input.theme.trim(),
    entrance: input.entrance.trim(),
    attention: input.attention.trim(),
    logoPosition: input.logoPosition.trim(),
    bg: input.bg.trim(),
    fg: input.fg.trim(),
    accent: input.accent.trim(),
  });
}

export interface PreviewColors {
  bg: string;
  fg: string;
  accent: string;
  /** Tugma ustidagi matn rangi. */
  accentText: string;
}

/**
 * Admin paneldagi taxminiy ko'rinish uchun ranglar. Saytdagi haqiqiy
 * mavzu CSS'da; bu yerda faqat "qaysi rang qayerda" degan taassurot.
 */
export function previewColors(style: BarStyle): PreviewColors {
  switch (style.theme) {
    case "glass-light":
      return { bg: "rgba(255,255,255,0.92)", fg: "#102033", accent: "#087ea4", accentText: "#ffffff" };
    case "brand-gradient":
      return {
        bg: "linear-gradient(90deg, #087ea4 0%, #1677ff 100%)",
        fg: "#ffffff",
        accent: "#ffffff",
        accentText: "#087ea4",
      };
    case "custom":
      return {
        bg: style.bg ?? "#102033",
        fg: style.fg ?? "#ffffff",
        accent: style.accent ?? "#00c7e8",
        accentText: readableOn(style.accent ?? "#00c7e8"),
      };
    default:
      return { bg: "rgba(16,32,51,0.88)", fg: "#ffffff", accent: "#00c7e8", accentText: "#071a33" };
  }
}

/** Och fonga to'q, to'q fonga oq matn — WCAG yorqinlik bo'yicha. */
export function readableOn(hex: string): string {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!match) return "#ffffff";
  const [r, g, b] = [match[1], match[2], match[3]].map((part) => parseInt(part, 16) / 255);
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const luminance = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return luminance > 0.45 ? "#071a33" : "#ffffff";
}

/* ========================================================================= *
 * REKLAMA YOZUVI (create / update)
 * ========================================================================= */

export interface AdFormInput {
  placement: string;
  title: string;
  text: string;
  url: string;
  kind: string;
  buttonLabel: string;
  logoUrl: string;
  imageUrl: string;
  imageWidth: string;
  imageHeight: string;
  style: BarStyleFormInput;
  closeOpensLink: boolean;
  startsAt: string;
  endsAt: string;
  isActive: boolean;
}

/** Bazaga yoziladigan ustunlar — nomlari migratsiya bilan bir xil. */
export interface AdWriteRecord {
  placement: AdPlacement;
  title: string;
  text: string | null;
  url: string;
  kind: AdKind | null;
  button_label: string | null;
  logo_url: string | null;
  image_url: string | null;
  image_width: number | null;
  image_height: number | null;
  style: BarStyle;
  close_opens_link: boolean;
  starts_at: string | null;
  ends_at: string | null;
  is_active: boolean;
}

export type AdRecordResult = { ok: true; record: AdWriteRecord } | { ok: false; error: string };

function positiveInt(value: string): number | null {
  const n = Number(value.trim());
  return Number.isInteger(n) && n > 0 ? n : null;
}

function isPlacement(value: string): value is AdPlacement {
  return (AD_PLACEMENTS as readonly string[]).includes(value);
}

function isKind(value: string): value is AdKind {
  return (AD_KINDS as readonly string[]).includes(value);
}

/**
 * Formani bazaga yoziladigan qatorga aylantiradi yoki birinchi xatoni
 * qaytaradi. Tekshiruvlar bazadagi CHECK shartlarining aynan o'zi — shunda
 * admin xatoni bazaga bormasdan, o'z tilida ko'radi.
 */
export function buildAdRecord(input: AdFormInput): AdRecordResult {
  const placement = input.placement.trim();
  if (!isPlacement(placement)) return { ok: false, error: "Joylashuv noto‘g‘ri" };

  const title = singleLine(input.title);
  if (title.length < 2 || title.length > AD_TITLE_MAX) {
    return { ok: false, error: `Nomi 2–${AD_TITLE_MAX} belgi bo‘lishi kerak` };
  }

  const url = normalizeHttpUrl(input.url);
  if (!url) return { ok: false, error: "Havola http(s):// bilan boshlanishi va bo‘shliqsiz bo‘lishi kerak" };

  const schedule = parseSchedule({ startsAt: input.startsAt, endsAt: input.endsAt });
  if (!schedule.ok) return schedule;

  const base = {
    placement,
    title,
    url,
    starts_at: schedule.startsAt,
    ends_at: schedule.endsAt,
    is_active: input.isActive,
  };

  if (placement === "bot_post") {
    const text = singleLine(input.text);
    if (text.length < 2 || text.length > BOT_AD_TEXT_MAX) {
      return { ok: false, error: `Matn 2–${BOT_AD_TEXT_MAX} belgi bo‘lishi kerak` };
    }
    return {
      ok: true,
      record: {
        ...base,
        text,
        kind: null,
        button_label: null,
        logo_url: null,
        image_url: null,
        image_width: null,
        image_height: null,
        style: parseBarStyle(null),
        close_opens_link: true,
      },
    };
  }

  const kind = input.kind.trim();
  if (!isKind(kind)) return { ok: false, error: "Bar turini tanlang" };
  const style = barStyleFromForm(input.style);

  if (kind === "image") {
    const imageUrl = normalizeHttpUrl(input.imageUrl);
    if (!imageUrl) return { ok: false, error: "Bar uchun rasm yuklang" };
    return {
      ok: true,
      record: {
        ...base,
        text: null,
        kind,
        button_label: null,
        logo_url: null,
        image_url: imageUrl,
        image_width: positiveInt(input.imageWidth),
        image_height: positiveInt(input.imageHeight),
        style,
        close_opens_link: input.closeOpensLink,
      },
    };
  }

  const text = singleLine(input.text);
  if (text.length < 2 || text.length > AD_TEXT_MAX) {
    return { ok: false, error: `Sarlavha 2–${AD_TEXT_MAX} belgi bo‘lishi kerak` };
  }
  const buttonLabel = singleLine(input.buttonLabel);
  if (buttonLabel.length > AD_BUTTON_LABEL_MAX) {
    return { ok: false, error: `Tugma matni ${AD_BUTTON_LABEL_MAX} belgidan oshmasin` };
  }
  const logoRaw = input.logoUrl.trim();
  const logoUrl = logoRaw ? normalizeHttpUrl(logoRaw) : null;
  if (logoRaw && !logoUrl) return { ok: false, error: "Logotip manzili noto‘g‘ri" };

  return {
    ok: true,
    record: {
      ...base,
      text,
      kind,
      button_label: buttonLabel || null,
      logo_url: logoUrl,
      image_url: null,
      image_width: null,
      image_height: null,
      style,
      close_opens_link: input.closeOpensLink,
    },
  };
}

/* ========================================================================= *
 * TARTIB (sort_order)
 * ========================================================================= */

export type MoveDirection = "up" | "down";

export function isMoveDirection(value: unknown): value is MoveDirection {
  return value === "up" || value === "down";
}

/**
 * Bir joydagi reklamalar ro'yxatida bittasini bir pog'ona suradi.
 * Chetda tursa (yuqoridagisini yana yuqoriga) `null` — qiladigan ish yo'q.
 */
export function reorderIds(ids: readonly string[], id: string, direction: MoveDirection): string[] | null {
  const index = ids.indexOf(id);
  if (index === -1) return null;
  const target = direction === "up" ? index - 1 : index + 1;
  if (target < 0 || target >= ids.length) return null;
  const next = [...ids];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

/**
 * Yangi tartib bo'yicha `sort_order` = indeks. Faqat o'zgarganlari
 * qaytadi: hamma qator 0 bilan kelgan bo'lsa (standart) birinchi surishda
 * hammasi raqamlanadi, keyin esa odatda ikkitasi.
 */
export function sortOrderUpdates(
  ads: readonly Pick<Ad, "id" | "sortOrder">[],
  orderedIds: readonly string[],
): Array<{ id: string; sort_order: number }> {
  const current = new Map(ads.map((ad) => [ad.id, ad.sortOrder]));
  const updates: Array<{ id: string; sort_order: number }> = [];
  orderedIds.forEach((id, index) => {
    if (current.get(id) !== index) updates.push({ id, sort_order: index });
  });
  return updates;
}

/** Yangi qator ro'yxat oxiriga tushadi. */
export function nextSortOrder(ads: readonly Pick<Ad, "sortOrder">[]): number {
  return ads.reduce((max, ad) => Math.max(max, ad.sortOrder), -1) + 1;
}

/* ========================================================================= *
 * HOLAT
 * ========================================================================= */

export type AdStatus = "live" | "scheduled" | "expired" | "off";

export const AD_STATUS_LABELS: Record<AdStatus, string> = {
  live: "Yoqilgan",
  scheduled: "Rejalashtirilgan",
  expired: "Muddati tugagan",
  off: "O‘chirilgan",
};

/** Yoqilgan, lekin muddat tashqarisida bo'lgan reklama "yoqilgan" emas — admin buni ko'rsin. */
export function adStatus(ad: Pick<Ad, "isActive" | "startsAt" | "endsAt">, now: Date): AdStatus {
  if (!ad.isActive) return "off";
  if (isAdLive(ad, now)) return "live";
  if (ad.startsAt && Date.parse(ad.startsAt) > now.getTime()) return "scheduled";
  return "expired";
}

/* ========================================================================= *
 * RASM / LOGOTIP YUKLASH
 * ========================================================================= */

export const MEDIA_KINDS = ["logo", "image"] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

export const MEDIA_MAX_BYTES = 5 * 1024 * 1024;
export const MEDIA_MIME_TYPES: readonly string[] = ["image/png", "image/jpeg", "image/webp", "image/gif"];

/** Logotip kvadratga kesilib shu o'lchamga keltiriladi. */
export const LOGO_SIZE = 512;
/** Bar rasmi shu kenglikdan oshmaydi (nisbat saqlanadi). */
export const IMAGE_MAX_WIDTH = 1600;

export type MediaUploadCheck = { ok: true; kind: MediaKind } | { ok: false; error: string };

export function validateMediaUpload(input: { kind: string; mimeType: string; size: number }): MediaUploadCheck {
  if (!(MEDIA_KINDS as readonly string[]).includes(input.kind)) {
    return { ok: false, error: "Yuklash turi noto‘g‘ri" };
  }
  if (!MEDIA_MIME_TYPES.includes(input.mimeType)) {
    return { ok: false, error: "Faqat PNG, JPEG, WebP yoki GIF qabul qilinadi" };
  }
  if (!Number.isFinite(input.size) || input.size <= 0) return { ok: false, error: "Fayl bo‘sh" };
  if (input.size > MEDIA_MAX_BYTES) return { ok: false, error: "Fayl hajmi 5 MB dan oshmasligi kerak" };
  return { ok: true, kind: input.kind as MediaKind };
}

/**
 * Saqlash yo'li: oy papkasi + tur + tasodifiy nom. Yo'l hech qachon
 * takrorlanmaydi, shuning uchun bir yillik kesh xavfsiz (upload-rules.ts).
 */
export function mediaObjectPath(kind: MediaKind, id: string, now: Date = new Date()): string {
  return `${now.toISOString().slice(0, 7)}/${kind}-${id}.webp`;
}

/* ========================================================================= *
 * SOZLAMALAR (ads_settings)
 * ========================================================================= */

export interface SettingsFormInput {
  rotation: string;
  appearDelayMs: string;
  cycleSeconds: string;
  dismissHours: string;
  hideOnScroll: boolean;
  botPostPosition: string;
}

export interface SettingsWriteRecord {
  profile_bar_rotation: BarRotation;
  profile_bar_appear_delay_ms: number;
  profile_bar_cycle_seconds: number;
  profile_bar_dismiss_hours: number;
  profile_bar_hide_on_scroll: boolean;
  bot_post_position: BotPostPosition;
}

export type SettingsRecordResult = { ok: true; record: SettingsWriteRecord } | { ok: false; error: string };

function intInRange(value: string, min: number, max: number): number | null {
  const n = Number(value.trim());
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
}

/** Oraliqlar bazadagi CHECK shartlari bilan bir xil; chetga chiqqan qiymat jim kesilmaydi — admin xabar oladi. */
export function buildSettingsRecord(input: SettingsFormInput): SettingsRecordResult {
  const rotation = input.rotation.trim();
  if (!(BAR_ROTATIONS as readonly string[]).includes(rotation)) {
    return { ok: false, error: "Navbat turi noto‘g‘ri" };
  }
  const botPostPosition = input.botPostPosition.trim();
  if (!(BOT_POST_POSITIONS as readonly string[]).includes(botPostPosition)) {
    return { ok: false, error: "Bot postidagi o‘rin noto‘g‘ri" };
  }
  const appearDelayMs = intInRange(input.appearDelayMs, 0, 30_000);
  if (appearDelayMs === null) return { ok: false, error: "Paydo bo‘lish kechikishi 0–30000 ms oralig‘ida bo‘lsin" };
  const cycleSeconds = intInRange(input.cycleSeconds, 3, 120);
  if (cycleSeconds === null) return { ok: false, error: "Almashish davri 3–120 soniya oralig‘ida bo‘lsin" };
  const dismissHours = intInRange(input.dismissHours, 1, 720);
  if (dismissHours === null) return { ok: false, error: "Yopilgandan keyingi tanaffus 1–720 soat oralig‘ida bo‘lsin" };

  return {
    ok: true,
    record: {
      profile_bar_rotation: rotation as BarRotation,
      profile_bar_appear_delay_ms: appearDelayMs,
      profile_bar_cycle_seconds: cycleSeconds,
      profile_bar_dismiss_hours: dismissHours,
      profile_bar_hide_on_scroll: input.hideOnScroll,
      bot_post_position: botPostPosition as BotPostPosition,
    },
  };
}

/* ========================================================================= *
 * SAYT KESHINI YANGILASH
 * ========================================================================= */

/** liderlar-web'dagi route — bar reklamalari va sozlamalari o'zgarganda chaqiriladi. */
export const PROFILE_HIGHLIGHT_REVALIDATE_PATH = "/api/revalidate/highlight";
