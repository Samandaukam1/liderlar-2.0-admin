/**
 * Coordinates calibrated against two independent sources (both measured by
 * pixel-analysis, not guessed):
 *  1. public/assets/certificates/liderlar-sertifikatlash.svg — the blank
 *     template (viewBox "0 0 842.25 595.499986", i.e. A4 landscape in points).
 *  2. The user-provided reference PDF "sertifikat nusxasi nusxasi.pdf"
 *     (Eshpulotova Jasmina), which is the same template with a name already
 *     filled in — used to cross-check the blank-area measurements and to
 *     read off the actual rendered name size/position.
 *
 * All coordinates are in PDF points, in a TOP-LEFT origin (y grows downward),
 * matching both the SVG viewBox and how the measurements were taken. Convert
 * to pdf-lib's bottom-left/y-up space at draw time via `PAGE.height - y`.
 */
export const CERTIFICATE_LAYOUT = {
  page: {
    // Matches the template SVG's viewBox exactly (A4 landscape, ~297x210mm).
    width: 842.25,
    height: 595.5,
    orientation: "landscape" as const,
  },

  background: {
    svgPath: "public/assets/certificates/liderlar-sertifikatlash.svg",
  },

  candidateName: {
    fontFile: "public/assets/certificates/fonts/great-vibes-regular.ttf",
    // Fallback for characters Great Vibes doesn't cover (e.g. Cyrillic,
    // including the Uzbek extras Ў/Қ/Ғ/Ҳ). A single Noto Sans variable TTF
    // covers all of them. Both files are plain TrueType (not WOFF2) and
    // embedded unsubsetted deliberately — see fonts.ts for why.
    fallbackFontFiles: ["public/assets/certificates/fonts/noto-sans-regular.ttf"],
    baseFontSize: 64.5,
    minFontSize: 42,
    color: "#151515",
    textAlign: "center" as const,
    // Blank band between the body paragraph ("...uchun") and the cyan
    // divider line — measured on the blank template at y=278.1..344.1pt,
    // cross-checked on the reference PDF's paragraph/name gap (278.5..290pt)
    // and the reference's actual name ink box (290.0..343.75pt).
    box: {
      top: 278,
      bottom: 344,
      centerX: 421.125, // page width / 2
      // Max ink width before the auto-shrink kicks in, leaving a safe
      // margin on both sides (page is 842.25pt wide).
      maxWidth: 700,
    },
  },

  qrCode: {
    // Measured on both the blank template (x=623.6,y=405.6,92.4x93.0pt) and
    // the reference PDF (x=624.3,y=405.8,93.0x94.0pt) — the two agree to
    // within 1pt, so the average is used as the final value.
    x: 624,
    y: 406,
    size: 94,
    errorCorrectionLevel: "H" as const,
    // Center logo must not exceed ~16-20% of the QR's own size.
    centerLogo: {
      path: "public/assets/certificates/qr-center-logo.png",
      sizeRatio: 0.18,
      paddingRatio: 0.05,
    },
  },
} as const;

export const CANDIDATE_NAME_BASE_FONT_SIZE = CERTIFICATE_LAYOUT.candidateName.baseFontSize;
