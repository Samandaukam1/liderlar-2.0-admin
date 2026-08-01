import "server-only";
import { PDFDocument, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { CERTIFICATE_LAYOUT } from "@/lib/certificates/certificate-layout";
import { getCertificateBackgroundJpeg } from "@/lib/certificates/background";
import { generateCertificateQr } from "@/lib/certificates/qr";
import {
  fitFontSize,
  loadCandidateNameFonts,
  measureRunsWidth,
  splitIntoFontRuns,
} from "@/lib/certificates/fonts";

export interface CertificateMetadata {
  title: string;
  author: string;
  subject: string;
  creator: string;
}

export interface CertificateRequest {
  fullName: string;
  targetUrl: string;
  metadata: CertificateMetadata;
}

function hexToUnitRgb(hex: string): { r: number; g: number; b: number } {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match) return { r: 0, g: 0, b: 0 };
  const value = parseInt(match[1], 16);
  return {
    r: ((value >> 16) & 0xff) / 255,
    g: ((value >> 8) & 0xff) / 255,
    b: (value & 0xff) / 255,
  };
}

/**
 * Renders the candidate certificate PDF: the static template background,
 * the candidate's full name (Great Vibes, auto-shrink-to-fit, centered),
 * and a QR code linking to their public page/article. Coordinates come
 * from CERTIFICATE_LAYOUT — see that file for how they were calibrated.
 */
export async function generateCertificatePdf(request: CertificateRequest): Promise<Uint8Array> {
  const { page, candidateName, qrCode } = CERTIFICATE_LAYOUT;

  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);

  pdfDoc.setTitle(request.metadata.title);
  pdfDoc.setAuthor(request.metadata.author);
  pdfDoc.setSubject(request.metadata.subject);
  pdfDoc.setCreator(request.metadata.creator);
  pdfDoc.setProducer(request.metadata.creator);

  const pdfPage = pdfDoc.addPage([page.width, page.height]);

  const [backgroundJpegBytes, qrPngBytes, fonts] = await Promise.all([
    getCertificateBackgroundJpeg(),
    generateCertificateQr(request.targetUrl),
    loadCandidateNameFonts(pdfDoc),
  ]);

  const backgroundImage = await pdfDoc.embedJpg(backgroundJpegBytes);
  pdfPage.drawImage(backgroundImage, { x: 0, y: 0, width: page.width, height: page.height });

  // ---- Candidate name: multi-font runs (Great Vibes + Cyrillic fallbacks),
  // shrink-to-fit by width, vertically centered in the calibrated blank band.
  const runs = splitIntoFontRuns(request.fullName.trim(), fonts);
  const size = fitFontSize(
    runs,
    candidateName.baseFontSize,
    candidateName.minFontSize,
    candidateName.box.maxWidth
  );
  const totalWidth = measureRunsWidth(runs, size);

  const primaryFont = fonts[0].embedded;
  const fullHeight = primaryFont.heightAtSize(size, { descender: true });
  const capHeight = primaryFont.heightAtSize(size, { descender: false });
  const boxHeight = candidateName.box.bottom - candidateName.box.top;
  const blockTopY = candidateName.box.top + Math.max(0, (boxHeight - fullHeight) / 2);
  const baselineY = page.height - (blockTopY + capHeight);

  const { r, g, b } = hexToUnitRgb(candidateName.color);
  let cursorX = candidateName.box.centerX - totalWidth / 2;
  for (const run of runs) {
    pdfPage.drawText(run.text, {
      x: cursorX,
      y: baselineY,
      size,
      font: run.font.embedded,
      color: rgb(r, g, b),
    });
    cursorX += run.font.embedded.widthOfTextAtSize(run.text, size);
  }

  // ---- QR code
  // The background template's own raster already has a QR code baked into
  // it at (nearly, but not exactly) this same spot. A plain white mask a
  // few points larger than our QR fully covers that old one first, so any
  // sub-pixel mismatch between the two doesn't show as ghosting/ragged
  // edges behind the new code.
  const qrMaskPadding = 8;
  pdfPage.drawRectangle({
    x: qrCode.x - qrMaskPadding,
    y: page.height - qrCode.y - qrCode.size - qrMaskPadding,
    width: qrCode.size + qrMaskPadding * 2,
    height: qrCode.size + qrMaskPadding * 2,
    color: rgb(1, 1, 1),
  });

  const qrImage = await pdfDoc.embedPng(qrPngBytes);
  pdfPage.drawImage(qrImage, {
    x: qrCode.x,
    y: page.height - qrCode.y - qrCode.size,
    width: qrCode.size,
    height: qrCode.size,
  });

  return pdfDoc.save();
}
