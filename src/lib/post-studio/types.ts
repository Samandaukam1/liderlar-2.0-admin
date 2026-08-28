/**
 * Post Studio — shared types.
 *
 * Everything in the render pipeline speaks the master SVG's own coordinate
 * system: a 810x810 user-unit canvas that the templates declare via
 * `viewBox="0 0 810 810"` while advertising `width/height = 1080`. Keeping the
 * layout in 810-space means the numbers in layout-config.ts can be read
 * straight off the master files; the 1.3333 scale to the final 1080x1080 PNG
 * happens once, in the renderer.
 */

export const POST_CANVAS_UNITS = 810;
export const POST_OUTPUT_SIZE = 1080;
export const POST_UNIT_SCALE = POST_OUTPUT_SIZE / POST_CANVAS_UNITS;

/**
 * Line heights are fixed product requirements, not per-template styling, so
 * they live here rather than in the per-template config where a future edit
 * could silently drift them apart.
 */
export const NAME_LINE_HEIGHT = 1.09;
export const QUOTE_LINE_HEIGHT = 1.03;
export const SHORT_BIO_LINE_HEIGHT = 0.98;


export const POST_TEMPLATE_IDS = [
  "template-01",
  "template-02",
  "template-03",
  "template-04",
  "template-05",
  "template-06",
] as const;
export type PostTemplateId = (typeof POST_TEMPLATE_IDS)[number];

export function isPostTemplateId(value: unknown): value is PostTemplateId {
  return typeof value === "string" && (POST_TEMPLATE_IDS as readonly string[]).includes(value);
}

/** Font roles resolved by lib/post-studio/fonts.ts into real TTF files. */
export type PostFontRole = "name" | "quote" | "shortBio" | "signature";

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type TextAlign = "left" | "center" | "right";

export interface TextBlockConfig extends Box {
  /** Auto-fit starts here and steps down; never rendered larger than this. */
  maxFontSize: number;
  /** Below this the block is considered un-fittable -> post needs review. */
  minFontSize: number;
  /**
   * Quote only: the smallest size at which taking a second sentence is still
   * worth it, and how full one sentence must leave the box before a second is
   * even considered.
   */
  comfortFontSize?: number;
  minFillRatio?: number;
  fontSize?: never;
  align: TextAlign;
  fill: string;
  /** Letter tracking as a fraction of font size (Canva-style display text). */
  tracking?: number;
  uppercase?: boolean;
}

export interface PortraitFrameConfig extends Box {
  /**
   * The portrait is a standing cut-out pinned into the canvas' bottom-right
   * corner, so it grows up and to the left out of that corner and is scaled to
   * fit inside the frame; "cover"-style cropping would decapitate tall sources.
   */
  anchor: "bottom-right";
}

export interface ScrimConfig {
  /**
   * Soft dark wash behind the quote. The card gradient runs from near-black on
   * the left to a bright accent on the right, so a quote that reaches past the
   * midpoint loses contrast against its own artwork — worst on the light
   * templates (04 green, 01 lime). The scrim restores it and matches the darker
   * card reading of the reference posts.
   */
  x: number;
  y: number;
  width: number;
  height: number;
  cornerRadius: number;
  /** Opacity at the left edge, fading to 0 at the right edge. */
  opacity: number;
  enabled: boolean;
}

export interface SignatureConfig {
  /**
   * The decorative "Liderlar iqtibosi!!!" script is re-drawn from the extracted
   * master vectors (see public/assets/post-studio/signature.svg) so it lands ON
   * TOP of the portrait. Templates 01/02/04/05 place their baked drop-shadow a
   * few units right of template-03's copy, hence the per-template nudge.
   */
  offsetX: number;
  offsetY: number;
  enabled: boolean;
}

export interface PostTemplateConfig {
  id: PostTemplateId;
  /** Uzbek label shown in the admin template picker. */
  label: string;
  /** Flat 1080x1080 background baked by scripts/build-post-studio-backgrounds.mjs. */
  backgroundPath: string;
  /**
   * The parts of the master that belong ON TOP of the candidate: the Humo bird,
   * the wordmark and the soft light at the foot of the band. Transparent
   * everywhere else.
   */
  foregroundPath: string;
  thumbnailPath: string;
  /** Dominant accent read off the master's card gradient end stop. */
  accentColor: string;
  /** Brand cyan of the lower pattern band, read off the master's gradient. */
  bandColor: string;
  quote: TextBlockConfig;
  quoteScrim: ScrimConfig;
  /** Colour applied to the leading half of the quote (see quote-split.ts). */
  quoteAccentFill: string;
  name: TextBlockConfig;
  shortBio: TextBlockConfig;
  portrait: PortraitFrameConfig;
  signature: SignatureConfig;
}

/* ------------------------------------------------------------------ *
 * Laid-out output — produced once on the server and reused verbatim by
 * both the browser preview and the final raster, so the two cannot drift.
 * ------------------------------------------------------------------ */

/**
 * Which of the palette's colours a run takes. Runs name a *role* rather than a
 * hex value so that switching template repaints the layout without re-running
 * the text engine — and so a stale accent from a previous template can never
 * be persisted as if it were the post's own content.
 */
export type PaintTone = "base" | "accent" | "dark";

/**
 * Zero-based index of the first name line drawn dark instead of white.
 * `splitNameIntoLines` puts the patronymic ("... qizi" / "... o‘g‘li") last, so
 * on a three-line name this is exactly that line — the two-tone treatment the
 * reference posters use. A two-line name never reaches it and stays white.
 */
export const NAME_DARK_LINE_INDEX = 2;

export interface LaidOutRun {
  text: string;
  /** Absolute x of this run's start, in 810-space. */
  x: number;
  tone: PaintTone;
}

/**
 * Every colour the overlay paints with, resolved from the *current* template.
 * The renderer and the browser preview both read fills from here, so a template
 * switch is a palette swap and nothing else.
 */
export interface PostPalette {
  quoteBase: string;
  quoteAccent: string;
  name: string;
  /** The patronymic line; see NAME_DARK_LINE_INDEX. */
  nameDark: string;
  shortBio: string;
}

/** The single place a run's tone becomes a concrete colour. */
export function resolveRunFill(
  palette: PostPalette,
  fontRole: PostFontRole,
  tone: PaintTone,
): string {
  if (fontRole === "quote") return tone === "accent" ? palette.quoteAccent : palette.quoteBase;
  if (fontRole === "shortBio") return palette.shortBio;
  return tone === "dark" ? palette.nameDark : palette.name;
}

export interface LaidOutLine {
  text: string;
  /** Baseline y in 810-space. */
  baseline: number;
  /** Left edge of the line's ink box after alignment, in 810-space. */
  x: number;
  width: number;
  runs: LaidOutRun[];
}

export interface LaidOutBlock {
  lines: LaidOutLine[];
  fontSize: number;
  lineHeight: number;
  fontRole: PostFontRole;
  tracking: number;
  /** True when auto-fit bottomed out at minFontSize and still overflowed. */
  overflow: boolean;
  box: Box;
}

export interface LaidOutPortrait {
  href: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
}

export type PostWarningCode =
  | "quote_overflow"
  | "name_overflow"
  | "short_bio_overflow"
  | "short_bio_trimmed"
  | "quote_missing"
  | "name_missing"
  | "portrait_missing"
  | "portrait_low_quality"
  | "portrait_removal_failed"
  | "article_unpublished"
  | "article_url_unconfigured";

export interface PostWarning {
  code: PostWarningCode;
  message: string;
}

export interface PostLayout {
  templateId: PostTemplateId;
  /** Current template's colours; swap this to repaint without re-laying out. */
  palette: PostPalette;
  /** The whole sentences taken from the raw answer, and why. */
  quoteSelection: {
    text: string;
    sentenceCount: number;
    availableSentences: number;
    reason: string;
  };
  quote: LaidOutBlock;
  name: LaidOutBlock;
  shortBio: LaidOutBlock;
  portrait: LaidOutPortrait;
  /**
   * The canonical, override-free placement solved from the person's alpha
   * bounds. The studio re-applies the admin's sliders to this while dragging,
   * so the live preview and the final render share one fit calculation.
   */
  portraitFit: import("./portrait-fit.ts").PortraitPlacement;
  scrim: ScrimConfig;
  signature: SignatureConfig;
  warnings: PostWarning[];
  /** Blocking warnings force the post into needs_review instead of ready. */
  needsReview: boolean;
}

export type PostQuoteSource =
  | "intake_quote"
  | "featured_quote"
  | "article_quote"
  | "life_motto"
  | "manual"
  | "none";

export const POST_STATUSES = [
  "draft",
  "rendering",
  "ready",
  "approved",
  "scheduled",
  "published",
  "failed",
  "needs_review",
] as const;
export type PostStatus = (typeof POST_STATUSES)[number];

/** Uzbek labels for the admin list and studio header. */
export const POST_STATUS_LABELS: Record<PostStatus, string> = {
  draft: "Qoralama",
  rendering: "Render qilinmoqda",
  ready: "Tayyor",
  approved: "Tasdiqlangan",
  scheduled: "Rejalashtirilgan",
  published: "Yuborilgan",
  failed: "Xatolik",
  needs_review: "Tekshirish kerak",
};

export const POST_STATUS_TONES: Record<PostStatus, "neutral" | "info" | "success" | "warning" | "danger"> = {
  draft: "neutral",
  rendering: "info",
  ready: "info",
  approved: "success",
  scheduled: "info",
  published: "success",
  failed: "danger",
  needs_review: "warning",
};

export interface PortraitTransform {
  /** Offset from the frame's resting position, in 810-space units. */
  offsetX: number;
  offsetY: number;
  scale: number;
  flip: boolean;
}

export const DEFAULT_PORTRAIT_TRANSFORM: PortraitTransform = {
  offsetX: 0,
  offsetY: 0,
  scale: 1,
  flip: false,
};

export interface FontSizeOverrides {
  quote?: number | null;
  name?: number | null;
  shortBio?: number | null;
}

export interface PostComposition {
  templateId: PostTemplateId;
  /** The RAW 15th answer. Whole sentences are selected from it at layout time. */
  quote: string;
  nameLines: string[];
  shortBioItems: string[];
  portraitHref: string | null;
  /**
   * Tight box of the person inside the stored cut-out. Absent only for legacy
   * assets processed before bounds were recorded, which fall back to the whole
   * frame.
   */
  portraitPersonBounds?: import("./portrait-fit.ts").PersonBounds | null;
  portraitTransform: PortraitTransform;
  fontSizeOverrides?: FontSizeOverrides;
}
