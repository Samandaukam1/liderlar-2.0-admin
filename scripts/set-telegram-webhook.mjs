/**
 * Registers the Telegram webhook for the private delivery bot.
 *
 * The bot is never added to a channel — it only talks to people who ran /start
 * — so this is the whole setup: point Telegram at the app's webhook route and
 * hand it the secret the route checks on every update.
 *
 * Run: node scripts/set-telegram-webhook.mjs https://admin.liderlar.uz
 */
const baseUrl = process.argv[2]?.replace(/\/+$/, "");
const token = process.env.TELEGRAM_BOT_TOKEN;
const secret = process.env.TELEGRAM_WEBHOOK_SECRET;

if (!baseUrl) throw new Error("Foydalanish: node scripts/set-telegram-webhook.mjs <https://domen>");
if (!token) throw new Error("TELEGRAM_BOT_TOKEN sozlanmagan");
if (!secret) throw new Error("TELEGRAM_WEBHOOK_SECRET sozlanmagan");

const response = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    url: `${baseUrl}/api/telegram/webhook`,
    secret_token: secret,
    // Only messages matter; the bot has no inline or callback surface.
    allowed_updates: ["message"],
    drop_pending_updates: true,
  }),
});

const payload = await response.json();
console.log(JSON.stringify(payload, null, 2));
if (!payload.ok) process.exitCode = 1;
