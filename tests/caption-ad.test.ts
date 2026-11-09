import test from "node:test";
import assert from "node:assert/strict";
import {
  appendAdToCaption,
  buildAdLine,
  captionLengthWithAd,
} from "../src/lib/post-studio/caption-ad.ts";
import { buildTelegramCaption, TELEGRAM_CAPTION_LIMIT } from "../src/lib/post-studio/telegram-markdown.ts";

const AD = {
  id: "11111111-1111-4111-8111-111111111111",
  text: "Liderlar.uz ilovasini yuklab oling",
  url: "https://liderlar.uz/ilova?utm=tg&v=(1)",
};

function fixtureCaption(): string {
  return buildTelegramCaption({
    quote: "Orzular tomon yurish shart. Vaqt o‘tib ketadi!",
    fullName: "Rasuljonova Gulnoza Avazjon qizi",
    articleUrl: "https://liderlar.uz/liderlar/rasuljonova-gulnoza",
    applicationUrl: "https://liderlar.uz/ariza",
    siteUrl: "https://liderlar.uz",
    instagramUrl: "https://instagram.com/liderlar.uz",
    telegramUsername: "liderlaruz",
  });
}

test("reklama qatori nomzod ismi qatori bilan bir xil shaklda va escape qilingan", () => {
  const line = buildAdLine(AD);
  assert.equal(line, "[*Liderlar\\.uz ilovasini yuklab oling*](https://liderlar.uz/ilova?utm=tg&v=(1\\))");
  // Ism qatori bilan bir xil shakl: [*...*](...)
  assert.match(line, /^\[\*.+\*\]\(.+\)$/);
});

test("'end' — reklama footer qatoridan keyin, postning eng oxirida", () => {
  const base = fixtureCaption();
  const composed = appendAdToCaption(base, AD, "end");
  assert.equal(composed.applied, true);
  const blocks = composed.caption.split("\n\n");
  assert.equal(blocks.length, 5);
  assert.equal(blocks[4], buildAdLine(AD));
  assert.ok(composed.caption.startsWith(base));
});

test("'before_footer' — reklama oxirgi (footer) blokdan oldin turadi", () => {
  const base = fixtureCaption();
  const composed = appendAdToCaption(base, AD, "before_footer");
  assert.equal(composed.applied, true);
  const blocks = composed.caption.split("\n\n");
  assert.equal(blocks.length, 5);
  assert.equal(blocks[3], buildAdLine(AD));
  assert.match(blocks[4], /^\[Liderlar\\\.uz\]/);
});

test("bitta blokli captionda 'before_footer' oxiriga tushadi", () => {
  const composed = appendAdToCaption("*Faqat iqtibos*", AD, "before_footer");
  assert.equal(composed.caption, `*Faqat iqtibos*\n\n${buildAdLine(AD)}`);
});

test("sig'masa reklama tushib qoladi — caption o'zgarmaydi, xato yo'q", () => {
  const long = "x".repeat(TELEGRAM_CAPTION_LIMIT - 10);
  const composed = appendAdToCaption(long, AD, "end");
  assert.equal(composed.applied, false);
  assert.equal(composed.reason, "caption_limit");
  assert.equal(composed.caption, long);
});

test("reklama yo'q bo'lsa caption o'zgarmaydi", () => {
  const base = fixtureCaption();
  const composed = appendAdToCaption(base, null, "end");
  assert.equal(composed.applied, false);
  assert.equal(composed.reason, "no_ad");
  assert.equal(composed.caption, base);
});

test("hisoblagich reklama bilan uzunlikni chegaradan oshsa ham ko'rsatadi", () => {
  const base = fixtureCaption();
  assert.equal(captionLengthWithAd(base, null), [...base].length);
  assert.equal(captionLengthWithAd(base, AD, "end"), [...appendAdToCaption(base, AD, "end").caption].length);
  const long = "x".repeat(TELEGRAM_CAPTION_LIMIT);
  assert.ok(captionLengthWithAd(long, AD) > TELEGRAM_CAPTION_LIMIT);
});

test("oxiridagi bo'sh qatorlar reklamadan oldin olib tashlanadi", () => {
  const composed = appendAdToCaption("*Iqtibos*\n\n\n", AD, "end");
  assert.equal(composed.caption, `*Iqtibos*\n\n${buildAdLine(AD)}`);
});
