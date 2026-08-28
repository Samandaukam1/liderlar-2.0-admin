import { DEFAULT_PORTRAIT_TRANSFORM, type Box, type PortraitTransform } from "./types.ts";

/**
 * Bottom-right corner placement for the portrait cut-out.
 *
 * The frame in layout-config.ts is flush with the canvas' right edge and its
 * floor, and the admin's scale slider grows the cut-out *out of that corner*
 * — up and to the left — rather than around the frame's centre. Centre-growth
 * pushed a scaled-up portrait off the right edge and cropped the shoulder.
 *
 * Kept free of `server-only`: the studio's drag-preview re-runs this exact
 * function on the client while a slider moves, so what the admin sees while
 * dragging is what the renderer will draw after the save round-trip.
 */

export interface PlacedPortrait {
  x: number;
  y: number;
  width: number;
  height: number;
}

function safeScale(transform: PortraitTransform): number {
  return Number.isFinite(transform.scale) && transform.scale > 0 ? transform.scale : 1;
}

/** Where the cut-out lands for a given frame and admin transform, in 810-space. */
export function placePortrait(
  frame: Box,
  transform: PortraitTransform = DEFAULT_PORTRAIT_TRANSFORM,
): PlacedPortrait {
  const scale = safeScale(transform);
  const width = frame.width * scale;
  const height = frame.height * scale;

  return {
    x: frame.x + frame.width - width + transform.offsetX,
    y: frame.y + frame.height - height + transform.offsetY,
    width,
    height,
  };
}

/**
 * Inverse of `placePortrait`. The studio client receives a laid-out portrait
 * rather than the template frame, so it recovers the frame once and re-places
 * it against the slider values instead of re-deriving the geometry by hand.
 */
export function derivePortraitFrame(
  placed: PlacedPortrait,
  transform: PortraitTransform = DEFAULT_PORTRAIT_TRANSFORM,
): Box {
  const scale = safeScale(transform);
  const width = placed.width / scale;
  const height = placed.height / scale;

  return {
    x: placed.x - transform.offsetX - width + placed.width,
    y: placed.y - transform.offsetY - height + placed.height,
    width,
    height,
  };
}
