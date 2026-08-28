import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  alphaBounds,
  boundsGap,
  connectedComponents,
  dilate,
  erode,
} from "../src/lib/post-studio/morphology.ts";
import { cleanupMatte } from "../src/lib/post-studio/matte-cleanup.ts";
import {
  fitPortrait,
  isCanonicalHeadTop,
  applyPortraitOverride,
  PORTRAIT_FIT,
  type PersonBounds,
} from "../src/lib/post-studio/portrait-fit.ts";
import { splitSentences, selectDisplayQuote } from "../src/lib/post-studio/quote-sentences.ts";
import { buildPostLayout } from "../src/lib/post-studio/compose.ts";
import { buildOverlaySvgBody } from "../src/lib/post-studio/svg.ts";
import { POST_TEMPLATES, paletteForTemplate } from "../src/lib/post-studio/layout-config.ts";
import { splitNameIntoLines } from "../src/lib/post-studio/name-lines.ts";

/* ------------------------------------------------------------------ *
 * Morphology primitives
 * ------------------------------------------------------------------ */

test("erosion severs a thin bridge that connected components cannot", () => {
  // Two 9x9 blocks joined by a 1px waist — the shape of a background fragment
  // hanging off a head.
  const w = 30;
  const h = 12;
  const mask = new Uint8Array(w * h);
  const put = (x: number, y: number) => (mask[y * w + x] = 1);
  for (let y = 1; y <= 9; y += 1) for (let x = 1; x <= 9; x += 1) put(x, y);
  for (let y = 1; y <= 9; y += 1) for (let x = 20; x <= 28; x += 1) put(x, y);
  for (let x = 10; x <= 19; x += 1) put(x, 5);

  assert.equal(connectedComponents(mask, w, h).components.length, 1, "one component before");
  const eroded = erode(mask, w, h, 2);
  assert.equal(connectedComponents(eroded, w, h).components.length, 2, "two seeds after");

  // Dilation is the inverse direction, and a zero radius is a no-op.
  assert.deepEqual([...dilate(eroded, w, h, 0)], [...eroded]);
});

test("bounds gap is zero for touching boxes and a real distance otherwise", () => {
  const a = { left: 0, top: 0, right: 10, bottom: 10, width: 11, height: 11 };
  const b = { left: 11, top: 0, right: 20, bottom: 10, width: 10, height: 11 };
  const far = { left: 40, top: 40, right: 50, bottom: 50, width: 11, height: 11 };
  assert.equal(boundsGap(a, b), 0);
  assert.ok(boundsGap(a, far) > 30);
});

test("alpha bounds measure the person, not the canvas", () => {
  const w = 40;
  const h = 40;
  const alpha = new Uint8Array(w * h);
  for (let y = 10; y < 30; y += 1) for (let x = 5; x < 15; x += 1) alpha[y * w + x] = 255;

  const box = alphaBounds(alpha, w, h, 128)!;
  assert.deepEqual(box, { left: 5, top: 10, right: 14, bottom: 29, width: 10, height: 20 });
  assert.equal(alphaBounds(new Uint8Array(w * h), w, h, 128), null, "an empty matte has no box");
});

/* ------------------------------------------------------------------ *
 * Artefact cleanup — the ear-fragment regression
 * ------------------------------------------------------------------ */

interface Scene {
  alpha: Uint8Array;
  confidence: Uint8Array;
  width: number;
  height: number;
}

/**
 * A person, a detached low-confidence blob beside the head, a second blob
 * joined to the head by a two-pixel bridge, and a thin high-confidence strand
 * of hair. Exactly the four things the cleanup has to tell apart.
 */
function buildScene(): Scene {
  const width = 260;
  const height = 320;
  const alpha = new Uint8Array(width * height);
  const confidence = new Uint8Array(width * height);

  const paint = (
    x0: number, y0: number, x1: number, y1: number, a: number, c: number,
  ) => {
    for (let y = y0; y < y1; y += 1) {
      for (let x = x0; x < x1; x += 1) {
        alpha[y * width + x] = a;
        confidence[y * width + x] = c;
      }
    }
  };

  paint(80, 40, 180, 150, 255, 250);   // head
  paint(50, 150, 210, 320, 255, 250);  // shoulders and torso
  paint(176, 90, 190, 130, 255, 245);  // ear, only just attached to the head
  paint(72, 44, 80, 96, 255, 240);     // a thin hair strand down the left of the head

  paint(18, 84, 60, 130, 255, 170);    // DETACHED background blob beside the head
  paint(196, 60, 246, 108, 255, 165);  // bridged background blob...
  paint(190, 82, 196, 85, 255, 160);   // ...joined by a 3px-tall bridge

  return { alpha, confidence, width, height };
}

test("background fragments beside the head are removed, ear and hair are not", () => {
  const scene = buildScene();
  const { alpha, report } = cleanupMatte(scene.alpha, scene.confidence, scene.width, scene.height);
  const at = (x: number, y: number) => alpha[y * scene.width + x];

  assert.equal(report.analysed, true);
  assert.ok(report.removed.length >= 2, `removed ${report.removed.length} fragments`);

  // Both background fragments are gone, including the bridged one.
  assert.equal(at(38, 100), 0, "detached blob beside the head is deleted");
  assert.equal(at(220, 80), 0, "blob attached by a thin bridge is deleted too");

  // Anatomy survives.
  assert.equal(at(130, 90), 255, "face");
  assert.equal(at(130, 250), 255, "torso");
  assert.equal(at(182, 110), 255, "ear");
  assert.equal(at(75, 60), 255, "hair strand");

  // And the removal did not eat a hole out of the person.
  const core = new Uint8Array(alpha.length);
  for (let i = 0; i < alpha.length; i += 1) core[i] = alpha[i] >= 200 ? 1 : 0;
  assert.equal(connectedComponents(core, scene.width, scene.height).components.length, 1);
});

test("cleanup keeps a large second region — a raised arm is not an artefact", () => {
  const scene = buildScene();
  // A big, confident, detached region: cleanup must not assume "largest wins".
  for (let y = 160; y < 300; y += 1) {
    for (let x = 214; x < 254; x += 1) {
      scene.alpha[y * scene.width + x] = 255;
      scene.confidence[y * scene.width + x] = 250;
    }
  }
  const { alpha } = cleanupMatte(scene.alpha, scene.confidence, scene.width, scene.height);
  assert.equal(alpha[230 * scene.width + 234], 255, "the large confident region is kept");
});

test("a soft edge survives cleanup instead of being clipped square", () => {
  const scene = buildScene();
  // An anti-aliased fringe down the left of the torso.
  for (let y = 160; y < 300; y += 1) {
    scene.alpha[y * scene.width + 49] = 160;
    scene.alpha[y * scene.width + 48] = 60;
    scene.confidence[y * scene.width + 49] = 200;
    scene.confidence[y * scene.width + 48] = 120;
  }
  const { alpha } = cleanupMatte(scene.alpha, scene.confidence, scene.width, scene.height);
  assert.equal(alpha[200 * scene.width + 49], 160, "half-opaque fringe kept");
  assert.equal(alpha[200 * scene.width + 48], 60, "fainter fringe kept");
});

test("an all-background matte is left alone rather than mangled", () => {
  const width = 40;
  const height = 40;
  const { report } = cleanupMatte(
    new Uint8Array(width * height),
    new Uint8Array(width * height),
    width,
    height,
  );
  assert.equal(report.analysed, false);
  assert.equal(report.removed.length, 0);
});

/* ------------------------------------------------------------------ *
 * Canonical portrait scale
 * ------------------------------------------------------------------ */

function bounds(
  width: number,
  height: number,
  pad: { left?: number; top?: number; right?: number; bottom?: number } = {},
): PersonBounds {
  const left = pad.left ?? 0;
  const top = pad.top ?? 0;
  return {
    left,
    top,
    width,
    height,
    imageWidth: left + width + (pad.right ?? 0),
    imageHeight: top + height + (pad.bottom ?? 0),
  };
}

test("transparent padding cannot change how large the candidate renders", () => {
  // The same person, once in a tight 1000x1500 frame and once adrift in a
  // 3000x4000 one. This is the bug that made one candidate a quarter-size.
  const tight = fitPortrait(bounds(1000, 1500));
  const padded = fitPortrait(bounds(1000, 1500, { left: 900, top: 350, right: 1100, bottom: 2150 }));

  assert.ok(Math.abs(tight.person.height - padded.person.height) < 1e-6, "same visual height");
  assert.ok(Math.abs(tight.person.width - padded.person.width) < 1e-6, "same visual width");
  assert.deepEqual(tight.person, padded.person, "and the same place on the canvas");
  // The PNG itself is drawn much larger, precisely because most of it is empty.
  assert.ok(padded.width > tight.width * 2);
});

test("the person is anchored to the canvas' bottom-right corner", () => {
  for (const person of [bounds(1000, 1500), bounds(700, 900, { left: 120, top: 300 })]) {
    const fit = fitPortrait(person);
    assert.equal(fit.person.right, PORTRAIT_FIT.rightAnchor);
    assert.equal(fit.person.bottom, PORTRAIT_FIT.bottomAnchor);
  }
});

test("a compact source is scaled up to the canonical head target", () => {
  // The Xasanboy regression: a small, tightly-cropped source used to render at
  // a fraction of the frame because the fit measured the whole PNG.
  const fit = fitPortrait(bounds(320, 418));
  assert.equal(fit.limitedBy, "headTarget");
  assert.ok(Math.abs(fit.person.top - PORTRAIT_FIT.headTopTarget) < 1e-6);
  assert.ok(fit.scale > 1, "a small source is scaled up, not left small");
  assert.ok(fit.person.height >= PORTRAIT_FIT.minPersonHeight);
  assert.equal(isCanonicalHeadTop(fit.person.top), true);
});

test("a tall source is held under the head ceiling", () => {
  // The Kamola regression: hair used to climb over the quote.
  const fit = fitPortrait(bounds(900, 2600));
  assert.ok(
    fit.person.top >= PORTRAIT_FIT.headTopLimit,
    `head top ${fit.person.top} never crosses ${PORTRAIT_FIT.headTopLimit}`,
  );
  assert.ok(fit.person.height <= PORTRAIT_FIT.maxPersonHeight + 1e-6);
});

test("a broad bust trades height for width instead of covering the quote", () => {
  const fit = fitPortrait(bounds(530, 619));
  assert.equal(fit.limitedBy, "maxWidth", "width is the binding constraint, not the head target");
  assert.ok(fit.person.width <= PORTRAIT_FIT.maxPersonWidth + 1e-6);
  // Settling lower is the price of staying narrow, and it is still canonical.
  assert.ok(fit.person.top > PORTRAIT_FIT.headTopTarget);
  assert.equal(isCanonicalHeadTop(fit.person.top), true);

  // maxPersonWidth is what keeps the shoulders out of the quote column: the
  // widest a person may be leaves the quote's own right limit clear at the
  // heights the quote actually occupies (verified on real cut-outs, which sit
  // at x=445 and x=449 inside the quote band).
  const quote = POST_TEMPLATES["template-01"].quote;
  assert.ok(quote.x + quote.width <= 445, "the quote column stops short of the measured limit");
});

test("wildly different sources land within one visual standard", () => {
  const heights = [
    bounds(530, 619),                                   // broad studio bust
    bounds(320, 418),                                   // small tight crop
    bounds(1000, 1500, { left: 900, top: 350, right: 1100, bottom: 2150 }), // padded
  ].map((b) => fitPortrait(b).person.height);

  const spread = (Math.max(...heights) - Math.min(...heights)) / Math.max(...heights);
  assert.ok(spread < 0.2, `visual heights within 20% of each other, got ${(spread * 100).toFixed(1)}%`);
  for (const h of heights) assert.ok(h >= PORTRAIT_FIT.minPersonHeight);
});

test("manual sliders override the canonical fit without losing the corner", () => {
  const fit = fitPortrait(bounds(530, 619));
  const untouched = applyPortraitOverride(fit, { offsetX: 0, offsetY: 0, scale: 1, flip: false });
  assert.deepEqual(
    { x: untouched.x, y: untouched.y, width: untouched.width, height: untouched.height },
    { x: fit.x, y: fit.y, width: fit.width, height: fit.height },
    "no manual values means exactly the canonical placement",
  );

  const nudged = applyPortraitOverride(fit, { offsetX: -20, offsetY: 15, scale: 1.2, flip: false });
  assert.ok(Math.abs(nudged.width - fit.width * 1.2) < 1e-6);
  // Growing keeps the right/bottom edge pinned before the offset is applied.
  assert.ok(Math.abs(nudged.x + nudged.width - (fit.x + fit.width) + 20) < 1e-6);
});

/* ------------------------------------------------------------------ *
 * Sentence selection
 * ------------------------------------------------------------------ */

test("sentences split on real punctuation and keep it", () => {
  assert.deepEqual(
    splitSentences("O‘zingizga ishoning. Bilim olishdan to‘xtamang! Imkoniyatni kutmang?"),
    ["O‘zingizga ishoning.", "Bilim olishdan to‘xtamang!", "Imkoniyatni kutmang?"],
  );
});

test("Uzbek apostrophes do not fake an abbreviation", () => {
  // "ma'no?" ends in a two-letter run once the apostrophe is treated as a
  // separator, which used to swallow the sentence break after it.
  assert.equal(
    splitSentences("Shunchaki yashashdan nima ma’no? Har kuni bir qadam tashlang.").length,
    2,
  );
  assert.equal(splitSentences("O‘qishni bitirdim. Ishga kirdim.").length, 2);
});

test("abbreviations, decimals and a missing final stop do not create sentences", () => {
  assert.equal(splitSentences("Bu 3.5 foizga oshdi va h.k. Keyin davom etdi.").length, 1);
  assert.deepEqual(splitSentences("Bitta gap nuqtasiz"), ["Bitta gap nuqtasiz"]);
  assert.deepEqual(splitSentences("   "), []);
});

test("one sentence is used when it fills the column, two when it does not", () => {
  const probe = (fill: number) => () => ({ fontSize: 40, height: fill, overflow: false });
  const options = { boxHeight: 100, minFillRatio: 0.62, comfortFontSize: 30 };

  const full = selectDisplayQuote("Birinchi gap. Ikkinchi gap.", { ...options, probe: probe(80) });
  assert.equal(full.sentenceCount, 1);
  assert.equal(full.reason, "single");

  const sparse = selectDisplayQuote("Birinchi gap. Ikkinchi gap.", { ...options, probe: probe(30) });
  assert.equal(sparse.sentenceCount, 2);
  assert.equal(sparse.text, "Birinchi gap. Ikkinchi gap.");
});

test("a second sentence is refused when it would crush the type", () => {
  const choice = selectDisplayQuote("Qisqa gap. Juda uzun ikkinchi gap.", {
    boxHeight: 100,
    minFillRatio: 0.62,
    comfortFontSize: 30,
    probe: (text) =>
      text.includes("ikkinchi")
        ? { fontSize: 22, height: 95, overflow: false }
        : { fontSize: 60, height: 30, overflow: false },
  });
  assert.equal(choice.sentenceCount, 1);
  assert.equal(choice.reason, "extension-too-small");
});

test("the real Kamola answer yields one whole sentence, never a fragment", () => {
  const raw =
    "O‘zingizga ishoning, bilim olishdan to‘xtamang va imkoniyatni kutmang — uni o‘zingiz yarating. " +
    "Bugungi mehnatingiz ertangi muvaffaqiyatingizning poydevoridir.";

  const layout = buildPostLayout({
    templateId: "template-02",
    quote: raw,
    nameLines: splitNameIntoLines("Kamola Bahodirova O‘tkirjon qizi"),
    shortBioItems: ["Talaba", "Ijodkor"],
    portraitHref: "data:image/png;base64,AA==",
    portraitPersonBounds: bounds(530, 619),
    portraitTransform: { offsetX: 0, offsetY: 0, scale: 1, flip: false },
  });

  assert.equal(layout.quoteSelection.availableSentences, 2);
  assert.equal(layout.quoteSelection.sentenceCount, 1);
  assert.equal(
    layout.quoteSelection.text,
    "O‘zingizga ishoning, bilim olishdan to‘xtamang va imkoniyatni kutmang — uni o‘zingiz yarating.",
  );
  assert.ok(!layout.quoteSelection.text.includes("…"));
  assert.equal(layout.quote.overflow, false);
  assert.equal(layout.warnings.length, 0);
});

/* ------------------------------------------------------------------ *
 * Template colour is a template property
 * ------------------------------------------------------------------ */

test("switching template repaints the accent and changes nothing else", () => {
  const composition = {
    quote: "Xatolar yo‘lning bir qismidir, muvaffaqiyatsizlik emas.",
    nameLines: splitNameIntoLines("Murodilov Xasanboy Tolibjon o‘g‘li"),
    shortBioItems: ["Talaba", "Sovrindor", "Stajyor"],
    portraitHref: "data:image/png;base64,AA==",
    portraitPersonBounds: bounds(320, 418),
    portraitTransform: { offsetX: 4, offsetY: -3, scale: 1.1, flip: false },
  };

  const two = buildPostLayout({ ...composition, templateId: "template-02" });
  const six = buildPostLayout({ ...composition, templateId: "template-06" });

  // Content is untouched.
  assert.deepEqual(two.quoteSelection, six.quoteSelection);
  assert.deepEqual(two.name.lines.map((l) => l.text), six.name.lines.map((l) => l.text));
  assert.deepEqual(two.shortBio.lines.map((l) => l.text), six.shortBio.lines.map((l) => l.text));
  assert.deepEqual(two.portrait, six.portrait);
  assert.deepEqual(two.portraitFit, six.portraitFit);

  // The accent is not.
  const accent2 = paletteForTemplate("template-02").quoteAccent;
  const accent6 = paletteForTemplate("template-06").quoteAccent;
  assert.notEqual(accent2, accent6);
  assert.equal(two.palette.quoteAccent, accent2);
  assert.equal(six.palette.quoteAccent, accent6);

  // And the previous template's colour is nowhere in the rendered markup.
  const svg6 = buildOverlaySvgBody(six);
  assert.ok(svg6.includes(accent6), "template 06 accent is painted");
  assert.ok(!svg6.includes(accent2), `stale ${accent2} must not survive the switch`);

  // Runs carry a tone, never a colour, which is what makes the swap possible.
  for (const run of two.quote.lines.flatMap((l) => l.runs)) {
    assert.ok(run.tone === "accent" || run.tone === "base");
    assert.ok(!("fill" in run), "a run must not carry a baked hex");
  }
});

test("the studio ships each template's palette so the preview can repaint", () => {
  const page = fs.readFileSync("src/app/(admin)/postlar/[postId]/page.tsx", "utf8");
  assert.match(page, /palette: paletteForTemplate\(t\.id\)/);

  const client = fs.readFileSync("src/app/(admin)/postlar/[postId]/studio-client.tsx", "utf8");
  assert.match(client, /palette: activeTemplate\?\.palette \?\? layout\.palette/);
  assert.match(client, /applyPortraitOverride\(layout\.portraitFit, transform\)/);
});

/* ------------------------------------------------------------------ *
 * Creating a post produces a finished post
 * ------------------------------------------------------------------ */

test("creating a post runs the portrait and the render, with no manual step", () => {
  const actions = fs.readFileSync("src/lib/actions/post-studio.ts", "utf8");
  const create = actions.slice(
    actions.indexOf("export async function createPostForCandidateAction"),
    actions.indexOf("export async function savePostContentAction"),
  );
  assert.match(create, /createPostDraft[\s\S]*preparePortrait\(post\)[\s\S]*renderAndStorePost/);

  // The manual button still exists, but only as an explicit re-run.
  const prepare = actions.slice(actions.indexOf("export async function preparePortraitAction"));
  assert.match(prepare, /preparePortrait\(post, \{ force: true \}\)/);
});

test("the studio's portrait button is a retry, not the normal path", () => {
  const client = fs.readFileSync("src/app/(admin)/postlar/[postId]/studio-client.tsx", "utf8");
  assert.match(client, /Portretni qayta ishlash/);
  assert.match(client, /Portret fonini avtomatik olib tashlashda xatolik yuz berdi/);
  // Source, background state and saturation are all reported.
  assert.match(client, /Anketa rasmi/);
  assert.match(client, /Olib tashlandi/);
  assert.match(client, /Jarayonda/);
  assert.match(client, /0%/);
});
