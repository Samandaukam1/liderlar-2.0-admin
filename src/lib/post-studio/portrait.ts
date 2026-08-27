import "server-only";
import sharp from "sharp";

/**
 * Portrait preparation for Post Studio.
 *
 * Background removal is deliberately provider-based alpha matting, never a
 * generative image edit: the brief requires that the candidate's face, hair,
 * clothing, skin tone and body shape are preserved exactly, and an
 * `images/edits` round-trip repaints all of them. Providers here return the
 * original pixels with an alpha channel attached.
 *
 * If no provider is configured, or the cut-out fails the quality gate, the
 * caller is told to route the post to `needs_review` — auto-publishing a broken
 * cut-out is worse than not publishing.
 */

export type BackgroundRemovalProvider = "removebg" | "photoroom" | "none";

export interface PortraitCutout {
  buffer: Buffer;
  provider: BackgroundRemovalProvider;
  width: number;
  height: number;
  /** Share of pixels that survived as (partly) opaque subject. */
  coverage: number;
}

export type PortraitFailureCode =
  | "no_provider"
  | "provider_failed"
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

/** Longest edge of the stored cut-out; the frame is 398x624 units at 1080px. */
const MAX_CUTOUT_EDGE = 1400;

/**
 * A believable head-and-shoulders cut-out covers a meaningful slice of the
 * frame but never almost all of it. Outside this band the matte has usually
 * either eaten the subject or kept the background.
 */
const MIN_COVERAGE = 0.08;
const MAX_COVERAGE = 0.88;

export function activeProvider(): BackgroundRemovalProvider {
  if (process.env.REMOVEBG_API_KEY) return "removebg";
  if (process.env.PHOTOROOM_API_KEY) return "photoroom";
  return "none";
}

async function callRemoveBg(source: Buffer): Promise<Buffer> {
  const form = new FormData();
  form.append("image_file", new Blob([new Uint8Array(source)]), "portrait.png");
  form.append("size", "auto");
  form.append("format", "png");
  // "person" tells the matter what it is looking at; it does not repaint.
  form.append("type", "person");

  const response = await fetch("https://api.remove.bg/v1.0/removebg", {
    method: "POST",
    headers: { "X-Api-Key": process.env.REMOVEBG_API_KEY! },
    body: form,
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new PortraitProcessingError(
      `remove.bg ${response.status}: ${detail.slice(0, 300)}`,
      "provider_failed",
    );
  }
  return Buffer.from(await response.arrayBuffer());
}

async function callPhotoRoom(source: Buffer): Promise<Buffer> {
  const form = new FormData();
  form.append("image_file", new Blob([new Uint8Array(source)]), "portrait.png");
  form.append("format", "png");

  const response = await fetch("https://sdk.photoroom.com/v1/segment", {
    method: "POST",
    headers: { "x-api-key": process.env.PHOTOROOM_API_KEY! },
    body: form,
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new PortraitProcessingError(
      `PhotoRoom ${response.status}: ${detail.slice(0, 300)}`,
      "provider_failed",
    );
  }
  return Buffer.from(await response.arrayBuffer());
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

/**
 * Trims fully transparent margins so the stored asset is the subject's own
 * bounding box — the layout frame is bottom-anchored, and stray transparent
 * padding would float the candidate off the canvas floor.
 */
async function normalizeCutout(cutout: Buffer): Promise<{ buffer: Buffer; width: number; height: number }> {
  const trimmed = await sharp(cutout)
    .ensureAlpha()
    .trim({ threshold: 1 })
    .resize({
      width: MAX_CUTOUT_EDGE,
      height: MAX_CUTOUT_EDGE,
      fit: "inside",
      withoutEnlargement: true,
    })
    .png({ compressionLevel: 9 })
    .toBuffer({ resolveWithObject: true });

  return { buffer: trimmed.data, width: trimmed.info.width, height: trimmed.info.height };
}

/**
 * Runs the configured provider and validates the result. Never mutates or
 * overwrites the source photo — the cut-out is stored as a separate asset.
 */
export async function removePortraitBackground(source: Buffer): Promise<PortraitCutout> {
  const provider = activeProvider();
  if (provider === "none") {
    throw new PortraitProcessingError(
      "Fon olib tashlash provayderi sozlanmagan (REMOVEBG_API_KEY yoki PHOTOROOM_API_KEY).",
      "no_provider",
    );
  }

  try {
    await sharp(source).metadata();
  } catch {
    throw new PortraitProcessingError("Manba rasmni o‘qib bo‘lmadi.", "source_unreadable");
  }

  const raw = provider === "removebg" ? await callRemoveBg(source) : await callPhotoRoom(source);
  const { buffer, width, height } = await normalizeCutout(raw);
  const coverage = await measureCoverage(buffer);

  if (coverage < MIN_COVERAGE || coverage > MAX_COVERAGE) {
    throw new PortraitProcessingError(
      `Cutout sifati past (qamrov ${(coverage * 100).toFixed(1)}%). Qo‘lda tekshirish kerak.`,
      "low_quality",
    );
  }

  return { buffer, provider, width, height, coverage };
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
