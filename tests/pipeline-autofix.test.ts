import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { AUTO_RETRY_STAGES, decideAutoRetry } from "../src/lib/post-studio/pipeline-retry.ts";
import { buildAutofixNotice } from "../src/lib/post-studio/autofix-message.ts";
import { PIPELINE_STAGE_LABELS } from "../src/lib/post-studio/pipeline-stages.ts";

const pipeline = readFileSync("src/lib/post-studio/pipeline.ts", "utf8");
/** Izohlar tashlanadi: tekshiruv KODNI o‘qishi kerak, izohni emas. */
const code = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

/* ------------------------ odam qarori tegilmaydi ------------------------ */

test("ismdosh HECH QACHON avtomatik nashr qilinmaydi", () => {
  // Avtomatik "tuzatish" yo tirik maqolani qayta yozardi, yo bir odamni
  // ikki marta chop etardi. Bu ikki xil odammi yoki bir odam ikki marta
  // anketa to'ldirganmi — buni faqat odam biladi.
  const decision = decideAutoRetry(
    "promotion: Bu ismli nomzod avval chop etilgan — maqola qayta ishlanmadi.",
  );
  assert.equal(decision.retry, false);
  assert.equal(decision.refusal, "human_decision");
});

test("qora ro‘yxatdagi nomzod avtomatik nashr qilinmaydi", () => {
  const decision = decideAutoRetry("promotion: Shartnoma buzildi — qora ro‘yxatdagi nomzod.");
  assert.equal(decision.retry, false);
  assert.equal(decision.refusal, "human_decision");
});

test("odam qarori BOSHQA bosqich nomi bilan yozilsa ham tanib olinadi", () => {
  // Ikkinchi himoya qatlami: matn qaror bilan birga ko'chadi, bosqich
  // nomi esa kelajakda o'zgarishi mumkin.
  for (const stored of [
    "render: Bu ismli nomzod avval chop etilgan — maqola qayta ishlanmadi.",
    "telegram: Shartnoma buzildi — qora ro‘yxatdagi nomzod.",
    "caption: qora ro'yxatdagi nomzod",
  ]) {
    assert.equal(decideAutoRetry(stored).refusal, "human_decision", stored);
  }
});

test("`promotion` bosqichi umuman oq ro‘yxatda yo‘q", () => {
  // Ikkala odam qarori ham shu bosqichda yashaydi.
  assert.ok(!AUTO_RETRY_STAGES.includes("promotion"));
});

/* -------------------------- qaytariladiganlar --------------------------- */

test("o‘tkinchi to‘xtashlar bot tomonidan qaytariladi", () => {
  for (const stage of AUTO_RETRY_STAGES) {
    const decision = decideAutoRetry(`${stage}: nimadir vaqtincha ishlamadi`);
    assert.equal(decision.retry, true, stage);
    assert.equal(decision.stage, stage);
  }
});

test("eski `fact_validation` yozuvlari ham qaytariladi", () => {
  // Bu bosqich endi umuman to'xtatmaydi, lekin bazada eski qatorlar
  // qolgan va ular ham navbatga qaytishi kerak.
  const decision = decideAutoRetry(
    "fact_validation: Javoblarni yaxshilashda ayrim faktlar saqlanmadi — qo‘lda tekshirish kerak.",
  );
  assert.equal(decision.retry, true);
});

test("bosqichi o‘qilmagan xato ko‘r-ko‘rona qaytarilmaydi", () => {
  for (const stored of [null, undefined, "", "   ", "Error: ETIMEDOUT", "nimadir bo‘ldi"]) {
    const decision = decideAutoRetry(stored as string | null);
    assert.equal(decision.retry, false, String(stored));
  }
  assert.equal(decideAutoRetry("").refusal, "no_error");
  assert.equal(decideAutoRetry("Error: ETIMEDOUT").refusal, "unknown_stage");
});

test("oq ro‘yxat — qora ro‘yxat emas", () => {
  // Kelajakda yangi bosqich qo'shilsa, u avtomatik ravishda "qayta
  // urinma" bo'lib qolishi kerak, jimgina avtomatik nashrga
  // qo'shilib ketmasligi.
  const unknownStage = Object.keys(PIPELINE_STAGE_LABELS).find(
    (s) => !(AUTO_RETRY_STAGES as readonly string[]).includes(s),
  );
  assert.ok(unknownStage, "sanity: oq ro‘yxatdan tashqarida bosqich bor");
  assert.equal(decideAutoRetry(`${unknownStage}: xato`).retry, false);
});

/* ---------------------------- faktlar qoidasi --------------------------- */

test("nomzodning asl matni saqlanishi nashrni TO‘XTATMAYDI", () => {
  /*
   * `kept_original` — "AI javobni yaxshilay olmadi, nomzodning O'Z
   * matni saqlandi" degani, ya'ni himoyaning MUVAFFAQIYATI: hamma fakt
   * joyida. Kod esa aynan shuni yiqilish deb o'qib, faktlarning
   * birortasi yo'qolmagan yagona holatda nashrni to'xtatib turardi.
   *
   * Tahririyat qoidasi: faktlarning to'g'riligiga nomzodning o'zi
   * javobgar; anketadagi noto'g'ri sana tizimning xatosi emas.
   */
  const stage1 = code(pipeline).slice(
    code(pipeline).indexOf("runIntakeAiImprovement({ intakeId"),
  );
  const block = stage1.slice(0, stage1.indexOf('await stage("approval")'));
  assert.ok(
    !/fail\(\s*\n?\s*intakeId,\s*\n?\s*"fact_validation"/.test(block),
    "kept_original endi to‘xtatmasin",
  );
  assert.ok(!block.includes("factGatePassed"), "eski darvoza qoldiq bo‘lib qolmasin");
});

test("ogohlantirishlar YO‘QOLMAYDI — hisobot bo‘lib qoladi", () => {
  // To'siq olib tashlandi, yozuv emas: har javob uchun
  // `ai_fact_preservation` saqlanadi va bu yerda ham log qoladi.
  assert.ok(code(pipeline).includes("factFallbackCount("));
  const improve = readFileSync("src/lib/intake/improve-service.ts", "utf8");
  assert.ok(improve.includes("ai_fact_preservation"));
});

/* ------------------------------ qaytarish ------------------------------- */

test("urinishlar chegarasi qaytarishda ham kuchda qoladi", () => {
  // Aks holda doim yiqiladigan anketa cheksiz aylanardi va har
  // aylanishda OpenAI puli sarflanardi.
  const sweep = code(pipeline).slice(
    code(pipeline).indexOf("export async function recoverAutoFixableFailures"),
  );
  const body = sweep.slice(0, sweep.indexOf("\n}"));
  assert.ok(body.includes('.lt("post_pipeline_attempts", PIPELINE_MAX_ATTEMPTS)'));
  assert.ok(
    !body.includes("post_pipeline_attempts: 0"),
    "urinishlar soni qayta tiklanmasin",
  );
});

test("qaytarish holat SHARTLI — ikki yugurish bir anketani olmasin", () => {
  const sweep = code(pipeline).slice(
    code(pipeline).indexOf("export async function recoverAutoFixableFailures"),
  );
  const body = sweep.slice(0, sweep.indexOf("\n}"));
  const update = body.indexOf(".update(");
  const guard = body.indexOf('.eq("post_pipeline_status", "needs_review")', update);
  assert.ok(update !== -1 && guard > update, "shart update zanjirining ichida bo‘lsin");
});

/* --------------------- avval saytga qaraladi ---------------------------- */

const sweepBody = (() => {
  const at = code(pipeline).indexOf("export async function recoverAutoFixableFailures");
  return code(pipeline).slice(at, code(pipeline).indexOf("\n}", at));
})();

test("qaytarishdan OLDIN sayt tekshiriladi", () => {
  // Bu anketalar ustida odam allaqachon ishlagan bo'lishi mumkin:
  // to'xtash yozuvi bazada qolgan, nomzod esa qo'lda chiqarilgan.
  const check = sweepBody.indexOf("findOwnPublishedCandidate(");
  const requeue = sweepBody.indexOf('post_pipeline_status: "pending"');
  assert.ok(check !== -1, "sayt holati so‘ralsin");
  assert.ok(check < requeue, "tekshiruv navbatga qaytarishdan OLDIN");
});

test("sayt holati o‘qilmasa hech narsa qilinmaydi", () => {
  // "Bilmadim" ni "chop etilmagan" deb o'qish jonli maqolani
  // qayta yozdirishi mumkin edi.
  assert.ok(sweepBody.includes("if (!live.known) {"));
  const unknown = sweepBody.indexOf("if (!live.known) {");
  const nextContinue = sweepBody.indexOf("continue;", unknown);
  const requeue = sweepBody.indexOf('post_pipeline_status: "pending"');
  assert.ok(nextContinue !== -1 && nextContinue < requeue, "noma’lum holatda o‘tkazib yuborilsin");
});

test("qo‘lda bajarilgan ish qayta ishlanmaydi va “tuzatildi” deb aytilmaydi", () => {
  // Qaytadan quvurga solish OpenAI pulini sarflaydi, postni qayta
  // yuborishi mumkin va tahririyatga yolg'on xabar beradi — aslida
  // uni odam tuzatgan.
  assert.ok(sweepBody.includes("hasDeliveredPost("));
  const done = sweepBody.indexOf("hasDeliveredPost(");
  const closed = sweepBody.indexOf('post_pipeline_status: "completed"', done);
  assert.ok(closed !== -1, "yozuv yopilsin");
  // Yopish yo'lida autofix belgisi QO'YILMAYDI — xabar shundan chiqadi.
  const branch = sweepBody.slice(done, sweepBody.indexOf("continue;", closed));
  assert.ok(
    !branch.includes("post_pipeline_autofix_from"),
    "belgi qo‘yilmasin, aks holda “avtomatik tuzatildi” xabari ketardi",
  );
});

test("“saytda bor, posti yo‘q” esa aynan qaytariladi", () => {
  // Bu quvur tuzatadigan holatning o'zi: maqola chiqqan, post
  // chiqmagan. Bunda ish tugamagan va yopib qo'yish uni abadiy
  // postsiz qoldirardi.
  assert.ok(sweepBody.includes("hasDeliveredPost("));
  const closeAt = sweepBody.indexOf('post_pipeline_status: "completed"');
  const requeueAt = sweepBody.indexOf('post_pipeline_status: "pending"');
  assert.ok(closeAt < requeueAt, "yopish faqat post yetkazilgan holatda");
});

test("yetkazilganlik POSTNING o‘zidan so‘raladi", () => {
  const helper = code(pipeline).slice(code(pipeline).indexOf("async function hasDeliveredPost"));
  const body = helper.slice(0, helper.indexOf("\n}"));
  assert.ok(body.includes('.not("telegram_last_sent_at", "is", null)'));
  assert.ok(body.includes('from("candidate_social_posts")'));
});

test("oldingi xato saqlanadi — xabar nima tuzatilganini biladi", () => {
  const sweep = code(pipeline).slice(
    code(pipeline).indexOf("export async function recoverAutoFixableFailures"),
  );
  assert.ok(sweep.includes("post_pipeline_autofix_from: previous"));
});

test("qaytarish har cron tikida ishlaydi", () => {
  const tick = code(pipeline).slice(code(pipeline).indexOf("export async function runDuePipelines"));
  assert.ok(tick.includes("recoverAutoFixableFailures()"));
});

/* -------------------------------- xabar --------------------------------- */

test("xabar KIM va NIMA bo‘lganini aytadi", () => {
  const text = buildAutofixNotice({
    fullName: "Ruhshona Hamdamova",
    previousError:
      "fact_validation: Javoblarni yaxshilashda ayrim faktlar saqlanmadi — qo‘lda tekshirish kerak.",
    articleUrl: "https://liderlar.uz/liderlar/ruhshona-hamdamova",
  });

  assert.ok(text.startsWith("🔧 AVTOMATIK TUZATILDI"));
  assert.ok(text.includes("RUHSHONA HAMDAMOVA"), "ism bosh harflarda");
  assert.ok(text.includes(PIPELINE_STAGE_LABELS.fact_validation), "qaysi bosqich to‘xtagani");
  assert.ok(text.includes("https://liderlar.uz/liderlar/ruhshona-hamdamova"));
  assert.ok(text.includes("post botga yuborildi"));
});

test("o‘zbek ismi lotin “i” bilan buzilmaydi", () => {
  const text = buildAutofixNotice({ fullName: "Islomov Ilhom", previousError: null });
  assert.ok(text.includes("ISLOMOV ILHOM"));
  assert.ok(!text.includes("İ"));
});

test("noma’lum bosqich xabarda O‘YLAB TOPILMAYDI", () => {
  const text = buildAutofixNotice({
    fullName: "Karimov Aziz",
    previousError: "Error: connect ETIMEDOUT",
  });
  assert.ok(!text.includes("Xato:"), "bosqich o‘qilmasa, qatorning o‘zi chiqmasin");
  assert.ok(text.includes("KARIMOV AZIZ"));
});

test("havolasiz xabar bo‘sh qator qoldirmaydi", () => {
  for (const url of [null, undefined, "", "  "]) {
    const text = buildAutofixNotice({
      fullName: "Karimov Aziz",
      previousError: "render: xato",
      articleUrl: url,
    });
    assert.ok(!text.includes("🔗"), String(url));
  }
});

test("xabar bir marta ketadi — belgi tozalanadi", () => {
  const announce = code(pipeline).slice(code(pipeline).indexOf("async function announceAutofix"));
  const body = announce.slice(0, announce.indexOf("\n}"));
  assert.ok(body.includes("post_pipeline_autofix_from: null"), "belgi tozalansin");
  const clear = body.indexOf("post_pipeline_autofix_from: null");
  const send = body.indexOf("sendTelegramMessage(");
  assert.ok(clear < send, "tozalash yuborishdan OLDIN — takroriy xabar bo‘lmasin");
});

test("belgisiz yugurish jim tugaydi", () => {
  // Har muvaffaqiyatli yugurish emas, faqat QAYTARILGANI xabar beradi.
  const announce = code(pipeline).slice(code(pipeline).indexOf("async function announceAutofix"));
  assert.ok(announce.includes("if (!previous) return;"));
});

/* ------------------------------ migratsiya ------------------------------ */

test("migratsiya non-destructive", () => {
  const sql = readFileSync("supabase/migrations/20260910170000_pipeline_autofix.sql", "utf8");
  assert.ok(sql.includes("add column if not exists post_pipeline_autofix_from"));
  assert.ok(!/\bdrop\b|\btruncate\b|\bdelete from\b/i.test(sql));
  assert.ok(!/update\s+public\.candidate_intakes/i.test(sql), "mavjud qatorlarga yozmasin");
});
