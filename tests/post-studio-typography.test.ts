import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import fontkit from "@pdf-lib/fontkit";

import {
  POST_TEMPLATE_IDS,
  POST_CANVAS_UNITS,
  POST_OUTPUT_SIZE,
  NAME_LINE_HEIGHT,
  QUOTE_LINE_HEIGHT,
  SHORT_BIO_LINE_HEIGHT,
} from "../src/lib/post-studio/types.ts";
import {
  paletteForTemplate,
  POST_TEMPLATES,
  POST_TEMPLATE_LIST,
  pickTemplateForCandidate,
} from "../src/lib/post-studio/layout-config.ts";
import { getFontMetrics, POST_FONT_FILES } from "../src/lib/post-studio/fonts.ts";
import {
  fitFixedLines,
  firstBaselineOffset,
  measureText,
  positionLines,
  wrapText,
} from "../src/lib/post-studio/text-engine.ts";
import { splitNameIntoLines, tokenizeFullName } from "../src/lib/post-studio/name-lines.ts";
import { findQuoteSplitWordIndex } from "../src/lib/post-studio/quote-split.ts";
import { buildPostLayout } from "../src/lib/post-studio/compose.ts";
import { escapeXml, buildOverlaySvgBody } from "../src/lib/post-studio/svg.ts";
import { POST_FONT_STACKS, fontFamilyAttr } from "../src/lib/post-studio/font-stacks.ts";
import { resolveRunFill } from "../src/lib/post-studio/types.ts";

/* ------------------------------------------------------------------ *
 * Templates
 * ------------------------------------------------------------------ */

test("all six master templates load with a complete layout config", () => {
  assert.equal(POST_TEMPLATE_IDS.length, 6);
  assert.equal(POST_TEMPLATE_LIST.length, 6);

  for (const id of POST_TEMPLATE_IDS) {
    const template = POST_TEMPLATES[id];
    assert.equal(template.id, id);
    assert.ok(fs.existsSync(template.backgroundPath), `${id} background baked`);
    assert.ok(fs.existsSync(template.thumbnailPath), `${id} thumbnail baked`);
    assert.ok(fs.existsSync(`public/assets/post-studio/templates/${id}.svg`), `${id} master`);
    assert.match(template.accentColor, /^#[0-9a-f]{6}$/i);
    assert.match(template.quoteAccentFill, /^#[0-9a-f]{6}$/i);
    // Every box must sit inside the 810-unit canvas.
    for (const box of [template.quote, template.name, template.shortBio, template.portrait]) {
      assert.ok(box.x >= 0 && box.x + box.width <= POST_CANVAS_UNITS, `${id} box width`);
      assert.ok(box.y >= 0 && box.y + box.height <= POST_CANVAS_UNITS, `${id} box height`);
    }
    assert.ok(template.name.maxFontSize > template.name.minFontSize);
    assert.ok(template.quote.maxFontSize > template.quote.minFontSize);
  }
});

test("every master SVG really is a 1080x1080 / viewBox 810 document", () => {
  for (const id of POST_TEMPLATE_IDS) {
    const head = fs.readFileSync(`public/assets/post-studio/templates/${id}.svg`, "utf8").slice(0, 400);
    assert.match(head, /width="1080"/, `${id} width`);
    assert.match(head, /height="1080"/, `${id} height`);
    assert.match(head, /viewBox="0 0 810 809\.999993"/, `${id} viewBox`);
  }
  assert.equal(POST_OUTPUT_SIZE, 1080);
  assert.equal(POST_CANVAS_UNITS, 810);
});

test("switching template keeps quote, name, bio and portrait transform intact", () => {
  const composition = {
    quote: "Orzular tomon yurish shart",
    nameLines: ["RASULJONOVA", "GULNOZA"],
    shortBioItems: ["Psixolog", "Ijodkor"],
    portraitHref: null,
    portraitTransform: { offsetX: 12, offsetY: -7, scale: 1.15, flip: false },
  };

  const first = buildPostLayout({ ...composition, templateId: "template-01" });
  const second = buildPostLayout({ ...composition, templateId: "template-05" });

  assert.deepEqual(
    first.name.lines.map((l) => l.text),
    second.name.lines.map((l) => l.text),
  );
  assert.deepEqual(
    first.shortBio.lines.map((l) => l.text),
    second.shortBio.lines.map((l) => l.text),
  );
  assert.equal(first.portrait.x, second.portrait.x);
  assert.equal(first.portrait.width, second.portrait.width);
  // Only the accent colour of the quote's leading half changes, and it lives in
  // the palette rather than being baked into the runs.
  assert.equal(first.quote.lines[0].runs[0].tone, second.quote.lines[0].runs[0].tone);
  assert.notEqual(first.palette.quoteAccent, second.palette.quoteAccent);
});

test("template selection is deterministic per candidate", () => {
  const id = "1f6b9a2e-0000-4000-8000-abcdefabcdef";
  assert.equal(pickTemplateForCandidate(id), pickTemplateForCandidate(id));
  assert.ok(POST_TEMPLATE_IDS.includes(pickTemplateForCandidate(id)));
});

/* ------------------------------------------------------------------ *
 * Fonts
 * ------------------------------------------------------------------ */

test("Anton is present as a real TTF and covers Uzbek Latin", () => {
  const anton = POST_FONT_FILES.find((f) => f.family === "Anton");
  assert.ok(anton, "Anton registered");
  assert.ok(fs.existsSync(anton!.file), "Anton TTF on disk");

  const font = fontkit.create(fs.readFileSync(anton!.file));
  assert.equal(font.unitsPerEm, 2048);
  for (const char of "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'‘’") {
    assert.ok(font.hasGlyphForCodePoint(char.codePointAt(0)!), `Anton has ${char}`);
  }
});

test("the quote is set in Anton, the same display face as the name", () => {
  assert.equal(POST_FONT_STACKS.quote[0], "Anton");
  assert.equal(POST_FONT_STACKS.name[0], "Anton");
  // Anton has no Cyrillic, so both chains must still carry a fallback.
  assert.ok(POST_FONT_STACKS.quote.length > 1, "quote chain has a Cyrillic fallback");

  const layout = quoteLayout("Bilim olishdan hech qachon qo‘rqmaslik kerak");
  const svg = buildOverlaySvgBody(layout);
  assert.equal(layout.quote.fontRole, "quote");
  assert.match(svg, new RegExp(`font-family="${fontFamilyAttr("quote")}"`));

  // Uppercase is part of the same treatment — the poster never shows lowercase.
  assert.equal(POST_TEMPLATES["template-01"].quote.uppercase, true);
  for (const line of layout.quote.lines) {
    assert.equal(line.text, line.text.toLocaleUpperCase("uz"));
  }
});

test("the name stack falls back for Cyrillic, which Anton does not ship", () => {
  const anton = fontkit.create(
    fs.readFileSync(POST_FONT_FILES.find((f) => f.family === "Anton")!.file),
  );
  assert.equal(anton.hasGlyphForCodePoint("Ў".codePointAt(0)!), false);

  // The chain still measures Cyrillic, so a Cyrillic name is never zero-width.
  const metrics = getFontMetrics("name");
  assert.ok(metrics.advance("ЎҚҒҲ") > 0);
  assert.ok(metrics.advance("RASULJONOVA") > 0);
});

test("every bundled font file exists and parses", () => {
  for (const font of POST_FONT_FILES) {
    assert.ok(fs.existsSync(font.file), `${font.family} exists`);
    const parsed = fontkit.create(fs.readFileSync(font.file));
    assert.ok(parsed.unitsPerEm > 0, `${font.family} parses`);
  }
});

/* ------------------------------------------------------------------ *
 * Line heights — the three fixed product requirements
 * ------------------------------------------------------------------ */

const metrics = { advance: (t: string) => t.length * 0.5, ascender: 0.8, descender: -0.2 };

test("name line-height is exactly 1.09 baseline-to-baseline", () => {
  assert.equal(NAME_LINE_HEIGHT, 1.09);

  const fit = fitFixedLines(["AAA", "BBB", "CCC"], {
    metrics,
    box: { x: 0, y: 0, width: 1000, height: 1000 },
    maxFontSize: 100,
    minFontSize: 10,
    lineHeight: NAME_LINE_HEIGHT,
  });
  const block = positionLines(fit, {
    metrics,
    box: { x: 0, y: 0, width: 1000, height: 1000 },
    lineHeight: NAME_LINE_HEIGHT,
    align: "left",
    fontRole: "name",
  });

  // 100px text -> 109px between baselines.
  assert.equal(block.fontSize, 100);
  assert.equal(block.lines[1].baseline - block.lines[0].baseline, 109);
  assert.equal(block.lines[2].baseline - block.lines[1].baseline, 109);
});

test("quote line-height is exactly 1.03 at every font size", () => {
  assert.equal(QUOTE_LINE_HEIGHT, 1.03);

  for (const size of [20, 33, 46]) {
    const fit = { fontSize: size, lines: ["A", "B"], overflow: false, height: 0, widest: 0 };
    const block = positionLines(fit, {
      metrics,
      box: { x: 0, y: 0, width: 1000, height: 1000 },
      lineHeight: QUOTE_LINE_HEIGHT,
      align: "left",
      fontRole: "quote",
    });
    const gap = block.lines[1].baseline - block.lines[0].baseline;
    assert.ok(Math.abs(gap - size * 1.03) < 1e-9, `size ${size} -> gap ${gap}`);
  }
});

test("short bio line-height is exactly 0.98", () => {
  assert.equal(SHORT_BIO_LINE_HEIGHT, 0.98);

  const fit = { fontSize: 50, lines: ["a", "b"], overflow: false, height: 0, widest: 0 };
  const block = positionLines(fit, {
    metrics,
    box: { x: 0, y: 0, width: 1000, height: 1000 },
    lineHeight: SHORT_BIO_LINE_HEIGHT,
    align: "left",
    fontRole: "shortBio",
  });
  assert.equal(block.lines[1].baseline - block.lines[0].baseline, 49);
});

test("the first baseline follows the CSS half-leading model", () => {
  // content height = (0.8 + 0.2) * 100 = 100; line box = 109; half-leading 4.5.
  assert.equal(firstBaselineOffset(100, 1.09, metrics), 4.5 + 80);
});

/* ------------------------------------------------------------------ *
 * Name splitting
 * ------------------------------------------------------------------ */

test("an Uzbek patronymic stays attached to its stem", () => {
  assert.deepEqual(tokenizeFullName("Rasuljonova Gulnoza Avazjon qizi"), [
    "Rasuljonova",
    "Gulnoza",
    "Avazjon qizi",
  ]);
  assert.deepEqual(tokenizeFullName("Dadaev Shaxzod Shuxratjon o‘g‘li"), [
    "Dadaev",
    "Shaxzod",
    "Shuxratjon o‘g‘li",
  ]);
});

test("a two-word name becomes two lines", () => {
  assert.deepEqual(splitNameIntoLines("Oybekova Farangiz"), ["OYBEKOVA", "FARANGIZ"]);
});

test("a three-part name becomes three lines", () => {
  assert.deepEqual(splitNameIntoLines("Rasuljonova Gulnoza Avazjon qizi"), [
    "RASULJONOVA",
    "GULNOZA",
    "AVAZJON QIZI",
  ]);
});

test("Uzbek letters and Cyrillic survive the uppercase pass unchanged", () => {
  assert.deepEqual(splitNameIntoLines("O‘ktamjonova Nilufar Topiboldi qizi"), [
    "O‘KTAMJONOVA",
    "NILUFAR",
    "TOPIBOLDI QIZI",
  ]);
  assert.deepEqual(splitNameIntoLines("Шаҳзод Дадаев"), ["ШАҲЗОД", "ДАДАЕВ"]);
});

test("a four-part name is balanced into three lines without reordering", () => {
  const lines = splitNameIntoLines("Abdurahmonov Muhammadali Shohruhbek Zafar o‘g‘li");
  assert.equal(lines.length, 3);
  assert.equal(lines.join(" "), "ABDURAHMONOV MUHAMMADALI SHOHRUHBEK ZAFAR O‘G‘LI");
});

test("a very long name shrinks rather than overflowing its box", () => {
  const layout = buildPostLayout({
    templateId: "template-01",
    quote: "Qisqa iqtibos",
    nameLines: splitNameIntoLines("Abdurahmonqulov Muhammadamin Shohruhbekmirzo o‘g‘li"),
    shortBioItems: ["Talaba"],
    portraitHref: null,
    portraitTransform: { offsetX: 0, offsetY: 0, scale: 1, flip: false },
  });

  const template = POST_TEMPLATES["template-01"];
  assert.ok(layout.name.fontSize < template.name.maxFontSize, "auto-fit shrank the name");
  assert.ok(layout.name.fontSize >= template.name.minFontSize, "not below the minimum");
  for (const line of layout.name.lines) {
    assert.ok(line.width <= template.name.width + 1e-6, `"${line.text}" fits the box`);
  }
});

/* ------------------------------------------------------------------ *
 * Quote auto-fit — length drives the size
 * ------------------------------------------------------------------ */

function quoteLayout(quote: string) {
  return buildPostLayout({
    templateId: "template-01",
    quote,
    nameLines: ["ISM", "FAMILIYA"],
    shortBioItems: ["Talaba"],
    portraitHref: null,
    portraitTransform: { offsetX: 0, offsetY: 0, scale: 1, flip: false },
  });
}

test("a longer sentence is rendered at a strictly smaller font size", () => {
  const short = quoteLayout("Bilim olishdan hech qachon qo‘rqmaslik kerak."); // ~44 chars
  const medium = quoteLayout(
    "O‘z qiziqishlari va imkoniyatlarini qidirlash, bilim olishdan hamda yangi narsalarni sinab ko‘rishdan qo‘rqmaslik kerak.",
  ); // ~118 chars

  assert.ok(short.quote.fontSize > medium.quote.fontSize, "short > medium");

  const box = POST_TEMPLATES["template-01"].quote;
  for (const layout of [short, medium]) {
    assert.equal(layout.quote.overflow, false);
    assert.ok(layout.quote.lines.length * layout.quote.fontSize * QUOTE_LINE_HEIGHT <= box.height + 1e-6);
    for (const line of layout.quote.lines) {
      assert.ok(line.width <= box.width + 1e-6, `line fits: ${line.text}`);
    }
  }
});

test("a multi-sentence answer is shortened, not shrunk", () => {
  const medium = quoteLayout(
    "O‘z qiziqishlari va imkoniyatlarini qidirlash, bilim olishdan hamda yangi narsalarni sinab ko‘rishdan qo‘rqmaslik kerak.",
  );
  // Four sentences: the old engine set all of them at the minimum size.
  const long = quoteLayout(
    "Nima bo‘lishidan qat’i nazar, orzular tomon yurish shart. Zero, vaqt o‘tib ketadi, orzu esa ro‘yobini topib, insonga baxt berishi lozim. Shunchaki yashashdan nima ma’no? Har kuni bir qadam oldinga tashlash kerak.",
  );

  assert.equal(long.quoteSelection.availableSentences, 4);
  assert.equal(long.quoteSelection.sentenceCount, 1);
  assert.equal(long.quoteSelection.text, "Nima bo‘lishidan qat’i nazar, orzular tomon yurish shart.");
  assert.ok(
    long.quote.fontSize >= medium.quote.fontSize,
    `a long answer no longer shrinks the type (${long.quote.fontSize} vs ${medium.quote.fontSize})`,
  );
  assert.equal(long.quote.overflow, false);
});

test("a short opening sentence pulls in the second one to fill the column", () => {
  const layout = quoteLayout(
    "O‘zingizga ishoning. Bilim olishdan to‘xtamang va har bir imkoniyatdan foydalaning.",
  );

  assert.equal(layout.quoteSelection.sentenceCount, 2);
  assert.equal(layout.quoteSelection.reason, "extended");
  assert.equal(
    layout.quoteSelection.text,
    "O‘zingizga ishoning. Bilim olishdan to‘xtamang va har bir imkoniyatdan foydalaning.",
  );
});

test("the poster never truncates a sentence or prints an ellipsis", () => {
  const raw =
    "Yoshlarga aytadigan eng katta maslahatim — o‘zlariga ishonishdan to‘xtamasinlar. " +
    "Har bir imkoniyatdan foydalanib, yangi bilim va tajriba orttirishga intilishsin. " +
    "Ba’zan yo‘l qiyin bo‘ladi, lekin kichik qadamlar ham katta yutuqlarga olib keladi.";
  const layout = quoteLayout(raw);

  assert.ok(!layout.quoteSelection.text.includes("…"));
  assert.ok(!layout.quoteSelection.text.includes("..."));
  assert.ok(layout.quoteSelection.sentenceCount <= 2, "at most two sentences reach the poster");
  // Whatever was chosen is a prefix of the raw answer and ends on real punctuation.
  assert.ok(raw.startsWith(layout.quoteSelection.text));
  assert.match(layout.quoteSelection.text, /[.!?…]$/);
});

test("a quote that cannot fit even at the minimum size flags needs_review and is not truncated", () => {
  const enormous = "Juda uzun iqtibos ".repeat(60).trim();
  const layout = quoteLayout(enormous);

  assert.equal(layout.quote.fontSize, POST_TEMPLATES["template-01"].quote.minFontSize);
  assert.equal(layout.quote.overflow, true);
  assert.equal(layout.needsReview, true);
  assert.ok(layout.warnings.some((w) => w.code === "quote_overflow"));

  // Nothing is silently cut or ellipsised — the words all survive.
  const rendered = layout.quote.lines.map((l) => l.text).join(" ");
  assert.equal(rendered.split(/\s+/).length, enormous.split(/\s+/).length);
  assert.ok(!rendered.includes("…"));
});

test("wrapping re-flows at each candidate size instead of clamping", () => {
  const text = "bir ikki uch to‘rt besh olti yetti sakkiz";
  const wide = wrapText(text, metrics, 100, { fontSize: 10 });
  const narrow = wrapText(text, metrics, 100, { fontSize: 20 });
  assert.ok(narrow.length > wide.length, "smaller box -> more lines");
});

test("measureText accounts for tracking between glyphs", () => {
  const plain = measureText("ABCD", metrics, { fontSize: 10 });
  const tracked = measureText("ABCD", metrics, { fontSize: 10, tracking: 0.1 });
  assert.equal(plain, 20);
  assert.equal(tracked, 20 + 3 * 1);
});

/* ------------------------------------------------------------------ *
 * Two-tone quote colouring
 * ------------------------------------------------------------------ */

test("the quote's leading half takes the accent colour and the rest goes white", () => {
  const layout = quoteLayout(
    "Xatolar yo‘lning bir qismidir, muvaffaqiyatsizlik emas. Har bir muvaffaqiyatsizlik darslikdan tezroq o‘rgatadi.",
  );
  const template = POST_TEMPLATES["template-01"];

  const fills = layout.quote.lines.flatMap((l) =>
    l.runs.map((r) => resolveRunFill(layout.palette, "quote", r.tone)),
  );
  assert.ok(fills.includes(template.quoteAccentFill), "accent half present");
  assert.ok(fills.includes(template.quote.fill), "white half present");
  // Accent first, white after — never interleaved.
  assert.equal(fills[0], template.quoteAccentFill);
  assert.equal(fills[fills.length - 1], template.quote.fill);
});

test("the colour split lands on a word boundary near the midpoint", () => {
  const words = ["bir", "ikki", "uch", "to‘rt"];
  const index = findQuoteSplitWordIndex(words);
  assert.ok(index >= 1 && index <= words.length - 1);
  assert.equal(findQuoteSplitWordIndex(["yolgiz"]), 1);
});

/* ------------------------------------------------------------------ *
 * Name colouring
 * ------------------------------------------------------------------ */

test("every name line is set in ink black", () => {
  for (const name of ["Xolmo‘minova Mavluda Rustam qizi", "Oybekova Farangiz"]) {
    const layout = buildPostLayout({
      templateId: "template-01",
      quote: "Qisqa iqtibos.",
      nameLines: splitNameIntoLines(name),
      shortBioItems: ["Talaba"],
      portraitHref: null,
      portraitTransform: { offsetX: 0, offsetY: 0, scale: 1, flip: false },
    });

    const fills = new Set(
      layout.name.lines.flatMap((l) =>
        l.runs.map((r) => resolveRunFill(layout.palette, "name", r.tone)),
      ),
    );
    assert.deepEqual([...fills], ["#000000"], `${name} is entirely black`);
  }
});

test("the name colour does not depend on which template is selected", () => {
  const fills = POST_TEMPLATE_IDS.map((id) => paletteForTemplate(id).name);
  assert.deepEqual([...new Set(fills)], ["#000000"]);
});

/* ------------------------------------------------------------------ *
 * Short bio
 * ------------------------------------------------------------------ */

test("at most five short-bio items are used", () => {
  const layout = buildPostLayout({
    templateId: "template-02",
    quote: "Qisqa",
    nameLines: ["ISM"],
    shortBioItems: ["Bir", "Ikki", "Uch", "To‘rt", "Besh", "Olti", "Yetti"],
    portraitHref: null,
    portraitTransform: { offsetX: 0, offsetY: 0, scale: 1, flip: false },
  });
  assert.ok(layout.shortBio.lines.length <= 5);
});

test("an over-long bio drops trailing items rather than inventing new ones", () => {
  const items = [
    "Xalqaro olimpiada sovrindori va faxriy talaba",
    "Respublika ko‘rik tanlovi g‘olibi",
    "Yosh ixtirochilar klubi rahbari",
    "Til sertifikatlari sohibasi",
    "Jamoat tashkiloti volontyori",
  ];
  const layout = buildPostLayout({
    templateId: "template-03",
    quote: "Qisqa",
    nameLines: ["ISM"],
    shortBioItems: items,
    portraitHref: null,
    portraitTransform: { offsetX: 0, offsetY: 0, scale: 1, flip: false },
  });

  // Whatever survives must be a prefix of the admin-ordered input.
  const kept = layout.shortBio.lines.map((l) => l.text.replace(/^•\s*/, ""));
  assert.deepEqual(kept, items.slice(0, kept.length));
  assert.ok(kept.length >= 3, "never trims below three items");
});

/* ------------------------------------------------------------------ *
 * SVG serialisation
 * ------------------------------------------------------------------ */

test("XML special characters in a quote are escaped", () => {
  assert.equal(escapeXml(`R&D <b> "x" 'y'`), "R&amp;D &lt;b&gt; &quot;x&quot; &apos;y&apos;");
  // Uzbek typography passes through untouched.
  assert.equal(escapeXml("O‘zbek G‘alaba"), "O‘zbek G‘alaba");
});

test("a missing quote or name is reported instead of rendering an empty post", () => {
  const layout = buildPostLayout({
    templateId: "template-01",
    quote: "",
    nameLines: [],
    shortBioItems: [],
    portraitHref: null,
    portraitTransform: { offsetX: 0, offsetY: 0, scale: 1, flip: false },
  });
  const codes = layout.warnings.map((w) => w.code);
  assert.ok(codes.includes("quote_missing"));
  assert.ok(codes.includes("name_missing"));
  assert.ok(codes.includes("portrait_missing"));
  assert.equal(layout.needsReview, true);
});

test("only the canonical intake answer is promoted into the poster as a quote", async () => {
  const { pickQuote, rankQuoteCandidates, looksLikeBadgeRow } = await import(
    "../src/lib/post-studio/quote-source.ts"
  );

  // This is the real shape of articles.excerpt for most published candidates.
  const badgeRow = "Marketing mutaxassisi | SMM mutaxassisi | Targetolog | Kitobxon";
  assert.equal(looksLikeBadgeRow(badgeRow), true);
  assert.equal(looksLikeBadgeRow("Bilim olishdan qo‘rqmaslik kerak"), false);

  assert.equal(pickQuote([{ text: badgeRow, source: "article_quote" }]), null);

  // Even a genuine legacy featured quote cannot replace the intake answer.
  const ranked = rankQuoteCandidates([
    { text: badgeRow, source: "article_quote" },
    { text: "Orzular tomon yurish shart", source: "featured_quote" },
    { text: "15-savol javobi", source: "intake_quote" },
  ]);
  assert.equal(pickQuote(ranked)?.text, "15-savol javobi");
  assert.equal(
    pickQuote([{ text: "Orzular tomon yurish shart", source: "featured_quote" }]),
    null,
  );
});
