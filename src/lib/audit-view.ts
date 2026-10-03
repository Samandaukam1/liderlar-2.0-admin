import {
  AUDIT_ENTITY_LABEL,
  AUDIT_EVENT_KEYS,
  AUDIT_EVENTS,
  type AuditEventKey,
} from "./vip/audit-events.ts";

/**
 * AUDIT JURNALINI KO'RSATISH — SOF MODUL.
 *
 * Panel sahifasi, nomzod tarixi, bosh sahifa va CSV eksport bir xil
 * qoidalar bilan ishlashi uchun: kim (aktyor), qaysi obyekt turi,
 * qidiruv va o'zgarishni o'qiladigan ko'rinishga keltirish. Bazaga
 * murojaat yo'q — `tests/audit-view.test.ts` uni to'g'ridan-to'g'ri
 * yuklaydi.
 */

/* ========================================================================= *
 * AKTYOR
 * ========================================================================= */

export interface AuditActorProfile {
  full_name: string | null;
  avatar_url: string | null;
}

export interface AuditActor {
  name: string;
  avatarUrl: string | null;
  /**
   *   user    — profil topildi;
   *   system  — `actor_id` bo'sh: fon vazifasi yoki imzosiz amal;
   *   missing — `actor_id` bor, lekin profil yo'q;
   *   unknown — profillarni o'qib bo'lmadi (ism noma'lum, yozuv bor).
   */
  kind: "user" | "system" | "missing" | "unknown";
}

/**
 * Bitta so'rovdagi id lar soni.
 *
 * `in.(…)` filtri manzil qatoriga yoziladi: 100 ta UUID taxminan 3,7 KB.
 * Undan ko'pi bitta so'rovda proksi chegarasiga urilishi mumkin edi va
 * eksport (5000 qator) aynan shunday holat.
 */
export const AUDIT_ACTOR_CHUNK = 100;

export function chunkIds(ids: readonly string[], size = AUDIT_ACTOR_CHUNK): string[][] {
  if (size < 1) throw new Error("chunk size must be positive");
  const chunks: string[][] = [];
  for (let start = 0; start < ids.length; start += size) {
    chunks.push(ids.slice(start, start + size));
  }
  return chunks;
}

/** Qatorlardagi takrorlanmas, bo'sh bo'lmagan `actor_id` lar. */
export function auditActorIds(rows: ReadonlyArray<{ actor_id: string | null }>): string[] {
  const ids = new Set<string>();
  for (const row of rows) if (row.actor_id) ids.add(row.actor_id);
  return [...ids];
}

/**
 * `actor_id` -> ko'rsatiladigan ism.
 *
 * `actor_id` auth.users ga bog'langan va PostgREST uni `profiles` bilan
 * bitta so'rovda qo'sha olmaydi (to'g'ridan-to'g'ri tashqi kalit yo'q) —
 * shuning uchun ismlar alohida o'qiladi va shu funksiya bilan qo'yiladi.
 */
export function resolveAuditActor(
  actorId: string | null,
  profiles: ReadonlyMap<string, AuditActorProfile>,
  lookupFailed: boolean,
): AuditActor {
  if (!actorId) return { name: "Tizim", avatarUrl: null, kind: "system" };
  const profile = profiles.get(actorId);
  if (profile) {
    return {
      name: profile.full_name?.trim() || "(ism yo‘q)",
      avatarUrl: profile.avatar_url ?? null,
      kind: "user",
    };
  }
  // O'qish yiqilgan bo'lsa "topilmadi" deyish yolg'on bo'lardi.
  if (lookupFailed) return { name: "Noma’lum (o‘qib bo‘lmadi)", avatarUrl: null, kind: "unknown" };
  return { name: "Profil topilmadi", avatarUrl: null, kind: "missing" };
}

/* ========================================================================= *
 * OBYEKT TURLARI
 * ========================================================================= */

/**
 * Katalogdan oldingi (`logAudit`) yozuvlarning asosiy obyekt turlari.
 *
 * Ro'yxat to'liq emas — ataylab: filtr manzil qatori orqali har qanday
 * turni qabul qiladi, bu yerda faqat tez-tez kerak bo'ladiganlari.
 */
const LEGACY_ENTITY_LABEL: Readonly<Record<string, string>> = {
  candidate: "Nomzod",
  candidate_intake: "Anketa",
  application: "Ariza",
  article: "Maqola",
  monthly_update: "Oylik yangilanish",
  monthly_update_token: "Token",
  ranking_period: "Reyting",
  promo_code: "Promo kod",
  coordinator: "Koordinator",
  mehr_activity: "MEHR tadbiri",
  admin_user: "Admin",
  auth: "Kirish/chiqish",
  media: "Media",
  site_settings: "Sozlamalar",
  export: "Eksport",
  import: "Import",
};

export interface AuditEntityOption {
  value: string;
  label: string;
}

/** Filtr tanlovlari: eski turlar, keyin katalogdagi yangi turlar. */
export function auditEntityOptions(): AuditEntityOption[] {
  const options = new Map<string, string>(Object.entries(LEGACY_ENTITY_LABEL));
  for (const [value, label] of Object.entries(AUDIT_ENTITY_LABEL)) {
    if (!options.has(value)) options.set(value, label);
  }
  return [...options].map(([value, label]) => ({ value, label }));
}

export function auditEntityLabel(entity: string): string {
  if (Object.hasOwn(LEGACY_ENTITY_LABEL, entity)) return LEGACY_ENTITY_LABEL[entity];
  if (Object.hasOwn(AUDIT_ENTITY_LABEL, entity)) {
    return AUDIT_ENTITY_LABEL[entity as keyof typeof AUDIT_ENTITY_LABEL];
  }
  return entity;
}

/* ========================================================================= *
 * QIDIRUV
 * ========================================================================= */

export type AuditSearch =
  | { kind: "none" }
  /** Panel matni bo'yicha topilgan katalog hodisalari. */
  | { kind: "actions"; actions: AuditEventKey[] }
  /** Texnik nom bo'yicha (`ilike`) — eski yozuvlarni ham topadi. */
  | { kind: "like"; pattern: string };

function normalizeSearch(value: string): string {
  return value
    .toLowerCase()
    .replace(/[‘’ʻʼ`']/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Qidiruv matnini filtrga aylantiradi.
 *
 * Admin odatda panel matnini yozadi ("uzaytirildi"), lekin bazada
 * texnik nom turadi (`vip.subscription.extended`). Shuning uchun:
 * matn katalogdagi biror hodisa matniga mos kelsa — o'sha hodisalar
 * bo'yicha; aks holda texnik nom bo'yicha (`candidate.update` kabi
 * eski yozuvlar ham shu yo'l bilan topiladi).
 */
export function auditSearch(query: string): AuditSearch {
  const needle = normalizeSearch(query);
  if (!needle) return { kind: "none" };

  if (!/[._]/.test(needle)) {
    const actions = AUDIT_EVENT_KEYS.filter((key) =>
      normalizeSearch(AUDIT_EVENTS[key].label).includes(needle),
    );
    if (actions.length > 0) return { kind: "actions", actions };
  }

  // LIKE belgilarini (`%`, `_` emas — u texnik nomning bir qismi) olib tashlaymiz.
  const literal = needle.replace(/[%\\]/g, "");
  return { kind: "like", pattern: `%${literal}%` };
}

/* ========================================================================= *
 * O'ZGARISHNI KO'RSATISH
 * ========================================================================= */

export interface AuditChangeRow {
  field: string;
  before: string;
  after: string;
}

const MAX_SHOWN = 120;

function isFlatRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.values(value).every(
    (item) =>
      item === null ||
      ["string", "number", "boolean"].includes(typeof item) ||
      (Array.isArray(item) && item.every((part) => part === null || typeof part !== "object")),
  );
}

export function formatAuditValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "ha" : "yo‘q";
  if (Array.isArray(value)) return value.length === 0 ? "—" : value.map(formatAuditValue).join(", ");
  const text = typeof value === "object" ? JSON.stringify(value) : String(value);
  return text.length > MAX_SHOWN ? `${text.slice(0, MAX_SHOWN)}…` : text;
}

/**
 * Tekis `old_value`/`new_value` -> maydonma-maydon qatorlar.
 *
 * Yangi yozuvlar (`recordAudit`) har doim tekis. Eski yozuvlarda butun
 * obyekt bo'lishi mumkin — ular uchun `null` qaytadi va panel xom
 * ko'rinishni qisqartirib ko'rsatadi.
 */
export function auditChangeRows(oldValue: unknown, newValue: unknown): AuditChangeRow[] | null {
  const before = oldValue ?? {};
  const after = newValue ?? {};
  if (!isFlatRecord(before) || !isFlatRecord(after)) return null;

  const fields = [...new Set([...Object.keys(before), ...Object.keys(after)])];
  return fields.map((field) => ({
    field,
    before: Object.hasOwn(before, field) ? formatAuditValue(before[field]) : "—",
    after: Object.hasOwn(after, field) ? formatAuditValue(after[field]) : "—",
  }));
}
