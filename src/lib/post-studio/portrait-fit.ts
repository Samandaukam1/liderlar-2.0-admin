import { POST_CANVAS_UNITS, type PortraitTransform } from "./types.ts";
import type { Bounds } from "./morphology.ts";

/**
 * Canonical portrait scaling.
 *
 * The bug this replaces: the portrait was fitted to the *stored PNG's* width
 * and height. Two candidates photographed at different crops therefore landed
 * at wildly different sizes on the poster — one filling the frame, the next
 * shrunk into the corner — because a source that happened to carry a lot of
 * transparent margin was measured as if that margin were the person.
 *
 * The fit now measures the person: `personBounds` is the tight box of opaque
 * pixels inside the cut-out, computed once at processing time and stored with
 * the asset. Every constraint below is expressed against that box, so the
 * candidate's head lands in the same place whatever the source photo looked
 * like.
 *
 * The scale is the *smallest* value that satisfies every constraint, which is
 * what stops the head from climbing over the quote or the shoulders from
 * spilling across it, and it is then clamped up to a floor so a compact source
 * cannot leave a candidate stranded at a quarter of the frame.
 */

/**
 * Geometry, all in the master SVG's 810-unit space.
 *
 * Where they come from — measured off the masters, not eyeballed:
 *  - The card interior ends at y=476 and the cyan band runs 476..810.
 *  - The portrait frame the masters reserve starts at y=186, so 186 is the
 *    hard ceiling: hair crossing it collides with the decorative quote glyph
 *    (clipped to y 44.5..166.8) and with the logo lock-up above it.
 *  - The canvas floor and right edge, 810, are the anchors: the reference
 *    posters bleed the cut-out into that corner.
 */
export const PORTRAIT_FIT = {
  /** Hard ceiling for the top of the head. Never crossed. */
  headTopLimit: 186,
  /**
   * Where the head should land. 810 - 232 = 578 units of person, i.e. 71% of
   * the canvas height — the standing bust proportion the reference posters
   * use, and comfortably clear of the 186 ceiling.
   */
  headTopTarget: 232,
  /**
   * Either side of the target counts as canonical. The band is wide on purpose:
   * a broad-shouldered bust hits `maxPersonWidth` before it reaches the head
   * target and legitimately settles lower — measured at 278.6 on the reference
   * studio portrait against 232 for a narrower one, which is 8% apart in
   * visual height and reads as the same standard.
   */
  headTopTolerance: 50,
  /** The person's right edge sits on the canvas edge. */
  rightAnchor: POST_CANVAS_UNITS,
  /** ...and their bottom on the canvas floor. */
  bottomAnchor: POST_CANVAS_UNITS,
  /**
   * Widest the person may render. Broad shoulders scaled to the head target
   * would otherwise reach across the quote column; this caps them at the
   * quote's right limit plus a gutter, and costs a little height instead.
   */
  maxPersonWidth: 455,
  /** Visual height floor and ceiling, so neither extreme source can win. */
  minPersonHeight: 470,
  maxPersonHeight: POST_CANVAS_UNITS - 186,
} as const;

export interface PersonBounds {
  /** Tight box of opaque pixels, in the cut-out's own pixel space. */
  left: number;
  top: number;
  width: number;
  height: number;
  /** Dimensions of the stored PNG the box was measured in. */
  imageWidth: number;
  imageHeight: number;
}

export interface PortraitPlacement {
  /** Where to draw the whole PNG, in 810-space. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Where the person themself ends up, in 810-space. */
  person: { left: number; top: number; right: number; bottom: number; width: number; height: number };
  /** Units-per-source-pixel actually applied. */
  scale: number;
  /** Which constraint decided the scale. */
  limitedBy: "headTarget" | "maxWidth" | "maxHeight" | "minHeight" | "headLimit";
}

export function toPersonBounds(
  box: Bounds,
  imageWidth: number,
  imageHeight: number,
): PersonBounds {
  return {
    left: box.left,
    top: box.top,
    width: box.width,
    height: box.height,
    imageWidth,
    imageHeight,
  };
}

/** A cut-out with no stored bounds falls back to its full frame. */
export function fallbackPersonBounds(imageWidth: number, imageHeight: number): PersonBounds {
  return { left: 0, top: 0, width: imageWidth, height: imageHeight, imageWidth, imageHeight };
}

/**
 * Solves the canonical scale for one person box.
 *
 * Each constraint is converted into the scale that would satisfy it exactly,
 * and the binding one is whichever is smallest — then the floor is applied, and
 * the head-ceiling last, because it is the one rule that may not be traded away.
 */
export function fitPortrait(person: PersonBounds): PortraitPlacement {
  const fit = PORTRAIT_FIT;

  const candidates: { scale: number; limitedBy: PortraitPlacement["limitedBy"] }[] = [
    { scale: (fit.bottomAnchor - fit.headTopTarget) / person.height, limitedBy: "headTarget" },
    { scale: fit.maxPersonWidth / person.width, limitedBy: "maxWidth" },
    { scale: fit.maxPersonHeight / person.height, limitedBy: "maxHeight" },
  ];

  let chosen = candidates.reduce((a, b) => (b.scale < a.scale ? b : a));

  const minScale = fit.minPersonHeight / person.height;
  if (chosen.scale < minScale) chosen = { scale: minScale, limitedBy: "minHeight" };

  // The ceiling wins over everything, including the floor: a very tall source
  // must shrink rather than push hair over the quote glyph.
  const ceilingScale = (fit.bottomAnchor - fit.headTopLimit) / person.height;
  if (chosen.scale > ceilingScale) chosen = { scale: ceilingScale, limitedBy: "headLimit" };

  const scale = chosen.scale;
  const personWidth = person.width * scale;
  const personHeight = person.height * scale;

  // Anchor the *person*, then back out where the whole PNG has to sit so that
  // their box lands there — this is what makes transparent padding irrelevant.
  const personLeft = fit.rightAnchor - personWidth;
  const personTop = fit.bottomAnchor - personHeight;

  return {
    x: personLeft - person.left * scale,
    y: personTop - person.top * scale,
    width: person.imageWidth * scale,
    height: person.imageHeight * scale,
    person: {
      left: personLeft,
      top: personTop,
      right: fit.rightAnchor,
      bottom: fit.bottomAnchor,
      width: personWidth,
      height: personHeight,
    },
    scale,
    limitedBy: chosen.limitedBy,
  };
}

/** True when the head landed inside the canonical band. */
export function isCanonicalHeadTop(top: number): boolean {
  return (
    top >= PORTRAIT_FIT.headTopLimit &&
    Math.abs(top - PORTRAIT_FIT.headTopTarget) <= PORTRAIT_FIT.headTopTolerance
  );
}

/**
 * Applies the admin's manual nudge on top of the canonical fit. Sliders are an
 * override, never the base: a post with no manual values always renders at the
 * canonical placement, and one that was hand-tuned keeps exactly its offset.
 */
export function applyPortraitOverride(
  placement: PortraitPlacement,
  transform: PortraitTransform,
): { x: number; y: number; width: number; height: number } {
  const scale = Number.isFinite(transform.scale) && transform.scale > 0 ? transform.scale : 1;
  const width = placement.width * scale;
  const height = placement.height * scale;

  // Grown from the same bottom-right corner the canonical fit anchors to, so
  // turning the slider never slides the candidate off the canvas edge.
  return {
    x: placement.x + (placement.width - width) + transform.offsetX,
    y: placement.y + (placement.height - height) + transform.offsetY,
    width,
    height,
  };
}
