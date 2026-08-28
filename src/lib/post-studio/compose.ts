import "server-only";
import { getFontMetrics } from "./fonts.ts";
import { fitFixedLines, fitWrappedText, positionLines } from "./text-engine.ts";
import { applyQuoteColorSplit } from "./quote-split.ts";
import { applyNameDarkTail } from "./name-color.ts";
import { placePortrait } from "./portrait-frame.ts";
import { getPostTemplate } from "./layout-config.ts";
import {
  DEFAULT_PORTRAIT_TRANSFORM,
  NAME_LINE_HEIGHT,
  QUOTE_LINE_HEIGHT,
  SHORT_BIO_LINE_HEIGHT,
  type Box,
  type LaidOutPortrait,
  type PostComposition,
  type PostLayout,
  type PostWarning,
} from "./types.ts";

/**
 * Turns candidate content into a fully positioned PostLayout.
 *
 * This is the single layout authority: the browser preview draws from the
 * PostLayout this returns, and the final 1080x1080 raster is built from the
 * very same object. Nothing downstream re-measures or re-wraps text.
 */

/** Badge marker in front of every short-bio item, matching the reference posts. */
export const SHORT_BIO_BULLET = "• ";
export const SHORT_BIO_MAX_ITEMS = 5;
/** Below this the bio stops being trimmed and the post is flagged instead. */
export const SHORT_BIO_MIN_ITEMS = 3;

function portraitPlacement(composition: PostComposition, frame: Box): LaidOutPortrait {
  // Corner-anchored: a standing cut-out grows up and to the left out of the
  // canvas' bottom-right corner, so scaling it up never crops the head off nor
  // pushes the shoulder past the right edge.
  return {
    href: composition.portraitHref,
    ...placePortrait(frame, composition.portraitTransform ?? DEFAULT_PORTRAIT_TRANSFORM),
  };
}

export function buildPostLayout(composition: PostComposition): PostLayout {
  const template = getPostTemplate(composition.templateId);
  const warnings: PostWarning[] = [];
  const overrides = composition.fontSizeOverrides ?? {};

  /* ---------------- quote (line-height 1.03, two-tone) ---------------- */

  const quoteMetrics = getFontMetrics("quote");
  const quoteText = template.quote.uppercase
    ? composition.quote.toLocaleUpperCase("uz")
    : composition.quote;

  const quoteMax = overrides.quote ?? template.quote.maxFontSize;
  const quoteMin = overrides.quote ?? template.quote.minFontSize;

  const quoteFit = fitWrappedText(quoteText, {
    metrics: quoteMetrics,
    box: template.quote,
    maxFontSize: quoteMax,
    minFontSize: quoteMin,
    lineHeight: QUOTE_LINE_HEIGHT,
    tracking: template.quote.tracking,
  });

  let quoteBlock = positionLines(quoteFit, {
    metrics: quoteMetrics,
    box: template.quote,
    lineHeight: QUOTE_LINE_HEIGHT,
    align: template.quote.align,
    tracking: template.quote.tracking,
    fill: template.quote.fill,
    fontRole: "quote",
  });
  quoteBlock = applyQuoteColorSplit(
    quoteBlock,
    quoteMetrics,
    template.quoteAccentFill,
    template.quote.fill,
  );

  if (!composition.quote.trim()) {
    warnings.push({ code: "quote_missing", message: "Iqtibos tanlanmagan." });
  } else if (quoteBlock.overflow) {
    warnings.push({
      code: "quote_overflow",
      message:
        "Iqtibos eng kichik shrift o‘lchamida ham maydonga sig‘madi. Qisqaroq iqtibos tanlang.",
    });
  }

  /* ---------------- name (line-height 1.09, Anton) ---------------- */

  const nameMetrics = getFontMetrics("name");
  const nameLines = composition.nameLines
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => (template.name.uppercase ? l.toLocaleUpperCase("uz") : l));

  const nameFit = fitFixedLines(nameLines, {
    metrics: nameMetrics,
    box: template.name,
    maxFontSize: overrides.name ?? template.name.maxFontSize,
    minFontSize: overrides.name ?? template.name.minFontSize,
    lineHeight: NAME_LINE_HEIGHT,
    tracking: template.name.tracking,
  });

  const nameBlock = applyNameDarkTail(
    positionLines(nameFit, {
      metrics: nameMetrics,
      box: template.name,
      lineHeight: NAME_LINE_HEIGHT,
      align: template.name.align,
      tracking: template.name.tracking,
      fill: template.name.fill,
      fontRole: "name",
    }),
    template.nameDarkFill,
  );

  if (nameLines.length === 0) {
    warnings.push({ code: "name_missing", message: "Nomzod ismi bo‘sh." });
  } else if (nameBlock.overflow) {
    warnings.push({
      code: "name_overflow",
      message: "Ism maydonga sig‘madi. Qatorlarga bo‘lishni qo‘lda o‘zgartiring.",
    });
  }

  /* ---------------- short bio (line-height 0.98) ---------------- */

  const bioMetrics = getFontMetrics("shortBio");
  const requested = composition.shortBioItems
    .map((i) => i.trim())
    .filter(Boolean)
    .slice(0, SHORT_BIO_MAX_ITEMS);

  let bioItems = requested;
  let bioFit = fitFixedLines(bioItems.map((i) => `${SHORT_BIO_BULLET}${i}`), {
    metrics: bioMetrics,
    box: template.shortBio,
    maxFontSize: overrides.shortBio ?? template.shortBio.maxFontSize,
    minFontSize: overrides.shortBio ?? template.shortBio.minFontSize,
    lineHeight: SHORT_BIO_LINE_HEIGHT,
    tracking: template.shortBio.tracking,
  });

  // Only after the font has already bottomed out do we drop items, and never
  // below three — the order is the admin's/AI-approved priority, so trimming
  // always removes from the tail rather than re-ranking.
  while (bioFit.overflow && bioItems.length > SHORT_BIO_MIN_ITEMS) {
    bioItems = bioItems.slice(0, bioItems.length - 1);
    bioFit = fitFixedLines(bioItems.map((i) => `${SHORT_BIO_BULLET}${i}`), {
      metrics: bioMetrics,
      box: template.shortBio,
      maxFontSize: overrides.shortBio ?? template.shortBio.maxFontSize,
      minFontSize: overrides.shortBio ?? template.shortBio.minFontSize,
      lineHeight: SHORT_BIO_LINE_HEIGHT,
      tracking: template.shortBio.tracking,
    });
  }

  if (bioItems.length < requested.length) {
    warnings.push({
      code: "short_bio_trimmed",
      message: `Tavsiflardan ${requested.length - bioItems.length} tasi sig‘magani uchun olib tashlandi.`,
    });
  }

  const bioBlock = positionLines(bioFit, {
    metrics: bioMetrics,
    box: template.shortBio,
    lineHeight: SHORT_BIO_LINE_HEIGHT,
    align: template.shortBio.align,
    tracking: template.shortBio.tracking,
    fill: template.shortBio.fill,
    fontRole: "shortBio",
  });

  if (bioBlock.overflow) {
    warnings.push({
      code: "short_bio_overflow",
      message: "Qisqa tavsiflar maydonga sig‘madi.",
    });
  }

  /* ---------------- portrait ---------------- */

  const portrait = portraitPlacement(composition, template.portrait);
  if (!portrait.href) {
    warnings.push({ code: "portrait_missing", message: "Portret rasmi tayyor emas." });
  }

  /**
   * Anything that would ship a visually broken or incomplete post blocks
   * auto-publish. Cosmetic trimming of the bio does not.
   */
  const BLOCKING: ReadonlySet<string> = new Set([
    "quote_overflow",
    "name_overflow",
    "short_bio_overflow",
    "quote_missing",
    "name_missing",
    "portrait_missing",
  ]);

  return {
    templateId: template.id,
    quote: quoteBlock,
    name: nameBlock,
    shortBio: bioBlock,
    portrait,
    scrim: template.quoteScrim,
    signature: template.signature,
    warnings,
    needsReview: warnings.some((w) => BLOCKING.has(w.code)),
  };
}
