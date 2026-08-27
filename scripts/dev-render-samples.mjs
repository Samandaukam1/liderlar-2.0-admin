/**
 * Dev-only: renders sample posts for every template so layout changes can be
 * eyeballed against the reference composition. Not used at runtime.
 *
 * Run: node --conditions=react-server scripts/dev-render-samples.mjs <outDir>
 */
import fs from "node:fs/promises";
import path from "node:path";
import { buildPostLayout } from "../src/lib/post-studio/compose.ts";
import { renderPostImage, toDataUri } from "../src/lib/post-studio/render.ts";
import { splitNameIntoLines } from "../src/lib/post-studio/name-lines.ts";
import { POST_TEMPLATE_IDS } from "../src/lib/post-studio/types.ts";

const outDir = process.argv[2] ?? "/tmp/post-samples";
await fs.mkdir(outDir, { recursive: true });

const portrait = await fs.readFile(process.argv[3]);
const href = toDataUri(portrait, "image/png");

const SAMPLES = [
  {
    name: "Rasuljonova Gulnoza Avazjon qizi",
    quote: "O‘z qiziqishlari va imkoniyatlarini qidirlash, bilim olishdan hamda yangi narsalarni sinab ko‘rishdan qo‘rqmaslik kerak",
    bio: ["Psixologiya talabasi", "Ijodkor", "Yosh volontyor", "Kitobxon", "Til sertifikatlari sohibasi"],
  },
  {
    name: "Oybekova Farangiz Farkhodovna",
    quote: "Buyuk bo‘lish shart emas, lekin boshlash uchun buyuk bo‘lish kerak",
    bio: ["Iqtisodchi", "Tadbirkor", "Grant sohibasi"],
  },
  {
    name: "O‘ktamjonova Nilufar Topiboldi qizi",
    quote: "Nima bo‘lishidan qat’i nazar, orzular tomon yurish shart. Zero, vaqt o‘tib ketadi, orzu esa ro‘yobini topib, insonga baxt berishi lozim. Shunchaki yashashdan nima ma’no?",
    bio: ["Bud-98 o‘quvchisi", "Xalqaro olimpiada sovrindori", "Yosh ixtirochi", "Volontyor"],
  },
  {
    name: "Шаҳзод Дадаев Шухратжон ўғли",
    quote: "Ҳар қандай шароитда ўз устингда ишлаш, фойдали бўлиш ва бошлаган йўлингдан масъулият билан давом этиш",
    bio: ["Дастурчи", "Ментор", "Кириллча текшируви"],
  },
];

let i = 0;
for (const templateId of POST_TEMPLATE_IDS) {
  const sample = SAMPLES[i % SAMPLES.length];
  i += 1;

  const started = Date.now();
  const layout = buildPostLayout({
    templateId,
    quote: sample.quote,
    nameLines: splitNameIntoLines(sample.name),
    shortBioItems: sample.bio,
    portraitHref: href,
    portraitTransform: { offsetX: 0, offsetY: 0, scale: 1, flip: false },
  });
  const { png } = await renderPostImage(layout);
  await fs.writeFile(path.join(outDir, `${templateId}.png`), png);

  console.log(
    `${templateId}  ${Date.now() - started}ms  quote=${layout.quote.fontSize}/${layout.quote.lines.length}ln  ` +
      `name=${layout.name.fontSize}/${layout.name.lines.length}ln  bio=${layout.shortBio.fontSize}  ` +
      `warn=[${layout.warnings.map((w) => w.code).join(",") || "-"}]`,
  );
}
