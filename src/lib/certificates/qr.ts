import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import QRCode from "qrcode";
import sharp from "sharp";
import { CERTIFICATE_LAYOUT } from "@/lib/certificates/certificate-layout";

// High-res raster so the QR stays crisp when embedded into the PDF at
// CERTIFICATE_LAYOUT.qrCode.size (94pt ≈ 125px @ 96dpi, but PDFs get
// printed/zoomed, so we render well above that).
const QR_RASTER_SIZE = 960;

let cachedLogoBuffer: Buffer | null = null;
async function readCenterLogo(): Promise<Buffer> {
  if (cachedLogoBuffer) return cachedLogoBuffer;
  const logoPath = path.join(process.cwd(), CERTIFICATE_LAYOUT.qrCode.centerLogo.path);
  cachedLogoBuffer = await fs.readFile(logoPath);
  return cachedLogoBuffer;
}

/**
 * Generates a QR code (PNG buffer) pointing at `targetUrl`, with the Humo
 * phoenix logo composited onto a white backing at its center. Uses "H"
 * error correction so the logo can safely obscure the middle of the code
 * without breaking scannability.
 */
export async function generateCertificateQr(targetUrl: string): Promise<Buffer> {
  const { errorCorrectionLevel, centerLogo } = CERTIFICATE_LAYOUT.qrCode;

  const qrPng = await QRCode.toBuffer(targetUrl, {
    errorCorrectionLevel,
    type: "png",
    width: QR_RASTER_SIZE,
    margin: 2,
    color: { dark: "#000000ff", light: "#ffffffff" },
  });

  const logoSize = Math.round(QR_RASTER_SIZE * centerLogo.sizeRatio);
  const backingSize = Math.round(logoSize * (1 + centerLogo.paddingRatio * 2));

  const logoBuffer = await readCenterLogo();
  const resizedLogo = await sharp(logoBuffer)
    .resize(logoSize, logoSize, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  const backing = await sharp({
    create: {
      width: backingSize,
      height: backingSize,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    },
  })
    .composite([{ input: resizedLogo, gravity: "center" }])
    .png()
    .toBuffer();

  return sharp(qrPng)
    .composite([{ input: backing, gravity: "center" }])
    .png()
    .toBuffer();
}
