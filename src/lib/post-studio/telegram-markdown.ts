/**
 * Telegram MarkdownV2 escaping and caption assembly — pure and unit-tested.
 *
 * MarkdownV2 is unforgiving: an unescaped `.` or `-` anywhere in a caption
 * makes the whole sendPhoto call fail with "can't parse entities", which would
 * silently drop a post for every subscriber. Escaping therefore happens here,
 * once, for every dynamic value, and the tests cover the characters that
 * actually occur in Uzbek quotes (`.`, `!`, `-`, `(`, `)`).
 */

/** Every character Telegram requires escaping in MarkdownV2 body text. */
const MARKDOWN_V2_SPECIALS = /[_*[\]()~`>#+\-=|{}.!\\]/g;

export function escapeMarkdownV2(value: string): string {
  return value.replace(MARKDOWN_V2_SPECIALS, (c) => `\\${c}`);
}

/**
 * Inside a `(...)` link target only `)` and `\` are special — escaping the rest
 * would corrupt query strings and produce a dead link.
 */
export function escapeMarkdownV2Url(url: string): string {
  return url.replace(/[)\\]/g, (c) => `\\${c}`);
}

export interface CaptionInput {
  quote: string;
  fullName: string;
  articleUrl: string;
  applicationUrl: string;
  siteUrl: string;
  instagramUrl: string;
  /** Without the leading "@". */
  telegramUsername: string;
}

/**
 * Builds the caption exactly in the agreed shape:
 *
 *   *{QUOTE}*
 *
 *   [*{FULL_NAME}*]({ARTICLE_URL})
 *
 *   *LIDERLAR.UZ ensiklopediyasiga kirish uchun [quyidagi havolani bosish orqali ariza qoldiring!]({APPLICATION_URL})*
 *
 *   [Liderlar.uz]({SITE_URL}) | [Instagram]({INSTAGRAM_URL}) | @{TELEGRAM_USERNAME}
 */
export function buildTelegramCaption(input: CaptionInput): string {
  const quote = escapeMarkdownV2(input.quote.trim());
  const name = escapeMarkdownV2(input.fullName.trim());
  const username = escapeMarkdownV2(input.telegramUsername.replace(/^@/, ""));

  const articleUrl = escapeMarkdownV2Url(input.articleUrl);
  const applicationUrl = escapeMarkdownV2Url(input.applicationUrl);
  const siteUrl = escapeMarkdownV2Url(input.siteUrl);
  const instagramUrl = escapeMarkdownV2Url(input.instagramUrl);

  return [
    `*${quote}*`,
    "",
    `[*${name}*](${articleUrl})`,
    "",
    `*LIDERLAR\\.UZ ensiklopediyasiga kirish uchun [quyidagi havolani bosish orqali ariza qoldiring\\!](${applicationUrl})*`,
    "",
    `[Liderlar\\.uz](${siteUrl}) \\| [Instagram](${instagramUrl}) \\| @${username}`,
  ].join("\n");
}

/** Telegram rejects captions over 1024 characters outright. */
export const TELEGRAM_CAPTION_LIMIT = 1024;

export function captionExceedsLimit(caption: string): boolean {
  return [...caption].length > TELEGRAM_CAPTION_LIMIT;
}
