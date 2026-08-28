import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";
import sharp from "sharp";

import {
  enhancePortraitColor,
  POST_PORTRAIT_SATURATION,
  PortraitProcessingError,
  portraitSourceFingerprint,
  removePortraitBackground,
  validateTransparentPortrait,
} from "../src/lib/post-studio/portrait.ts";
import {
  ALPHA_CLEAR,
  ALPHA_OPAQUE,
  attachAlpha,
  measureMatte,
  rampAlpha,
} from "../src/lib/post-studio/matte.ts";
import {
  buildSegmentationInput,
  SEGMENTATION_INPUT_SIZE,
  segmentationModelAvailable,
  segmentationModelSize,
} from "../src/lib/post-studio/segmentation.ts";
import { buildPostLayout } from "../src/lib/post-studio/compose.ts";
import { renderPostImage, toDataUri } from "../src/lib/post-studio/render.ts";
import { splitNameIntoLines } from "../src/lib/post-studio/name-lines.ts";
import { POST_OUTPUT_SIZE } from "../src/lib/post-studio/types.ts";

const PLAIN = "tests/fixtures/portrait-plain-background.jpg";
const BUSY = "tests/fixtures/portrait-busy-background.jpg";

/* ------------------------------------------------------------------ *
 * The model itself
 * ------------------------------------------------------------------ */

test("the segmentation model is committed, not downloaded at runtime", () => {
  assert.equal(segmentationModelAvailable(), true, "models/silueta.onnx is on disk");
  assert.equal(segmentationModelSize(), 44_173_029, "exact byte size, so a partial checkout fails loudly");
  assert.equal(
    crypto.createHash("sha256").update(fs.readFileSync("models/silueta.onnx")).digest("hex"),
    "75da6c8d2f8096ec743d071951be73b4a8bc7b3e51d9a6625d63644f90ffeedb",
  );
});

test("no third-party background-removal API is reachable from the codebase any more", () => {
  const sources = fs
    .readdirSync("src/lib/post-studio")
    .filter((f) => f.endsWith(".ts"))
    .map((f) => fs.readFileSync(`src/lib/post-studio/${f}`, "utf8"))
    .join("\n");

  // Endpoints and credentials, not prose: the modules are free to *say* they
  // no longer call these services.
  for (const banned of [
    "api.remove.bg",
    "sdk.photoroom.com",
    "REMOVEBG_API_KEY",
    "PHOTOROOM_API_KEY",
    "X-Api-Key",
    "x-api-key",
  ]) {
    assert.ok(!sources.includes(banned), `${banned} is gone`);
  }

  const env = fs.readFileSync(".env.example", "utf8");
  assert.ok(!env.includes("REMOVEBG_API_KEY"), "the key is no longer advertised as configuration");
  assert.ok(!env.includes("PHOTOROOM_API_KEY"));
});

test("the model input is built to the graph's fixed 320x320 NCHW contract", () => {
  const size = SEGMENTATION_INPUT_SIZE;
  assert.equal(size, 320);

  const rgb = Buffer.alloc(size * size * 3, 128);
  const input = buildSegmentationInput(rgb, size);
  assert.equal(input.length, 3 * size * size);
  // A flat mid-grey normalises to a constant per channel, and the three
  // channels differ because the ImageNet means differ.
  assert.notEqual(input[0], input[size * size]);
  assert.ok(Number.isFinite(input[0]));

  assert.throws(() => buildSegmentationInput(Buffer.alloc(10), size), /RGB bytes/);
});

test("nothing in the portrait path writes a temporary file", () => {
  for (const file of ["portrait.ts", "segmentation.ts", "matte.ts"]) {
    const source = fs.readFileSync(`src/lib/post-studio/${file}`, "utf8");
    for (const banned of ["tmpdir", "writeFile", "createWriteStream", "mkdtemp", "/tmp"]) {
      assert.ok(!source.includes(banned), `${file} does not touch ${banned}`);
    }
  }
});

/* ------------------------------------------------------------------ *
 * Matte maths, without touching the model
 * ------------------------------------------------------------------ */

test("the alpha ramp discards the low-confidence wash but keeps a gradient", () => {
  const ramped = rampAlpha(Uint8Array.from([0, 60, 76, 128, 179, 200, 255]), 0.3, 0.7);
  assert.equal(ramped[0], 0);
  assert.equal(ramped[1], 0, "below the floor is background, not a faint halo");
  assert.equal(ramped[6], 255);
  assert.ok(ramped[3] > 0 && ramped[3] < 255, "the middle stays a real gradient");
  // Monotonic: the ramp never reorders confidences.
  for (let i = 1; i < ramped.length; i += 1) assert.ok(ramped[i] >= ramped[i - 1]);
});

test("attachAlpha copies the photographed pixels through untouched", () => {
  const rgb = Uint8Array.from([10, 20, 30, 200, 210, 220]);
  const rgba = attachAlpha(rgb, Uint8Array.from([0, 255]));
  assert.deepEqual([...rgba], [10, 20, 30, 0, 200, 210, 220, 255]);
  assert.throws(() => attachAlpha(rgb, Uint8Array.from([1])), /RGB bytes/);
});

test("matte statistics separate a decisive matte from a hedged one", () => {
  const decisive = measureMatte(Uint8Array.from([0, 0, 255, 255]));
  assert.equal(decisive.decisiveShare, 1);
  assert.equal(decisive.coverage, 0.5);

  const hedged = measureMatte(Uint8Array.from([120, 130, 140, 125]));
  assert.equal(hedged.decisiveShare, 0);
  assert.ok(ALPHA_CLEAR < ALPHA_OPAQUE);
});

/* ------------------------------------------------------------------ *
 * End-to-end on real photographs
 * ------------------------------------------------------------------ */

async function alphaOf(png: Buffer) {
  const { data, info } = await sharp(png)
    .ensureAlpha()
    .extractChannel("alpha")
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

for (const [label, fixture] of [["plain", PLAIN], ["busy", BUSY]] as const) {
  test(`a real photograph with a ${label} background becomes a transparent cut-out`, async () => {
    const source = fs.readFileSync(fixture);
    const sourceBefore = Buffer.from(source);

    const cutout = await removePortraitBackground(source);

    assert.deepEqual(source, sourceBefore, "the source photo buffer is never mutated");
    assert.deepEqual(
      fs.readFileSync(fixture),
      sourceBefore,
      "the original file on disk is untouched",
    );

    const meta = await sharp(cutout.buffer).metadata();
    assert.equal(meta.format, "png");
    assert.equal(meta.hasAlpha, true, "the cut-out really carries an alpha channel");

    const { data: alpha, width, height } = await alphaOf(cutout.buffer);

    // Background: the cut-out is trimmed to the subject's bounding box, so the
    // remaining background lives in the corners.
    const corner = (x: number, y: number) => alpha[y * width + x];
    const corners = [
      corner(0, 0),
      corner(width - 1, 0),
      corner(1, 1),
      corner(width - 2, 1),
    ];
    for (const value of corners) {
      assert.ok(value <= ALPHA_CLEAR, `a top corner is background (alpha ${value})`);
    }

    // Subject: the face sits in the upper-middle of a head-and-shoulders crop.
    const face = alpha[Math.round(height * 0.35) * width + Math.round(width * 0.5)];
    assert.ok(face >= ALPHA_OPAQUE, `the face is opaque (alpha ${face})`);

    // A soft, anti-aliased boundary exists — this is what a plain threshold
    // would not produce, and what keeps hair and shoulders from looking cut out
    // with scissors.
    const soft = alpha.reduce((n, v) => (v > ALPHA_CLEAR && v < ALPHA_OPAQUE ? n + 1 : n), 0);
    assert.ok(soft > 0, "the edge carries intermediate alpha");
    assert.ok(soft / alpha.length < 0.2, "but the frame is not a translucent smear");

    assert.ok(cutout.confidence >= 0.5, `model confidence ${cutout.confidence}`);
    assert.ok(cutout.coverage > 0.08 && cutout.coverage < 0.99);
  });
}

test("a sideways phone photo is uprighted before it is segmented", async () => {
  // Orientation 6 = "rotate 90° clockwise on display". Written as EXIF, so the
  // stored pixels stay landscape and only a correct pipeline turns them.
  const sideways = await sharp(fs.readFileSync(PLAIN)).rotate(270).jpeg().toBuffer();
  // Written in a second pass: sharp resets the tag when the same pipeline also
  // rotates pixels, so the flag has to be attached to the finished bytes.
  const landscape = await sharp(sideways).withMetadata({ orientation: 6 }).jpeg().toBuffer();

  const stored = await sharp(landscape).metadata();
  assert.ok(stored.width > stored.height, "the stored pixels really are on their side");
  assert.equal(stored.orientation, 6);

  const cutout = await removePortraitBackground(landscape);
  assert.ok(
    cutout.height > cutout.width,
    `EXIF rotation was applied before segmentation (${cutout.width}x${cutout.height})`,
  );
  assert.ok(cutout.confidence >= 0.5, "and the model still found the subject");
});

test("saturation 0 greys the portrait out and leaves every alpha byte alone", async () => {
  const cutout = await removePortraitBackground(fs.readFileSync(PLAIN));
  const enhanced = await enhancePortraitColor(cutout.buffer);

  assert.equal(POST_PORTRAIT_SATURATION, 0);
  assert.equal(enhanced.saturation, 0);
  assert.deepEqual(
    await sharp(enhanced.buffer).extractChannel("alpha").raw().toBuffer(),
    await sharp(cutout.buffer).ensureAlpha().extractChannel("alpha").raw().toBuffer(),
    "alpha bytes are unchanged",
  );

  const { data, info } = await sharp(enhanced.buffer)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += info.channels) {
    assert.ok(
      Math.abs(data[i] - data[i + 1]) <= 1 && Math.abs(data[i + 1] - data[i + 2]) <= 1,
      `pixel ${i / info.channels} is neutral grey: ${data[i]},${data[i + 1]},${data[i + 2]}`,
    );
  }

  await validateTransparentPortrait(enhanced.buffer);
});

test("a photograph with no person in it is refused instead of shipped", async () => {
  // A flat gradient: nothing the model can call a subject.
  const empty = await sharp({
    create: { width: 600, height: 800, channels: 3, background: { r: 200, g: 205, b: 210 } },
  })
    .jpeg()
    .toBuffer();

  await assert.rejects(
    () => removePortraitBackground(empty),
    (err: unknown) => {
      assert.ok(err instanceof PortraitProcessingError);
      assert.equal(err.code, "low_quality", "low quality routes the post to needs_review");
      return true;
    },
  );
});

test("unreadable bytes are reported as a source problem, not a model problem", async () => {
  await assert.rejects(
    () => removePortraitBackground(Buffer.from("not an image at all")),
    (err: unknown) => err instanceof PortraitProcessingError && err.code === "source_unreadable",
  );
});

/* ------------------------------------------------------------------ *
 * Caching
 * ------------------------------------------------------------------ */

test("the cut-out cache key follows the photo's bytes, not its storage path", () => {
  const a = fs.readFileSync(PLAIN);
  const b = fs.readFileSync(BUSY);

  assert.equal(portraitSourceFingerprint(a), portraitSourceFingerprint(Buffer.from(a)));
  assert.notEqual(portraitSourceFingerprint(a), portraitSourceFingerprint(b));
  assert.match(portraitSourceFingerprint(a), /^[0-9a-f]{32}$/);

  const service = fs.readFileSync("src/lib/post-studio/service.ts", "utf8");
  assert.match(service, /previous\.sourceFingerprint === fingerprint/, "cache hit is hash-based");
  assert.match(service, /sourceFingerprint: fingerprint/, "and the hash is persisted");
  assert.match(service, /options\.force/, "the admin can force a re-run");
});

/* ------------------------------------------------------------------ *
 * The portrait reaching the poster
 * ------------------------------------------------------------------ */

test("the processed portrait lands in the poster's bottom-right corner", async () => {
  const cutout = await removePortraitBackground(fs.readFileSync(PLAIN));
  const enhanced = await enhancePortraitColor(cutout.buffer);

  const layout = buildPostLayout({
    templateId: "template-01",
    quote: "Bilim olishdan hech qachon qo‘rqmaslik kerak",
    nameLines: splitNameIntoLines("Rasuljonova Gulnoza Avazjon qizi"),
    shortBioItems: ["Talaba", "Ijodkor", "Volontyor"],
    portraitHref: toDataUri(enhanced.buffer, "image/png"),
    portraitTransform: { offsetX: 0, offsetY: 0, scale: 1, flip: false },
  });

  assert.equal(layout.warnings.length, 0, "a real portrait clears every layout warning");
  assert.equal(layout.needsReview, false);

  const { png } = await renderPostImage(layout);
  const rendered = sharp(png);
  const meta = await rendered.metadata();
  assert.equal(meta.width, POST_OUTPUT_SIZE);
  assert.equal(meta.height, POST_OUTPUT_SIZE);

  // The band under the name is flat cyan artwork. Where the portrait covers it
  // the pixels must be grey; where it does not, they must still be cyan.
  const sample = async (left: number, top: number) => {
    // removeAlpha first: the composited poster is RGBA, and reading it as RGB
    // would slide the channels one byte per pixel and make everything neutral.
    const { data } = await sharp(png)
      .extract({ left, top, width: 24, height: 24 })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    let r = 0, g = 0, b = 0;
    for (let i = 0; i < data.length; i += 3) { r += data[i]; g += data[i + 1]; b += data[i + 2]; }
    const n = data.length / 3;
    return { r: r / n, g: g / n, b: b / n };
  };

  const corner = await sample(POST_OUTPUT_SIZE - 120, POST_OUTPUT_SIZE - 120);
  const isNeutral = Math.abs(corner.r - corner.b) <= 2 && Math.abs(corner.g - corner.b) <= 2;
  assert.ok(isNeutral, `bottom-right corner is the greyscale portrait, got ${JSON.stringify(corner)}`);

  const leftBand = await sample(20, POST_OUTPUT_SIZE - 30);
  assert.ok(leftBand.b > leftBand.r + 100, "the far left of the band is still brand cyan");
});

test("preview and final render are built from one layout engine and one asset", () => {
  const service = fs.readFileSync("src/lib/post-studio/service.ts", "utf8");
  // Both paths read the same stable storage object and hand it to the same
  // builder; only how the image is referenced differs (data URI vs URL).
  assert.equal((service.match(/buildPostLayout\(\{/g) ?? []).length, 2);
  for (const fn of ["buildLayoutForPost", "buildLayoutForPreview"]) {
    const block = service.slice(service.indexOf(`export async function ${fn}`));
    assert.match(block, /downloadPostAsset\(post\.candidateId, "portrait-transparent"\)/);
  }

  const withHref = (portraitHref: string | null) =>
    buildPostLayout({
      templateId: "template-03",
      quote: "Bir xil geometriya",
      nameLines: ["ISM", "FAMILIYA"],
      shortBioItems: ["Talaba"],
      portraitHref,
      portraitTransform: { offsetX: 6, offsetY: -4, scale: 1.2, flip: false },
    });

  const preview = withHref("https://example.test/portrait.png");
  const final = withHref("data:image/png;base64,AA==");
  assert.deepEqual(
    { ...preview.portrait, href: null },
    { ...final.portrait, href: null },
    "the portrait box is identical in preview and final",
  );
  assert.deepEqual(preview.quote, final.quote);
  assert.deepEqual(preview.name, final.name);
});
