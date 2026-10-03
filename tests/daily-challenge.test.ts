import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  challengeEnded,
  challengeRewardDays,
  challengeWindow,
  challengeWinnerMessage,
} from "../src/lib/challenge/daily-rules.ts";

/**
 * KUNLIK PREMIUM CHALLENGE — qoidalar va bazadagi yakunlash shartlari.
 */

test("oyna: 09:00–19:00 Asia/Tashkent = 04:00–14:00 UTC", () => {
  const w = challengeWindow("2026-10-04");
  assert.equal(w.startsAt.toISOString(), "2026-10-04T04:00:00.000Z");
  assert.equal(w.endsAt.toISOString(), "2026-10-04T14:00:00.000Z");
});

test("19:00 dan oldin yopilmaydi, 19:00 dan keyin yopiladi", () => {
  assert.equal(challengeEnded("2026-10-04", new Date("2026-10-04T13:59:59Z")), false);
  assert.equal(challengeEnded("2026-10-04", new Date("2026-10-04T14:00:00Z")), true);
});

test("mukofot: 1 -> 30, 2 -> 20, 3 -> 10, qolganlar 0", () => {
  assert.equal(challengeRewardDays(1), 30);
  assert.equal(challengeRewardDays(2), 20);
  assert.equal(challengeRewardDays(3), 10);
  assert.equal(challengeRewardDays(4), 0);
});

test("xabarnoma matni o'rin va kunni aytadi", () => {
  const m = challengeWinnerMessage(1, 30);
  assert.match(m.title, /1-o'rin/);
  assert.match(m.body, /30 kun/);
});

const SQL = readFileSync("supabase/migrations/20261004103000_daily_premium_challenge.sql", "utf8");

test("baza: faqat 09:00 dan OLDIN chop etilganlar qatnashadi", () => {
  assert.match(SQL, /c\.published_at < w\.starts_at/);
});

test("baza: faqat oyna ichidagi SANALGAN ko'rishlar", () => {
  assert.match(SQL, /pv\.is_counted/);
  assert.match(SQL, /pv\.created_at >= w\.starts_at/);
  assert.match(SQL, /pv\.created_at < w\.ends_at/);
});

test("baza: teng natija qoidasi — ko'rish, ertaroq yetish, id", () => {
  assert.match(SQL, /order by e\.views desc, e\.reached_at asc, e\.candidate_id asc/);
});

test("baza: yakunlash bir marta, qulf bilan, oyna tugagach; natija o'zgarmas", () => {
  assert.match(SQL, /pg_advisory_xact_lock\(hashtextextended\('daily_challenge:'/);
  assert.match(SQL, /'already', true/);
  assert.match(SQL, /if now\(\) < v_end then/);
  assert.match(SQL, /trg_daily_challenge_results_frozen/);
});

test("baza: VIP yagona xizmat orqali, sana+o'rin kaliti bilan", () => {
  assert.match(SQL, /public\.vip_grant_days\(/);
  assert.match(SQL, /'daily-challenge:' \|\| p_date::text \|\| ':' \|\| v_row\.place/);
  assert.match(SQL, /when 1 then 30 when 2 then 20 when 3 then 10/);
});

const ENGINE = readFileSync("supabase/migrations/20261004102000_vip_grant_engine.sql", "utf8");

test("VIP xizmati: idempotent, navbat, qisqartirmaydi", () => {
  assert.match(ENGINE, /idempotency_key text not null unique/);
  assert.match(ENGINE, /pg_advisory_xact_lock\(hashtextextended\('vip_grant:'/);
  assert.match(ENGINE, /v_sub\.current_period_end \+ make_interval\(days => p_days\)/);
  assert.match(ENGINE, /'duplicate', true/);
});

test("referal VIP: +10 kun, ko'pi bilan 3 ta (30 kun), nashr va o'ziga-o'zi tekshiruvi bazada", () => {
  assert.match(ENGINE, /if v_count >= 3 then/);
  assert.match(ENGINE, /p_referrer_profile_id, 10, 'referral'/);
  assert.match(ENGINE, /v_status <> 'published' or v_deleted is not null/);
  assert.match(ENGINE, /'self_referral'/);
  assert.match(ENGINE, /'candidate_already_rewarded'/);
});

test("barcha yangi SECURITY DEFINER funksiyalar faqat service_role", () => {
  for (const sql of [SQL, ENGINE]) {
    // Har funksiyaning O'Z sarlavhasi (`as $$` gacha) tekshiriladi.
    const definers = [...sql.matchAll(/create or replace function public\.(\w+)\(([^$]*?)as \$\$/g)]
      .filter((m) => /security definer/.test(m[2]))
      .map((m) => m[1]);
    assert.ok(definers.length > 0);
    for (const fn of definers) {
      assert.match(sql, new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\)\\s+from public, anon, authenticated`), fn);
    }
  }
});
