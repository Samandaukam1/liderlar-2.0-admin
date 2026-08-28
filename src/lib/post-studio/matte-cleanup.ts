import {
  boundsGap,
  connectedComponents,
  dilate,
  erode,
  type Bounds,
} from "./morphology.ts";

/**
 * Artefact cleanup for a segmentation matte.
 *
 * The model's mask is usually right about the person and occasionally wrong
 * about a slab of wall, a chair back or a flag behind them. Those survive as a
 * blob beside the head or shoulder — the visible failure in production was a
 * fragment of the office background left hanging next to a candidate's ear.
 *
 * Removing them is not "keep the largest component": a real ear, a hair clump
 * or a shirt collar can also read as a separate or barely-attached region, and
 * deleting those is a far worse defect than leaving a blob. Two signals do the
 * separating instead:
 *
 *  - *Erosion-assisted splitting.* Background fragments are usually joined to
 *    the person by a bridge only a few pixels wide, which ordinary connected
 *    components will not break. Eroding a copy of the mask severs those bridges
 *    while leaving anatomy — which is attached along a wide front — intact. The
 *    erosion is only ever used for analysis; the matte that ships is never
 *    eroded, so edges keep their softness.
 *
 *  - *The model's own confidence.* Cleanup scores each fragment against the raw
 *    probabilities, not against the ramped alpha, which has already been pushed
 *    to 0/255 and no longer knows what the network believed. An ear the model
 *    was sure about scores near 1.0; the wall it half-believed scores far
 *    lower, and that is the fragment worth dropping.
 */

/** Alpha at or above this is the matte's solid core, i.e. not a soft edge. */
const CORE_ALPHA = 200;
/**
 * Below this raw probability a region is "uncertain".
 *
 * The ramps that build the alpha channel push a 0.68 and a 0.99 to the same
 * 255, so a slab of wall the model half-believed becomes indistinguishable from
 * a cheek. The uncertain pass below puts that difference back for background
 * that is joined to the subject along a front too wide for the bridge analysis
 * to sever.
 */
const UNCERTAIN_CONFIDENCE = 0.75;
/** Erosion radius as a share of the shorter edge; 2px floor for small images. */
const BRIDGE_DIVISOR = 170;
const MIN_BRIDGE_RADIUS = 2;
/** A fragment this large relative to the person is a body part, not a blob. */
const KEEP_AREA_RATIO = 0.15;
/** Mean raw probability at which a fragment counts as confidently person. */
const KEEP_CONFIDENCE = 0.9;
/** How close a confident fragment must sit, as a share of the shorter edge. */
const NEAR_GAP_RATIO = 0.02;
/** Extra dilation when restoring the kept region, to spare the soft fringe. */
const FEATHER_MARGIN = 3;

export interface RemovedFragment {
  area: number;
  meanConfidence: number;
  gap: number;
  bounds: Bounds;
}

export interface CleanupReport {
  /** Fragments deleted as background, largest first. */
  removed: RemovedFragment[];
  /** Pixels the person kept, in the analysed core. */
  keptCoreArea: number;
  /** Share of the original core that was deleted. */
  removedShare: number;
  /** Erosion radius the bridge analysis used, in pixels. */
  bridgeRadius: number;
  /** False when the matte was too thin to analyse and was left alone. */
  analysed: boolean;
}

export interface CleanupResult {
  alpha: Uint8Array;
  report: CleanupReport;
}

function meanOver(values: Uint8Array, labels: Int32Array, label: number, area: number): number {
  let sum = 0;
  for (let i = 0; i < labels.length; i += 1) if (labels[i] === label) sum += values[i];
  return area > 0 ? sum / (area * 255) : 0;
}

/**
 * Deletes background fragments from a refined alpha matte.
 *
 * `confidence` is the network's upscaled probability map, aligned to the same
 * width/height as `alpha`.
 */
export function cleanupMatte(
  alpha: Uint8Array,
  confidence: Uint8Array,
  width: number,
  height: number,
): CleanupResult {
  const shortEdge = Math.min(width, height);
  const bridgeRadius = Math.max(MIN_BRIDGE_RADIUS, Math.round(shortEdge / BRIDGE_DIVISOR));
  // Seeds are measured after erosion, which has pulled every boundary inward by
  // the bridge radius — so two regions that actually touch now read as 2r
  // apart. The allowance is widened to match, or a confidently-detected ear
  // would be judged "far from the person" purely by the analysis step.
  const nearGap = shortEdge * NEAR_GAP_RATIO + 2 * bridgeRadius;

  const core = new Uint8Array(alpha.length);
  const uncertain = new Uint8Array(alpha.length);
  const uncertainFloor = UNCERTAIN_CONFIDENCE * 255;
  for (let i = 0; i < alpha.length; i += 1) {
    core[i] = alpha[i] >= CORE_ALPHA ? 1 : 0;
    uncertain[i] = core[i] && confidence[i] < uncertainFloor ? 1 : 0;
  }

  // Analysis copy only — the shipped matte is never eroded.
  const seeds = erode(core, width, height, bridgeRadius);
  const seeded = connectedComponents(seeds, width, height);

  const emptyReport = (analysed: boolean): CleanupResult => ({
    alpha,
    report: { removed: [], keptCoreArea: 0, removedShare: 0, bridgeRadius, analysed },
  });

  if (seeded.components.length === 0) {
    // Erosion ate everything: the subject is thinner than the bridge radius, so
    // there is nothing safe to reason about. Leave the matte untouched and let
    // the confidence gates decide whether it is publishable.
    return emptyReport(false);
  }

  const person = seeded.components.reduce((a, b) => (b.area > a.area ? b : a));
  const removed: RemovedFragment[] = [];
  const droppedSeeds = new Uint8Array(alpha.length);

  for (const seed of seeded.components) {
    if (seed.label === person.label) continue;

    const meanConfidence = meanOver(confidence, seeded.labels, seed.label, seed.area);
    const gap = boundsGap(seed.bounds, person.bounds);
    const areaRatio = seed.area / person.area;

    const isBodyScale = areaRatio >= KEEP_AREA_RATIO;
    const isConfidentDetail = meanConfidence >= KEEP_CONFIDENCE && gap <= nearGap;
    if (isBodyScale || isConfidentDetail) continue;

    removed.push({ area: seed.area, meanConfidence, gap, bounds: seed.bounds });
    for (let i = 0; i < seeded.labels.length; i += 1) {
      if (seeded.labels[i] === seed.label) droppedSeeds[i] = 1;
    }
  }

  /**
   * Second signal: a *solid* patch the model was unsure about.
   *
   * Every cut-out has an uncertain fringe — that is what a soft edge is — but a
   * fringe is thin and disappears under the same erosion that severs bridges. A
   * slab of background attached to the subject along a wide front does not, and
   * that is the one the bridge analysis above cannot reach. Anything surviving
   * the erosion is at least a (2r+1)² block of "the model did not really think
   * this was a person", so it goes.
   */
  const uncertainBlobs = erode(uncertain, width, height, bridgeRadius);
  const uncertainMap = connectedComponents(uncertainBlobs, width, height);
  for (const blob of uncertainMap.components) {
    removed.push({
      area: blob.area,
      meanConfidence: meanOver(confidence, uncertainMap.labels, blob.label, blob.area),
      gap: boundsGap(blob.bounds, person.bounds),
      bounds: blob.bounds,
    });
    for (let i = 0; i < uncertainMap.labels.length; i += 1) {
      if (uncertainMap.labels[i] === blob.label) droppedSeeds[i] = 1;
    }
  }

  // Dilating the dropped regions back past the erosion radius recovers each
  // fragment's true extent *and* the thin bridge stub that joined it, so no
  // sliver of wall is left pointing at the candidate's ear.
  const removal =
    removed.length > 0 ? dilate(droppedSeeds, width, height, bridgeRadius + 1) : droppedSeeds;

  const survivingCore = new Uint8Array(alpha.length);
  for (let i = 0; i < core.length; i += 1) survivingCore[i] = core[i] && !removal[i] ? 1 : 0;

  // Second pass on the full-resolution core: fragments small enough that the
  // erosion erased them entirely never produced a seed, so they are only
  // reachable here.
  const surviving = connectedComponents(survivingCore, width, height);
  if (surviving.components.length === 0) return emptyReport(false);

  const main = surviving.components.reduce((a, b) => (b.area > a.area ? b : a));
  const keep = new Uint8Array(alpha.length);

  for (const component of surviving.components) {
    const keepIt =
      component.label === main.label ||
      component.area / main.area >= KEEP_AREA_RATIO ||
      (meanOver(confidence, surviving.labels, component.label, component.area) >= KEEP_CONFIDENCE &&
        boundsGap(component.bounds, main.bounds) <= nearGap);

    if (!keepIt) {
      removed.push({
        area: component.area,
        meanConfidence: meanOver(confidence, surviving.labels, component.label, component.area),
        gap: boundsGap(component.bounds, main.bounds),
        bounds: component.bounds,
      });
      continue;
    }
    for (let i = 0; i < surviving.labels.length; i += 1) {
      if (surviving.labels[i] === component.label) keep[i] = 1;
    }
  }

  if (removed.length === 0) {
    return {
      alpha,
      report: { removed, keptCoreArea: main.area, removedShare: 0, bridgeRadius, analysed: true },
    };
  }

  // Restore a margin around what we kept so the soft, sub-core edge — hair
  // wisps, the shoulder's anti-aliased boundary — is not clipped into a hard
  // paper-doll outline by the cleanup.
  const keepRegion = dilate(keep, width, height, bridgeRadius + FEATHER_MARGIN);

  const out = new Uint8Array(alpha.length);
  let removedPixels = 0;
  for (let i = 0; i < alpha.length; i += 1) {
    if (keepRegion[i]) {
      out[i] = alpha[i];
    } else {
      if (alpha[i] > 0) removedPixels += 1;
      out[i] = 0;
    }
  }

  const originalCoreArea = core.reduce((n, v) => n + v, 0);
  removed.sort((a, b) => b.area - a.area);

  return {
    alpha: out,
    report: {
      removed,
      keptCoreArea: main.area,
      removedShare: originalCoreArea > 0 ? removedPixels / originalCoreArea : 0,
      bridgeRadius,
      analysed: true,
    },
  };
}
