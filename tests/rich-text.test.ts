import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  isSafeLink,
  parseInline,
  parseRichText,
  richTextToPlain,
} from "../src/lib/articles/rich-text.ts";

/*
 * MAQOLA MATNI — YENGIL BELGILASH.
 *
 * Bu fayl IKKALA repoda bir xil: web matnni chizadi, admin uni
 * AdabiyotX'ga bloklar sifatida uzatadi. Tahlilchi ikki joyda farq
 * qilsa, bitta maqola ikki ilovada turlicha ko'rinardi.
 */

/* ------------------------------------------------------------------ *
 * ESKI MATN O'ZGARMAYDI
 * ------------------------------------------------------------------ */

test("belgisiz matn: har qator alohida abzats (oldingi ko'rinish)", () => {
  const blocks = parseRichText("Birinchi qator.\nIkkinchi qator.\n\nUchinchi abzats.");
  assert.deepEqual(
    blocks.map((block) => (block.type === "paragraph" ? block.children[0]!.text : block.type)),
    ["Birinchi qator.", "Ikkinchi qator.", "Uchinchi abzats."],
  );
});

test("bo'sh va yo'q matn bo'sh ro'yxat beradi", () => {
  assert.deepEqual(parseRichText(""), []);
  assert.deepEqual(parseRichText(null), []);
  assert.deepEqual(parseRichText("\n\n   \n"), []);
});

/* ------------------------------------------------------------------ *
 * QATOR ICHIDAGI BELGILAR
 * ------------------------------------------------------------------ */

test("qalin, kursiv va havola", () => {
  assert.deepEqual(parseInline("a **qalin** b"), [
    { text: "a " },
    { text: "qalin", bold: true },
    { text: " b" },
  ]);
  assert.deepEqual(parseInline("*kursiv*"), [{ text: "kursiv", italic: true }]);
  assert.deepEqual(parseInline("[Liderlar](https://liderlar.uz)"), [
    { text: "Liderlar", href: "https://liderlar.uz" },
  ]);
});

test("ichma-ich: qalin havola, qalin ichida kursiv", () => {
  assert.deepEqual(parseInline("[**muhim**](https://liderlar.uz)"), [
    { text: "muhim", bold: true, href: "https://liderlar.uz" },
  ]);
  assert.deepEqual(parseInline("**a *b* c**"), [
    { text: "a ", bold: true },
    { text: "b", bold: true, italic: true },
    { text: " c", bold: true },
  ]);
});

test("yopilmagan belgi matn bo'lib qoladi — hech narsa yo'qolmaydi", () => {
  assert.deepEqual(parseInline("5 * 3 = 15"), [{ text: "5 * 3 = 15" }]);
  assert.deepEqual(parseInline("**yopilmagan"), [{ text: "**yopilmagan" }]);
  assert.deepEqual(parseInline("[matn](havola"), [{ text: "[matn](havola" }]);
});

test("qochirish: \\* belgining o'zi", () => {
  assert.deepEqual(parseInline("\\*yulduz\\*"), [{ text: "*yulduz*" }]);
});

/* ------------------------------------------------------------------ *
 * HAVOLA XAVFSIZLIGI — §58
 * ------------------------------------------------------------------ */

test("faqat https havola qabul qilinadi", () => {
  assert.equal(isSafeLink("https://liderlar.uz/liderlar/a"), true);
  for (const bad of [
    "javascript:alert(1)",
    "data:text/html,<script>",
    "http://liderlar.uz",
    "//liderlar.uz",
    "liderlar.uz",
    "https://localhost",
    "",
  ]) {
    assert.equal(isSafeLink(bad), false, bad);
  }
});

test("xavfli havola HAVOLA BO'LMAYDI, matn bo'lib qoladi", () => {
  const nodes = parseInline("[bosing](javascript:alert(1))");
  assert.equal(nodes.some((node) => "href" in node), false);
  assert.equal(nodes.map((node) => node.text).join(""), "[bosing](javascript:alert(1))");
});

/* ------------------------------------------------------------------ *
 * BLOKLAR
 * ------------------------------------------------------------------ */

test("iqtibos: ketma-ket > qatorlar bitta blok", () => {
  const blocks = parseRichText("> Birinchi\n> ikkinchi\n\nOddiy");
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0]!.type, "quote");
  assert.equal(blocks[0]!.type === "quote" && blocks[0]!.children[0]!.text, "Birinchi\nikkinchi");
  assert.equal(blocks[1]!.type, "paragraph");
});

test("sarlavha darajalari", () => {
  const blocks = parseRichText("## Katta\n### Kichik\n# Bir panjara ham 2-daraja");
  assert.deepEqual(
    blocks.map((block) => (block.type === "heading" ? block.level : 0)),
    [2, 3, 2],
  );
});

test("ro'yxat: ketma-ket - qatorlar, ichida belgilar ishlaydi", () => {
  const blocks = parseRichText("- bir\n- **ikki**\n- uch");
  assert.equal(blocks.length, 1);
  const list = blocks[0]!;
  assert.equal(list.type, "list");
  if (list.type !== "list") return;
  assert.equal(list.items.length, 3);
  assert.deepEqual(list.items[1], [{ text: "ikki", bold: true }]);
});

test("qochirilgan blok belgisi oddiy abzats", () => {
  const blocks = parseRichText("\\## sarlavha emas\n\\- ro'yxat emas");
  assert.deepEqual(
    blocks.map((block) => block.type),
    ["paragraph", "paragraph"],
  );
});

test("matndagi tire ro'yxat emas — faqat qator boshidagi '- '", () => {
  const blocks = parseRichText("2020-2024 yillar");
  assert.equal(blocks[0]!.type, "paragraph");
});

test("oddiy matn — belgilar va havola manzillari sanalmaydi", () => {
  assert.equal(
    richTextToPlain("## Sarlavha\n**qalin** [havola](https://liderlar.uz)"),
    "Sarlavha\n\nqalin havola",
  );
});

/* ------------------------------------------------------------------ *
 * IKKI REPO — BITTA TAHLILCHI
 * ------------------------------------------------------------------ */

test("tahlilchi ikki repoda bayt-baytigacha bir xil", (t) => {
  const self = (JSON.parse(readFileSync("package.json", "utf8")) as { name: string }).name;
  const other = join("..", self === "liderlar-admin" ? "liderlar-web" : "liderlar-admin");
  const path = "src/lib/articles/rich-text.ts";

  if (!existsSync(join(other, path))) {
    t.skip(`${other} topilmadi — ikki repoli tekshiruv o'tkazib yuborildi`);
    return;
  }

  assert.equal(
    readFileSync(join(other, path), "utf8"),
    readFileSync(path, "utf8"),
    "rich-text.ts ikki repoda farq qiladi — AdabiyotX va sayt maqolani turlicha ko'rsatadi",
  );
});
