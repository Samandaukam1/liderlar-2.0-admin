import type { PostTemplateConfig, PostTemplateId } from "./types.ts";
import { POST_TEMPLATE_IDS } from "./types.ts";

/**
 * Per-template layout, measured off the master SVGs — no magic numbers are
 * allowed to live in components or in the renderer.
 *
 * How the numbers were obtained (all six masters were parsed, not eyeballed):
 *  - Every master declares `viewBox="0 0 810 809.999993"` with width/height
 *    1080, so the layout below is in 810-space.
 *  - The rounded quote card is the group at `translate(11, 9)` clipped to a
 *    788x467 rect, i.e. the card occupies x 11..799, y 9..476.
 *  - The logo lock-up is the bird at `translate(39, 24)` (101x102) plus the
 *    wordmark clipped to x 139.7..371.5, y 8..141.9 — so text must clear y=142.
 *  - The decorative cyan quote glyph is clipped to x 625.2..755.7, y 44.5..166.8.
 *  - The lower band is three pattern tiles at y=482..810.
 *  - `accentColor` is the end stop of each master's card gradient; `bandColor`
 *    is the start stop of the lower band gradient. Both were read from the
 *    <linearGradient> stop lists rather than sampled from a render.
 *  - `quoteAccentFill` is that accent lifted in HSL until it clears 4.5:1
 *    against the card's dark left edge — the raw accents (#1638c8, #5f16c8)
 *    are unreadable as text on their own artwork.
 */

/** Card interior, shared by all six masters. */
export const POST_CARD_BOX = { x: 11, y: 9, width: 788, height: 467 } as const;
/** Everything below the card: the cyan islamic-pattern band. */
export const POST_BAND_BOX = { x: 0, y: 476, width: 810, height: 334 } as const;
/** Bottom of the logo lock-up; no dynamic text may start above this. */
export const POST_LOGO_BASELINE = 142;

/** Common left text margin, aligned with the logo bird's left edge (x=39). */
const TEXT_LEFT = 44;

const BRAND_CYAN = "#1ec8fb";
const WHITE = "#ffffff";
/** Ink black of the patronymic name line; reads on the cyan band on all six. */
const INK_BLACK = "#000000";

/**
 * Geometry is identical across the six masters (they are colour variants of one
 * Canva composition), so the boxes are declared once and spread per template.
 * Colours and the signature nudge are the only per-template differences.
 */
const SHARED = {
  quote: {
    x: TEXT_LEFT,
    y: 150,
    width: 430,
    height: 252,
    maxFontSize: 46,
    minFontSize: 20,
    align: "left" as const,
    fill: WHITE,
    tracking: 0,
    uppercase: true,
  },
  name: {
    x: TEXT_LEFT,
    y: 490,
    width: 372,
    height: 212,
    maxFontSize: 72,
    minFontSize: 34,
    align: "left" as const,
    fill: WHITE,
    tracking: 0,
    uppercase: true,
  },
  shortBio: {
    // Kept clear of the decorative signature, which starts at x=247 on its own
    // baseline of 794.5 — a wider bio box would collide with the script.
    x: TEXT_LEFT,
    y: 700,
    width: 205,
    height: 80,
    maxFontSize: 18,
    minFontSize: 11,
    align: "left" as const,
    fill: WHITE,
    tracking: 0,
    uppercase: false,
  },
  quoteScrim: {
    x: POST_CARD_BOX.x,
    y: POST_CARD_BOX.y,
    width: 530,
    height: POST_CARD_BOX.height,
    cornerRadius: 18,
    opacity: 0.42,
    enabled: true,
  },
  portrait: {
    // Flush with the canvas' right edge (412 + 398 = 810) and its floor, so the
    // cut-out sits in the bottom-right corner the reference posters use.
    x: 412,
    y: 186,
    width: 398,
    height: 624,
    anchor: "bottom-right" as const,
  },
} satisfies Pick<PostTemplateConfig, "quote" | "quoteScrim" | "name" | "shortBio" | "portrait">;

/**
 * Templates 01/02/04/05 draw the baked signature drop-shadow from
 * `translate(238,732)` + `translate(24.201303, 63.076156)` = (262.2, 795.08),
 * while template-03 uses absolute `translate(247.30521, 794.542492)` — which is
 * the copy public/assets/post-studio/signature.svg was extracted from. The
 * nudge re-registers the re-drawn glyphs onto each master's own shadow.
 * Template-06 has no baked signature at all, so any offset renders cleanly.
 */
const SHADOW_ALIGNED_OFFSET = { offsetX: 14.9, offsetY: 0.534, enabled: true } as const;
const NATIVE_OFFSET = { offsetX: 0, offsetY: 0, enabled: true } as const;

interface TemplateVariant {
  label: string;
  accentColor: string;
  quoteAccentFill: string;
  signature: PostTemplateConfig["signature"];
}

const VARIANTS: Record<PostTemplateId, TemplateVariant> = {
  "template-01": {
    label: "01 — Limon",
    accentColor: "#e0e43a",
    quoteAccentFill: "#f1f55c",
    signature: SHADOW_ALIGNED_OFFSET,
  },
  "template-02": {
    label: "02 — Firuza",
    accentColor: "#16c8c8",
    quoteAccentFill: "#5cf5f5",
    signature: SHADOW_ALIGNED_OFFSET,
  },
  "template-03": {
    label: "03 — Pushti",
    accentColor: "#c8167b",
    quoteAccentFill: "#f679c0",
    signature: NATIVE_OFFSET,
  },
  "template-04": {
    label: "04 — Yashil",
    accentColor: "#3fc816",
    quoteAccentFill: "#7ff55c",
    signature: SHADOW_ALIGNED_OFFSET,
  },
  "template-05": {
    label: "05 — Ko‘k",
    accentColor: "#1638c8",
    quoteAccentFill: "#8ca1f8",
    signature: SHADOW_ALIGNED_OFFSET,
  },
  "template-06": {
    label: "06 — Siyoh",
    accentColor: "#5f16c8",
    quoteAccentFill: "#bb91f8",
    signature: NATIVE_OFFSET,
  },
};

export const POST_TEMPLATES: Record<PostTemplateId, PostTemplateConfig> = Object.fromEntries(
  POST_TEMPLATE_IDS.map((id) => {
    const variant = VARIANTS[id];
    return [
      id,
      {
        id,
        label: variant.label,
        backgroundPath: `public/assets/post-studio/backgrounds/${id}.png`,
        thumbnailPath: `public/assets/post-studio/backgrounds/${id}-thumb.jpg`,
        accentColor: variant.accentColor,
        bandColor: BRAND_CYAN,
        quoteAccentFill: variant.quoteAccentFill,
        nameDarkFill: INK_BLACK,
        signature: variant.signature,
        ...SHARED,
      } satisfies PostTemplateConfig,
    ];
  }),
) as Record<PostTemplateId, PostTemplateConfig>;

export const POST_TEMPLATE_LIST: PostTemplateConfig[] = POST_TEMPLATE_IDS.map(
  (id) => POST_TEMPLATES[id],
);

export const DEFAULT_POST_TEMPLATE_ID: PostTemplateId = "template-01";

export function getPostTemplate(id: PostTemplateId): PostTemplateConfig {
  return POST_TEMPLATES[id];
}

/** Public (browser-reachable) URL of a baked background or its thumbnail. */
export function templateAssetUrl(assetPath: string): string {
  return assetPath.replace(/^public/, "");
}

/**
 * Rotates through the six templates so a batch of candidates does not come out
 * as six identical-looking posts. Deterministic in the candidate id, so a
 * re-render of the same post always picks the same template.
 */
export function pickTemplateForCandidate(candidateId: string): PostTemplateId {
  let hash = 0;
  for (let i = 0; i < candidateId.length; i += 1) {
    hash = (hash * 31 + candidateId.charCodeAt(i)) % 100000;
  }
  return POST_TEMPLATE_IDS[hash % POST_TEMPLATE_IDS.length];
}
