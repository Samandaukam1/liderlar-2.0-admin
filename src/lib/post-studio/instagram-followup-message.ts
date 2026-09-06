/**
 * Instagram follow-up xabari — sof modul.
 *
 * Xabar ATAYLAB oddiy matn (payment-messages.ts dagi kabi): MarkdownV2 bo'lsa,
 * username ichidagi bitta pastki chiziq yoki nuqta butun yuborishni 400 bilan
 * yiqitadi.
 */

/**
 * The message sent right after a candidate's post reaches Telegram.
 *
 * Kept as a builder rather than an inline template so the exact wording — and
 * the fact that the handle always carries its "@" — is covered by a real test.
 */
export function buildInstagramFollowUpText(username: string): string {
  return ["📸 Instagram:", `@${username}`, "", "Collaboration post uchun."].join("\n");
}
