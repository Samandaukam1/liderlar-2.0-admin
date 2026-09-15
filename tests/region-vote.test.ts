import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildVoteKeyboard,
  buildVoteText,
  buildVoteAck,
  voteButtonLabel,
  voteCallbackData,
  parseVoteCallback,
  tallyVotes,
  VOTE_COLUMNS,
  REGION_VOTE_QUESTION,
  REGION_POLL_BUTTON_LABEL,
  REGION_POLL_COMMAND,
  type VoteOption,
} from "../src/lib/post-studio/region-vote.ts";

const router = readFileSync("src/lib/post-studio/bot-router.ts", "utf8");
const service = readFileSync("src/lib/post-studio/region-vote-service.ts", "utf8");
const migration = readFileSync(
  "supabase/migrations/20260915120000_channel_region_vote.sql",
  "utf8",
);
const code = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

/** 14 ta hudud — bazadagi kabi qisqa nomlar bilan. */
const REGIONS: VoteOption[] = [
  ["toshkent-shahri", "Toshkent shahri"],
  ["toshkent-viloyati", "Toshkent viloyati"],
  ["andijon", "Andijon"],
  ["buxoro", "Buxoro"],
  ["fargona", "Farg‘ona"],
  ["jizzax", "Jizzax"],
  ["xorazm", "Xorazm"],
  ["namangan", "Namangan"],
  ["navoiy", "Navoiy"],
  ["qashqadaryo", "Qashqadaryo"],
  ["qoraqalpogiston", "Qoraqalpog‘iston"],
  ["samarqand", "Samarqand"],
  ["sirdaryo", "Sirdaryo"],
  ["surxondaryo", "Surxondaryo"],
].map(([key, name]) => ({ key, name }));

/* ===================== 1. TUGMALAR — 14 TA, CHEGARASIZ ================= */

test("14 ta hudud BITTA xabarga sig‘adi", () => {
  /*
   * Telegram so'rovnomasi 12 tadan ko'p variant qabul qilmaydi va
   * ro'yxatni ikkiga bo'lish kerak bo'lgan edi. Tugmali ovozda
   * bunday cheklov yo'q — 14 tasi ham bitta xabarda.
   */
  const keyboard = buildVoteKeyboard(REGIONS);
  const buttons = keyboard.flat();
  assert.equal(buttons.length, 14);
  assert.equal(keyboard.length, 7, "2 ustundan 7 qator");
});

test("ikki ustun — nom kesilmasin, lenta ham egallanmasin", () => {
  assert.equal(VOTE_COLUMNS, 2);
  for (const row of buildVoteKeyboard(REGIONS)) {
    assert.ok(row.length <= VOTE_COLUMNS, `${row.length} ta tugma`);
  }
});

test("callback 64 bayt chegarasida", () => {
  for (const region of REGIONS) {
    const data = voteCallbackData(region.key);
    assert.ok(Buffer.byteLength(data, "utf8") <= 64, data);
    assert.equal(parseVoteCallback(data), region.key);
  }
});

test("begona callback qabul qilinmaydi", () => {
  for (const bad of [null, undefined, "", "crm:w:t:1", "chn:abc", "ilg:m", "rv:", "rv:UPPER", "rv:a b"]) {
    assert.equal(parseVoteCallback(bad as string | null), null, String(bad));
  }
});

test("callback SQL yoki yo‘l belgilarini o‘tkazmaydi", () => {
  // Qiymat to'g'ridan-to'g'ri bazaga so'rovga aylanadi.
  for (const bad of ["rv:'; drop table channel_poll_votes;--", "rv:../../etc", "rv:a%20b"]) {
    assert.equal(parseVoteCallback(bad), null, bad);
  }
});

/* ========================= 2. SANOQ KO'RINISHI ========================= */

test("bosgan zahoti son ko‘rinadi", () => {
  // Bu javob callback orqali darhol chiqadi va Telegram uni
  // cheklamaydi — xabar tahriri esa sekinroq bo‘lishi mumkin.
  const ack = buildVoteAck({ name: "Andijon", count: 42, changed: false });
  assert.match(ack, /Andijon/);
  assert.match(ack, /42/);
  assert.match(ack, /qabul qilindi/);
});

test("ovoz o‘zgartirilganda boshqacha aytiladi", () => {
  const changed = buildVoteAck({ name: "Buxoro", count: 7, changed: true });
  assert.match(changed, /o‘zgartirildi/);
});

test("tugmada son ovoz bo‘lgandagina chiqadi", () => {
  /*
   * "Andijon 0" yozuvi bo'sh so'rovda "bu yerda hech kim yo'q"
   * degan taassurot beradi va odamlar ko'pchilik tanlagan variantga
   * qarab ovoz berishga moyil bo'ladi.
   */
  assert.equal(voteButtonLabel("Andijon", 0), "Andijon");
  assert.equal(voteButtonLabel("Andijon", 1), "Andijon — 1");
  assert.equal(voteButtonLabel("Andijon", 128), "Andijon — 128");
});

test("tugmalar sanoq bilan yangilanadi", () => {
  const keyboard = buildVoteKeyboard(REGIONS, { andijon: 5, buxoro: 2 });
  const labels = keyboard.flat().map((b) => b.text);
  assert.ok(labels.includes("Andijon — 5"));
  assert.ok(labels.includes("Buxoro — 2"));
  assert.ok(labels.includes("Navoiy"), "ovozsizida son yo‘q");
});

test("jami ovoz xabar matnida", () => {
  assert.ok(!buildVoteText(0).includes("Jami"), "bo‘sh so‘rovda son yo‘q");
  assert.match(buildVoteText(17), /Jami: 17 ta ovoz/);
  assert.ok(buildVoteText(0).includes(REGION_VOTE_QUESTION));
});

test("sanoq ovozlardan to‘g‘ri yig‘iladi", () => {
  const counts = tallyVotes([
    { option_key: "andijon" },
    { option_key: "andijon" },
    { option_key: "buxoro" },
  ]);
  assert.deepEqual(counts, { andijon: 2, buxoro: 1 });
  assert.deepEqual(tallyVotes([]), {});
});

/* ======================= 3. BIR ODAM — BIR OVOZ ======================== */

test("takroriy bosish yangi ovoz QO‘SHMAYDI", () => {
  // Unikal indeks: (chat, message, user). Usiz bir odam cheksiz
  // bosib natijani buzib yuborardi.
  assert.match(
    migration,
    /create unique index[^;]*channel_poll_votes\(chat_id, message_id, telegram_user_id\)/,
  );
  assert.ok(code(service).includes('onConflict: "chat_id,message_id,telegram_user_id"'));
});

test("boshqa tugma bosilsa ovoz KO‘CHADI", () => {
  const fn = code(service).slice(code(service).indexOf("export async function recordRegionVote"));
  assert.ok(fn.includes(".upsert("), "yangi qator emas, ko‘chirish");
  assert.ok(fn.includes("previousKey"), "o‘zgarish aniqlansin");
});

test("o‘sha tugma qayta bosilsa hech narsa o‘zgarmaydi", () => {
  const fn = code(service).slice(code(service).indexOf("export async function recordRegionVote"));
  assert.ok(fn.includes("previousKey === input.optionKey"));
  assert.ok(fn.includes("allaqachon hisobga olingan"));
});

/* ==================== 4. KANAL VA RUXSATLAR ============================ */

test("so‘rov KANALGA joylanadi — forward ishlamaydi", () => {
  /*
   * Tugmali xabar forward qilinganda tugmalarini YO'QOTADI, ya'ni
   * "botdan olib kanalga tashlash" bu yerda mumkin emas.
   */
  const fn = code(service).slice(code(service).indexOf("export async function publishRegionVote"));
  assert.ok(fn.includes("getChannelId()"));
  assert.ok(fn.includes("sendTelegramMessage(channelId"));
});

test("kanal id forward orqali olinadi", () => {
  // Telegram kanal id'sini interfeysda ko'rsatmaydi va moderator
  // uni qo'lda topa olmaydi.
  assert.ok(code(router).includes("forward_from_chat"));
  assert.ok(code(router).includes('forwarded?.type === "channel"'));
  assert.ok(code(router).includes("saveChannelId("));
});

test("kanalni ro‘yxatga olish TAHRIRIYAT bilan cheklangan", () => {
  const branch = code(router).slice(code(router).indexOf('forwarded?.type === "channel"'));
  const guard = branch.indexOf("if (!editorial) return deny(");
  const save = branch.indexOf("saveChannelId(");
  assert.ok(guard !== -1 && guard < save, "ruxsat saqlashdan OLDIN");
});

test("kanal ulanmagan bo‘lsa NIMA QILISHNI aytadi", () => {
  // "Xato" deb qo'yish moderatorni nima qilishini bilmay qoldirardi.
  assert.ok(code(router).includes("CHANNEL_NOT_LINKED_REPLY"));
  assert.match(router, /uzating \(forward\)/);
  assert.match(router, /admin bo‘lishi shart/);
});

test("OVOZ BERISHDA tahririyat tekshiruvi YO‘Q — bu ataylab", () => {
  /*
   * Ovozni kanalning har bir obunachisi beradi va ular tahririyat
   * ro'yxatida bo'lmaydi. Tekshiruv qo'yilsa, so'rovga faqat
   * moderatorlar javob bera olardi.
   *
   * Himoya boshqa joyda: bir odam bir ovoz va qat'iy callback
   * shakli.
   */
  const branch = code(router).slice(code(router).indexOf("parseVoteCallback(query.data)"));
  const end = branch.indexOf("parseIntakeGenderCallback");
  const scoped = branch.slice(0, end === -1 ? undefined : end);
  assert.ok(!scoped.includes("isEditorialChat"), "obunachilar bloklanmasin");
  assert.ok(scoped.includes("recordRegionVote("));
});

/* ===================== 5. TEZLIK CHEGARASI ============================= */

test("tahrir yiqilsa OVOZ YO‘QOLMAYDI", () => {
  /*
   * Ko'p odam bir vaqtda bosganda ayrim tahrirlar 429 bilan
   * qaytadi. Ovoz allaqachon bazada, shuning uchun xato yutiladi
   * va keyingi bosish sanoqni baribir yangilaydi.
   */
  const fn = code(service).slice(code(service).indexOf("export async function recordRegionVote"));
  const upsert = fn.indexOf(".upsert(");
  const edit = fn.indexOf("editTelegramMessageText(");
  assert.ok(upsert !== -1 && upsert < edit, "ovoz tahrirdan OLDIN yoziladi");

  const editBlock = fn.slice(edit - 200);
  assert.ok(editBlock.includes("catch"), "tahrir xatosi ushlansin");
});

/* ======================== 6. BOTGA ULANGAN ============================= */

test("tugma va komanda bor", () => {
  assert.ok(code(router).includes("REGION_POLL_BUTTON_LABEL"));
  assert.ok(router.includes(REGION_POLL_COMMAND));
  assert.ok(!router.includes(REGION_POLL_BUTTON_LABEL), "yorliq nusxasi bo‘lmasin");
});

test("hududlar BAZADAN — ariza formasi bilan bir manbadan", () => {
  // Kodga yozilsa, admin panelda nom o'zgarganda forma bir nomni,
  // kanal so'rovi boshqasini ko'rsatardi.
  assert.ok(code(service).includes('from("regions")'));
  assert.ok(!service.includes("Qashqadaryo"), "kodda hudud nomi qotib qolmasin");
});

test("migratsiya non-destructive", () => {
  assert.ok(!/\bdrop table\b|\btruncate\b|\bdelete from\b/i.test(migration));
  assert.ok(migration.includes("create table if not exists public.channel_poll_votes"));
});
