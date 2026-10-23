import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildSearchIndex, nameSkeleton, searchIndex } from "../src/lib/vip/bot-search.ts";
import {
  buildCandidateInvitation,
  buildVipCardKeyboard,
  buildVipCardText,
  canGrantNow,
  inlineDescription,
  inlineMessageText,
  isLegacyBioLink,
  monthsToDays,
  parseCandidateReference,
  parseVipCallback,
  vipCallbackData,
  type VipCard,
} from "../src/lib/vip/bot-messages.ts";

/* ================================================================ qidiruv */

const NAMES = [
  "Саидов Сардорбек Ойбекович",
  "Музафаров Отабек Умидovich",
  "Исаева Маржона Васлиддин Кизи",
  "Абдуллаева Латофат Абдулатипovna",
  "Уктамов Шахзод Сухробович",
  "Sodiqov Xurshid Sa'dullo O'g'li",
  "Xabibullayeva Mohinabonu Xurshidjon Qizi",
  "Aliyev Ali Valiyevich",
  "Muhammadov Jasur",
  "Джамшид Маджидов",
];
const INDEX = buildSearchIndex(NAMES.map((fullName, i) => ({ id: String(i), fullName, published: true })));
const first = (query: string) => searchIndex(INDEX, query, 1)[0]?.fullName ?? null;

test("lotincha yozilsa kirillcha ism topiladi", () => {
  assert.equal(first("saidov"), "Саидов Сардорбек Ойбекович");
  assert.equal(first("marjona"), "Исаева Маржона Васлиддин Кизи");
  assert.equal(first("shaxzod"), "Уктамов Шахзод Сухробович");
  assert.equal(first("jamshid"), "Джамшид Маджидов");
});

test("o'zbek va rus yozuvidagi farqlar bir xil skeletga tushadi", () => {
  assert.equal(nameSkeleton("Aliyev"), nameSkeleton("Алиев"), "-iyev = -иев");
  assert.equal(nameSkeleton("Abdullayeva"), nameSkeleton("Абдуллаева"), "-ayeva = -аева");
  assert.equal(nameSkeleton("Xurshid"), nameSkeleton("Khurshid"));
  assert.equal(nameSkeleton("Xurshid"), nameSkeleton("Хуршид"));
  assert.equal(nameSkeleton("Qizi"), nameSkeleton("Кизи"));
  assert.equal(nameSkeleton("Muhammad"), nameSkeleton("Мухаммад"));
  assert.equal(nameSkeleton("Yo‘ldosh"), nameSkeleton("Йўлдош"));
});

test("apostrofning har xil belgisi farq qilmaydi", () => {
  for (const variant of ["O'g'li", "Oʻgʻli", "O‘g‘li", "O`g`li", "Ogli"]) {
    assert.equal(nameSkeleton(variant), "ogli", variant);
  }
});

test("rus «У» o'rnida o'zbek «O'» — bitta harf farqi kechiriladi", () => {
  assert.equal(first("o'ktamov"), "Уктамов Шахзод Сухробович");
  assert.equal(first("oktam"), "Уктамов Шахзод Сухробович");
});

test("harf-harf: so'zning boshi yetarli, so'zlar tartibi muhim emas", () => {
  assert.equal(first("sar"), "Саидов Сардорбек Ойбекович");
  assert.equal(first("sardor saidov"), "Саидов Сардорбек Ойбекович");
  assert.equal(first("jasur muham"), "Muhammadov Jasur");
});

test("har so'z boshqa-boshqa bo'lakka mos kelishi shart", () => {
  // "Aliyev Ali Valiyevich" da "ali" ikki marta bor; "Muhammadov Jasur" da yo'q.
  assert.equal(first("ali ali"), "Aliyev Ali Valiyevich");
  assert.equal(first("jasur jasur"), null);
});

test("teng ballda chop etilgan nomzod oldinda turadi", () => {
  const index = buildSearchIndex([
    { id: "draft", fullName: "Karimov Bekzod", published: false },
    { id: "pub", fullName: "Karimov Bekzod", published: true },
  ]);
  assert.deepEqual(searchIndex(index, "karimov").map((e) => e.id), ["pub", "draft"]);
});

test("bo'sh so'rov va chegaralar", () => {
  assert.deepEqual(searchIndex(INDEX, ""), []);
  assert.deepEqual(searchIndex(INDEX, "  ''  "), []);
  assert.equal(searchIndex(INDEX, "s", 2).length, 2, "limit kesadi");
});

/* ================================================================ callback */

const ID = "5f2c1e8a-1b2c-4d3e-8f90-123456789abc";

test("callback ikki tomonga o'giriladi va 64 baytdan oshmaydi", () => {
  for (const action of [
    { kind: "link", months: 0, candidateId: ID },
    { kind: "link", months: 3, candidateId: ID },
    { kind: "grant", months: 1, candidateId: ID },
  ] as const) {
    const data = vipCallbackData(action);
    assert.ok(Buffer.byteLength(data) <= 64, data);
    assert.deepEqual(parseVipCallback(data), action);
  }
});

test("begona yoki buzilgan callback qabul qilinmaydi", () => {
  assert.equal(parseVipCallback("vip:g0:" + ID), null, "0 oy VIP berib bo'lmaydi");
  assert.equal(parseVipCallback("vip:l4:" + ID), null);
  assert.equal(parseVipCallback("vip:l1:not-a-uuid"), null);
  assert.equal(parseVipCallback("chn:" + ID), null);
  assert.equal(parseVipCallback(undefined), null);
});

/* ================================================================ havola */

test("biografiya havolasi har xil ko'rinishda taniladi", () => {
  for (const text of [
    "https://liderlar.uz/liderlar/aliyev-ali",
    "https://www.liderlar.uz/liderlar/aliyev-ali/",
    "liderlar.uz/liderlar/aliyev-ali?utm_source=tg",
    "Mana: https://liderlar.uz/liderlar/aliyev-ali#bio rahmat",
  ]) {
    assert.deepEqual(parseCandidateReference(text), { kind: "slug", slug: "aliyev-ali" }, text);
  }
  assert.deepEqual(parseCandidateReference("https://liderlar.uz/liderlar/%D0%B0%D0%BB%D0%B8"), {
    kind: "slug",
    slug: "али",
  });
});

test("inline natija matni botning o'ziga qaytib taniladi", () => {
  const withLink = inlineMessageText({ candidateId: ID, fullName: "Aliyev Ali", articleUrl: "https://liderlar.uz/liderlar/aliyev-ali" });
  assert.deepEqual(parseCandidateReference(withLink), { kind: "slug", slug: "aliyev-ali" });
  const withoutLink = inlineMessageText({ candidateId: ID, fullName: "Aliyev Ali", articleUrl: null });
  assert.deepEqual(parseCandidateReference(withoutLink), { kind: "id", id: ID });
});

test("oddiy matn va eski sayt havolasi nomzod deb olinmaydi", () => {
  assert.equal(parseCandidateReference("salom, qalaysiz"), null);
  assert.equal(parseCandidateReference("https://liderlar.uz/nomzodlar/aliyev-ali"), null);
  assert.equal(isLegacyBioLink("https://liderlar.uz/nomzodlar/aliyev-ali"), true);
  assert.equal(isLegacyBioLink("https://liderlar.uz/tpost/abc123"), true);
  assert.equal(isLegacyBioLink("https://liderlar.uz/liderlar/aliyev-ali"), false);
});

/* ================================================================ karta */

const NOW = new Date("2026-10-23T10:00:00Z");
const day = (n: number) => new Date(NOW.getTime() + n * 86_400_000);

function card(overrides: Partial<VipCard> = {}): VipCard {
  return {
    candidateId: ID,
    fullName: "Aliyev Ali",
    articleUrl: "https://liderlar.uz/liderlar/aliyev-ali",
    regionName: "Toshkent shahri",
    published: true,
    linked: false,
    subscription: null,
    liveLink: null,
    ...overrides,
  };
}

const sub = (state: "active" | "expired" | "suspended" | "cancelled", end: Date | null) => ({
  state,
  times: { startedAt: day(-30), currentPeriodEnd: end, graceUntil: null },
});

const callbacks = (c: VipCard) => buildVipCardKeyboard(c, NOW).flat().map((b) => parseVipCallback(b.callback_data));

test("akkaunti yo'q: 1/2/3 oy VIP bilan havola va VIPsiz havola", () => {
  assert.deepEqual(
    callbacks(card()).map((a) => a && `${a.kind}${a.months}`),
    ["link1", "link2", "link3", "link0"],
  );
  assert.match(buildVipCardText(card(), NOW), /akkauntini ochgan paytdan hisoblanadi/);
});

test("akkaunti bor: tugagan VIP'ga ham, faoliga ham +1/+2/+3 oy", () => {
  const expired = card({ linked: true, subscription: sub("expired", day(-3)) });
  assert.deepEqual(callbacks(expired).map((a) => a && `${a.kind}${a.months}`), ["grant1", "grant2", "grant3"]);
  assert.match(buildVipCardText(expired, NOW), /tugagan — 20\.10\.2026/);

  const active = card({ linked: true, subscription: sub("active", day(12)) });
  assert.equal(callbacks(active).length, 3);
  assert.match(buildVipCardText(active, NOW), /12 kun qoldi[\s\S]*tugash sanasidan uzaytiriladi/i);

  assert.equal(callbacks(card({ linked: true })).length, 3, "hech qachon VIP bo'lmagan");
  assert.equal(callbacks(card({ linked: true, subscription: sub("cancelled", day(-1)) })).length, 3);
});

test("to'xtatilgan va muddatsiz VIP'ga bot tegmaydi", () => {
  const suspended = card({ linked: true, subscription: sub("suspended", day(10)) });
  assert.equal(canGrantNow(suspended, NOW), false);
  assert.deepEqual(buildVipCardKeyboard(suspended, NOW), []);
  assert.match(buildVipCardText(suspended, NOW), /panel orqali tiklang/);

  const lifetime = card({ linked: true, subscription: sub("active", null) });
  assert.deepEqual(buildVipCardKeyboard(lifetime, NOW), []);
});

test("amaldagi havola kartada ko'rinadi va yangisi uni bekor qilishi aytiladi", () => {
  const text = buildVipCardText(card({ liveLink: { expiresAt: day(1), vipDays: 60 } }), NOW);
  assert.match(text, /Amaldagi havola: 24\.10\.2026 15:00 gacha · \+2 oy VIP bilan/);
  assert.match(text, /Yangi havola amaldagisini bekor qiladi/);
});

test("ismdagi HTML belgilar xabarni buzmaydi", () => {
  assert.match(buildVipCardText(card({ fullName: "A<b>&" }), NOW), /A&lt;b&gt;&amp;/);
});

test("inline natija ostida akkaunt va VIP holati", () => {
  assert.equal(inlineDescription(card(), NOW), "Toshkent shahri · akkaunt yo‘q");
  assert.equal(
    inlineDescription(card({ liveLink: { expiresAt: day(1), vipDays: 90 } }), NOW),
    "Toshkent shahri · akkaunt yo‘q · havolada +3 oy VIP",
  );
  assert.equal(
    inlineDescription(card({ linked: true, subscription: sub("expired", day(-3)) }), NOW),
    "Toshkent shahri · akkaunt bor · VIP tugagan 20.10.2026",
  );
  assert.equal(
    inlineDescription(card({ linked: true, published: false, subscription: sub("active", day(12)) }), NOW),
    "Toshkent shahri · chop etilmagan · akkaunt bor · VIP 04.11.2026 gacha",
  );
});

test("nomzodga yuboriladigan matn: havola, muddat, VIP sovg'asi faqat VIP bilan", () => {
  const withVip = buildCandidateInvitation({ fullName: "Aliyev Ali", link: "https://x/akkaunt/faollashtirish/t", vipDays: 60, expiresAt: day(2) });
  assert.match(withVip, /https:\/\/x\/akkaunt\/faollashtirish\/t/);
  assert.match(withVip, /2 oylik VIP sovg‘a qilindi/);
  assert.match(withVip, /25\.10\.2026 15:00 gacha amal qiladi/);
  const plain = buildCandidateInvitation({ fullName: "Aliyev Ali", link: "https://x", vipDays: null, expiresAt: day(2) });
  assert.doesNotMatch(plain, /VIP/);
});

test("1 oy = 30 kun", () => {
  assert.deepEqual([1, 2, 3].map((m) => monthsToDays(m as 1 | 2 | 3)), [30, 60, 90]);
});

/* ================================================================ ulanish */

const ROUTER = readFileSync("src/lib/post-studio/bot-router.ts", "utf8");
const FLOW = readFileSync("src/lib/vip/bot-flow.ts", "utf8");
const SERVICE = readFileSync("src/lib/vip/bot-service.ts", "utf8");
const MIGRATION = readFileSync("supabase/migrations/20261023100000_vip_post_bot.sql", "utf8");

test("har VIP yo'li studio.vip ruxsatini tekshiradi", () => {
  assert.match(ROUTER, /if \(access\.has\("studio\.vip"\)\) rows\.push\(\[VIP_BUTTON_LABEL\]\)/);
  assert.match(ROUTER, /text === VIP_BUTTON_LABEL\) \{\s*if \(!can\("studio\.vip"\)\) return deny/);
  assert.match(ROUTER, /allowed: inlineAccess\.permissions\.has\("studio\.vip"\)/);
  assert.match(ROUTER, /!vipAccess\?\.permissions\.has\("studio\.vip"\)/);
  assert.match(ROUTER, /if \(can\("studio\.vip"\)\) \{\s*const reference = parseCandidateReference\(text\)/);
});

test("havola tarmog'i yordam javobidan OLDIN, javob kutayotgan oqimlardan KEYIN", () => {
  const reference = ROUTER.indexOf("const reference = parseCandidateReference(text)");
  assert.ok(reference > ROUTER.indexOf("isBlacklistPromptReply(message?.reply_to_message?.text)"));
  assert.ok(reference > ROUTER.indexOf("isIntakeLinkNamePrompt(message?.reply_to_message?.text)"));
  assert.ok(reference < ROUTER.indexOf("// Never leave a message unanswered."));
});

test("ruxsati yo'q odamga inline qidiruv bo'sh qaytadi", () => {
  assert.match(FLOW, /if \(!access\.allowed\) \{\s*await answerInlineQuery\(query\.id, \[\]/);
});

test("bir karta — bir amal: ikkinchi bosish to'xtaydi, VIP kaliti kartaga bog'liq", () => {
  assert.match(FLOW, /const claimed = await claimCard\(/);
  assert.match(FLOW, /idempotencyKey: `post-bot:\$\{chatId\}:\$\{messageId\}`/);
  assert.match(MIGRATION, /primary key \(chat_id, message_id\)/);
});

test("VIP yozilmasa havola bekor qilinadi — 'VIP bilan' havola VIPsiz ketmaydi", () => {
  const fn = SERVICE.slice(SERVICE.indexOf("export async function createVipLink"));
  assert.match(fn.slice(0, fn.indexOf("\n}\n")), /if \(error\) \{[\s\S]*await revokeActivation\(created\.activationId/);
});

test("trigger akkaunt ochilishini hech qachon yiqitmaydi va faqat o'sha havolaning VIP'ini beradi", () => {
  assert.match(MIGRATION, /after update of user_id on public\.candidates/);
  assert.match(MIGRATION, /when \(old\.user_id is null and new\.user_id is not null\)/);
  assert.match(MIGRATION, /exception when others then\s*-- Akkaunt baribir ochiladi/);
  assert.match(MIGRATION, /and a\.consumed_by_user_id = c\.user_id/);
  assert.match(MIGRATION, /'post-bot-pending:' \|\| r\.id/);
  assert.match(MIGRATION, /activation_id uuid not null unique/);
});

test("jadvallarga faqat server kiradi", () => {
  assert.match(MIGRATION, /alter table public\.vip_pending_grants enable row level security/);
  assert.match(MIGRATION, /alter table public\.vip_bot_card_actions enable row level security/);
  assert.match(MIGRATION, /revoke all on function public\.vip_apply_pending_grants\(uuid\) from public, anon, authenticated/);
  assert.match(MIGRATION, /grant execute on function public\.vip_apply_pending_grants\(uuid\) to service_role/);
});

test("trigger o'tkazib yuborgan VIP soatlik cron'da qayta uriniladi", () => {
  const cron = readFileSync("src/app/api/cron/vip-expiry/route.ts", "utf8");
  assert.match(cron, /await applyPendingVipGrants\(\)/);
});
