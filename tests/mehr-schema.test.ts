import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PERMISSIONS, ROLE_PERMISSIONS } from "../src/lib/permissions.ts";

const M = "supabase/migrations/";
const foundation = readFileSync(`${M}20260920120000_mehr_member_foundation.sql`, "utf8");
const activities = readFileSync(`${M}20260920130000_mehr_activities.sql`, "utf8");
const points = readFileSync(`${M}20260920140000_mehr_points_certificates.sql`, "utf8");
const rls = readFileSync(`${M}20260920150000_mehr_rls.sql`, "utf8");

const ALL = [foundation, activities, points, rls].join("\n");

/** Izohlarni olib tashlaydi: izohdagi matn "kod bor" degani emas. */
function stripComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^\n]*/g, "");
}

const CODE = stripComments(ALL);

// ---------------------------------------------------------------
// RUXSATLAR: SQL ↔ TS
// ---------------------------------------------------------------

const NEW_PERMISSIONS = [
  "members.view",
  "members.manage",
  "mehr.view",
  "mehr.review",
  "mehr.manage",
  "points.view",
  "points.manage",
  "certificates.manage",
  "referrals.view",
  "referrals.manage",
] as const;

test("yangi ruxsatlar TS ro'yxatida bor", () => {
  for (const p of NEW_PERMISSIONS) {
    assert.ok((PERMISSIONS as readonly string[]).includes(p), `${p} permissions.ts da yo'q`);
  }
});

test("SQL urug'idagi har bir (rol, ruxsat) juftligi TS matritsasiga mos", () => {
  /*
   * Bu loyihada ikkalasi ajralib ketganda panel bo'limni
   * ko'rsatgan, RLS esa bo'sh ro'yxat qaytargan — foydalanuvchi
   * uchun "buzuq sahifa". Shuning uchun parity testi.
   */
  const pairs = [...stripComments(rls).matchAll(/\('([a-z_]+)',\s*'([a-z_.]+)'\)/g)]
    .map(([, role, perm]) => ({ role, perm }))
    .filter(({ perm }) => (NEW_PERMISSIONS as readonly string[]).includes(perm));

  assert.ok(pairs.length > 0, "SQL da yangi ruxsat urug'i topilmadi");

  for (const { role, perm } of pairs) {
    const tsPerms = ROLE_PERMISSIONS[role as keyof typeof ROLE_PERMISSIONS];
    assert.ok(tsPerms, `TS da '${role}' roli yo'q`);
    assert.ok(
      (tsPerms as readonly string[]).includes(perm),
      `SQL '${role}' ga '${perm}' beradi, TS bermaydi`,
    );
  }
});

test("admin barcha yangi ruxsatlarni oladi", () => {
  for (const p of NEW_PERMISSIONS) {
    assert.ok((ROLE_PERMISSIONS.admin as readonly string[]).includes(p), p);
  }
});

test("moderator ball iqtisodiyotini o'zgartira olmaydi", () => {
  const mod = ROLE_PERMISSIONS.moderator as readonly string[];

  assert.ok(mod.includes("mehr.review"), "moderator tekshira olishi kerak");
  assert.ok(!mod.includes("points.manage"), "moderatorga points.manage berilmasin");
  assert.ok(!mod.includes("mehr.manage"), "moderatorga mehr.manage berilmasin");
});

// ---------------------------------------------------------------
// MIGRATSIYA KAFOLATLARI
// ---------------------------------------------------------------

test("ball daftari takrorlanmaslik kaliti bo'yicha UNIKAL", () => {
  // Bu bitta so'z — butun tizimning ikki marta ball bermasligi kafolati.
  assert.match(CODE, /idempotency_key text not null unique/);
});

test("ball daftari o'zgarmas: update va delete triggeri bor", () => {
  assert.match(CODE, /before update or delete on public\.point_ledger/);
});

test("bitta tadbir + odam + rol = bitta sertifikat", () => {
  assert.match(CODE, /create unique index if not exists certificates_activity_recipient_role_uidx/);
});

test("bitta odam bitta tadbirda bir marta ishtirok etadi", () => {
  assert.match(CODE, /create unique index if not exists mehr_participants_activity_profile_uidx/);
});

test("takroriy check-in odam bo'yicha to'siladi, nonce bo'yicha emas", () => {
  /*
   * Nonce unikal bo'lsa, bitta ekrandagi QR'ni skanerlagan
   * IKKINCHI odam bazada yiqilardi.
   */
  assert.match(CODE, /mehr_checkins_session_participant_uidx/);
  assert.ok(
    !/unique index[^;]*mehr_checkins_session_nonce/.test(CODE),
    "nonce unikal indeksi ikkinchi ishtirokchini to'sib qo'yardi",
  );
});

test("ball tarixi bor a'zo o'chirilmaydi — daftar cascade bilan yo'q qilinmaydi", () => {
  /*
   * Cascade bo'lganda profil o'chirilishi daftar qatorlarini
   * o'chirishga urinardi va o'zgarmaslik triggeriga urilib,
   * butun amal tushunarsiz xato bilan yiqilardi.
   */
  const table = stripComments(points).match(
    /create table if not exists public\.point_ledger[\s\S]*?\n\);/,
  );
  assert.ok(table, "point_ledger jadvali topilmadi");
  assert.match(table[0], /profile_id uuid not null references public\.profiles\(id\) on delete restrict/);
  assert.ok(!/on delete cascade/.test(table[0]), "point_ledger da cascade qolgan");
});

test("tasdiqlangan tadbir o'chirilmaydi", () => {
  assert.match(CODE, /before delete on public\.mehr_activities/);
  assert.match(CODE, /old\.status = 'approved'/);
});

test("sertifikat tadbir bilan birga yo'q qilinmaydi", () => {
  const table = stripComments(points).match(
    /create table if not exists public\.certificates[\s\S]*?\n\);/,
  );
  assert.ok(table);
  assert.match(table[0], /activity_id uuid references public\.mehr_activities\(id\) on delete restrict/);
});

test("o'zini o'zi taklif qilish baza darajasida to'siladi", () => {
  assert.match(CODE, /constraint referral_no_self check/);
});

test("rad etish va tuzatish so'rovi sababsiz bo'lmaydi", () => {
  assert.match(CODE, /constraint mehr_activities_reason_required check/);
  assert.match(CODE, /constraint mehr_reviews_reason_required check/);
});

test("bekor qilingan sertifikat sababsiz bo'lmaydi", () => {
  assert.match(CODE, /constraint certificates_revoked_reason check/);
});

test("member_accounts da candidate_id YO'Q — ikkinchi bog'lanish yaratilmaydi", () => {
  /*
   * Nomzod ↔ akkaunt bog'lanishi faqat candidates.user_id da.
   * Ikkinchi nusxa bir kun kelib birinchisi bilan kelishmay
   * qolardi va qaysi biri to'g'ri ekani noma'lum bo'lardi.
   */
  const table = stripComments(foundation).match(
    /create table if not exists public\.member_accounts[\s\S]*?\n\);/,
  );
  assert.ok(table, "member_accounts jadvali topilmadi");
  assert.ok(!/candidate_id/.test(table[0]), "member_accounts da candidate_id paydo bo'lgan");
});

test("bog'lash tokeni ochiq saqlanmaydi", () => {
  const table = stripComments(foundation).match(
    /create table if not exists public\.member_link_tokens[\s\S]*?\n\);/,
  );
  assert.ok(table);
  assert.match(table[0], /token_hash text not null unique/);
  assert.ok(!/\btoken text\b/.test(table[0]), "ochiq token ustuni paydo bo'lgan");
});

// ---------------------------------------------------------------
// RLS
// ---------------------------------------------------------------

test("barcha yangi jadvallarda RLS yoqilgan", () => {
  const created = [...CODE.matchAll(/create table if not exists public\.([a-z_]+)/g)].map((m) => m[1]);
  const enabled = new Set(
    [...CODE.matchAll(/alter table public\.([a-z_]+)\s+enable row level security/g)].map((m) => m[1]),
  );

  assert.ok(created.length >= 18, `kutilganidan kam jadval: ${created.length}`);
  for (const t of created) {
    assert.ok(enabled.has(t), `${t} da RLS yoqilmagan`);
  }
});

test("ommaviy yo'l faqat tasdiqlangan tadbirni ko'radi", () => {
  assert.match(CODE, /create policy mehr_activities_public_select[\s\S]*?status = 'approved'/);
});

test("ishtirokchilar ro'yxati anon rolga ochilmagan", () => {
  const policies = [...stripComments(rls).matchAll(/create policy (\w+) on public\.mehr_participants[\s\S]*?;/g)];
  assert.ok(policies.length > 0);

  for (const [body] of policies) {
    assert.ok(
      /auth\.uid\(\)|has_permission/.test(body),
      "mehr_participants uchun cheklovsiz siyosat topildi",
    );
  }
});

test("QR imzolash kaliti mijozga ochilmaydi", () => {
  /*
   * Seans kaliti chiqib ketsa, istalgan odam o'zi uchun haqiqiy
   * check-in tokeni yasay olardi — ishtirok tekshiruvi ma'nosini
   * yo'qotardi.
   */
  const policies = [...stripComments(rls).matchAll(/create policy \w+ on public\.mehr_activity_sessions[\s\S]*?;/g)];
  assert.ok(policies.length > 0);

  for (const [body] of policies) {
    assert.match(body, /has_permission/);
  }
});

test("referral ma'lumotlari hech qachon ommaviy emas", () => {
  for (const table of ["referral_codes", "referral_attributions", "referral_rewards"]) {
    const policies = [...stripComments(rls).matchAll(new RegExp(`create policy \\w+ on public\\.${table}[\\s\\S]*?;`, "g"))];
    assert.ok(policies.length > 0, `${table} uchun siyosat yo'q`);

    for (const [body] of policies) {
      assert.ok(/auth\.uid\(\)|has_permission/.test(body), `${table} ommaviy ochilgan`);
    }
  }
});

test("hech bir jadvalga mijoz tomonidan yozish siyosati berilmagan", () => {
  /*
   * Insert/update siyosati bo'lsa, odam o'ziga ball yozib
   * qo'yardi. Yozish faqat server (service role) orqali.
   */
  assert.ok(!/for insert/i.test(CODE), "insert siyosati topildi");
  assert.ok(!/for update/i.test(stripComments(rls)), "update siyosati topildi");
  assert.ok(!/for all/i.test(CODE), "for all siyosati topildi");
});

// ---------------------------------------------------------------
// BAYROQLAR
// ---------------------------------------------------------------

test("barcha bayroqlar o'chiq holatda keladi", () => {
  const flags = [
    "mehr.public_enabled",
    "mehr.activity_creation_enabled",
    "mehr.qr_checkin_enabled",
    "mehr.points_enabled",
    "mehr.certificates_enabled",
    "member.auth_enabled",
    "member.bot_enabled",
    "referral.points_enabled",
  ];

  for (const flag of flags) {
    const row = new RegExp(`\\('${flag.replace(".", "\\.")}',\\s*'([^']*)'\\)`);
    const match = CODE.match(row);
    assert.ok(match, `${flag} urug'i yo'q`);
    assert.equal(match[1], "false", `${flag} yoqilgan holda kelyapti`);
  }
});

test("mavjud jadvallar buzilmaydi: drop table / drop column yo'q", () => {
  assert.ok(!/drop table/i.test(CODE), "drop table topildi");
  assert.ok(!/drop column/i.test(CODE), "drop column topildi");
  assert.ok(!/truncate/i.test(CODE), "truncate topildi");
});
