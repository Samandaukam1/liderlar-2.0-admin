import { fontFamilyAttr } from "./font-stacks.ts";
import {
  POST_CANVAS_UNITS,
  resolveRunFill,
  type LaidOutBlock,
  type PostLayout,
  type PostPalette,
} from "./types.ts";

/**
 * SVG serialisation for a laid-out post.
 *
 * Text is emitted as absolutely-positioned <text> elements — one per colour run
 * — rather than as a flowed block with tspans. Every x and baseline y already
 * came out of the layout engine, so the renderer never re-wraps, and a run's
 * position cannot drift between the preview and the final raster.
 */

const XML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
};

/** Escapes text and attribute content. Uzbek ‘ / ’ are safe as-is in UTF-8. */
export function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => XML_ESCAPES[c]);
}

function renderBlock(block: LaidOutBlock, palette: PostPalette): string {
  if (block.lines.length === 0) return "";

  const family = escapeXml(fontFamilyAttr(block.fontRole));
  const tracking = block.tracking
    ? ` letter-spacing="${(block.tracking * block.fontSize).toFixed(3)}"`
    : "";

  return block.lines
    .flatMap((line) =>
      line.runs
        .filter((run) => run.text.length > 0)
        .map(
          (run) =>
            `<text x="${run.x.toFixed(3)}" y="${line.baseline.toFixed(3)}" ` +
            `font-family="${family}" font-size="${block.fontSize.toFixed(3)}" ` +
            `fill="${resolveRunFill(palette, block.fontRole, run.tone)}"${tracking} ` +
            `xml:space="preserve">${escapeXml(run.text)}</text>`,
        ),
    )
    .join("");
}

export interface OverlayOptions {
  /**
   * Extracted "Liderlar iqtibosi!!!" outlines. Drawn after the portrait so the
   * script sits on top of the candidate, matching the reference posts.
   */
  signatureMarkup?: string | null;
  /**
   * The template's foreground plate — logo lock-up and the band's light. Drawn
   * after the portrait and before the signature, which is the master's own
   * layer order: the branding is frontmost, the light passes in front of the
   * candidate but behind the script.
   */
  foregroundHref?: string | null;
}

/** The dynamic half of a post: portrait, signature and all text, in 810-space. */
export function buildOverlaySvgBody(layout: PostLayout, options: OverlayOptions = {}): string {
  const parts: string[] = [];
  const defs: string[] = [];

  const { scrim } = layout;
  if (scrim.enabled) {
    // Drawn first so the portrait and every text run sit on top of it.
    defs.push(
      `<linearGradient id="post-scrim" x1="0" y1="0" x2="1" y2="0">` +
        `<stop offset="0" stop-color="#000000" stop-opacity="${scrim.opacity}"/>` +
        `<stop offset="0.62" stop-color="#000000" stop-opacity="${(scrim.opacity * 0.5).toFixed(3)}"/>` +
        `<stop offset="1" stop-color="#000000" stop-opacity="0"/>` +
        `</linearGradient>`,
    );
    parts.push(
      `<rect x="${scrim.x}" y="${scrim.y}" width="${scrim.width}" height="${scrim.height}" ` +
        `rx="${scrim.cornerRadius}" ry="${scrim.cornerRadius}" fill="url(#post-scrim)"/>`,
    );
  }

  const { portrait } = layout;
  if (portrait.href) {
    parts.push(
      `<image href="${escapeXml(portrait.href)}" x="${portrait.x.toFixed(3)}" ` +
        `y="${portrait.y.toFixed(3)}" width="${portrait.width.toFixed(3)}" ` +
        // xMaxYMax: the cut-out is trimmed to the subject's own bounding box, so
        // pinning it to the frame's bottom-right keeps it in the canvas corner
        // whatever aspect ratio the source photo had.
        `height="${portrait.height.toFixed(3)}" preserveAspectRatio="xMaxYMax meet"/>`,
    );
  }

  if (options.foregroundHref) {
    parts.push(
      `<image href="${escapeXml(options.foregroundHref)}" x="0" y="0" ` +
        `width="${POST_CANVAS_UNITS}" height="${POST_CANVAS_UNITS}"/>`,
    );
  }

  if (options.signatureMarkup && layout.signature.enabled) {
    const { offsetX, offsetY } = layout.signature;
    parts.push(
      `<g transform="translate(${offsetX}, ${offsetY})">${options.signatureMarkup}</g>`,
    );
  }

  parts.push(renderBlock(layout.quote, layout.palette));
  parts.push(renderBlock(layout.name, layout.palette));
  parts.push(renderBlock(layout.shortBio, layout.palette));

  const body = parts.filter(Boolean).join("");
  return defs.length > 0 ? `<defs>${defs.join("")}</defs>${body}` : body;
}

/** Standalone transparent overlay document, sized to the final output. */
export function buildOverlaySvg(
  layout: PostLayout,
  outputSize: number,
  options: OverlayOptions = {},
): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${outputSize}" height="${outputSize}" ` +
    `viewBox="0 0 ${POST_CANVAS_UNITS} ${POST_CANVAS_UNITS}">` +
    buildOverlaySvgBody(layout, options) +
    `</svg>`
  );
}

/** Full post document (background + overlay) — used for SVG export/debugging. */
export function buildPostSvg(
  layout: PostLayout,
  outputSize: number,
  backgroundHref: string,
  options: OverlayOptions = {},
): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${outputSize}" height="${outputSize}" ` +
    `viewBox="0 0 ${POST_CANVAS_UNITS} ${POST_CANVAS_UNITS}">` +
    `<image href="${escapeXml(backgroundHref)}" x="0" y="0" ` +
    `width="${POST_CANVAS_UNITS}" height="${POST_CANVAS_UNITS}"/>` +
    buildOverlaySvgBody(layout, options) +
    `</svg>`
  );
}
