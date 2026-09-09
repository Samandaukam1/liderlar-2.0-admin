import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  addUsage,
  AI_TASKS,
  DEFAULT_TASK_MODEL,
  EMPTY_USAGE,
  estimateCostUsd,
  formatCostUsd,
  MODEL_PRICING,
  resolveModel,
  TASK_ENV_VAR,
} from "../src/lib/ai-models.ts";

const ROOT = new URL("..", import.meta.url).pathname;

/* ---------------------------- model tanlash ----------------------------- */

test("sozlanmagan holatda hamma vazifa ARZON modelda", () => {
  for (const task of AI_TASKS) {
    assert.equal(resolveModel(task, {}), DEFAULT_TASK_MODEL[task], task);
  }
});

test("vazifaga xos o‘zgaruvchi ustun turadi", () => {
  for (const task of AI_TASKS) {
    const env = { [TASK_ENV_VAR[task]]: "maxsus-model", OPENAI_MODEL: "global-model" };
    assert.equal(resolveModel(task, env), "maxsus-model", task);
  }
});

test("MAQOLA global sozlamani MEROS QILIB OLMAYDI", () => {
  // Aynan shu xato hisobni oshirgan edi: bir joyda sifat uchun qimmat
  // model qo'yilsa, eng ko'p token yeydigan ish ham o'sha modelga
  // o'tib ketardi.
  const env = { OPENAI_MODEL: "qimmat-model" };
  assert.equal(resolveModel("article", env), DEFAULT_TASK_MODEL.article);

  // Boshqa vazifalar esa global sozlamaga bo'ysunadi — mavjud
  // sozlama buzilmasin.
  assert.equal(resolveModel("improve", env), "qimmat-model");
  assert.equal(resolveModel("intake", env), "qimmat-model");
  assert.equal(resolveModel("sales", env), "qimmat-model");
});

test("maqolani qimmatlashtirish faqat ATAYLAB bo‘ladi", () => {
  const env = { OPENAI_MODEL: "qimmat-model", OPENAI_ARTICLE_MODEL: "gpt-4o" };
  assert.equal(resolveModel("article", env), "gpt-4o");
});

test("bo‘sh satr sozlama deb hisoblanmaydi", () => {
  assert.equal(resolveModel("improve", { OPENAI_MODEL: "   " }), DEFAULT_TASK_MODEL.improve);
  assert.equal(
    resolveModel("article", { OPENAI_ARTICLE_MODEL: "" }),
    DEFAULT_TASK_MODEL.article,
  );
});

/* ------------------------------- narx ----------------------------------- */

test("token yig‘indisi va narx hisoblanadi", () => {
  const usage = addUsage(addUsage(EMPTY_USAGE, { promptTokens: 1000, completionTokens: 200 }), {
    promptTokens: 500,
    completionTokens: 100,
  });
  assert.equal(usage.promptTokens, 1500);
  assert.equal(usage.completionTokens, 300);
  assert.equal(usage.totalTokens, 1800);
  assert.equal(estimateCostUsd("gpt-4o-mini", usage), 0.0004);
});

test("qimmat model qanchalik qimmatligi ko‘rinadi", () => {
  // Bir xil sarf, ikki model — farq shu.
  const usage = { promptTokens: 20_000, completionTokens: 12_000, totalTokens: 32_000 };
  const cheap = estimateCostUsd("gpt-4o-mini", usage)!;
  const expensive = estimateCostUsd("gpt-4o", usage)!;
  assert.ok(expensive > cheap * 10, `${expensive} vs ${cheap}`);
});

test("narxi noma’lum model uchun taxmin QILINMAYDI", () => {
  // Nol "bepul" degani; noma'lum esa noma'lum.
  assert.equal(estimateCostUsd("hali-yo‘q-model", EMPTY_USAGE), null);
  assert.equal(formatCostUsd(null), "noma’lum");
  assert.equal(formatCostUsd(0.0004), "$0.0004");
});

test("standart modellarning narxi jadvalda bor", () => {
  for (const task of AI_TASKS) {
    assert.ok(MODEL_PRICING[DEFAULT_TASK_MODEL[task]], DEFAULT_TASK_MODEL[task]);
  }
});

/* ------------------------ yagona manba kafolati ------------------------- */

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(path));
    else if (/\.tsx?$/.test(entry.name)) out.push(path);
  }
  return out;
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

test("OPENAI_MODEL faqat bitta joyda o‘qiladi", () => {
  // Oltita chaqiruv nuqtasi bitta o'zgaruvchini o'qigani uchun aynan
  // shu muammo chiqqan edi. Endi tanlov markazlashgan.
  const offenders = sourceFiles(join(ROOT, "src"))
    .filter((file) => !file.endsWith("ai-models.ts"))
    .filter((file) => stripComments(readFileSync(file, "utf8")).includes("OPENAI_MODEL"));
  assert.deepEqual(offenders, []);
});

test("narx jadvalining ikkinchi nusxasi YO‘Q", () => {
  // Ikki jadval vaqt o'tib ajralib ketardi va bir xil yugurish ikki
  // xil narx ko'rsatardi.
  const offenders = sourceFiles(join(ROOT, "src"))
    .filter((file) => !file.endsWith("ai-models.ts"))
    .filter((file) => /inputPerMTok\s*:/.test(stripComments(readFileSync(file, "utf8"))));
  assert.deepEqual(offenders, []);
});

/* ------------------------------ o‘lchov --------------------------------- */

test("maqola yugurishi token va narxni QAYD ETADI", () => {
  // Bularsiz "qimmatga tushyapti" degan savolga o'lchov bilan javob
  // berib bo'lmasdi.
  const service = readFileSync(join(ROOT, "src/lib/candidates/ai-service.ts"), "utf8");
  assert.match(service, /prompt_tokens: usage\.promptTokens/);
  assert.match(service, /completion_tokens: usage\.completionTokens/);
  assert.match(service, /estimated_cost_usd: estimatedCost/);
  assert.match(service, /attempts,/);
  // Sarf BARCHA urinishlar bo'yicha yig'iladi, oxirgisi emas.
  assert.match(service, /usage = addUsage\(usage,/);

  const migration = readFileSync(
    join(ROOT, "supabase/migrations/20260909120000_ai_jobs_token_usage.sql"),
    "utf8",
  );
  for (const column of ["prompt_tokens", "completion_tokens", "total_tokens", "estimated_cost_usd", "attempts"]) {
    assert.ok(migration.includes(column), column);
  }
  assert.ok(!/drop column|drop table/i.test(migration));
});
