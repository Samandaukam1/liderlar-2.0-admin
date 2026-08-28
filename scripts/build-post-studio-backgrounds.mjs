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
 * Three more parts of the master belong on top of the portrait for the same
 * reason, so each template is baked twice:
 *
 *   {id}.png        everything behind the candidate
 *   {id}-front.png  the Humo bird, the wordmark and the soft light at the
 *                   bottom of the band — transparent everywhere else
 *
 * Without the split the cut-out is pasted over the logo lock-up and erases the
 * light, which is what made the branding look like it had slipped behind the
 * artwork.
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

/**
 * Splits the document body into its top-level drawable elements, so each can be
 * assigned to the back or the front plate. The masters are well-formed, so a
 * depth counter over tags is enough — no XML parser needed for 8.4MB of mostly
 * base64.
 */
function topLevelElements(body) {
  const elements = [];
  let depth = 0;
  let start = -1;

  const tag = /<(\/?)([a-zA-Z][\w:-]*)((?:"[^"]*"|'[^']*'|[^"'>])*?)(\/?)>/g;
  let m;
  while ((m = tag.exec(body)) !== null) {
    const [, closing, , , selfClosing] = m;
    if (closing) {
      depth -= 1;
      if (depth === 0) {
        elements.push(body.slice(start, tag.lastIndex));
        start = -1;
      }
      continue;
    }
    if (depth === 0) start = m.index;
    if (!selfClosing) depth += 1;
    else if (depth === 0) {
      elements.push(body.slice(m.index, tag.lastIndex));
      start = -1;
    }
  }
  return elements;
}

/**
 * The three foreground parts, matched on the master's own transforms rather
 * than on position in the file:
 *  - the Humo bird sits at translate(39, 24);
 *  - the wordmark is the 0.1924x-scaled image starting at x≈48.5, y≈7.6;
 *  - the light is the one full-bleed gradient rect (x=-178.2) in the band.
 */
function isForeground(element) {
  return (
    element.includes("matrix(1, 0, 0, 1, 39, 24)") ||
    /matrix\(0\.19\d+, 0, 0, 0\.19\d+, 4[0-9.]+, 7\.\d+\)/.test(element) ||
    /<rect x="-178\.2" fill="url\(#/.test(element)
  );
}

await fs.mkdir(OUT, { recursive: true });
const files = (await fs.readdir(TEMPLATES)).filter((f) => f.endsWith(".svg")).sort();

for (const file of files) {
  const id = file.replace(".svg", "");
  const raw = await fs.readFile(path.join(TEMPLATES, file), "utf8");
  const svg = stripSignature(raw);

  const head = svg.slice(0, svg.indexOf("</defs>") + "</defs>".length);
  const body = svg.slice(svg.indexOf("</defs>") + "</defs>".length, svg.lastIndexOf("</svg>"));
  const elements = topLevelElements(body);
  const front = elements.filter(isForeground);
  if (front.length !== 3) {
    throw new Error(`${id}: expected 3 foreground elements, found ${front.length}`);
  }

  const compose = (parts) => `${head}${parts.join("")}</svg>`;
  const render = (source) =>
    new Resvg(source, { fitTo: { mode: "width", value: SIZE }, background: "rgba(0,0,0,0)" })
      .render()
      .asPng();

  const backPng = render(compose(elements.filter((e) => !isForeground(e))));
  const frontPng = render(compose(front));

  await fs.writeFile(path.join(OUT, `${id}.png`), backPng);
  await fs.writeFile(path.join(OUT, `${id}-front.png`), frontPng);
  await sharp(render(compose(elements))).resize(360, 360).jpeg({ quality: 86 })
    .toFile(path.join(OUT, `${id}-thumb.jpg`));

  const stripped = raw.length - svg.replace(/fill-opacity="0"/g, 'fill-opacity="1"').length;
  console.log(
    `${id}: back ${(backPng.length / 1024).toFixed(0)}KB, front ${(frontPng.length / 1024).toFixed(0)}KB` +
      `${stripped === 0 ? " (no baked signature)" : ""}`,
  );
}
