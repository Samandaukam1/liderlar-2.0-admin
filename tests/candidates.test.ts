import assert from "node:assert/strict";
import test from "node:test";
import { parseCandidateText, splitPipeValues, stripCandidateMarkers } from "../src/lib/candidates/parser.ts";
import { serializeCandidateData } from "../src/lib/candidates/serializer.ts";
import { normalizeCandidateIntake } from "../src/lib/candidates/normalize-intake.ts";
import { candidateAiOutputSchema, emptyCandidateData } from "../src/lib/candidates/schema.ts";

const SAMPLE = [
  "!!!Rasulova Sevara Turdimurod qizi",
  "&&&Jurnalist | Maqola muallifi | Yosh ijodkor",
  "+++2006-yil 1-noyabr",
  "***Sirdaryo viloyati",
  "$$$Sirdaryo viloyati, Mirzaobod tumani",
  "(((O‘zbekiston jurnalistika va ommaviy kommunikatsiyalar universiteti",
  ")))Jurnalistika va ommaviy kommunikatsiyalar",
  "%%%O‘zbek tili | Ingliz tili | Rus tili",
  "",
  "^^^Ilk qadamlar",
  "",
  "Sevaraning qiziqishi maktab davrida boshlangan.",
  "",
  "^^^Ijodiy faoliyat",
  "",
  "Uning maqolalari gazetalarda e’lon qilingan.",
].join("\r\n");

test("marker parser Windows/Unix qatorlari va bo‘limlarni tartib bilan ajratadi", () => {
  const result = parseCandidateText(SAMPLE);
  assert.equal(result.data.fullName, "Rasulova Sevara Turdimurod qizi");
  assert.deepEqual(result.data.descriptionItems, ["Jurnalist", "Maqola muallifi", "Yosh ijodkor"]);
  assert.deepEqual(result.data.languages, ["O‘zbek tili", "Ingliz tili", "Rus tili"]);
  assert.deepEqual(result.data.sections.map((section) => section.title), ["Ilk qadamlar", "Ijodiy faoliyat"]);
  assert.deepEqual(result.data.sections.map((section) => section.order), [0, 1]);
});

test("faqat yangi qator boshidagi belgi marker hisoblanadi", () => {
  const result = parseCandidateText(`${SAMPLE}\nMatn ichida !!!bu marker emas.`);
  assert.match(result.data.sections[1]?.content ?? "", /!!!bu marker emas/);
});

test("tavsif va tillar pipe orqali trim/dedupe qilinadi", () => {
  assert.deepEqual(splitPipeValues(" Hamshira | Volontyor || hamshira | Yoshlar faoli "), [
    "Hamshira",
    "Volontyor",
    "Yoshlar faoli",
  ]);
});

test("takrorlangan marker ogohlantiriladi va matni yo‘qolmaydi", () => {
  const result = parseCandidateText(`${SAMPLE}\n!!!Ikkinchi ism`);
  assert.equal(result.data.fullName, "Rasulova Sevara Turdimurod qizi");
  assert.ok(result.warnings.some((warning) => warning.code === "duplicate_marker"));
  assert.match(result.unparsedText, /!!!Ikkinchi ism/);
});

test("yetishmayotgan markerlar bo‘yicha aniq ogohlantirish qaytadi", () => {
  const result = parseCandidateText("!!!Faqat Ism");
  assert.ok(result.warnings.filter((warning) => warning.code === "missing_marker").length >= 7);
});

test("structured → markerli matn → structured round-trip teng", () => {
  const initial = parseCandidateText(SAMPLE).data;
  const serialized = serializeCandidateData(initial);
  const roundTrip = parseCandidateText(serialized).data;
  assert.deepEqual(
    {
      ...roundTrip,
      sections: roundTrip.sections.map(({ title, content, order }) => ({ title, content, order })),
      rawContent: "",
    },
    {
      ...initial,
      sections: initial.sections.map(({ title, content, order }) => ({ title, content, order })),
      rawContent: "",
    },
  );
});

test("public matndan barcha markerlar olib tashlanadi", () => {
  const clean = stripCandidateMarkers("!!!Ali Valiyev\n^^^Ta’lim\n%%%O‘zbek tili");
  assert.equal(clean, "Ali Valiyev\nTa’lim\nO‘zbek tili");
  assert.doesNotMatch(clean, /!!!|\^\^\^|%%%/);
});

test("raw anketa aliaslari markaziy adapterda normalize qilinadi va noma’lum javob saqlanadi", () => {
  const result = normalizeCandidateIntake({
    fish: "Ali Valiyev",
    tugilgan_yili: "2001",
    qaysi_tillar: "O‘zbek | Ingliz",
    sevimli_kitob: "O‘tkan kunlar",
  });
  assert.equal(result.data.fullName, "Ali Valiyev");
  assert.equal(result.data.birthYear, "2001");
  assert.deepEqual(result.data.languages, ["O‘zbek", "Ingliz"]);
  assert.equal(result.unmapped.sevimli_kitob, "O‘tkan kunlar");
  assert.match(result.rawContent, /sevimli_kitob/);
});

test("AI candidate schema noto‘g‘ri javobni rad etadi", () => {
  const valid = candidateAiOutputSchema.safeParse({
    fullName: "Ali Valiyev",
    description: ["Talaba"],
    birthYear: "2001",
    birthPlace: "Toshkent",
    currentLocation: "Toshkent",
    education: "Universitet",
    activityField: "IT",
    languages: ["O‘zbek tili"],
    sections: [{ title: "Ta’lim", content: "Mazmun", order: 0 }],
  });
  assert.equal(valid.success, true);
  assert.equal(candidateAiOutputSchema.safeParse({ ...emptyCandidateData(), description: "Talaba" }).success, false);
});

