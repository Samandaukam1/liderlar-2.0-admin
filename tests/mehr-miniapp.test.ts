import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  verifyTelegramInitData,
  INITDATA_MAX_AGE_SECONDS,
} from "../src/lib/member-bot/webapp-auth.ts";
import {
  mainMenu,
  mehrMenu,
  notLinkedMessage,
  linkFailureMessage,
  pointsMessage,
  certificatesMessage,
  notAvailableYet,
} from "../src/lib/member-bot/messages.ts";

const BOT_TOKEN = "123456:TEST-TOKEN-abcdefghijklmnop";
const NOW = 1_800_000_000;

/** Telegram qanday imzolasa, test ham xuddi shunday imzolaydi. */
function signInitData(
  fields: Record<string, string>,
  botToken: string = BOT_TOKEN,
): string {
  const pairs = Object.entries(fields)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`);

  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const hash = createHmac("sha256", secret).update(pairs.join("\n")).digest("hex");

  const params = new URLSearchParams(fields);
  params.set("hash", hash);
  return params.toString();
}

const USER = JSON.stringify({ id: 777001, first_name: "Aziz", username: "aziz_uz" });

// ---------------------------------------------------------------
// MINI APP IDENTIFIKATSIYASI
// ---------------------------------------------------------------

test("to'g'ri imzolangan initData qabul qilinadi va raqamli id chiqadi", () => {
  const data = signInitData({ user: USER, auth_date: String(NOW), query_id: "AAA" });
  const result = verifyTelegramInitData(data, BOT_TOKEN, NOW + 10);

  assert.equal(result.ok, true);
  assert.equal(result.ok === true && result.user.id, 777001);
});

test("BOSHQA bot tokeni bilan imzolangan initData rad etiladi", () => {
  /*
   * Bu eng muhim tekshiruv. Imzo o'tib ketsa, istalgan odam
   * o'zi uchun initData yasab, boshqa a'zo nomidan check-in
   * qila olardi.
   */
  const data = signInitData({ user: USER, auth_date: String(NOW) }, "999:BOSHQA-TOKEN");
  const result = verifyTelegramInitData(data, BOT_TOKEN, NOW);

  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.reason, "bad_signature");
});

test("foydalanuvchi id sini o'zgartirish imzoni buzadi", () => {
  const data = signInitData({ user: USER, auth_date: String(NOW) });

  const params = new URLSearchParams(data);
  params.set("user", JSON.stringify({ id: 999999, first_name: "O'g'ri" }));

  const result = verifyTelegramInitData(params.toString(), BOT_TOKEN, NOW);
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.reason, "bad_signature");
});

test("imzosiz initData rad etiladi", () => {
  const params = new URLSearchParams({ user: USER, auth_date: String(NOW) });
  const result = verifyTelegramInitData(params.toString(), BOT_TOKEN, NOW);

  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.reason, "no_hash");
});

test("eski initData qabul qilinmaydi", () => {
  /*
   * Imzo to'g'ri bo'lsa ham, o'g'irlangan satr cheksiz
   * ishlamasligi kerak.
   */
  const data = signInitData({ user: USER, auth_date: String(NOW) });
  const result = verifyTelegramInitData(data, BOT_TOKEN, NOW + INITDATA_MAX_AGE_SECONDS + 60);

  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.reason, "expired");
});

test("muddat imzodan KEYIN tekshiriladi", () => {
  // Imzosi soxta va muddati ham o'tgan — javob imzo haqida bo'lsin.
  const data = signInitData({ user: USER, auth_date: String(NOW) }, "boshqa");
  const result = verifyTelegramInitData(data, BOT_TOKEN, NOW + 999_999);

  assert.equal(result.ok === false && result.reason, "bad_signature");
});

test("foydalanuvchisiz initData rad etiladi", () => {
  const data = signInitData({ auth_date: String(NOW), query_id: "AAA" });
  const result = verifyTelegramInitData(data, BOT_TOKEN, NOW);

  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.reason, "no_user");
});

test("bo'sh va buzuq initData tushunarli sabab bilan rad etiladi", () => {
  for (const bad of ["", "   "]) {
    assert.equal(verifyTelegramInitData(bad, BOT_TOKEN, NOW).ok, false, bad);
  }

  const noDate = signInitData({ user: USER, auth_date: "salom" });
  assert.equal(verifyTelegramInitData(noDate, BOT_TOKEN, NOW).ok, false);
});

test("username emas, RAQAMLI id shaxs sifatida qaytadi", () => {
  const data = signInitData({
    user: JSON.stringify({ id: 42, first_name: "A", username: "admin" }),
    auth_date: String(NOW),
  });
  const result = verifyTelegramInitData(data, BOT_TOKEN, NOW);

  assert.equal(result.ok === true && result.user.id, 42);
  assert.equal(result.ok === true && typeof result.user.id, "number");
});

test("bot tokeni natijaga tushmaydi", () => {
  const data = signInitData({ user: USER, auth_date: String(NOW) });
  const result = verifyTelegramInitData(data, BOT_TOKEN, NOW);

  assert.ok(!JSON.stringify(result).includes(BOT_TOKEN));
});

// ---------------------------------------------------------------
// BOT MATNLARI — SOXTA MA'LUMOT YO'Q
// ---------------------------------------------------------------

test("asosiy menyuda spec talab qilgan sakkizta bo'lim bor", () => {
  const flat = mainMenu("Aziz").buttons.flat().map((b) => b.text).join(" ");
  for (const item of ["Profilim", "Mehr 365+", "Reytingim", "Ballarim",
                      "Sertifikatlarim", "Referral", "Murojaatlar", "Xavfsizlik"]) {
    assert.ok(flat.includes(item), `${item} yo'q`);
  }
});

test("Mini App havolasi bo'lmasa, ishlamaydigan tugma KO'RSATILMAYDI", () => {
  /*
   * Bosilganda hech nima qilmaydigan tugma — buzuq mahsulot
   * belgisi. Yo'qligini aytish halolroq.
   */
  const without = mehrMenu(null);
  const flat = without.buttons.flat();

  assert.ok(!flat.some((b) => b.web_app), "web_app tugmasi qolgan");
  assert.ok(without.text.includes("yopiq"));

  const with_ = mehrMenu("https://example.com/mehr-app");
  assert.ok(with_.buttons.flat().some((b) => b.web_app));
});

test("bog'lanmagan foydalanuvchiga token BERILMAYDI — kabinetga yuboriladi", () => {
  /*
   * Bot tokenni o'zi yaratsa, Telegram raqamini bilgan odam
   * o'zini boshqa a'zo deb ko'rsatib ulanib olardi.
   */
  const msg = notLinkedMessage("https://liderlar.uz/kabinet");

  assert.ok(msg.text.includes("bog'lanmagan"));
  assert.ok(msg.buttons.flat().every((b) => !b.callback_data?.includes("link")));
  assert.ok(msg.buttons.flat().some((b) => b.url?.includes("kabinet")));
});

test("bog'lash xatolari bir-biridan farq qiladi", () => {
  const seen = new Set<string>();
  for (const reason of ["not_found", "already_used", "expired", "taken"] as const) {
    const text = linkFailureMessage(reason).text;
    assert.ok(text.length > 20, reason);
    seen.add(text);
  }
  // Har bir sabab boshqacha javob beradi: "muddati tugagan" va
  // "ishlatilgan" foydalanuvchi uchun boshqa-boshqa ma'no.
  assert.equal(seen.size, 4);
});

test("ball yo'q bo'lsa, 0 emas — keyingi qadam aytiladi", () => {
  const msg = pointsMessage({ total: 0, byCategory: [], recent: [] });

  assert.ok(msg.text.includes("Hozircha ball yo'q"));
  assert.ok(msg.text.includes("tasdiqlangan ezgulik"));
});

test("ball bo'lsa, jami va yo'nalishlar ko'rsatiladi", () => {
  const msg = pointsMessage({
    total: 80,
    byCategory: [{ label: "Yetakchilik", points: 60 }, { label: "Ijtimoiy ta'sir", points: 20 }],
    recent: [{ label: "Qishki yordam", points: 60, date: "18.09.2026" }],
  });

  assert.ok(msg.text.includes("80"));
  assert.ok(msg.text.includes("Yetakchilik"));
  assert.ok(msg.text.includes("+60"));
});

test("bekor qilingan sertifikat ro'yxatda BELGILANADI", () => {
  const msg = certificatesMessage([
    {
      activityTitle: "Qishki yordam", roleLabel: "Tashkilotchi", issuedDate: "18.09.2026",
      code: "MEHR-ABCD123456", revoked: true, verifyUrl: "https://liderlar.uz/x",
    },
  ]);

  assert.ok(msg.text.includes("Bekor qilingan"));
  assert.ok(msg.text.includes("❌"));
});

test("tayyor bo'lmagan bo'lim soxta ma'lumot ko'rsatmaydi", () => {
  const msg = notAvailableYet("Reyting");

  assert.ok(msg.text.includes("hali tayyor emas"));
  assert.ok(!/\d+\s*(ball|o'rin)/.test(msg.text), "soxta raqam bor");
});

// ---------------------------------------------------------------
// TUZILMA INTIZOMI
// ---------------------------------------------------------------

function src(path: string): string {
  return readFileSync(path, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

test("a'zo boti ALOHIDA token va sekret ishlatadi", () => {
  const api = src("src/lib/member-bot/bot-api.ts");

  assert.match(api, /MEMBER_TELEGRAM_BOT_TOKEN/);
  assert.match(api, /MEMBER_TELEGRAM_WEBHOOK_SECRET/);

  // Boshqa botlarning sozlamalari bu yerga ko'rinmasin.
  for (const other of ["SALES_TELEGRAM", "COORDINATOR_TELEGRAM"]) {
    assert.ok(!api.includes(other), `${other} a'zo botiga aralashgan`);
  }
  assert.ok(!/process\.env\.TELEGRAM_BOT_TOKEN/.test(api), "post boti tokeni ishlatilgan");
});

test("webhook sekreti doimiy vaqtda solishtiriladi", () => {
  assert.match(src("src/lib/member-bot/bot-api.ts"), /timingSafeEqual/);
});

test("a'zo webhook'i proxy'ning MACHINE_PATHS ro'yxatida", () => {
  /*
   * Bo'lmasa, admin sessiya middleware'i Telegram'ga 307
   * qaytaradi va bot umuman ishlamaydi.
   */
  assert.match(src("src/proxy.ts"), /"\/api\/telegram-member"/);
});

test("Mini App admin sessiyasini talab qilmaydi", () => {
  const proxy = src("src/proxy.ts");
  assert.match(proxy, /"\/mehr-app"/);
  assert.match(proxy, /"\/api\/mehr-app"/);
});

test("Mini App API'lari shaxsni SO'ROVDAN olmaydi", () => {
  /*
   * Ikki aniq belgi qidiriladi:
   *   1. zod sxemasida `profileId:` maydoni — mijoz uni yubora olardi;
   *   2. `parsed.data.profileId` o'qilishi — server unga ishongan bo'lardi.
   *
   * Ikkalasi ham bo'lmasa, shaxs faqat imzodan chiqadi.
   */
  const files = [
    "src/app/api/mehr-app/checkin/route.ts",
    "src/app/api/mehr-app/session/route.ts",
    "src/app/api/mehr-app/activity/route.ts",
    "src/lib/mehr/activity-service.ts",
  ];

  for (const file of files) {
    const code = src(file);

    assert.ok(
      !/(profileId|organizerProfileId)\s*:\s*z\./.test(code),
      `${file} sxemasida shaxs maydoni bor`,
    );
    assert.ok(
      !/parsed\.data\.(profileId|organizerProfileId)/.test(code),
      `${file} shaxsni so'rovdan o'qiyapti`,
    );
  }

  for (const file of files.slice(0, 3)) {
    assert.match(src(file), /identifyWebAppRequest\(/, `${file} imzoni tekshirmaydi`);
  }
});

test("Mini App API'lari bayroq o'chiq bo'lsa ishlamaydi", () => {
  for (const file of [
    "src/app/api/mehr-app/checkin/route.ts",
    "src/app/api/mehr-app/session/route.ts",
    "src/app/api/mehr-app/activity/route.ts",
  ]) {
    assert.match(src(file), /getMehrFlags\(\)/, `${file} bayroqni tekshirmaydi`);
  }
});

test("seans kaliti hech qachon javobga qo'shilmaydi", () => {
  /*
   * Kalit chiqib ketsa, istalgan odam o'zi uchun haqiqiy
   * check-in tokeni yasay olardi.
   *
   * Kalitni O'QISH normal — u imzolovchiga uzatiladi. Xavfli
   * bo'lgani — uni QAYTARILADIGAN obyektga KALIT sifatida
   * qo'yish. Test aynan shuni qidiradi.
   */
  const route = src("src/app/api/mehr-app/session/route.ts");
  assert.ok(!/signing_secret/.test(route), "javob yo'lida signing_secret bor");

  const service = src("src/lib/mehr/session-service.ts");
  /*
   * Faqat DVUNUQTA qidiriladi — ya'ni obyekt kaliti. Vergul
   * ham qo'shilsa, `select("id, signing_secret, ...")` dagi
   * ustunlar ro'yxati ham tushib qolardi, holbuki kalitni
   * BAZADAN O'QISH aynan kerak: usiz imzo qo'yib bo'lmaydi.
   *
   * Yagona qonuniy `signing_secret:` — seans yaratishdagi
   * insert; u olib tashlanadi.
   */
  const withoutInsert = service.replace(/signing_secret:\s*randomBytes\([^)]*\)[^,]*,/g, "");
  assert.ok(
    !/signing_secret\s*:/.test(withoutInsert),
    "signing_secret obyekt kaliti sifatida uzatilyapti",
  );

  // Xizmat qaytaradigan tip kalitni umuman bilmaydi.
  const qrType = service.match(/export interface QrToken \{[\s\S]*?\n\}/)?.[0] ?? "";
  assert.ok(qrType.length > 0, "QrToken tipi topilmadi");
  assert.ok(!/secret/i.test(qrType), "QrToken tipida kalit bor");
});

test("tashkilotchilik har so'rovda qayta tekshiriladi", () => {
  const service = src("src/lib/mehr/session-service.ts");
  const checks = service.match(/organizer_profile_id !== organizerProfileId|owner !== organizerProfileId/g) ?? [];

  assert.ok(checks.length >= 3, `kutilganidan kam tekshiruv: ${checks.length}`);
});

// ---------------------------------------------------------------
// SOZLAMALAR: BOT VA BAYROQLAR
// ---------------------------------------------------------------

test("webhook manzili SO'ROVDAN olinmaydi", () => {
  /*
   * Manzilni mijoz yuborsa, kimdir botning barcha xabarlarini
   * o'z serveriga yo'naltirib olardi — ya'ni a'zolarning
   * yozishmalarini o'qiy olardi.
   */
  const code = src("src/lib/actions/mehr.ts");
  const fn = code.match(/export async function registerMemberWebhookAction\([\s\S]*?\n\}/)?.[0] ?? "";

  assert.ok(fn.length > 0, "action topilmadi");
  assert.match(fn, /registerMemberWebhookAction\(\): Promise/, "action argument qabul qilyapti");
  assert.match(fn, /process\.env\.MEMBER_WEBHOOK_BASE_URL/);
});

test("bayroq kaliti ro'yxatdan, ixtiyoriy satr emas", () => {
  /*
   * Ixtiyoriy kalit qabul qilinsa, bu action `site_settings`
   * dagi ISTALGAN sozlamani o'zgartiradigan umumiy yozish
   * yo'liga aylanardi.
   */
  const code = src("src/lib/actions/mehr.ts");
  const schema = code.match(/const flagSchema = z\.object\(\{[\s\S]*?\n\}\);/)?.[0] ?? "";

  assert.ok(schema.length > 0, "flagSchema topilmadi");
  assert.match(schema, /key: z\.enum\(\[/);
  assert.ok(!/key: z\.string\(\)/.test(schema), "kalit ixtiyoriy satr");
});

test("sozlamalarni faqat settings.manage o'zgartiradi", () => {
  const code = src("src/lib/actions/mehr.ts");

  for (const name of ["registerMemberWebhookAction", "setMehrFlagAction"]) {
    const fn = code.match(new RegExp(`export async function ${name}\\([\\s\\S]*?\\n\\}`))?.[0] ?? "";
    assert.ok(fn.length > 0, `${name} topilmadi`);
    assert.match(fn, /requirePermission\("settings\.manage"\)/, `${name} ruxsatni tekshirmaydi`);
  }
});

test("bayroq o'zgarishi auditga tushadi", () => {
  /*
   * Xususiyat yoqilishi productionda ko'rinadigan o'zgarish —
   * keyin "kim yoqdi" degan savol muqarrar.
   */
  const code = src("src/lib/actions/mehr.ts");
  const fn = code.match(/export async function setMehrFlagAction\([\s\S]*?\n\}/)?.[0] ?? "";

  assert.match(fn, /logAudit\(/);
  assert.match(fn, /severity: "warning"/);
});

test("bot holati token qaytarmaydi", () => {
  const code = src("src/lib/member-bot/bot-api.ts");
  const type = code.match(/export interface MemberBotStatus \{[\s\S]*?\n\}/)?.[0] ?? "";

  assert.ok(type.length > 0, "MemberBotStatus topilmadi");
  assert.ok(!/token/i.test(type), "holat tipida token bor");
});

test("kutayotgan xabarlar webhook o'rnatilganda O'CHIRILMAYDI", () => {
  /*
   * O'chirilsa, navbatda turgan odamlarning xabarlari jimgina
   * yo'qolardi va ular "bot javob bermadi" deb qolardi.
   */
  assert.match(src("src/lib/member-bot/bot-api.ts"), /drop_pending_updates: false/);
});

test("sozlama qiymatlari brauzerga yuborilmaydi — faqat nomlari", () => {
  const code = src("src/app/(admin)/mehr/page.tsx");
  const block = code.match(/const missingEnv = \[[\s\S]*?\.map\([\s\S]*?\);/)?.[0] ?? "";

  assert.ok(block.length > 0, "missingEnv topilmadi");
  // Filtrdan keyin faqat NOM qoladi, qiymat emas.
  assert.match(block, /\.map\(\(\[name\]\) => name as string\)/);
});

test("bayroqlarni birdaniga yoqadigan yo'l yo'q", () => {
  /*
   * §43 — nazorat ostidagi bosqichma-bosqich yoqish. Bir
   * vaqtning o'zida hamma narsa ochilsa, nimadir buzilganda
   * qaysi biri sabab bo'lganini aniqlab bo'lmaydi.
   */
  const code = src("src/lib/actions/mehr.ts");

  assert.ok(!/enableAllFlags|setAllFlags/i.test(code), "ommaviy yoqish yo'li bor");

  const ui = src("src/app/(admin)/mehr/bot-settings.tsx");
  assert.ok(!/Hammasini yoq/i.test(ui), "UI da 'hammasini yoq' tugmasi bor");
});

// ---------------------------------------------------------------
// MIJOZ/SERVER CHEGARASI
// ---------------------------------------------------------------

test("mijoz komponentlari server-only moduldan import qilmaydi", () => {
  /*
   * `import "server-only"` bo'lgan modulni "use client"
   * faylidan hatto TIP uchun import qilish ham build'ni
   * yiqitadi: bundler butun modulni brauzer paketiga tortadi.
   *
   * `tsc` buni KO'RMAYDI — xato faqat build'da chiqadi.
   * Shu loyihada bu ikki marta sodir bo'lgan, shuning uchun
   * test.
   */
  const serverOnly: string[] = [];

  for (const file of [
    "src/lib/mehr/flags.ts",
    "src/lib/mehr/dashboard.ts",
    "src/lib/mehr/approval-service.ts",
    "src/lib/mehr/session-service.ts",
    "src/lib/mehr/checkin-service.ts",
    "src/lib/mehr/activity-service.ts",
    "src/lib/member/link-service.ts",
    "src/lib/member-bot/bot-api.ts",
    "src/lib/member-bot/router.ts",
    "src/lib/member-bot/webapp-session.ts",
  ]) {
    if (/^import ["']server-only["']/m.test(readFileSync(file, "utf8"))) {
      serverOnly.push(file.replace(/^src\//, "@/").replace(/\.tsx?$/, ""));
    }
  }

  assert.ok(serverOnly.length >= 5, `server-only modullar kam topildi: ${serverOnly.length}`);

  for (const file of [
    "src/app/(admin)/mehr/bot-settings.tsx",
    "src/app/(admin)/mehr/review-queue.tsx",
    "src/app/mehr-app/mini-app.tsx",
  ]) {
    const code = readFileSync(file, "utf8");
    if (!/^["']use client["']/m.test(code)) continue;

    /*
     * `import type { … }` BUTUNLAY O'CHADI — TypeScript uni
     * kompilyatsiyada olib tashlaydi va bundler ko'rmaydi.
     * Xavfli bo'lgani — QIYMAT importi. Aynan shu farq
     * `bot-settings.tsx` ni yiqitgan edi: u tip bilan birga
     * `MEHR_FLAG_KEYS` ni ham olardi.
     */
    for (const statement of code.match(/^import\s+[\s\S]*?from\s+["'][^"']+["'];/gm) ?? []) {
      if (/^import\s+type\s/.test(statement)) continue;

      const mod = statement.match(/from\s+["']([^"']+)["']/)?.[1];
      if (!mod || !serverOnly.includes(mod)) continue;

      assert.fail(
        `${file} — "use client" bo'la turib ${mod} dan QIYMAT import qilyapti:\n  ${statement}`,
      );
    }
  }
});

test("bayroq kalitlari moduli server-only EMAS", () => {
  /*
   * Izohlar olib tashlanadi: modul o'zining nega alohida
   * ekanini tushuntirganda "server-only" so'zini yozadi va
   * test o'z izohiga tushib qolardi. Qidirilayotgani — matn
   * emas, DIREKTIVA.
   */
  const code = src("src/lib/mehr/flag-keys.ts");

  assert.ok(!/import\s+["']server-only["']/.test(code), "server-only direktivasi bor");
  assert.ok(!/from\s+["']@\/lib\/supabase/.test(code), "kalitlar modulida baza mijozi bor");
});

test("Mini App manzili admin panel manzilidan kelib chiqadi", () => {
  /*
   * Alohida o'zgaruvchi talab qilinsa, uni qo'shishni unutish
   * oson — va bot tugmani jimgina ko'rsatmay qo'yardi.
   */
  const code = src("src/lib/member-bot/router.ts");
  const fn = code.match(/function miniAppUrl\(\)[\s\S]*?\n\}/)?.[0] ?? "";

  assert.ok(fn.length > 0, "miniAppUrl topilmadi");
  assert.match(fn, /MEMBER_MINI_APP_URL/);
  assert.match(fn, /NEXT_PUBLIC_ADMIN_URL/);
  assert.match(fn, /"\/mehr-app"/);

  // Manzil umuman topilmasa — null, taxminiy manzil EMAS.
  assert.match(fn, /return null/);
});
