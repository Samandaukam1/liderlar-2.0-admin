import sharp from "sharp";

/**
 * Alpha-matte refinement — the step between "the network said 0.62 here" and a
 * cut-out that can sit on the poster's cyan band without a grey halo.
 *
 * A plain threshold is not enough in either direction. Cutting at 0.5 gives a
 * hard, aliased, paper-doll edge; keeping the raw upscaled probabilities leaves
 * a translucent wash of background over the whole frame, because a 320x320
 * prediction stretched to 1400px is soft everywhere. So the mask is squeezed in
 * three moves: a first ramp that discards the low-confidence wash, a small blur
 * that restores anti-aliasing, and a second, *asymmetric* ramp that pulls the
 * boundary a fraction of a pixel inwards — which is what removes the fringe of
 * original background colour that would otherwise outline the candidate.
 *
 * Pure and dependency-light on purpose (only sharp's blur), so the numbers
 * below are exercised directly by the tests instead of only through a render.
 */

/** Below this the upscaled probability is background wash, not a soft edge. */
const WASH_FLOOR = 0.3;
/** Above this it is solidly subject. Between the two, a real gradient. */
const WASH_CEILING = 0.7;
/**
 * Second ramp, deliberately off-centre: raising the floor more than the ceiling
 * erodes the boundary slightly, so edge pixels still carrying the old
 * background's colour end up transparent instead of haloed.
 */
const EDGE_FLOOR = 0.42;
const EDGE_CEILING = 0.88;

/** Blur radius as a fraction of the shorter edge, with a sub-pixel floor. */
const FEATHER_DIVISOR = 600;
const MIN_FEATHER = 0.6;

/** Alpha at or below this is background; at or above, opaque subject. */
export const ALPHA_CLEAR = 8;
export const ALPHA_OPAQUE = 247;

export interface MatteStats {
  /** Mean alpha over the frame, 0..1 — how much of it the subject fills. */
  coverage: number;
  /** Share of pixels that are neither clearly in nor clearly out. */
  softShare: number;
  /** Share that the matte committed on, either way. */
  decisiveShare: number;
}

/**
 * Rescales alpha so `lo` maps to fully transparent and `hi` to fully opaque,
 * keeping a genuine gradient in between. Operates on a copy.
 */
export function rampAlpha(alpha: Uint8Array, lo: number, hi: number): Uint8Array {
  const low = lo * 255;
  const span = (hi - lo) * 255;
  const out = new Uint8Array(alpha.length);
  for (let i = 0; i < alpha.length; i += 1) {
    const v = (alpha[i] - low) / span;
    out[i] = v <= 0 ? 0 : v >= 1 ? 255 : Math.round(v * 255);
  }
  return out;
}

export function measureMatte(alpha: Uint8Array): MatteStats {
  let sum = 0;
  let soft = 0;
  for (let i = 0; i < alpha.length; i += 1) {
    sum += alpha[i];
    if (alpha[i] > ALPHA_CLEAR && alpha[i] < ALPHA_OPAQUE) soft += 1;
  }
  const softShare = soft / alpha.length;
  return {
    coverage: sum / (alpha.length * 255),
    softShare,
    decisiveShare: 1 - softShare,
  };
}

export interface RefinedMask {
  /** The alpha channel to attach to the photograph. */
  alpha: Uint8Array;
  /**
   * The network's own probabilities at working resolution. Kept because the
   * ramps below destroy them — everything is 0 or 255 afterwards — and the
   * artefact cleanup needs to know how sure the model actually was about each
   * fragment before it decides to delete one.
   */
  confidence: Uint8Array;
}

/**
 * Upscales the network's probabilities to the working image and refines them
 * into a usable alpha channel.
 */
export async function refineMask(
  probabilities: Float32Array,
  maskSize: number,
  width: number,
  height: number,
): Promise<RefinedMask> {
  const coarse = Buffer.alloc(probabilities.length);
  for (let i = 0; i < probabilities.length; i += 1) {
    const v = probabilities[i];
    coarse[i] = v <= 0 ? 0 : v >= 1 ? 255 : Math.round(v * 255);
  }

  // Lanczos on the way up is what gives the edge its gradient in the first
  // place; a nearest-neighbour upscale would produce 4px staircase blocks.
  const upscaled = await sharp(coarse, { raw: { width: maskSize, height: maskSize, channels: 1 } })
    .resize(width, height, { fit: "fill", kernel: "lanczos3" })
    .toColourspace("b-w")
    .raw()
    .toBuffer();

  const cleaned = rampAlpha(upscaled, WASH_FLOOR, WASH_CEILING);

  const feathered = await sharp(cleaned, { raw: { width, height, channels: 1 } })
    .blur(Math.max(MIN_FEATHER, Math.min(width, height) / FEATHER_DIVISOR))
    .toColourspace("b-w")
    .raw()
    .toBuffer();

  return {
    alpha: rampAlpha(feathered, EDGE_FLOOR, EDGE_CEILING),
    confidence: new Uint8Array(upscaled),
  };
}

/**
 * Attaches the alpha channel to the working RGB pixels.
 *
 * The RGB bytes are copied through untouched — this is the guarantee that the
 * candidate's face, hair, clothing and skin tone reach the poster exactly as
 * they were photographed. sharp's `joinChannel` is not used: on a 3-band sRGB
 * pipeline it silently drops the extra band instead of promoting it to alpha.
 */
export function attachAlpha(rgb: Uint8Array, alpha: Uint8Array): Buffer {
  const pixels = alpha.length;
  if (rgb.length !== pixels * 3) {
    throw new Error(`expected ${pixels * 3} RGB bytes for ${pixels} alpha samples, got ${rgb.length}`);
  }

  const rgba = Buffer.alloc(pixels * 4);
  for (let p = 0; p < pixels; p += 1) {
    rgba[p * 4] = rgb[p * 3];
    rgba[p * 4 + 1] = rgb[p * 3 + 1];
    rgba[p * 4 + 2] = rgb[p * 3 + 2];
    rgba[p * 4 + 3] = alpha[p];
  }
  return rgba;
}
