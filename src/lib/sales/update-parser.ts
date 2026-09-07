/**
 * Telegram Business update'larini normallashtirish.
 *
 * SOF MODUL: tarmoq ham, baza ham yo'q. Webhook route faqat shu yerdan
 * chiqqan natijani saqlaydi. Shuning uchun yo'nalish, xabar turi va
 * takrorlanish kaliti kabi mantiq testda to'liq tekshiriladi.
 *
 * 0.1 DOIRASI: `business_connection`, `business_message`,
 * `edited_business_message`, `deleted_business_messages`. Boshqa hamma
 * narsa — oddiy `message` ham — ATAYLAB e'tiborsiz qoldiriladi. Botga
 * to'g'ridan-to'g'ri yozilgan xabarga javob berish 0.1 doirasidan tashqarida
 * va bu yerda unga yo'l ham yo'q.
 */

import type { SalesDirection, SalesMessageType } from "./types.ts";

/* ------------------------- kiruvchi (xom) shakl ------------------------- */

interface RawUser {
  id?: number;
  is_bot?: boolean;
  username?: string;
  first_name?: string;
  last_name?: string;
  language_code?: string;
}

interface RawChat {
  id?: number;
  type?: string;
  title?: string;
  username?: string;
  first_name?: string;
  last_name?: string;
}

interface RawMessage {
  message_id?: number;
  business_connection_id?: string;
  date?: number;
  edit_date?: number;
  from?: RawUser;
  chat?: RawChat;
  text?: string;
  caption?: string;
  reply_to_message?: { message_id?: number };
  forward_origin?: unknown;
  [key: string]: unknown;
}

export interface RawSalesUpdate {
  update_id?: number;
  business_connection?: {
    id?: string;
    user?: RawUser;
    user_chat_id?: number;
    date?: number;
    can_reply?: boolean;
    rights?: { can_reply?: boolean } | null;
    is_enabled?: boolean;
  };
  business_message?: RawMessage;
  edited_business_message?: RawMessage;
  deleted_business_messages?: {
    business_connection_id?: string;
    chat?: RawChat;
    message_ids?: number[];
  };
  [key: string]: unknown;
}

/* --------------------------- chiquvchi shakl --------------------------- */

export interface ParsedConnection {
  telegramConnectionId: string;
  ownerTelegramUserId: number | null;
  ownerUsername: string | null;
  isEnabled: boolean;
  canReply: boolean;
  connectedAt: string | null;
}

export interface ParsedContact {
  telegramUserId: number;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  languageCode: string | null;
  isBot: boolean;
}

export interface ParsedBusinessMessage {
  businessConnectionId: string;
  chatId: number;
  chatTitle: string | null;
  telegramMessageId: number;
  direction: SalesDirection;
  messageType: SalesMessageType;
  text: string | null;
  sentAt: string;
  editedAt: string | null;
  /** Xabarni yozgan odam — outgoing'da bu sotuvchi, mijoz emas. */
  fromTelegramUserId: number | null;
  fromUsername: string | null;
  /** Suhbat egasi (mijoz) — doim `chat` dan olinadi. */
  contact: ParsedContact | null;
  /** Minimal metadata. Fayl id, telefon, token bu yerga TUSHMAYDI. */
  metadata: Record<string, unknown>;
}

export interface ParsedDeletion {
  businessConnectionId: string;
  chatId: number;
  telegramMessageIds: number[];
}

export type ParsedSalesUpdate =
  | { kind: "connection"; connection: ParsedConnection }
  | { kind: "message"; message: ParsedBusinessMessage; edited: boolean }
  | { kind: "deleted"; deletion: ParsedDeletion }
  | { kind: "ignored"; reason: string };

/* ------------------------------ yo'nalish ------------------------------ */

/**
 * Xabarni kim yozgan.
 *
 * ENG ISHONCHLI MANBA — ulanish egasining user id'si: biznes akkaunt egasi
 * bizning sotuvchimiz, demak undan kelgan xabar `outgoing`.
 *
 * Ulanish hali saqlanmagan bo'lsa (birinchi xabar ulanish update'idan oldin
 * kelishi mumkin) zaxira qoida ishlaydi: shaxsiy chatda mijozning
 * `from.id` va `chat.id` qiymatlari bir xil bo'ladi, sotuvchiniki esa yo'q.
 */
export function resolveDirection(input: {
  fromId: number | null;
  chatId: number;
  ownerUserId?: number | null;
}): SalesDirection {
  const { fromId, chatId, ownerUserId } = input;
  if (ownerUserId != null && fromId != null) {
    return fromId === ownerUserId ? "outgoing" : "incoming";
  }
  if (fromId == null) return "incoming";
  return fromId === chatId ? "incoming" : "outgoing";
}

/* ----------------------------- xabar turi ------------------------------ */

/** Tekshirish tartibi muhim: `photo` bilan `document` bir xabarda bo'lmaydi,
 *  lekin `animation` doim `document` bilan birga keladi. */
const TYPE_KEYS: Array<[string, SalesMessageType]> = [
  ["animation", "animation"],
  ["photo", "photo"],
  ["video_note", "video_note"],
  ["video", "video"],
  ["voice", "voice"],
  ["audio", "audio"],
  ["document", "document"],
  ["sticker", "sticker"],
  ["contact", "contact"],
  ["location", "location"],
  ["venue", "location"],
  ["poll", "poll"],
  ["story", "story"],
];

export function resolveMessageType(message: RawMessage): SalesMessageType {
  for (const [key, type] of TYPE_KEYS) {
    if (message[key] != null) return type;
  }
  if (typeof message.text === "string") return "text";
  return "other";
}

/* ------------------------------- yordam -------------------------------- */

const toIso = (unixSeconds: number | undefined): string | null =>
  typeof unixSeconds === "number" && Number.isFinite(unixSeconds)
    ? new Date(unixSeconds * 1000).toISOString()
    : null;

const str = (value: unknown): string | null =>
  typeof value === "string" && value.trim() !== "" ? value.trim() : null;

/** `sales_messages` dagi unikal indeksning kaliti — takrorlanishdan himoya. */
export function messageDedupeKey(
  businessConnectionId: string,
  chatId: number,
  telegramMessageId: number,
): string {
  return `${businessConnectionId}:${chatId}:${telegramMessageId}`;
}

/** `sales_conversations` dagi unikal kalit. */
export function conversationKey(businessConnectionId: string, chatId: number): string {
  return `${businessConnectionId}:${chatId}`;
}

/* ------------------------------ tahlilchi ------------------------------ */

function parseMessage(
  raw: RawMessage,
  ownerUserId: number | null,
): ParsedBusinessMessage | null {
  const businessConnectionId = str(raw.business_connection_id);
  const chatId = raw.chat?.id;
  const messageId = raw.message_id;
  const sentAt = toIso(raw.date);

  // Bu to'rttasisiz yozuvni saqlab ham, keyin topib ham bo'lmaydi.
  if (!businessConnectionId || typeof chatId !== "number") return null;
  if (typeof messageId !== "number" || !sentAt) return null;

  const fromId = typeof raw.from?.id === "number" ? raw.from.id : null;

  // MIJOZ doim `chat` dan olinadi. `from` dan olinsa, sotuvchi o'zining
  // yozgan xabari orqali "mijoz" sifatida ro'yxatga tushib qolardi.
  const chat = raw.chat ?? {};
  const contact: ParsedContact | null =
    chat.type === "private" || chat.type === undefined
      ? {
          telegramUserId: chatId,
          username: str(chat.username),
          firstName: str(chat.first_name),
          lastName: str(chat.last_name),
          languageCode: fromId === chatId ? str(raw.from?.language_code) : null,
          isBot: false,
        }
      : null;

  const messageType = resolveMessageType(raw);

  return {
    businessConnectionId,
    chatId,
    chatTitle: str(chat.title),
    telegramMessageId: messageId,
    direction: resolveDirection({ fromId, chatId, ownerUserId }),
    messageType,
    text: str(raw.text) ?? str(raw.caption),
    sentAt,
    editedAt: toIso(raw.edit_date),
    fromTelegramUserId: fromId,
    fromUsername: str(raw.from?.username),
    contact,
    // Faqat xabarning SHAKLI haqidagi faktlar.
    metadata: {
      messageType,
      isReply: raw.reply_to_message?.message_id != null,
      isForwarded: raw.forward_origin != null,
      hasCaption: str(raw.caption) != null,
    },
  };
}

/**
 * Bitta update'ni normallashtiradi. Hech qachon xato tashlamaydi — webhook
 * noma'lum update'da 500 qaytarsa, Telegram uni cheksiz qayta yuboradi.
 */
export function parseSalesUpdate(
  update: unknown,
  options: { ownerUserId?: number | null } = {},
): ParsedSalesUpdate {
  if (!update || typeof update !== "object") {
    return { kind: "ignored", reason: "update JSON obyekt emas" };
  }
  const raw = update as RawSalesUpdate;
  const ownerUserId = options.ownerUserId ?? null;

  if (raw.business_connection) {
    const bc = raw.business_connection;
    const id = str(bc.id);
    if (!id) return { kind: "ignored", reason: "business_connection.id yo‘q" };
    return {
      kind: "connection",
      connection: {
        telegramConnectionId: id,
        ownerTelegramUserId: typeof bc.user?.id === "number" ? bc.user.id : null,
        ownerUsername: str(bc.user?.username),
        isEnabled: bc.is_enabled !== false,
        // Bot API 9.0 `can_reply` o'rniga `rights` obyektini berdi; ikkala
        // shakl ham qo'llab-quvvatlanadi. 0.1 da bu qiymat FAQAT qayd
        // etiladi — bot baribir yozmaydi.
        canReply:
          typeof bc.can_reply === "boolean" ? bc.can_reply : Boolean(bc.rights?.can_reply),
        connectedAt: toIso(bc.date),
      },
    };
  }

  if (raw.business_message || raw.edited_business_message) {
    const edited = Boolean(raw.edited_business_message);
    const source = (raw.business_message ?? raw.edited_business_message)!;
    const message = parseMessage(source, ownerUserId);
    if (!message) {
      return { kind: "ignored", reason: "business_message majburiy maydonsiz" };
    }
    return { kind: "message", message, edited };
  }

  if (raw.deleted_business_messages) {
    const del = raw.deleted_business_messages;
    const businessConnectionId = str(del.business_connection_id);
    const chatId = del.chat?.id;
    const ids = Array.isArray(del.message_ids)
      ? del.message_ids.filter((n): n is number => typeof n === "number")
      : [];
    if (!businessConnectionId || typeof chatId !== "number" || ids.length === 0) {
      return { kind: "ignored", reason: "deleted_business_messages to‘liq emas" };
    }
    return {
      kind: "deleted",
      deletion: { businessConnectionId, chatId, telegramMessageIds: ids },
    };
  }

  return { kind: "ignored", reason: "0.1 doirasidagi update emas" };
}

/* -------------------------- takrorlanish qoidasi ------------------------- */

export interface StoredMessageState {
  editedAt: string | null;
  deletedAt: string | null;
}

/**
 * Bazada shu xabar allaqachon bor. Uni QAYTA YOZAMIZMI?
 *
 * Telegram webhook'ga 200 kelmasa bitta update'ni qayta-qayta yuboradi, ya'ni
 * takrorlanish odatiy hol. Qoida:
 *   · oddiy (tahrirlanmagan) takror — HECH QACHON qayta yozilmaydi;
 *   · tahrir — faqat `edit_date` bazadagisidan YANGI bo'lsa yoziladi, ya'ni
 *     eski tahrir yangisini bosib ketmaydi.
 */
export function shouldApplyMessage(
  incoming: { edited: boolean; editedAt: string | null },
  existing: StoredMessageState | null,
): boolean {
  if (existing === null) return true;
  if (!incoming.edited) return false;
  if (!incoming.editedAt) return false;
  if (!existing.editedAt) return true;
  return new Date(incoming.editedAt).getTime() > new Date(existing.editedAt).getTime();
}
