/**
 * Bot command parsing — pure, so the group-suffix and casing rules are covered
 * by real unit tests instead of a source-text assertion.
 */

/**
 * Extracts the command from a message's text.
 *
 * Telegram appends "@botname" to commands sent in groups, so
 * "/start@liderlaruz_bot" has to subscribe exactly like a plain "/start".
 * Anything that is not a command comes back as its own first word, which the
 * handler answers with the help text rather than ignoring.
 */
export function parseTelegramCommand(text: string | undefined | null): string {
  const first = (text ?? "").trim().split(/\s+/)[0];
  if (!first) return "";
  return first.toLowerCase().replace(/@[a-z0-9_]+$/i, "");
}
