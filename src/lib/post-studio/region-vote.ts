/**
 * KANALDAGI TUGMALI OVOZ BERISH — sof modul.
 *
 * NEGA TELEGRAM SO'ROVNOMASI EMAS:
 *   · bitta so'rovnomaga 12 tadan ko'p variant sig'maydi, hudud
 *     esa 14 ta — ro'yxatni ikkiga bo'lish kerak bo'lardi;
 *   · natija Telegram ichida qoladi, bizning bazamizga tushmaydi.
 *
 * Tugmali ovozda ikkala cheklov ham yo'q.
 *
 * SOF MODUL — tugma yasash, callback o'qish va sanoq matni shu
 * yerda, baza esa `region-vote-service.ts` da.
 */

export interface VoteOption {
  /** `regions.slug` — nom o'zgarsa ham bog'lanish saqlanadi. */
  key: string;
  name: string;
}

export interface VoteButton {
  text: string;
  callback_data: string;
}

/**
 * Callback payload.
 *
 * Telegram uni 64 BAYTDA kesadi. "rv:" + eng uzun slug
 * ("qoraqalpogiston" — 15) = 18 bayt.
 */
const CALLBACK_PREFIX = "rv:";

export function voteCallbackData(optionKey: string): string {
  return `${CALLBACK_PREFIX}${optionKey}`;
}

export function parseVoteCallback(data: string | null | undefined): string | null {
  if (!data || !data.startsWith(CALLBACK_PREFIX)) return null;
  const key = data.slice(CALLBACK_PREFIX.length).trim();
  // Slug shakli: faqat kichik harf, raqam va tire. Boshqasi bizniki
  // emas va bazaga so'rovga aylanmasligi kerak.
  return /^[a-z0-9-]{1,64}$/.test(key) ? key : null;
}

/**
 * Tugma matni: hudud nomi va ovozlar soni.
 *
 * NOL KO'RSATILMAYDI. "Andijon 0" yozuvi bo'sh so'rovda ham
 * "bu yerda hech kim yo'q" degan taassurot beradi va odamlar
 * ko'pchilik tanlagan variantga qarab ovoz berishga moyil bo'ladi.
 * Ovoz paydo bo'lgach son chiqadi.
 */
export function voteButtonLabel(name: string, count: number): string {
  return count > 0 ? `${name} — ${count}` : name;
}

/**
 * Tugmalar panjarasi.
 *
 * IKKI USTUN: hudud nomlari uzun va bir ustunda 14 qator chiqib,
 * kanal lentasini egallab ketardi; uch ustunda esa nom kesiladi.
 */
export const VOTE_COLUMNS = 2;

export function buildVoteKeyboard(
  options: readonly VoteOption[],
  counts: Readonly<Record<string, number>> = {},
): VoteButton[][] {
  const rows: VoteButton[][] = [];
  for (let i = 0; i < options.length; i += VOTE_COLUMNS) {
    rows.push(
      options.slice(i, i + VOTE_COLUMNS).map((option) => ({
        text: voteButtonLabel(option.name, counts[option.key] ?? 0),
        callback_data: voteCallbackData(option.key),
      })),
    );
  }
  return rows;
}

/** Kanalga joylanadigan savol matni. */
export const REGION_VOTE_QUESTION = "Qaysi viloyatdan bizni kuzatyapsiz siz?";

export const REGION_POLL_BUTTON_LABEL = "📊 Hudud so‘rovnomasi";
export const REGION_POLL_COMMAND = "/sorovnoma";

export function buildVoteText(totalVotes: number): string {
  const lines = ["📊 " + REGION_VOTE_QUESTION];
  if (totalVotes > 0) {
    lines.push("", `Jami: ${totalVotes} ta ovoz`);
  }
  return lines.join("\n");
}

/**
 * Tugma bosilganda ovoz beruvchiga ko'rinadigan javob.
 *
 * BU DARHOL CHIQADI va Telegram uni cheklamaydi — xabarni
 * tahrirlash esa sekinroq va tezlik chegarasiga tushadi. Shuning
 * uchun "nechta bo'ldi" degan javob aynan shu yerda beriladi:
 * odam bosgan zahoti natijani ko'radi.
 */
export function buildVoteAck(input: {
  name: string;
  count: number;
  changed: boolean;
}): string {
  const head = input.changed ? "Ovozingiz o‘zgartirildi" : "Ovozingiz qabul qilindi";
  return `✅ ${head}: ${input.name} — ${input.count} ta ovoz`;
}

/** Ovozlar ro'yxatidan sanoq. */
export function tallyVotes(
  votes: readonly { option_key: string }[],
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const vote of votes) {
    counts[vote.option_key] = (counts[vote.option_key] ?? 0) + 1;
  }
  return counts;
}
