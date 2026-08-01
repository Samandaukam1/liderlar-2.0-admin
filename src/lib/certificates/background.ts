import "server-only";
import path from "node:path";
import sharp from "sharp";
import { CERTIFICATE_LAYOUT } from "@/lib/certificates/certificate-layout";

// px-per-pt used to rasterize the (huge, vector+embedded-raster) SVG
// template once at a print-quality resolution.
const RASTER_SCALE = 4;

let cachedBackgroundJpeg: Buffer | null = null;

/**
 * Rasterizes the certificate background SVG to JPEG once per warm server
 * instance (module-level cache) — the template is 51MB and static, so
 * re-reading/re-rendering it on every request would be wasteful. JPEG
 * (quality 92) is used instead of PNG because the artwork is soft
 * gradients/watermarks with no text or hard edges of its own (the name and
 * QR are separate overlays drawn on top), so lossy compression is visually
 * safe and cuts the embedded image from ~5.8MB to ~1.6MB.
 */
export async function getCertificateBackgroundJpeg(): Promise<Buffer> {
  if (cachedBackgroundJpeg) return cachedBackgroundJpeg;

  const svgPath = path.join(process.cwd(), CERTIFICATE_LAYOUT.background.svgPath);
  const targetWidth = Math.round(CERTIFICATE_LAYOUT.page.width * RASTER_SCALE);

  cachedBackgroundJpeg = await sharp(svgPath, { density: 300 })
    .resize({ width: targetWidth })
    .jpeg({ quality: 92 })
    .toBuffer();

  return cachedBackgroundJpeg;
}
