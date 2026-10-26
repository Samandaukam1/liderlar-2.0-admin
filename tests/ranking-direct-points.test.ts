import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/*
 * Reyting qoidasi (egasi 2026-10-26 da belgilagan): quyidagilar umumiy ballga
 * og'irliksiz, chegarasiz, butun tarix bo'yicha qo'shiladi —
 *   ko'rish 5 ta = 1 · promo kod (to'lov + nashr) = 1 · VIP maqola = 3 ·
 *   AdabiyotX o'z kitobi = 10 · o'z maqolasi = 2 · tasdiqlangan yutuq = 2.
 * Production'dagi funksiya shu migratsiya bilan qo'yilgan.
 */
const sql = readFileSync("supabase/migrations/20261026200000_ranking_direct_points.sql", "utf8");
const cte = (name: string) => {
  const start = sql.indexOf(`  ${name} as (`);
  assert.ok(start >= 0, name);
  return sql.slice(start, sql.indexOf("\n  ),", start));
};

test("5 ko'rish = 1 ball, butun tarix, chegarasiz", () => {
  assert.match(sql, /update public\.site_settings set value = '5' where key = 'ranking\.views_per_point';/);
  const views = cte("views");
  assert.doesNotMatch(views, /created_at|v_start|v_end|points_cap|least\(/);
  assert.match(views, /count\(\*\)::numeric \/ \(select views_per_point from pol\)/);
});

test("promo kod: faqat to'lov tasdiqlangan va hozir chop etilgan tavsiya, 1 ball", () => {
  const promo = cte("referral_pts");
  assert.match(promo, /rr\.stage = 'payment_confirmed'/);
  assert.match(promo, /referred\.status = 'published'[\s\S]*referred\.deleted_at is null/);
  assert.match(promo, /count\(distinct rr\.attribution_id\)::numeric as pts/);
});

test("VIP maqola 3, AdabiyotX kitob 10 / maqola 2, tasdiqlangan yutuq 2", () => {
  const articles = cte("article_pts");
  assert.match(articles, /count\(\*\)::numeric \* 3/);
  assert.match(articles, /m\.state = 'published'/);
  const adx = cte("adabiyotx_pts");
  assert.match(adx, /content_type = 'book'\)\)::numeric \* 10/);
  assert.match(adx, /content_type = 'article'\)\)::numeric \* 2/);
  assert.match(adx, /relationship_type = 'own_work' and i\.is_visible = true/);
  const achievements = cte("achievement_pts");
  assert.match(achievements, /count\(\*\)::numeric \* 2/);
  assert.match(achievements, /a\.review_state = 'published'/, "faqat tahririyat tasdiqlagan yutuq");
});

test("to'g'ridan-to'g'ri ballar umumiy ballga 100 chegarasidan TASHQARIDA qo'shiladi", () => {
  assert.match(sql, /\)\)\s*\+ d\.view_points \+ d\.referral_points \+ d\.article_points\s*\+ d\.adabiyotx_book_points \+ d\.adabiyotx_article_points \+ d\.achievement_points as overall/);
  // Ko'rish "Faol liderlik" ichida ikkinchi marta sanalmaydi.
  assert.doesNotMatch(cte("cat_scores"), /from views/);
});

test("safeupdate: funksiyadagi har DELETE/UPDATE da WHERE bor", () => {
  const body = sql.slice(sql.indexOf("AS $function$"));
  for (const statement of body.match(/\b(delete from|update)\s+[^;]+/gi) ?? []) {
    assert.match(statement, /\bwhere\b/i, statement.slice(0, 60));
  }
});
