/**
 * CAPTIONGA REKLAMA QATORI — SOF MODUL.
 *
 * Reklama nomzod ismi bilan BIR XIL shaklda qo'shiladi: `[*Matn*](havola)`.
 * Ism qatori `telegram-markdown.ts` da shunday yig'iladi; o'quvchi uchun
 * ikkalasi bir xil "qalin, bosiladigan" qator bo'lib ko'rinadi.
 *
 * NEGA SAQLANGAN CAPTIONGA YOZILMAYDI: `telegram_caption` besh xil sababdan
 * qayta yig'iladi (saqlash, qayta render, havola, qayta yaratish, pipeline).
 * Reklama o'sha matnda tursa, har qayta yig'ishda navbat buzilar yoki ikki
 * marta chiqar edi. Shuning uchun u yuborish lahzasida shu yerda qo'shiladi.
 *
 * CHEGARA: Telegram 1024 belgidan oshgan captionni butunlay rad etadi.
 * Sig'masa reklama TUSHIB QOLADI — hech qachon qirqilmaydi (MarkdownV2
 * havolasini o'rtasidan qirqish butun yuborishni buzadi) va xato ham
 * tashlanmaydi (pipeline-retry uni uch marta qayta urintirardi).
 *
 * Testlar `../src/...ts` deb import qiladi — shuning uchun `@/` yo'q.
 */

import { escapeMarkdownV2, escapeMarkdownV2Url, TELEGRAM_CAPTION_LIMIT } from "./telegram-markdown.ts";

export interface CaptionAd {
  id: string;
  text: string;
  url: string;
}

/** `end` — postning eng oxiri; `before_footer` — "Liderlar.uz | Instagram" qatoridan oldin. */
export type AdPosition = "end" | "before_footer";

export interface ComposedCaption {
  caption: string;
  applied: boolean;
  reason?: "no_ad" | "caption_limit";
}

/** Nomzod ismi qatori bilan bir xil shakl. */
export function buildAdLine(ad: Pick<CaptionAd, "text" | "url">): string {
  return `[*${escapeMarkdownV2(ad.text.trim())}*](${escapeMarkdownV2Url(ad.url.trim())})`;
}

function insertLine(caption: string, line: string, position: AdPosition): string {
  const base = caption.replace(/\s+$/, "");
  if (!base) return line;
  if (position === "before_footer") {
    // Caption admin tomonidan erkin tahrirlangan bo'lishi mumkin, shuning
    // uchun "to'rt blok" deb taxmin qilinmaydi: oxirgi blokdan oldin qo'yiladi,
    // blok bitta bo'lsa oxiriga.
    const blocks = base.split("\n\n");
    if (blocks.length >= 2) {
      blocks.splice(blocks.length - 1, 0, line);
      return blocks.join("\n\n");
    }
  }
  return `${base}\n\n${line}`;
}

export function appendAdToCaption(
  caption: string,
  ad: CaptionAd | null | undefined,
  position: AdPosition = "end",
): ComposedCaption {
  if (!ad) return { caption, applied: false, reason: "no_ad" };
  const composed = insertLine(caption, buildAdLine(ad), position);
  if ([...composed].length > TELEGRAM_CAPTION_LIMIT) {
    return { caption, applied: false, reason: "caption_limit" };
  }
  return { caption: composed, applied: true };
}

/** Studio hisoblagichi uchun: reklama bilan uzunlik (chegaradan oshsa ham hisoblaydi). */
export function captionLengthWithAd(
  caption: string,
  ad: CaptionAd | null | undefined,
  position: AdPosition = "end",
): number {
  if (!ad) return [...caption].length;
  return [...insertLine(caption, buildAdLine(ad), position)].length;
}
