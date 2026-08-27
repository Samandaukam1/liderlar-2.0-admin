/**
 * Bakes the six Post Studio master SVGs into flat 1080x1080 PNG backgrounds
 * plus small JPEG thumbnails for the admin UI.
 *
 * Why bake at all: each master is ~8.4MB of base64-embedded raster art, and
 * resvg spends ~1.3s just parsing one. Since the masters are static and the
 * output size is fixed at 1080x1080, rasterizing once at exactly 1:1 loses
 * nothing (their vector parts land on the same pixel grid they would in a
 * direct render) and cuts per-post render time by an order of magnitude.
 *
 * The decorative "Liderlar iqtibosi!!!" signature is deliberately NOT baked in:
 * it has to sit ON TOP of the candidate portrait (see the reference posts), and
 * template-06 is missing it entirely. It is drawn from public/assets/post-studio/
 * signature.svg during composition instead, so all six templates match.
 *
 * Run: node scripts/build-post-studio-backgrounds.mjs
 */
import { Resvg } from "@resvg/resvg-js";
import sharp from "sharp";
import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const TEMPLATES = path.join(ROOT, "public/assets/post-studio/templates");
const OUT = path.join(ROOT, "public/assets/post-studio/backgrounds");
const SIZE = 1080;

/** Hides the baked-in signature glyphs without unbalancing the XML. */
function stripSignature(svg) {
  return svg.replace(
    /<g fill="#ffffff" fill-opacity="1">(\s*<g transform="translate\([\d.]+, (?:794\.5\d*|63\.07\d*)\)">)/g,
    '<g fill="#ffffff" fill-opacity="0">$1',
  );
}

await fs.mkdir(OUT, { recursive: true });
const files = (await fs.readdir(TEMPLATES)).filter((f) => f.endsWith(".svg")).sort();

for (const file of files) {
  const id = file.replace(".svg", "");
  const raw = await fs.readFile(path.join(TEMPLATES, file), "utf8");
  const svg = stripSignature(raw);

  const png = new Resvg(svg, { fitTo: { mode: "width", value: SIZE } }).render().asPng();
  await fs.writeFile(path.join(OUT, `${id}.png`), png);
  await sharp(png).resize(360, 360).jpeg({ quality: 86 }).toFile(path.join(OUT, `${id}-thumb.jpg`));

  const stripped = raw.length - svg.replace(/fill-opacity="0"/g, 'fill-opacity="1"').length;
  console.log(`${id}: ${(png.length / 1024).toFixed(0)}KB png${stripped === 0 ? " (no baked signature)" : ""}`);
}
