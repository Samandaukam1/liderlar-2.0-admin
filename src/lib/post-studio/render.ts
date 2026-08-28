import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import { Resvg } from "@resvg/resvg-js";
import sharp from "sharp";
import { postFontFilePaths } from "./fonts.ts";
import { buildOverlaySvg } from "./svg.ts";
import { POST_OUTPUT_SIZE, type PostLayout, type PostTemplateId } from "./types.ts";

/**
 * Final rasterizer.
 *
 * The six masters are ~8.4MB of base64-embedded artwork and cost resvg ~1.3s
 * just to parse, so they are pre-baked to flat 1080x1080 PNGs by
 * scripts/build-post-studio-backgrounds.mjs. Because the bake happens at
 * exactly the output resolution, the template's own vector parts land on the
 * same pixel grid they would in a direct render — nothing is lost, and a post
 * renders in ~150ms instead of ~1.9s.
 *
 * Dynamic content stays fully vector: resvg draws the portrait, signature and
 * all text into a transparent 1080x1080 overlay from the real TTFs, and sharp
 * composites that once over the background.
 */

const THUMBNAIL_SIZE = 320;

const backgroundCache = new Map<PostTemplateId, Buffer>();
const foregroundCache = new Map<PostTemplateId, string>();
let signatureCache: string | null = null;

async function loadBackground(templateId: PostTemplateId): Promise<Buffer> {
  const cached = backgroundCache.get(templateId);
  if (cached) return cached;

  // Static directory prefix + dynamic file name keeps the file tracer scoped.
  const buffer = await fs.readFile(
    path.join(process.cwd(), "public/assets/post-studio/backgrounds", `${templateId}.png`),
  );
  backgroundCache.set(templateId, buffer);
  return buffer;
}

/**
 * The foreground plate, as a data URI so it rides inside the same overlay
 * document as the portrait and the text. Inlining keeps the render to one resvg
 * pass; the plate is ~38KB, which is cheaper than a second rasterisation.
 */
async function loadForeground(templateId: PostTemplateId): Promise<string> {
  const cached = foregroundCache.get(templateId);
  if (cached) return cached;

  const buffer = await fs.readFile(
    path.join(process.cwd(), "public/assets/post-studio/backgrounds", `${templateId}-front.png`),
  );
  const uri = toDataUri(buffer, "image/png");
  foregroundCache.set(templateId, uri);
  return uri;
}

/** Extracted "Liderlar iqtibosi!!!" outlines, shared by all six templates. */
async function loadSignatureMarkup(): Promise<string> {
  if (signatureCache !== null) return signatureCache;
  signatureCache = await fs.readFile(
    path.join(process.cwd(), "public/assets/post-studio/signature.svg"),
    "utf8",
  );
  return signatureCache;
}

/** resvg cannot fetch remote images, so the portrait is inlined as a data URI. */
export function toDataUri(buffer: Buffer, mime: string): string {
  return `data:${mime};base64,${buffer.toString("base64")}`;
}

export interface RenderedPost {
  png: Buffer;
  thumbnail: Buffer;
  width: number;
  height: number;
}

export async function renderPostImage(layout: PostLayout): Promise<RenderedPost> {
  const [background, foregroundHref, signatureMarkup] = await Promise.all([
    loadBackground(layout.templateId),
    loadForeground(layout.templateId),
    loadSignatureMarkup(),
  ]);

  const overlaySvg = buildOverlaySvg(layout, POST_OUTPUT_SIZE, {
    signatureMarkup,
    foregroundHref,
  });

  const overlayPng = new Resvg(overlaySvg, {
    fitTo: { mode: "width", value: POST_OUTPUT_SIZE },
    font: {
      fontFiles: postFontFilePaths(),
      // Bundled fonts only — a Vercel lambda has no system font set, and
      // relying on one would make output differ between local and production.
      loadSystemFonts: false,
      defaultFontFamily: "Montserrat",
    },
    shapeRendering: 2,
    textRendering: 1,
    imageRendering: 0,
  })
    .render()
    .asPng();

  const png = await sharp(background)
    .composite([{ input: overlayPng, top: 0, left: 0 }])
    .png({ compressionLevel: 9 })
    .toBuffer();

  const thumbnail = await sharp(png)
    .resize(THUMBNAIL_SIZE, THUMBNAIL_SIZE)
    .webp({ quality: 82 })
    .toBuffer();

  return { png, thumbnail, width: POST_OUTPUT_SIZE, height: POST_OUTPUT_SIZE };
}
