/**
 * Binary morphology and connected components for matte cleanup.
 *
 * Pure, allocation-conscious and dependency-free: these run on 1400x1400
 * masks inside a lambda, so every operation is a flat typed-array pass rather
 * than a per-pixel object or a nested array.
 *
 * Erosion/dilation use a square structuring element, applied separably (a
 * horizontal pass then a vertical one), which is exact for a square and turns
 * an O(k²) window into O(k) per pixel.
 */

export interface Bounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export interface Component {
  label: number;
  area: number;
  bounds: Bounds;
}

export interface ComponentMap {
  /** 0 = background, otherwise the component's label. */
  labels: Int32Array;
  components: Component[];
  width: number;
  height: number;
}

/** Erodes a 0/1 mask by `radius` using a (2r+1)² square element. */
export function erode(mask: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  return separable(mask, width, height, radius, Math.min);
}

/** Dilates a 0/1 mask by `radius` using a (2r+1)² square element. */
export function dilate(mask: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  return separable(mask, width, height, radius, Math.max);
}

function separable(
  mask: Uint8Array,
  width: number,
  height: number,
  radius: number,
  pick: (a: number, b: number) => number,
): Uint8Array {
  if (radius <= 0) return Uint8Array.from(mask);

  const horizontal = new Uint8Array(mask.length);
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    for (let x = 0; x < width; x += 1) {
      let value = mask[row + x];
      const from = Math.max(0, x - radius);
      const to = Math.min(width - 1, x + radius);
      for (let i = from; i <= to; i += 1) value = pick(value, mask[row + i]);
      horizontal[row + x] = value;
    }
  }

  const out = new Uint8Array(mask.length);
  for (let y = 0; y < height; y += 1) {
    const from = Math.max(0, y - radius);
    const to = Math.min(height - 1, y + radius);
    for (let x = 0; x < width; x += 1) {
      let value = horizontal[y * width + x];
      for (let i = from; i <= to; i += 1) value = pick(value, horizontal[i * width + x]);
      out[y * width + x] = value;
    }
  }
  return out;
}

/**
 * Labels 8-connected regions of a 0/1 mask.
 *
 * 8-connectivity rather than 4: a hair strand or an ear that only touches the
 * head diagonally is one region with the head, which is what keeps the cleanup
 * from treating real anatomy as a detached island.
 */
export function connectedComponents(
  mask: Uint8Array,
  width: number,
  height: number,
): ComponentMap {
  const labels = new Int32Array(mask.length);
  const components: Component[] = [];
  const queue = new Int32Array(mask.length);

  let next = 0;
  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || labels[start]) continue;

    next += 1;
    let head = 0;
    let tail = 0;
    queue[tail += 1] = start;
    labels[start] = next;

    let area = 0;
    let left = width;
    let right = -1;
    let top = height;
    let bottom = -1;

    while (head < tail) {
      const index = queue[head += 1];
      const x = index % width;
      const y = (index - x) / width;

      area += 1;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;

      for (let dy = -1; dy <= 1; dy += 1) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          const n = ny * width + nx;
          if (!mask[n] || labels[n]) continue;
          labels[n] = next;
          queue[tail += 1] = n;
        }
      }
    }

    components.push({
      label: next,
      area,
      bounds: { left, top, right, bottom, width: right - left + 1, height: bottom - top + 1 },
    });
  }

  return { labels, components, width, height };
}

/**
 * Shortest gap in pixels between two boxes; 0 when they touch or overlap.
 * Boxes are inclusive pixel ranges, so neighbouring columns (right=10,
 * left=11) are touching and separated by nothing.
 */
export function boundsGap(a: Bounds, b: Bounds): number {
  const dx = Math.max(0, Math.max(a.left - b.right, b.left - a.right) - 1);
  const dy = Math.max(0, Math.max(a.top - b.bottom, b.top - a.bottom) - 1);
  return Math.hypot(dx, dy);
}

/**
 * Tight box of everything at or above `threshold`, or null when the mask is
 * empty. This is what the layout measures the person by — never the image's
 * own dimensions, which include however much transparent padding the source
 * photo happened to carry.
 */
export function alphaBounds(
  alpha: Uint8Array,
  width: number,
  height: number,
  threshold: number,
): Bounds | null {
  let left = width;
  let right = -1;
  let top = height;
  let bottom = -1;

  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    for (let x = 0; x < width; x += 1) {
      if (alpha[row + x] < threshold) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }

  if (right < 0) return null;
  return { left, top, right, bottom, width: right - left + 1, height: bottom - top + 1 };
}
