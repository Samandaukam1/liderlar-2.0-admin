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
import {
  enhancePortraitColor,
  measureCoverage,
  POST_PORTRAIT_SATURATION,
  validateTransparentPortrait,
} from "../src/lib/post-studio/portrait.ts";
import { buildPostLayout } from "../src/lib/post-studio/compose.ts";
import { renderPostImage, toDataUri } from "../src/lib/post-studio/render.ts";
import { splitNameIntoLines } from "../src/lib/post-studio/name-lines.ts";
import { buildOverlaySvgBody } from "../src/lib/post-studio/svg.ts";
import { POST_OUTPUT_SIZE, POST_TEMPLATE_IDS } from "../src/lib/post-studio/types.ts";
import {
  CANONICAL_POST_QUOTE_HELP_TEXT,
  CANONICAL_POST_QUOTE_KEY,
  isCanonicalPostQuoteQuestion,
  preserveCanonicalPostQuote,
} from "../src/lib/intake/canonical-quote.ts";

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

test("only the canonical intake quote can seed an automatic post", () => {
  const ranked = rankQuoteCandidates([
    { text: "Qo‘lda", source: "manual" },
    { text: "Shior", source: "life_motto" },
    { text: "Tanlangan", source: "featured_quote" },
    { text: "Maqoladan", source: "article_quote" },
    { text: "Nomzodning 15-savol javobi", source: "intake_quote" },
  ]);
  assert.equal(ranked[0].source, "intake_quote");
  assert.equal(pickQuote(ranked)?.text, "Nomzodning 15-savol javobi");
  assert.equal(
    pickQuote([{ text: "Maqoladan taxmin", source: "article_quote" }]),
    null,
  );
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

test("canonical quote identity survives question reordering and preserves the raw idea", () => {
  assert.equal(
    isCanonicalPostQuoteQuestion({
      canonical_key: CANONICAL_POST_QUOTE_KEY,
      question_no: 22,
      prompt: "Tahrirlangan ko‘rinish",
    }),
    true,
  );
  assert.equal(
    isCanonicalPostQuoteQuestion({
      canonical_key: null,
      question_no: 7,
      prompt: "Boshqa yoshlar uchun qanday maslahat yoki motivatsion fikr bildirasiz?",
    }),
    true,
  );
  assert.equal(
    preserveCanonicalPostQuote("  Xatolar yo‘lning bir qismidir,\n muvaffaqiyatsizlik emas.  "),
    "Xatolar yo‘lning bir qismidir, muvaffaqiyatsizlik emas.",
  );

  const migration = fs.readFileSync(
    "supabase/migrations/20260827220000_canonical_intake_quote.sql",
    "utf8",
  );
  assert.match(migration, /canonical_key = 'post_quote'/);

  // The instruction itself was rewritten later, so the live wording lives in
  // the migration that last set it — checking the original would pin the text
  // to whatever it happened to say first.
  const hintMigration = fs.readFileSync(
    "supabase/migrations/20260905030000_quote_hint_and_blacklist.sql",
    "utf8",
  );
  assert.match(hintMigration, /canonical_key = 'post_quote'/);

  // The migration builds the text with SQL `||`, so the file never contains it
  // as one string. Rebuilding it here is what keeps the database wording and
  // the constant from drifting apart — the candidate reads the database one.
  const setBlock = hintMigration.slice(
    hintMigration.indexOf("set help_text ="),
    hintMigration.indexOf("where canonical_key = 'post_quote'"),
  );
  const rebuilt = (setBlock.match(/'([^']*)'/g) ?? [])
    .map((literal) => literal.slice(1, -1))
    .join("");
  assert.equal(rebuilt, CANONICAL_POST_QUOTE_HELP_TEXT);
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

test("the portrait is desaturated to greyscale while the alpha channel survives byte-for-byte", async () => {
  const cutout = await sharp({
    create: {
      width: 120,
      height: 180,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([
      {
        input: await sharp({
          create: {
            width: 70,
            height: 130,
            channels: 4,
            background: { r: 120, g: 80, b: 70, alpha: 0.72 },
          },
        })
          .png()
          .toBuffer(),
        top: 40,
        left: 25,
      },
    ])
    .png()
    .toBuffer();

  const enhanced = await enhancePortraitColor(cutout);
  assert.equal(enhanced.saturation, POST_PORTRAIT_SATURATION);
  assert.deepEqual(
    await sharp(enhanced.buffer).extractChannel("alpha").raw().toBuffer(),
    await sharp(cutout).extractChannel("alpha").raw().toBuffer(),
    "alpha bytes are unchanged",
  );
  assert.notDeepEqual(
    await sharp(enhanced.buffer).removeAlpha().raw().toBuffer(),
    await sharp(cutout).removeAlpha().raw().toBuffer(),
    "RGB pixels receive the saturation pass",
  );

  // Saturation 0 is the art direction, not a colour lift: every opaque pixel
  // has to come out neutral, or the poster gets a colour portrait back.
  assert.equal(POST_PORTRAIT_SATURATION, 0);
  const { data, info } = await sharp(enhanced.buffer)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += info.channels) {
    assert.ok(
      Math.abs(data[i] - data[i + 1]) <= 1 && Math.abs(data[i + 1] - data[i + 2]) <= 1,
      `pixel ${i / info.channels} is neutral: ${data[i]},${data[i + 1]},${data[i + 2]}`,
    );
  }

  const validated = await validateTransparentPortrait(enhanced.buffer);
  assert.ok(validated.coverage > 0 && validated.coverage < 0.88);
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

test("all six templates render a visible portrait layer inside the canvas", async () => {
  const portrait = await sharp({
    create: {
      width: 300,
      height: 600,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([
      {
        input: await sharp({
          create: {
            width: 230,
            height: 520,
            channels: 4,
            background: { r: 244, g: 90, b: 42, alpha: 1 },
          },
        })
          .png()
          .toBuffer(),
        top: 80,
        left: 35,
      },
    ])
    .png()
    .toBuffer();
  const href = toDataUri(portrait, "image/png");

  for (const templateId of POST_TEMPLATE_IDS) {
    const input = {
      templateId,
      quote: "Xatolar yo‘lning bir qismidir, muvaffaqiyatsizlik emas.",
      nameLines: ["TEST", "NOMZOD"],
      shortBioItems: ["Mutaxassis", "Ijodkor", "Lider"],
      portraitTransform: { offsetX: 0, offsetY: 0, scale: 1, flip: false },
    };
    const withPortrait = buildPostLayout({ ...input, portraitHref: href });
    const withoutPortrait = buildPostLayout({ ...input, portraitHref: null });

    assert.ok(withPortrait.portrait.width > 0, `${templateId}: width`);
    assert.ok(withPortrait.portrait.height > 0, `${templateId}: height`);
    assert.ok(withPortrait.portrait.x < 810, `${templateId}: x inside canvas`);
    assert.ok(withPortrait.portrait.y < 810, `${templateId}: y inside canvas`);

    const overlay = buildOverlaySvgBody(withPortrait);
    assert.ok(overlay.includes("<image "), `${templateId}: image layer exists`);
    assert.ok(
      overlay.indexOf("<image ") < overlay.indexOf("<text "),
      `${templateId}: portrait is below copy but above the baked background`,
    );

    const [renderedWith, renderedWithout] = await Promise.all([
      renderPostImage(withPortrait),
      renderPostImage(withoutPortrait),
    ]);
    const [pixelsWith, pixelsWithout] = await Promise.all([
      sharp(renderedWith.png).raw().toBuffer(),
      sharp(renderedWithout.png).raw().toBuffer(),
    ]);
    let changed = 0;
    for (let i = 0; i < pixelsWith.length; i += 4) {
      if (
        pixelsWith[i] !== pixelsWithout[i] ||
        pixelsWith[i + 1] !== pixelsWithout[i + 1] ||
        pixelsWith[i + 2] !== pixelsWithout[i + 2]
      ) {
        changed += 1;
      }
    }
    assert.ok(changed > 40_000, `${templateId}: portrait visibly changes ${changed} pixels`);
  }
});

test("preview and final renderer consume the same stored portrait asset", () => {
  const service = fs.readFileSync("src/lib/post-studio/service.ts", "utf8");
  const preview = fs.readFileSync("src/components/post-studio/preview-canvas.tsx", "utf8");
  assert.match(service, /portraitHref: previewPortraitHref/);
  assert.match(service, /downloadPostAsset\(post\.candidateId, "portrait-transparent"\)/);
  assert.match(preview, /buildOverlaySvgBody\(layout/);
  assert.match(preview, /dangerouslySetInnerHTML=\{\{ __html: overlay \}\}/);
});

test("every studio render regenerates Telegram caption from the same post quote", () => {
  const actions = fs.readFileSync("src/lib/actions/post-studio.ts", "utf8");
  const saveBlock = actions.slice(
    actions.indexOf("export async function savePostContentAction"),
    actions.indexOf("export async function rerenderPostAction"),
  );
  const rerenderBlock = actions.slice(
    actions.indexOf("export async function rerenderPostAction"),
    actions.indexOf("export async function preparePortraitAction"),
  );
  assert.match(saveBlock, /renderAndStorePost[\s\S]*refreshPostCaption\(result\.post\)/);
  assert.match(rerenderBlock, /renderAndStorePost[\s\S]*refreshPostCaption\(result\.post\)/);
});

test("portrait selection uses explicit intake metadata and authenticated storage download", () => {
  const repository = fs.readFileSync("src/lib/post-studio/repository.ts", "utf8");
  assert.match(repository, /\.eq\("is_primary_photo", true\)/);
  assert.match(repository, /selectedOriginalAttachmentId/);
  assert.match(repository, /selectedPhotoEditId/);
  assert.match(repository, /\.from\(source\.bucket\)\.download\(source\.path\)/);
  assert.ok(!repository.includes('.select("storage_path")'), "real schema column is path");
  assert.match(repository, /supabase-storage:\/\//);

  const service = fs.readFileSync("src/lib/post-studio/service.ts", "utf8");
  assert.ok(!service.includes("source.url"), "service does not log or persist signed URLs");
  assert.match(service, /\[post-studio\] \$\{message\}/);
  for (const stage of [
    "source portrait found",
    "portrait downloaded",
    "background removed",
    "saturation applied",
    "portrait stored",
    "portrait attached to layout",
    "render complete",
  ]) {
    assert.ok(service.includes(`postStudioLog("${stage}"`), `${stage} is observable`);
  }
  assert.ok(
    service.includes('"Portret fonini olib tashlash amalga oshmadi"'),
    "failed removal has the required admin-facing message",
  );
  assert.match(service, /status: "needs_review"/);
  assert.match(
    service,
    /const portraitWarning = allWarnings\.find[\s\S]*error: portraitWarning\?\.message \?\? null/,
    "rendering a review proof must not clear the portrait failure message",
  );
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
  // The conversation lives in bot-router.ts; telegram.ts owns the subscriber
  // rows those replies talk about.
  const router = fs.readFileSync("src/lib/post-studio/bot-router.ts", "utf8");
  const telegram = fs.readFileSync("src/lib/post-studio/telegram.ts", "utf8");

  assert.ok(router.includes("Assalomu alaykum! 👋"), "/start greeting");
  assert.ok(
    router.includes("post yetkazib beruvchi botiga muvaffaqiyatli ulandingiz."),
    "/start confirmation",
  );
  assert.ok(router.includes("Obunani to‘xtatish: /stop"), "/start explains /stop");
  assert.ok(
    router.includes("Post xabarnomalari to‘xtatildi. Qayta ulanish uchun /start yuboring."),
    "/stop reply",
  );
  assert.ok(router.includes("/start — postlarni olish"), "help reply");

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
  const telegram = fs.readFileSync("src/lib/post-studio/bot-router.ts", "utf8");

  // The upsert/deactivate calls must be inside try/catch, with the reply after
  // the catch — a bare `await upsertSubscriber(...)` in front of sendMessage is
  // exactly what made /start return nothing when the table was unreachable.
  const startBlock = telegram.slice(
    telegram.indexOf('if (command === "/start")'),
    telegram.indexOf('if (command === "/stop")'),
  );
  assert.match(startBlock, /try \{[\s\S]*await upsertSubscriber\([\s\S]*\} catch/);
  assert.match(startBlock, /\} catch[\s\S]*await sendTelegramMessage\(chatId, START_REPLY/);

  // Any unknown text still gets an answer.
  assert.match(telegram, /await sendTelegramMessage\(chatId, HELP_REPLY/);
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
  // Transport (fetch, error shapes, keyboards) lives in telegram-api.ts; the
  // subscriber and delivery logic that consumes it stays in telegram.ts.
  const api = fs.readFileSync("src/lib/post-studio/telegram-api.ts", "utf8");
  assert.match(api, /\[telegram-api\] \$\{method\} failed status=/);
  assert.match(api, /body=\$\{raw\.slice\(0, 500\)\}/);
  // The request URL embeds the bot token, so it must not be interpolated in.
  assert.ok(!/console\.error\([^)]*TELEGRAM_API/.test(api));
});

test("a blocked or deleted chat deactivates that subscriber instead of retrying forever", () => {
  const telegram = fs.readFileSync("src/lib/post-studio/telegram.ts", "utf8");
  const api = fs.readFileSync("src/lib/post-studio/telegram-api.ts", "utf8");
  assert.match(api, /if \(this\.errorCode === 403\) return true/);
  assert.match(api, /chat not found\|user is deactivated/);
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

test("applying the migration does not retroactively queue historical intakes", () => {
  // Marking existing submitted intakes 'pending' with a past process_after
  // would make the first cron tick process the whole history at once — AI
  // calls, auto-approvals and publications nobody asked for.
  assert.match(
    MIGRATION,
    /update public\.candidate_intakes\s+set post_pipeline_status = 'skipped'\s+where submitted_at is not null\s+and post_pipeline_status is null;/,
  );
  assert.ok(
    !/post_pipeline_status = coalesce\(post_pipeline_status, 'pending'\)/.test(MIGRATION),
    "no retroactive pending backfill",
  );

  // Defence in depth: the sweep also refuses anything older than the cap.
  const pipeline = fs.readFileSync("src/lib/post-studio/pipeline.ts", "utf8");
  assert.match(pipeline, /PIPELINE_MAX_AGE_DAYS = \d+/);
  assert.match(pipeline, /\.gte\("post_pipeline_process_after", oldestAllowed\)/);
});

test("the application link points at the real form on the public site", () => {
  // telegram.ts resolves through the "@/lib" alias, so it is read as source
  // here rather than imported — the same way every other check in this file
  // inspects it.
  const telegram = fs.readFileSync("src/lib/post-studio/telegram.ts", "utf8");
  const DEFAULT_APPLICATION_URL = "https://liderlar.uz/ariza_qoldirish";
  assert.match(
    telegram,
    /export const DEFAULT_APPLICATION_URL = "https:\/\/liderlar\.uz\/ariza_qoldirish"/,
  );
  // The form lives at a fixed address; it is no longer derived from whichever
  // origin the poster happens to be served from.
  assert.ok(!telegram.includes("${siteUrl}/ariza`"), "not derived from the site origin");
  assert.match(
    telegram,
    /process\.env\.NEXT_PUBLIC_APPLICATION_URL,\s*DEFAULT_APPLICATION_URL/,
    "settings and env still override the default",
  );

  const caption = buildTelegramCaption({
    quote: "Test",
    fullName: "Ism Familiya",
    articleUrl: "https://liderlar.uz/liderlar/test",
    applicationUrl: DEFAULT_APPLICATION_URL,
    siteUrl: "https://liderlar.uz",
    instagramUrl: "https://instagram.com/liderlar.uz",
    telegramUsername: "uzlye_rasmiy",
  });
  assert.ok(caption.includes("https://liderlar.uz/ariza_qoldirish"));
  assert.equal(captionExceedsLimit(caption), false);
});

test("a flood limit pauses the batch instead of failing the rest of it", () => {
  const telegram = fs.readFileSync("src/lib/post-studio/telegram.ts", "utf8");
  const api = fs.readFileSync("src/lib/post-studio/telegram-api.ts", "utf8");

  // Telegram's own retry_after is parsed and honoured.
  assert.match(api, /parameters\?\.retry_after \?\? null/);
  assert.match(api, /get isTransient\(\)[\s\S]*errorCode === 429[\s\S]*errorCode >= 500/);

  const retry = telegram.slice(telegram.indexOf("async function sendWithRetry"));
  assert.match(retry, /if \(!error\?\.isTransient \|\| attempt >= MAX_SEND_ATTEMPTS\) throw err/);
  assert.match(retry, /Math\.min\(\(error\.retryAfter \?\? attempt\) \* 1000, MAX_RETRY_WAIT_MS\)/);

  // A permanent error is still permanent — a blocked user is not retried.
  assert.match(api, /get isPermanent\(\)[\s\S]*errorCode === 403/);
});

test("the poster is uploaded once and then referenced by file_id", () => {
  const telegram = fs.readFileSync("src/lib/post-studio/telegram.ts", "utf8");

  const deliver = telegram.slice(telegram.indexOf("export async function deliverPostToSubscribers"));
  assert.match(deliver, /let uploaded: string \| null = null/);
  assert.match(deliver, /sendWithRetry\(subscriber\.chat_id as number, uploaded \?\? photo, caption\)/);
  assert.match(deliver, /uploaded = uploaded \?\? sent\.fileId/);

  // And the sends are paced under the bot-wide limit.
  assert.match(deliver, /SEND_INTERVAL_MS - sinceLast/);
  assert.match(telegram, /const SEND_INTERVAL_MS = 40/);

  // sendPhoto accepts either the bytes or the handle.
  const api = fs.readFileSync("src/lib/post-studio/telegram-api.ts", "utf8");
  assert.match(api, /photo: Buffer \| string/);
  assert.match(api, /if \(typeof photo === "string"\)/);
});

test("the caption handle comes from settings, not a hardcoded string", () => {
  const telegram = fs.readFileSync("src/lib/post-studio/telegram.ts", "utf8");
  // site_settings wins, then env, and only then the documented default.
  assert.match(
    telegram,
    /pick\(TELEGRAM_SETTINGS_KEYS\.username, process\.env\.TELEGRAM_BOT_USERNAME, "uzlye_rasmiy"\)/,
  );
  assert.match(MIGRATION, /\('telegram_bot\.username', 'uzlye_rasmiy'\)/);
});

test("the public site origin is never guessed as liderlar.uz", async () => {
  const { normalizePublicWebUrl, PUBLIC_WEB_SETTING_KEY } = await import(
    "../src/lib/post-studio/public-web-url.ts"
  );

  // liderlar.uz currently still serves the OLD site, so there is no fallback:
  // unconfigured must resolve to null, not to a guessed domain.
  assert.equal(normalizePublicWebUrl(""), null);
  assert.equal(normalizePublicWebUrl(null), null);
  assert.equal(normalizePublicWebUrl("   "), null);
  assert.equal(normalizePublicWebUrl("http://localhost:3000"), null);
  assert.equal(normalizePublicWebUrl("javascript:alert(1)"), null);

  assert.equal(normalizePublicWebUrl("liderlar-web.vercel.app"), "https://liderlar-web.vercel.app");
  assert.equal(normalizePublicWebUrl("https://example.uz/"), "https://example.uz");
  assert.equal(PUBLIC_WEB_SETTING_KEY, "public_web.base_url");

  // The old domain may appear in a comment explaining why it is not used; what
  // matters is that no code path can produce it.
  for (const file of [
    "src/lib/post-studio/public-web-url.ts",
    "src/lib/post-studio/site-origin.ts",
  ]) {
    const code = fs
      .readFileSync(file, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    assert.ok(!code.includes("liderlar.uz"), `${file} has no hardcoded old domain`);
  }
});

test("an unconfigured public site holds the post at needs_review instead of linking the old domain", () => {
  const service = fs.readFileSync("src/lib/post-studio/service.ts", "utf8");
  assert.match(service, /code: "article_url_unconfigured"/);
  // An admin-confirmed URL is the way forward while the domain is in flux.
  assert.match(service, /post\.articleUrl\?\.trim\(\) \|\| source\.articleUrl/);
  // refreshPostCaption parks the post when no caption could be built.
  assert.match(service, /status: "needs_review",\s*\n\s*error: warning\?\.message/);

  const repository = fs.readFileSync("src/lib/post-studio/repository.ts", "utf8");
  assert.ok(!repository.includes("getSiteUrl"), "article links no longer use the old fallback");

  const telegram = fs.readFileSync("src/lib/post-studio/telegram.ts", "utf8");
  assert.ok(!telegram.includes("getSiteUrl"), "caption links no longer use the old fallback");
});

test("a hand-confirmed article URL also settles where the public site lives", async () => {
  const { originOfConfirmedUrl } = await import("../src/lib/post-studio/public-web-url.ts");

  assert.equal(
    originOfConfirmedUrl("https://liderlar-2-0.vercel.app/liderlar/abduraxmanov"),
    "https://liderlar-2-0.vercel.app",
  );
  assert.equal(originOfConfirmedUrl("http://example.test/liderlar/x?a=1#b"), "http://example.test");
  // The same rules the configured setting is held to.
  assert.equal(originOfConfirmedUrl("http://localhost:3000/liderlar/x"), null);
  assert.equal(originOfConfirmedUrl("ftp://example.test/x"), null);
  assert.equal(originOfConfirmedUrl("not a url"), null);
  assert.equal(originOfConfirmedUrl(null), null);

  // And the caption actually falls back to it, so confirming the link by hand
  // is a real escape hatch rather than one that still fails the next gate.
  const service = fs.readFileSync("src/lib/post-studio/service.ts", "utf8");
  assert.match(service, /const confirmedOrigin = originOfConfirmedUrl\(post\.articleUrl\)/);
  assert.match(service, /const siteUrl = settings\.siteUrl \?\? confirmedOrigin/);
  assert.match(service, /settings\.applicationUrl \?\? \(siteUrl \? `\$\{siteUrl\}\/ariza` : null\)/);
});

test("a working caption lifts the review flag it previously raised", () => {
  const service = fs.readFileSync("src/lib/post-studio/service.ts", "utf8");
  const block = service.slice(service.indexOf("export async function refreshPostCaption"));

  // Success clears the stale caption error and releases needs_review...
  assert.match(block, /patch\.error = null/);
  assert.match(block, /if \(synchronized\.status === "needs_review"\) patch\.status = "ready"/);
  // ...but only when the last render left no blocking layout warning.
  assert.match(block, /const stillBlocked = hasBlockingRenderWarning\(synchronized\)/);
  assert.match(block, /if \(!stillBlocked\)/);

  const guard = service.slice(service.indexOf("function hasBlockingRenderWarning"));
  for (const code of ["portrait_missing", "quote_missing", "name_overflow"]) {
    assert.ok(guard.includes(code), `${code} still holds the post`);
  }
});

test("the caption link follows the candidate's own publication, not an article row", () => {
  // The public site serves /liderlar/{slug} whenever candidates.status is
  // 'published' — the articles table is one optional section inside that page.
  // Gating on the article row held live profiles out of Telegram.
  const repository = fs.readFileSync("src/lib/post-studio/repository.ts", "utf8");
  assert.match(repository, /const candidateStatus = \(candidate\.status as string \| null\) \?\? null/);
  assert.match(repository, /candidateStatus === "published"\s*\?\s*await buildCandidateArticleUrl/);
  assert.ok(
    !/article\?\.status === "published"\s*\n?\s*\? await buildCandidateArticleUrl/.test(repository),
    "the article row no longer gates the link",
  );
  assert.match(repository, /"id, full_name, slug, status, avatar_url/, "status is actually selected");
});

test("the studio names which of the two causes left the profile link empty", () => {
  const client = fs.readFileSync("src/app/(admin)/postlar/[postId]/studio-client.tsx", "utf8");
  const fn = client.slice(client.indexOf("function describeProfileState"));

  assert.match(fn, /Nomzod sahifasi hali nashr qilinmagan \(holati: \$\{label\}\)/);
  assert.match(fn, /public sayt manzili sozlanmagan/);
  // The old blanket message is gone.
  assert.ok(!client.includes('"Maqola hali nashr qilinmagan"'));

  const page = fs.readFileSync("src/app/(admin)/postlar/[postId]/page.tsx", "utf8");
  assert.match(page, /candidateStatus: source\?\.candidateStatus \?\? null/);
  assert.match(page, /publicWebConfigured: source\?\.publicWebConfigured \?\? false/);
});

test("a hand-confirmed article URL must be a real http(s) link", () => {
  const actions = fs.readFileSync("src/lib/actions/post-studio.ts", "utf8");
  assert.match(actions, /saveArticleUrlAction/);
  assert.match(actions, /parsed\.protocol !== "http:" && parsed\.protocol !== "https:"/);
  // Changing the URL rebuilds the caption that embeds it.
  assert.match(actions, /await refreshPostCaption\(updated\)/);
});

test("the cron endpoint fails closed when CRON_SECRET is missing", () => {
  // It is exempt from the session middleware, so the secret is the only guard.
  // Without this it ran for anyone who knew the URL, spending OpenAI credit.
  const cron = fs.readFileSync("src/app/api/cron/post-pipeline/route.ts", "utf8");
  assert.match(cron, /if \(!secret\) \{[\s\S]*?status: 503/);
  assert.match(cron, /request\.headers\.get\("authorization"\) !== `Bearer \$\{secret\}`/);

  // The refusal must come before any work is started.
  const refusal = cron.indexOf("CRON_SECRET sozlanmagan");
  const work = cron.indexOf("runDuePipelines()");
  assert.ok(refusal > 0 && refusal < work, "refuses before running the pipeline");
});
