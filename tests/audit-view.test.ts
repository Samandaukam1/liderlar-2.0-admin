import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  AUDIT_ACTOR_CHUNK,
  auditActorIds,
  auditChangeRows,
  auditEntityLabel,
  auditEntityOptions,
  auditSearch,
  chunkIds,
  formatAuditValue,
  resolveAuditActor,
} from "../src/lib/audit-view.ts";
import { AUDIT_ENTITY_LABEL, AUDIT_EVENT_KEYS } from "../src/lib/vip/audit-events.ts";

/*
 * AUDIT JURNALINI KO'RSATISH — panel, nomzod tarixi, bosh sahifa, eksport.
 */

/** Izohsiz kod — "yo'q" shartlari izohdagi tushuntirishga qarshi ishlamasin. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * AKTYOR
 * ------------------------------------------------------------------ */

test("id lar 100 talik bo'laklarga bo'linadi", () => {
  const ids = Array.from({ length: 250 }, (_, i) => `id-${i}`);
  const chunks = chunkIds(ids);
  assert.deepEqual(chunks.map((chunk) => chunk.length), [100, 100, 50]);
  assert.equal(AUDIT_ACTOR_CHUNK, 100);
  assert.deepEqual(chunks.flat(), ids);
  assert.deepEqual(chunkIds([]), []);
  assert.throws(() => chunkIds(ids, 0));
});

test("aktyor id lari takrorlanmaydi, bo'shlari tashlanadi", () => {
  assert.deepEqual(
    auditActorIds([{ actor_id: "a" }, { actor_id: null }, { actor_id: "b" }, { actor_id: "a" }]),
    ["a", "b"],
  );
});

test("aktyor: tizim, topilgan, ismsiz, topilmagan va o'qilmagan holatlar farqlanadi", () => {
  const profiles = new Map([
    ["u1", { full_name: "Aziza Karimova", avatar_url: "https://x/a.jpg" }],
    ["u2", { full_name: "   ", avatar_url: null }],
  ]);

  assert.deepEqual(resolveAuditActor(null, profiles, false), { name: "Tizim", avatarUrl: null, kind: "system" });
  assert.deepEqual(resolveAuditActor("u1", profiles, false), {
    name: "Aziza Karimova",
    avatarUrl: "https://x/a.jpg",
    kind: "user",
  });
  assert.equal(resolveAuditActor("u2", profiles, false).name, "(ism yo‘q)");
  assert.equal(resolveAuditActor("u3", profiles, false).kind, "missing");
  // O'qish yiqilganda "topilmadi" deyilmaydi — bu yolg'on bo'lardi.
  assert.equal(resolveAuditActor("u3", profiles, true).kind, "unknown");
  assert.equal(resolveAuditActor("u1", profiles, true).kind, "user");
});

/* ------------------------------------------------------------------ *
 * OBYEKT TURLARI
 * ------------------------------------------------------------------ */

test("filtrda eski va katalogdagi barcha obyekt turlari bor, takrorsiz", () => {
  const options = auditEntityOptions();
  const values = options.map((option) => option.value);
  assert.equal(new Set(values).size, values.length, "takroriy tur");
  for (const entity of Object.keys(AUDIT_ENTITY_LABEL)) {
    assert.ok(values.includes(entity), `filtrda yo'q: ${entity}`);
  }
  for (const legacy of ["candidate", "article", "application", "auth", "site_settings"]) {
    assert.ok(values.includes(legacy), `eski tur yo'qoldi: ${legacy}`);
  }
  assert.equal(auditEntityLabel("candidate"), "Nomzod");
  assert.equal(auditEntityLabel("vip_subscription"), AUDIT_ENTITY_LABEL.vip_subscription);
  // Prototip kalitlari nom sifatida qaytmaydi.
  assert.equal(auditEntityLabel("constructor"), "constructor");
  assert.equal(auditEntityLabel("noma_lum"), "noma_lum");
});

/* ------------------------------------------------------------------ *
 * QIDIRUV
 * ------------------------------------------------------------------ */

test("qidiruv: panel matni katalog hodisalariga aylanadi", () => {
  assert.deepEqual(auditSearch(""), { kind: "none" });
  assert.deepEqual(auditSearch("   "), { kind: "none" });
  assert.deepEqual(auditSearch("uzaytirildi"), { kind: "actions", actions: ["vip.subscription.extended"] });
  // Oddiy apostrof bilan yozilgan so'z ham topiladi (katalogda ‘ bor).
  assert.deepEqual(auditSearch("to'xtatildi"), { kind: "actions", actions: ["vip.subscription.suspended"] });

  const vip = auditSearch("VIP obuna");
  assert.equal(vip.kind, "actions");
  if (vip.kind === "actions") {
    assert.ok(vip.actions.length >= 5);
    assert.ok(vip.actions.every((key) => key.startsWith("vip.subscription.")));
  }
});

test("qidiruv: texnik nom va mos matn topilmagan so'z ilike bilan qidiriladi", () => {
  // Eski yozuvlar (`candidate.update`) katalogda yo'q — ular ham topilishi kerak.
  assert.deepEqual(auditSearch("candidate.update"), { kind: "like", pattern: "%candidate.update%" });
  assert.deepEqual(auditSearch("vip.subscription"), { kind: "like", pattern: "%vip.subscription%" });
  // `account` — eski `account.blocked` ham bor; katalog matnlarida esa bu so'z yo'q.
  assert.deepEqual(auditSearch("account"), { kind: "like", pattern: "%account%" });
  // LIKE belgisi foydalanuvchi matnidan olib tashlanadi.
  assert.deepEqual(auditSearch("50%"), { kind: "like", pattern: "%50%" });
});

test("qidiruv natijasidagi har bir nom katalogda bor", () => {
  for (const word of ["obuna", "maqola", "profil", "sertifikat", "rasm", "tavsiya", "telegram"]) {
    const search = auditSearch(word);
    if (search.kind === "actions") {
      for (const key of search.actions) assert.ok(AUDIT_EVENT_KEYS.includes(key), `${word}: ${key}`);
    }
  }
});

/* ------------------------------------------------------------------ *
 * O'ZGARISHNI KO'RSATISH
 * ------------------------------------------------------------------ */

test("tekis qiymatlar maydonma-maydon ko'rsatiladi", () => {
  assert.deepEqual(
    auditChangeRows(
      { state: "active", current_period_end: "2027-01-01T00:00:00.000Z" },
      { state: "suspended", grace_until: null },
    ),
    [
      { field: "state", before: "active", after: "suspended" },
      { field: "current_period_end", before: "2027-01-01T00:00:00.000Z", after: "—" },
      { field: "grace_until", before: "—", after: "—" },
    ],
  );
  assert.deepEqual(auditChangeRows(null, null), []);
  assert.deepEqual(auditChangeRows(null, { fields: ["short_bio", "region_id"], ok: true }), [
    { field: "fields", before: "—", after: "short_bio, region_id" },
    { field: "ok", before: "—", after: "ha" },
  ]);
});

test("eski yozuvdagi ichma-ich obyekt maydonlarga bo'linmaydi", () => {
  assert.equal(auditChangeRows({ candidate: { full_name: "X" } }, null), null);
  assert.equal(auditChangeRows("matn", null), null);
  assert.equal(auditChangeRows([1, 2], null), null);
  // Xom ko'rinish qisqartiriladi.
  const long = formatAuditValue({ text: "a".repeat(500) });
  assert.ok(long.length <= 121 && long.endsWith("…"));
  assert.equal(formatAuditValue(false), "yo‘q");
  assert.equal(formatAuditValue(""), "—");
  assert.equal(formatAuditValue([]), "—");
  assert.equal(formatAuditValue(0), "0");
});

/* ------------------------------------------------------------------ *
 * KOD QOIDALARI
 * ------------------------------------------------------------------ */

test("audit_logs so'rovlarida profiles(...) qo'shilmaydi", () => {
  /*
   * `actor_id` auth.users ga bog'langan — PostgREST bu birlashmani rad
   * etadi va BUTUN so'rov xato bilan qaytadi. Oldin jurnal sahifasi,
   * bosh sahifa bloki va nomzod tarixi shu sababli bo'sh ko'rinardi.
   */
  const bad: string[] = [];
  for (const file of sourceFiles("src")) {
    const text = readFileSync(file, "utf8");
    const pattern = /from\("audit_logs"\)\s*\.select\(\s*(["'`])([\s\S]*?)\1/g;
    for (const match of text.matchAll(pattern)) {
      if (/\bprofiles\s*\(/.test(match[2])) bad.push(file);
    }
  }
  assert.deepEqual(bad, []);
});

test("eski withAuditActors yordamchisi qolmagan", () => {
  // U ariza eksportiga ham noto'g'ri qo'yilgan edi (arizada actor_id yo'q).
  const users = sourceFiles("src").filter((file) => withoutComments(readFileSync(file, "utf8")).includes("withAuditActors"));
  assert.deepEqual(users, []);
});

test("eksport: so'rov xatosi bo'sh CSV emas, prototip kaliti eksport turi emas", () => {
  const route = withoutComments(readFileSync("src/app/api/export/[entity]/route.ts", "utf8"));
  assert.doesNotMatch(route, /const \{ data \} = await admin/);
  assert.match(route, /function rowsOrThrow\(/);
  assert.match(route, /if \(result\.error\) throw new Error/);
  assert.match(route, /Object\.hasOwn\(EXPORTERS, entity\)/);
  // Audit eksporti sahifadagi filtrlar bilan bir xil ishlaydi.
  assert.match(route, /auditSearch\(params\.get\("q"\)/);
  assert.match(route, /loadAuditActors\(logRows\)/);
});

test("jurnal sahifasi, bosh sahifa va nomzod tarixi hodisani odam tilida ko'rsatadi", () => {
  for (const file of [
    "src/app/(admin)/audit-log/page.tsx",
    "src/app/(admin)/page.tsx",
    "src/app/(admin)/candidates/[id]/page.tsx",
  ]) {
    const text = readFileSync(file, "utf8");
    assert.match(text, /auditEventLabel\(/, `${file}: matn yo'q`);
    assert.match(text, /loadAuditActors\(/, `${file}: ismlar o'qilmaydi`);
  }
});

test("jurnal sahifasi xatoni 'jadval topilmadi' deb yashirmaydi", () => {
  const page = withoutComments(readFileSync("src/app/(admin)/audit-log/page.tsx", "utf8"));
  assert.doesNotMatch(page, /Jadval topilmadi/);
  assert.match(page, /<ErrorState/);
  assert.match(page, /actors\.failed/);
});

test("tahrir tarixi xatosi sahifani yiqitmaydi", () => {
  const service = readFileSync("src/lib/profile-editor/review-service.ts", "utf8");
  const body = withoutComments(service.slice(service.indexOf("export async function loadEditHistory(")));
  assert.match(body, /return \{ ok: false, error:/);
  assert.doesNotMatch(body, /\bthrow\b/);
});

test("obyekt tarixi indeksi vaqt bo'yicha saralangan", () => {
  const sql = readFileSync("supabase/migrations/20261003100000_audit_log_history_index.sql", "utf8");
  assert.match(
    sql,
    /create index if not exists idx_audit_logs_entity_time\s+on public\.audit_logs \(entity_type, entity_id, created_at desc\)/,
  );
  assert.match(sql, /drop index if exists public\.idx_audit_logs_entity;/);
});
