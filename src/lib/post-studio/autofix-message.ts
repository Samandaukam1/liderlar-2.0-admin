/**
 * "Avtomatik tuzatildi" xabari — SOF modul.
 *
 * Xabar ATAYLAB formatsiz oddiy matn: ichida ism va xato matni bor,
 * ikkalasi ham erkin matn, va MarkdownV2'da ulardagi bitta nuqta yoki
 * chiziqcha butun yuborishni 400 bilan yiqitardi.
 */

import { pipelineStageLabel, splitPipelineError } from "./pipeline-stages.ts";

export interface AutofixNoticeInput {
  fullName: string;
  /** Oldingi to'xtash matni — `fail()` yozgan "<bosqich>: <matn>" shakli. */
  previousError: string | null;
  /** Maqola havolasi; yo'q bo'lsa qator chiqmaydi. */
  articleUrl?: string | null;
}

/**
 * Ism BOSH HARFLARDA — chat kun davomida o'nlab xabar bilan to'ladi va
 * bu xabarning butun ma'nosi "KIM" degan savolda.
 *
 * Locale BERILMAYDI: o'zbek lotinida "i" ning bosh harfi "I", turkchadagi
 * kabi "İ" emas.
 */
function upper(name: string): string {
  return name.trim().replace(/\s+/g, " ").toUpperCase();
}

/**
 * Tahririyatga yuboriladigan xabar.
 *
 * Nima bo'lgani YASHIRILMAYDI: qaysi bosqich to'xtagani aytiladi.
 * "Hammasi joyida" deb jim o'tish tizimga bo'lgan ishonchni yo'qotadi —
 * muharrir keyin o'sha postni o'zi tekshirishga majbur bo'lardi.
 */
export function buildAutofixNotice(input: AutofixNoticeInput): string {
  const { stage } = splitPipelineError(input.previousError);
  const lines = [
    "🔧 AVTOMATIK TUZATILDI",
    "",
    `👤 ${upper(input.fullName) || "(ISMI YO‘Q)"}`,
  ];

  if (stage) lines.push(`Xato: ${pipelineStageLabel(stage)}`);

  const url = (input.articleUrl ?? "").trim();
  if (url) lines.push(`🔗 ${url}`);

  lines.push("", "Maqola nashr qilindi va post botga yuborildi.");
  return lines.join("\n");
}
