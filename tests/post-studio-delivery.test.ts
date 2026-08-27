import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import sharp from "sharp";

import {
  buildTelegramCaption,
  captionExceedsLimit,
  escapeMarkdownV2,
  escapeMarkdownV2Url,
  TELEGRAM_CAPTION_LIMIT,
} from "../src/lib/post-studio/telegram-markdown.ts";
import { pickQuote, rankQuoteCandidates } from "../src/lib/post-studio/quote-source.ts";
import { measureCoverage } from "../src/lib/post-studio/portrait.ts";
import { buildPostLayout } from "../src/lib/post-studio/compose.ts";
import { renderPostImage, toDataUri } from "../src/lib/post-studio/render.ts";
import { splitNameIntoLines } from "../src/lib/post-studio/name-lines.ts";
import { POST_OUTPUT_SIZE } from "../src/lib/post-studio/types.ts";

/* ------------------------------------------------------------------ *
 * Telegram MarkdownV2
 * ------------------------------------------------------------------ */

test("every MarkdownV2 special character is escaped in body text", () => {
  assert.equal(escapeMarkdownV2("a.b-c!d"), "a\\.b\\-c\\!d");
  assert.equal(escapeMarkdownV2("(x) [y] {z}"), "\\(x\\) \\[y\\] \\{z\\}");
  assert.equal(escapeMarkdownV2("a_b*c~d`e"), "a\\_b\\*c\\~d\\`e");
  assert.equal(escapeMarkdownV2("50% > 40% | ok"), "50% \\> 40% \\| ok");
  // Uzbek typography is not a Markdown special and must survive intact.
  assert.equal(escapeMarkdownV2("O‘zbek G‘alaba — “iqtibos”"), "O‘zbek G‘alaba — “iqtibos”");
});

test("link targets escape only the characters that break a link", () => {
  assert.equal(
    escapeMarkdownV2Url("https://liderlar.uz/liderlar/gulnoza-rasuljonova?utm=tg&x=1"),
    "https://liderlar.uz/liderlar/gulnoza-rasuljonova?utm=tg&x=1",
  );
  assert.equal(escapeMarkdownV2Url("https://x.uz/a)b"), "https://x.uz/a\\)b");
});

test("the caption follows the agreed four-block shape", () => {
  const caption = buildTelegramCaption({
    quote: "Orzular tomon yurish shart. Vaqt o‘tib ketadi!",
    fullName: "Rasuljonova Gulnoza Avazjon qizi",
    articleUrl: "https://liderlar.uz/liderlar/rasuljonova-gulnoza",
    applicationUrl: "https://liderlar.uz/ariza",
    siteUrl: "https://liderlar.uz",
    instagramUrl: "https://instagram.com/liderlar.uz",
    telegramUsername: "@liderlaruz",
  });

  const blocks = caption.split("\n\n");
  assert.equal(blocks.length, 4);

  // 1. bold quote, fully escaped
  assert.equal(blocks[0], "*Orzular tomon yurish shart\\. Vaqt o‘tib ketadi\\!*");
  // 2. bold name linking to the canonical article
  assert.equal(
    blocks[1],
    "[*Rasuljonova Gulnoza Avazjon qizi*](https://liderlar.uz/liderlar/rasuljonova-gulnoza)",
  );
  // 3. the application call-to-action
  assert.match(blocks[2], /^\*LIDERLAR\\\.UZ ensiklopediyasiga kirish uchun \[/);
  assert.ok(blocks[2].includes("(https://liderlar.uz/ariza)"));
  // 4. footer with escaped pipes
  assert.equal(
    blocks[3],
    "[Liderlar\\.uz](https://liderlar.uz) \\| [Instagram](https://instagram.com/liderlar.uz) \\| @liderlaruz",
  );
  // The leading "@" the admin may type must not be doubled.
  assert.ok(!caption.includes("@@"));
});

test("an over-long caption is detected before Telegram rejects it", () => {
  const caption = buildTelegramCaption({
    quote: "x".repeat(1200),
    fullName: "Ism",
    articleUrl: "https://liderlar.uz/a",
    applicationUrl: "https://liderlar.uz/ariza",
    siteUrl: "https://liderlar.uz",
    instagramUrl: "https://instagram.com/l",
    telegramUsername: "liderlaruz",
  });
  assert.equal(captionExceedsLimit(caption), true);
  assert.equal(TELEGRAM_CAPTION_LIMIT, 1024);
  assert.equal(captionExceedsLimit("qisqa"), false);
});

/* ------------------------------------------------------------------ *
 * Quote priority
 * ------------------------------------------------------------------ */

test("quotes are ranked featured -> article -> motto -> manual", () => {
  const ranked = rankQuoteCandidates([
    { text: "Qo‘lda", source: "manual" },
    { text: "Shior", source: "life_motto" },
    { text: "Tanlangan", source: "featured_quote" },
    { text: "Maqoladan", source: "article_quote" },
  ]);
  assert.deepEqual(
    ranked.map((q) => q.source),
    ["featured_quote", "article_quote", "life_motto", "manual"],
  );
  assert.equal(pickQuote(ranked)?.text, "Tanlangan");
});

test("blank and duplicate quotes are dropped, and none are invented", () => {
  const ranked = rankQuoteCandidates([
    { text: "  ", source: "featured_quote" },
    { text: "Bir xil", source: "life_motto" },
    { text: "bir xil", source: "manual" },
  ]);
  assert.equal(ranked.length, 1);
  assert.equal(pickQuote([]), null);
});

/* ------------------------------------------------------------------ *
 * Portrait
 * ------------------------------------------------------------------ */

test("a transparent cut-out keeps its alpha and reports plausible coverage", async () => {
  const cutout = await sharp({
    create: { width: 200, height: 400, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([
      {
        input: await sharp({
          create: { width: 100, height: 200, channels: 4, background: { r: 40, g: 60, b: 80, alpha: 1 } },
        })
          .png()
          .toBuffer(),
        top: 100,
        left: 50,
      },
    ])
    .png()
    .toBuffer();

  const metadata = await sharp(cutout).metadata();
  assert.equal(metadata.hasAlpha, true, "alpha channel preserved");

  // 100x200 opaque out of 200x400 = 25% of the frame.
  const coverage = await measureCoverage(cutout);
  assert.ok(Math.abs(coverage - 0.25) < 0.02, `coverage ${coverage}`);
});

test("an empty or fully opaque matte is outside the accepted quality band", async () => {
  const empty = await sharp({
    create: { width: 100, height: 100, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .png()
    .toBuffer();
  const solid = await sharp({
    create: { width: 100, height: 100, channels: 4, background: { r: 10, g: 10, b: 10, alpha: 1 } },
  })
    .png()
    .toBuffer();

  // MIN_COVERAGE is 0.08 and MAX_COVERAGE 0.88 in portrait.ts.
  assert.ok((await measureCoverage(empty)) < 0.08, "a blank matte is rejected");
  assert.ok((await measureCoverage(solid)) > 0.88, "an untouched photo is rejected");
});

/* ------------------------------------------------------------------ *
 * End-to-end render
 * ------------------------------------------------------------------ */

test("a post renders as a 1080x1080 PNG with a 320px thumbnail", async () => {
  const portrait = await sharp({
    create: { width: 380, height: 620, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([
      {
        input: await sharp({
          create: { width: 240, height: 460, channels: 4, background: { r: 45, g: 60, b: 80, alpha: 1 } },
        })
          .png()
          .toBuffer(),
        top: 160,
        left: 70,
      },
    ])
    .png()
    .toBuffer();

  const layout = buildPostLayout({
    templateId: "template-04",
    quote: "Har qanday sharoitda o‘z ustingda ishlash va boshlagan yo‘lingdan davom etish",
    nameLines: splitNameIntoLines("Rasuljonova Gulnoza Avazjon qizi"),
    shortBioItems: ["Psixologiya talabasi", "Ijodkor", "Yosh volontyor"],
    portraitHref: toDataUri(portrait, "image/png"),
    portraitTransform: { offsetX: 0, offsetY: 0, scale: 1, flip: false },
  });

  assert.equal(layout.needsReview, false, layout.warnings.map((w) => w.code).join(","));

  const rendered = await renderPostImage(layout);
  assert.equal(rendered.width, POST_OUTPUT_SIZE);

  const meta = await sharp(rendered.png).metadata();
  assert.equal(meta.width, 1080);
  assert.equal(meta.height, 1080);
  assert.equal(meta.format, "png");

  const thumb = await sharp(rendered.thumbnail).metadata();
  assert.equal(thumb.width, 320);
  assert.equal(thumb.format, "webp");
});

/* ------------------------------------------------------------------ *
 * Schema, scheduling and runtime guarantees
 * ------------------------------------------------------------------ */

const MIGRATION = fs.readFileSync(
  "supabase/migrations/20260827120000_post_studio_and_telegram_bot.sql",
  "utf8",
);

test("the pipeline is scheduled two hours after submission, not by a timer", () => {
  assert.match(MIGRATION, /post_pipeline_process_after\s*:=\s*new\.submitted_at \+ interval '2 hours'/);
  assert.match(MIGRATION, /trg_intake_pipeline_schedule/);
  // Vercel Cron is what actually wakes the pipeline up.
  const vercelConfig = JSON.parse(fs.readFileSync("vercel.json", "utf8"));
  assert.equal(vercelConfig.crons[0].path, "/api/cron/post-pipeline");
  assert.ok(vercelConfig.crons[0].schedule.length > 0);
});

test("a stalled run is retried a bounded number of times", () => {
  // pipeline.ts pulls in the whole server graph via "@/" aliases, so the retry
  // budget is asserted from source rather than by importing the module.
  const pipeline = fs.readFileSync("src/lib/post-studio/pipeline.ts", "utf8");
  const attempts = Number(pipeline.match(/PIPELINE_MAX_ATTEMPTS = (\d+)/)?.[1]);
  assert.ok(attempts >= 2 && attempts <= 5, `retry budget is ${attempts}`);

  // The claim step both increments the counter and acts as the lock, so two
  // overlapping cron ticks cannot process the same intake twice.
  assert.match(pipeline, /post_pipeline_attempts: intake\.post_pipeline_attempts \+ 1/);
  assert.match(pipeline, /\.in\("post_pipeline_status", \["pending", "failed"\]\)/);
  assert.match(pipeline, /\.lt\("post_pipeline_attempts", PIPELINE_MAX_ATTEMPTS\)/);
  assert.match(MIGRATION, /post_pipeline_attempts integer not null default 0/);
});

test("a subscriber can never receive the same post twice", () => {
  // The partial unique index is the real guarantee; the skip list in
  // deliverPostToSubscribers is the fast path in front of it.
  assert.match(
    MIGRATION,
    /create unique index if not exists uq_tg_delivery_once\s+on public\.telegram_post_deliveries\(post_id, subscriber_id\)\s+where status = 'sent'/,
  );
  const telegram = fs.readFileSync("src/lib/post-studio/telegram.ts", "utf8");
  assert.match(telegram, /alreadySent\.has\(id\)/);
});

test("subscribers are keyed uniquely so a repeated /start updates instead of duplicating", () => {
  assert.match(MIGRATION, /telegram_user_id bigint not null unique/);
  assert.match(MIGRATION, /chat_id bigint not null unique/);
  const telegram = fs.readFileSync("src/lib/post-studio/telegram.ts", "utf8");
  assert.match(telegram, /onConflict: "telegram_user_id"/);
});

test("post and subscriber tables are closed to public clients", () => {
  for (const table of [
    "candidate_social_posts",
    "telegram_post_subscribers",
    "telegram_post_deliveries",
  ]) {
    assert.match(
      MIGRATION,
      new RegExp(`alter table public\\.${table} enable row level security`),
      `${table} has RLS`,
    );
  }
  // No policy grants anon/public write access.
  assert.ok(!/to anon/.test(MIGRATION));
});

test("server routes pin the Node runtime and guard their entry points", () => {
  const webhook = fs.readFileSync("src/app/api/telegram/webhook/route.ts", "utf8");
  const cron = fs.readFileSync("src/app/api/cron/post-pipeline/route.ts", "utf8");
  const preview = fs.readFileSync(
    "src/app/api/admin/post-studio/[postId]/preview/route.ts",
    "utf8",
  );

  for (const [name, source] of [["webhook", webhook], ["cron", cron], ["preview", preview]] as const) {
    assert.match(source, /export const runtime = "nodejs"/, `${name} runs on Node`);
  }
  assert.match(webhook, /x-telegram-bot-api-secret-token/, "webhook checks the secret token");
  assert.match(cron, /CRON_SECRET/, "cron checks its secret");
  assert.match(preview, /checkPermission\("posts\.view"\)/, "preview checks permission");
});

test("the bot token never leaves the server", () => {
  const clientFiles = [
    "src/app/(admin)/postlar/[postId]/studio-client.tsx",
    "src/app/(admin)/postlar/post-list-filters.tsx",
    "src/components/post-studio/preview-canvas.tsx",
  ];
  for (const file of clientFiles) {
    const source = fs.readFileSync(file, "utf8");
    assert.ok(!source.includes("TELEGRAM_BOT_TOKEN"), `${file} has no bot token`);
    assert.ok(!/process\.env\.(?!NEXT_PUBLIC_)/.test(source), `${file} reads no server env`);
  }
  const telegram = fs.readFileSync("src/lib/post-studio/telegram.ts", "utf8");
  assert.match(telegram, /^import "server-only";/m);
});

test("the Post Studio layout is responsive rather than desktop-only", () => {
  const studio = fs.readFileSync("src/app/(admin)/postlar/[postId]/studio-client.tsx", "utf8");
  // Single column by default, three panels only from the lg breakpoint up.
  assert.match(studio, /grid gap-4 lg:grid-cols-\[260px_minmax\(0,1fr\)_320px\]/);
  const list = fs.readFileSync("src/app/(admin)/postlar/page.tsx", "utf8");
  assert.match(list, /overflow-x-auto/, "the list table scrolls on narrow screens");
});

test("the post list never loads full-size renders", () => {
  const repository = fs.readFileSync("src/lib/post-studio/repository.ts", "utf8");
  const listColumns = repository.match(/const LIST_COLUMNS =\s*([\s\S]*?);/)?.[1] ?? "";
  assert.ok(listColumns.includes("rendered_thumbnail_url"));
  assert.ok(!listColumns.includes("rendered_image_url"), "no 1080x1080 URL in the list query");
  // And no select("*") anywhere in the module.
  assert.ok(!/\.select\("\*"\)/.test(repository));
});

test("an older candidate with no structured extras still produces a layout", () => {
  // description_items empty, no quotes, no portrait — the pre-v2 shape.
  const layout = buildPostLayout({
    templateId: "template-06",
    quote: "Eski nomzod uchun shior",
    nameLines: splitNameIntoLines("Karimov Anvar"),
    shortBioItems: [],
    portraitHref: null,
    portraitTransform: { offsetX: 0, offsetY: 0, scale: 1, flip: false },
  });

  assert.equal(layout.name.lines.length, 2);
  assert.equal(layout.shortBio.lines.length, 0);
  assert.ok(layout.quote.lines.length > 0);
  // It is flagged for review (no portrait) rather than crashing or auto-publishing.
  assert.equal(layout.needsReview, true);
  assert.ok(layout.warnings.some((w) => w.code === "portrait_missing"));
});

test("the /start and /stop flow replies in Uzbek and toggles is_active", () => {
  const telegram = fs.readFileSync("src/lib/post-studio/telegram.ts", "utf8");

  assert.ok(telegram.includes("Assalomu alaykum! 👋"), "/start greeting");
  assert.ok(
    telegram.includes("post yetkazib beruvchi botiga muvaffaqiyatli ulandingiz."),
    "/start confirmation",
  );
  assert.ok(telegram.includes("Obunani to‘xtatish: /stop"), "/start explains /stop");
  assert.ok(
    telegram.includes("Post xabarnomalari to‘xtatildi. Qayta ulanish uchun /start yuboring."),
    "/stop reply",
  );
  assert.ok(telegram.includes("/start — postlarni olish"), "help reply");

  // /start re-activates, /stop deactivates and stamps stopped_at.
  assert.match(telegram, /is_active: true,\s*\n\s*started_at:/);
  assert.match(telegram, /is_active: false, stopped_at: new Date\(\)\.toISOString\(\)/);
});

test("a command sent in a group keeps working", async () => {
  const { parseTelegramCommand } = await import(
    "../src/lib/post-studio/telegram-command.ts"
  );
  assert.equal(parseTelegramCommand("/start"), "/start");
  assert.equal(parseTelegramCommand("/start@liderlaruz_bot"), "/start");
  assert.equal(parseTelegramCommand("  /STOP  "), "/stop");
  assert.equal(parseTelegramCommand("/start salom"), "/start");
  assert.equal(parseTelegramCommand("salom"), "salom");
  assert.equal(parseTelegramCommand(undefined), "");
});

test("a database failure never silences the bot", () => {
  const telegram = fs.readFileSync("src/lib/post-studio/telegram.ts", "utf8");

  // The upsert/deactivate calls must be inside try/catch, with the reply after
  // the catch — a bare `await upsertSubscriber(...)` in front of sendMessage is
  // exactly what made /start return nothing when the table was unreachable.
  const startBlock = telegram.slice(
    telegram.indexOf('if (command === "/start")'),
    telegram.indexOf('if (command === "/stop")'),
  );
  assert.match(startBlock, /try \{[\s\S]*await upsertSubscriber\([\s\S]*\} catch/);
  assert.match(startBlock, /\} catch[\s\S]*await sendTelegramMessage\(chatId, START_REPLY\)/);

  // Any unknown text still gets an answer.
  assert.match(telegram, /await sendTelegramMessage\(chatId, HELP_REPLY\)/);
});

test("machine callers are exempt from the admin session redirect", () => {
  // Telegram and Vercel Cron have no cookie jar and cannot follow a 307 to
  // /login; both authenticate inside their own route instead.
  const proxy = fs.readFileSync("src/proxy.ts", "utf8");
  const machinePaths = proxy.match(/const MACHINE_PATHS = \[([\s\S]*?)\];/)?.[1] ?? "";
  assert.ok(machinePaths.includes('"/api/telegram"'), "telegram webhook is exempt");
  assert.ok(machinePaths.includes('"/api/cron"'), "cron is exempt");

  // The exemption must come before the session lookup, so a Supabase auth
  // outage cannot stop the bot from replying.
  const shortCircuit = proxy.indexOf("MACHINE_PATHS.some");
  const sessionLookup = proxy.indexOf("supabase.auth.getUser()");
  assert.ok(shortCircuit > 0 && shortCircuit < sessionLookup, "exemption precedes auth");
});

test("the webhook checks its secret in constant time and awaits the reply", () => {
  const route = fs.readFileSync("src/app/api/telegram/webhook/route.ts", "utf8");
  assert.match(route, /timingSafeEqual/);
  assert.match(route, /x-telegram-bot-api-secret-token/);
  // The update is fully handled before the 200 goes back to Telegram.
  assert.match(route, /await handleTelegramUpdate\(/);
  assert.match(route, /\[telegram-webhook\] update received/);
  // The token itself is never logged.
  assert.ok(!/console\.[a-z]+\([^)]*TELEGRAM_BOT_TOKEN\b[^)]*\$\{/.test(route));
});

test("a failed Telegram API call logs its response body, never the token", () => {
  const telegram = fs.readFileSync("src/lib/post-studio/telegram.ts", "utf8");
  assert.match(telegram, /\[telegram-api\] \$\{method\} failed status=/);
  assert.match(telegram, /body=\$\{raw\.slice\(0, 500\)\}/);
  // The request URL embeds the bot token, so it must not be interpolated in.
  assert.ok(!/console\.error\([^)]*TELEGRAM_API/.test(telegram));
});

test("a blocked or deleted chat deactivates that subscriber instead of retrying forever", () => {
  const telegram = fs.readFileSync("src/lib/post-studio/telegram.ts", "utf8");
  assert.match(telegram, /if \(this\.errorCode === 403\) return true/);
  assert.match(telegram, /chat not found\|user is deactivated/);
  assert.match(telegram, /if \(error\?\.isPermanent\) await deactivateSubscriberById\(id\)/);
  // One failure must not abort the fan-out.
  assert.match(telegram, /result\.failed \+= 1;/);
});

test("every delivery attempt is logged with its outcome", () => {
  const telegram = fs.readFileSync("src/lib/post-studio/telegram.ts", "utf8");
  for (const field of ["post_id", "subscriber_id", "telegram_message_id", "status", "error"]) {
    assert.ok(telegram.includes(field), `delivery row records ${field}`);
  }
  assert.match(MIGRATION, /sent_at timestamptz not null default now\(\)/);
});

test("a scheduled post is actually sent when its time arrives", () => {
  const cron = fs.readFileSync("src/app/api/cron/post-pipeline/route.ts", "utf8");
  assert.match(cron, /sendDueScheduledPosts\(\)/, "the cron sweeps scheduled posts");

  const scheduler = fs.readFileSync("src/lib/post-studio/scheduler.ts", "utf8");
  assert.match(scheduler, /\.eq\("status", "scheduled"\)/);
  assert.match(scheduler, /\.lte\("scheduled_at", new Date\(\)\.toISOString\(\)\)/);
  // A partial send must resume, not duplicate: delivery skips 'sent' rows.
  assert.match(scheduler, /deliverPostToSubscribers\(/);
  // Missing caption or render parks the post instead of sending something broken.
  assert.match(scheduler, /status: "needs_review"/);
});
