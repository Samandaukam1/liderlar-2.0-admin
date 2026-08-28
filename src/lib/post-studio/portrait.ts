import "server-only";
import crypto from "node:crypto";
import sharp from "sharp";
import { runSegmentation, segmentationModelAvailable } from "./segmentation.ts";
import { attachAlpha, measureMatte, refineMask, type MatteStats } from "./matte.ts";

/**
 * Portrait preparation for Post Studio.
 *
 * Background removal runs on our own server: a U²-Net ONNX graph predicts a
 * per-pixel alpha matte (see segmentation.ts), the matte is refined (matte.ts),
 * and it is attached to the candidate's *original* pixels. No third-party image
 * API is involved and nothing is regenerated — the brief requires that the
 * candidate's face, hair, clothing, skin tone and body shape survive untouched,
 * which an `images/edits` round-trip would repaint.
 *
 * Everything happens in memory. No temporary file is written, so there is
 * nothing to leak or to clean up after the request, and the private source
 * photo is never copied into a public bucket — only the derived cut-out is
 * stored, and that is the asset the poster publishes anyway.
 *
 * When the matte cannot be trusted the caller is told to route the post to
 * `needs_review`; an original, still-backgrounded photo is never allowed onto
 * a poster as a fallback.
 */

export interface PortraitCutout {
  buffer: Buffer;
  width: number;
  height: number;
  /** Share of pixels that survived as (partly) opaque subject. */
  coverage: number;
  /** Highest foreground probability the model produced, 0..1. */
  confidence: number;
  /** Share of pixels the matte committed on, either way. */
  decisiveShare: number;
}

export interface EnhancedPortrait {
  buffer: Buffer;
  width: number;
  height: number;
  saturation: number;
  alphaCoverageBefore: number;
  alphaCoverageAfter: number;
}

export type PortraitFailureCode =
  | "model_unavailable"
  | "segmentation_failed"
  | "low_quality"
  | "source_unreadable";

export class PortraitProcessingError extends Error {
  // Declared as a plain field rather than a constructor parameter property:
  // node --test strips types only, and parameter properties need a real
  // transpiler, so the tests could not import this module.
  readonly code: PortraitFailureCode;

  constructor(message: string, code: PortraitFailureCode) {
    super(message);
    this.name = "PortraitProcessingError";
    this.code = code;
  }
}

/** Longest edge of the working image; the frame is 398x624 units at 1080px. */
const MAX_CUTOUT_EDGE = 1400;

/**
 * A believable head-and-shoulders cut-out covers a meaningful slice of the
 * frame but never almost all of it. Outside this band the matte has usually
 * either eaten the subject or kept the background.
 */
const MIN_COVERAGE = 0.08;
const MAX_COVERAGE = 0.88;

/**
 * Confidence floors. `peak` below this means the model never found anything it
 * considered foreground; a low decisive share means it hedged across the whole
 * frame, which upscales into a translucent smear rather than a cut-out.
 */
const MIN_PEAK_CONFIDENCE = 0.5;
const MIN_DECISIVE_SHARE = 0.9;

/**
 * The poster art direction desaturates the cut-out completely: the candidate is
 * printed in greyscale against the coloured card and cyan band. This is a pure
 * RGB channel operation — no skin, shape or image generation is involved, and
 * the alpha channel is asserted unchanged by `enhancePortraitColor`.
 */
export const POST_PORTRAIT_SATURATION = 0;

/**
 * Identity of a source photo, used as the cache key for the stored cut-out.
 * Content-addressed rather than URL-addressed: the intake storage path stays
 * the same when a candidate replaces their photo, so a URL would never
 * invalidate.
 */
export function portraitSourceFingerprint(source: Buffer): string {
  return crypto.createHash("sha256").update(source).digest("hex").slice(0, 32);
}

interface WorkingImage {
  rgb: Buffer;
  width: number;
  height: number;
}

/**
 * Normalises whatever the candidate uploaded into the pixels both the network
 * and the final cut-out see: EXIF rotation applied, colour profile converted to
 * sRGB, and the long edge capped so a 12-megapixel phone photo cannot blow the
 * lambda's memory budget.
 */
async function prepareWorkingImage(source: Buffer): Promise<WorkingImage> {
  try {
    const { data, info } = await sharp(source)
      .rotate()
      .resize({
        width: MAX_CUTOUT_EDGE,
        height: MAX_CUTOUT_EDGE,
        fit: "inside",
        withoutEnlargement: true,
      })
      .toColourspace("srgb")
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    return { rgb: data, width: info.width, height: info.height };
  } catch {
    throw new PortraitProcessingError("Manba rasmni o‘qib bo‘lmadi.", "source_unreadable");
  }
}

/**
 * Measures how much of the image the matte kept. Reads the alpha channel's
 * mean directly rather than counting pixels in JS, which would be far slower on
 * a 1400px image inside a lambda.
 */
export async function measureCoverage(cutout: Buffer): Promise<number> {
  const image = sharp(cutout).ensureAlpha();
  const { channels } = await image.stats();
  const alpha = channels[channels.length - 1];
  return alpha ? alpha.mean / 255 : 0;
}

/** Rejects an opaque result even if it happens to be encoded as PNG. */
export async function validateTransparentPortrait(cutout: Buffer): Promise<{
  width: number;
  height: number;
  coverage: number;
}> {
  const image = sharp(cutout);
  const metadata = await image.metadata();
  if (!metadata.hasAlpha || !metadata.width || !metadata.height) {
    throw new PortraitProcessingError(
      "Fon olib tashlash natijasida alpha channel topilmadi.",
      "low_quality",
    );
  }

  const { channels } = await image.stats();
  const alpha = channels[channels.length - 1];
  const coverage = alpha ? alpha.mean / 255 : 1;
  if (!alpha || alpha.min >= 255 || alpha.max <= 0) {
    throw new PortraitProcessingError(
      "Fon olib tashlash natijasi haqiqiy shaffof portret emas.",
      "low_quality",
    );
  }
  return { width: metadata.width, height: metadata.height, coverage };
}

/**
 * Applies the poster's saturation pass to RGB only. Sharp carries the existing
 * alpha channel through `modulate`; the before/after gate makes that guarantee
 * executable rather than an assumption.
 */
export async function enhancePortraitColor(
  cutout: Buffer,
  saturation = POST_PORTRAIT_SATURATION,
): Promise<EnhancedPortrait> {
  const before = await validateTransparentPortrait(cutout);
  const output = await sharp(cutout)
    .ensureAlpha()
    .modulate({ saturation })
    .png({ compressionLevel: 9 })
    .toBuffer();
  const after = await validateTransparentPortrait(output);

  if (
    before.width !== after.width ||
    before.height !== after.height ||
    Math.abs(before.coverage - after.coverage) > 0.000_001
  ) {
    throw new PortraitProcessingError(
      "Rangni boyitish vaqtida portret shaffofligi o‘zgardi.",
      "low_quality",
    );
  }

  return {
    buffer: output,
    width: after.width,
    height: after.height,
    saturation,
    alphaCoverageBefore: before.coverage,
    alphaCoverageAfter: after.coverage,
  };
}

/**
 * Trims fully transparent margins so the stored asset is the subject's own
 * bounding box — the layout frame is corner-anchored, and stray transparent
 * padding would float the candidate off the canvas floor and away from the
 * right edge.
 */
async function trimToSubject(rgba: Buffer, width: number, height: number): Promise<{
  buffer: Buffer;
  width: number;
  height: number;
}> {
  const trimmed = await sharp(rgba, { raw: { width, height, channels: 4 } })
    .trim({ threshold: 1 })
    .png({ compressionLevel: 9 })
    .toBuffer({ resolveWithObject: true });

  return { buffer: trimmed.data, width: trimmed.info.width, height: trimmed.info.height };
}

/** Turns a matte the model hedged on into a review, not a broken poster. */
function assertUsableMatte(stats: MatteStats, confidence: number): void {
  if (confidence < MIN_PEAK_CONFIDENCE) {
    throw new PortraitProcessingError(
      `Model rasmda odamni ishonchli aniqlay olmadi (ishonch ${(confidence * 100).toFixed(0)}%).`,
      "low_quality",
    );
  }
  if (stats.decisiveShare < MIN_DECISIVE_SHARE) {
    throw new PortraitProcessingError(
      `Maska juda noaniq (aniq piksellar ${(stats.decisiveShare * 100).toFixed(1)}%).`,
      "low_quality",
    );
  }
  if (stats.coverage < MIN_COVERAGE || stats.coverage > MAX_COVERAGE) {
    throw new PortraitProcessingError(
      `Cutout sifati past (qamrov ${(stats.coverage * 100).toFixed(1)}%). Qo‘lda tekshirish kerak.`,
      "low_quality",
    );
  }
}

/**
 * Runs the local segmentation model and returns a transparent cut-out. Never
 * mutates or overwrites the source photo — the cut-out is a separate asset.
 */
export async function removePortraitBackground(source: Buffer): Promise<PortraitCutout> {
  if (!segmentationModelAvailable()) {
    throw new PortraitProcessingError(
      "Segmentatsiya modeli topilmadi (models/silueta.onnx).",
      "model_unavailable",
    );
  }

  const working = await prepareWorkingImage(source);

  // The network wants a fixed 320x320 frame; "fill" rather than "contain" so
  // no letterbox bars enter the prediction. The mask is stretched back to the
  // working aspect ratio in refineMask.
  const modelFrame = await sharp(working.rgb, {
    raw: { width: working.width, height: working.height, channels: 3 },
  })
    .resize(320, 320, { fit: "fill", kernel: "lanczos3" })
    .raw()
    .toBuffer();

  let mask;
  try {
    mask = await runSegmentation(modelFrame);
  } catch (err) {
    throw new PortraitProcessingError(
      `Segmentatsiya bajarilmadi: ${err instanceof Error ? err.message : String(err)}`,
      "segmentation_failed",
    );
  }

  const alpha = await refineMask(mask.data, mask.size, working.width, working.height);
  const stats = measureMatte(alpha);
  assertUsableMatte(stats, mask.peak);

  const trimmed = await trimToSubject(
    attachAlpha(working.rgb, alpha),
    working.width,
    working.height,
  );
  const validated = await validateTransparentPortrait(trimmed.buffer);

  return {
    buffer: trimmed.buffer,
    width: trimmed.width,
    height: trimmed.height,
    coverage: validated.coverage,
    confidence: mask.peak,
    decisiveShare: stats.decisiveShare,
  };
}

/** Downloads a stored/remote source photo for processing. */
export async function fetchPortraitSource(url: string): Promise<Buffer> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new PortraitProcessingError(
      `Portret manbasini yuklab bo‘lmadi (${response.status}).`,
      "source_unreadable",
    );
  }
  return Buffer.from(await response.arrayBuffer());
}
