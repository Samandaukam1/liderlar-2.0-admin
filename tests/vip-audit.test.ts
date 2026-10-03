import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import {
  AUDIT_ENTITY_LABEL,
  AUDIT_EVENT_KEYS,
  AUDIT_EVENTS,
  auditEventLabel,
  auditEventSpec,
  isAuditEventKey,
} from "../src/lib/vip/audit-events.ts";
import {
  AUDIT_MAX_LIST,
  AUDIT_MAX_TEXT,
  AUDIT_REDACTED,
  cleanAuditFields,
  cleanAuditReason,
  isSecretAuditKey,
} from "../src/lib/vip/audit-fields.ts";

/*
 * AUDIT JURNALI — KATALOG, YOZUVCHI VA CHAQIRUV JOYLARI (§37, §56).
 *
 * BU FAYL IKKALA REPODA AYNAN BIR XIL (`liderlar-admin/tests` va
 * `liderlar-web/tests`). Qaysi repoda ishga tushganini `package.json`
 * dagi nomdan biladi va ikkinchi repoga yonidagi papka orqali qaraydi
 * (`../liderlar-web` yoki `../liderlar-admin`). Ikkinchi repo yonida
 * bo'lmasa (masalan, CI faqat bitta repoini oladi), ikki repoli
 * tekshiruvlar SABABI YOZILGAN holda o'tkazib yuboriladi — jim emas.
 *
 * Kod matn bilan emas, TypeScript sintaksis daraxti bilan o'qiladi:
 * izoh ichidagi `recordAudit(` yoki satr ichidagi `//` tekshiruvni
 * aldamaydi.
 */

const SELF = (JSON.parse(readFileSync("package.json", "utf8")) as { name: string }).name;
const IS_ADMIN = SELF === "liderlar-admin";
const OTHER = join("..", IS_ADMIN ? "liderlar-web" : "liderlar-admin");
const HAS_OTHER = existsSync(join(OTHER, "src/lib/vip/audit-events.ts"));
const NEEDS_OTHER = HAS_OTHER ? false : `${OTHER} topilmadi — ikki repoli tekshiruv o'tkazib yuborildi`;

const ROOTS: Record<"admin" | "web", string | null> = {
  admin: IS_ADMIN ? "." : HAS_OTHER ? OTHER : null,
  web: IS_ADMIN ? (HAS_OTHER ? OTHER : null) : ".",
};

const CATALOG = "src/lib/vip/audit-events.ts";
const FIELDS = "src/lib/vip/audit-fields.ts";
const WRITER = "src/lib/vip/audit-log.ts";

/* ------------------------------------------------------------------ *
 * KODNI O'QISH
 * ------------------------------------------------------------------ */

interface SourceUnit {
  repo: "admin" | "web";
  path: string;
  sf: ts.SourceFile;
}

function listSources(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith(".d.ts")) out.push(full);
    }
  };
  walk(join(root, "src"));
  return out;
}

function parseSource(repo: "admin" | "web", path: string, text: string): SourceUnit {
  const kind = path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  return { repo, path, sf: ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, kind) };
}

function walkNodes(node: ts.Node, visit: (node: ts.Node) => void): void {
  visit(node);
  ts.forEachChild(node, (child) => walkNodes(child, visit));
}

function where(unit: SourceUnit, node: ts.Node): string {
  const { line } = unit.sf.getLineAndCharacterOfPosition(node.getStart(unit.sf));
  return `${unit.repo}:${unit.path.replace(/^(\.\.\/[^/]+\/|\.\/)/, "")}:${line + 1}`;
}

/*
 * Faqat audit bilan aloqasi bor fayllar daraxtga aylantiriladi:
 * butun `src` ni tahlil qilish testni sekinlashtirardi. Katalog
 * kalitlaridan biri yoki `recordAudit` matnda bo'lmagan fayl bu
 * testga hech narsa bermaydi.
 */
const UNITS: SourceUnit[] = [];
for (const repo of ["admin", "web"] as const) {
  const root = ROOTS[repo];
  if (!root) continue;
  for (const path of listSources(root)) {
    if (path.endsWith(CATALOG)) continue;
    const text = readFileSync(path, "utf8");
    const relevant =
      text.includes("recordAudit") ||
      text.includes("AuditEventKey") ||
      AUDIT_EVENT_KEYS.some((key) => text.includes(key));
    if (relevant) UNITS.push(parseSource(repo, path, text));
  }
}

interface AuditCall {
  unit: SourceUnit;
  node: ts.CallExpression;
}

const CALLS: AuditCall[] = [];
for (const unit of UNITS) {
  walkNodes(unit.sf, (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "recordAudit"
    ) {
      CALLS.push({ unit, node });
    }
  });
}

/** Har repodagi satr ko'rinishidagi qiymatlar (izohlar hisobga kirmaydi). */
function stringLiterals(unit: SourceUnit): Array<{ text: string; node: ts.Node }> {
  const found: Array<{ text: string; node: ts.Node }> = [];
  walkNodes(unit.sf, (node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      found.push({ text: node.text, node });
    }
  });
  return found;
}

function hasImports(path: string): boolean {
  const sf = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
  let found = false;
  walkNodes(sf, (node) => {
    if (ts.isImportDeclaration(node) || ts.isImportEqualsDeclaration(node)) found = true;
    if (ts.isExportDeclaration(node) && node.moduleSpecifier) found = true;
    if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === "require"))
    ) {
      found = true;
    }
  });
  return found;
}

/* ------------------------------------------------------------------ *
 * KATALOG
 * ------------------------------------------------------------------ */

test("audit katalogi va tozalash moduli hech narsa import qilmaydi", () => {
  // Ikkala fayl ham ikki repoga ko'chiriladi va testda to'g'ridan-to'g'ri yuklanadi.
  for (const file of [CATALOG, FIELDS]) {
    assert.equal(hasImports(file), false, `${file} da import topildi`);
  }
});

test("har bir hodisa: nuqtali kichik harfli kalit, ma'lum obyekt turi, jiddiylik va matn", () => {
  const labels = new Map<string, string>();
  for (const key of AUDIT_EVENT_KEYS) {
    const spec = AUDIT_EVENTS[key];
    assert.match(key, /^[a-z][a-z_]*(\.[a-z][a-z_]*)+$/, `kalit shakli: ${key}`);
    assert.ok(Object.hasOwn(AUDIT_ENTITY_LABEL, spec.entity), `${key}: noma'lum obyekt turi ${spec.entity}`);
    assert.ok(["info", "warning", "critical"].includes(spec.severity), `${key}: jiddiylik ${spec.severity}`);
    assert.ok(["admin", "member", "system"].includes(spec.actor), `${key}: aktyor ${spec.actor}`);
    assert.ok(spec.label.trim().length > 0, `${key}: matn bo'sh`);
    assert.notEqual(spec.label, key, `${key}: matn texnik nomni takrorlaydi`);
    /*
     * Panel matnida oddiy apostrof (') emas, o‘zbekcha belgilar (‘ va ’).
     * Aralash yozuv panelda bir xil so'zni ikki xil ko'rsatardi.
     */
    assert.doesNotMatch(spec.label, /'/, `${key}: matnda oddiy apostrof`);

    // Bir xil matnli ikki hodisa panelda bir-biridan ajratib bo'lmas edi.
    const clash = labels.get(spec.label);
    assert.equal(clash, undefined, `${key} va ${clash} bir xil matnga ega`);
    labels.set(spec.label, key);
  }
});

test("katalogdan tashqari eski yozuv: texnik nom ko'rsatiladi, prototip kaliti hodisa emas", () => {
  assert.equal(AUDIT_EVENT_KEYS.length, Object.keys(AUDIT_EVENTS).length);
  assert.equal(auditEventLabel("vip.subscription.extended"), AUDIT_EVENTS["vip.subscription.extended"].label);

  // `audit_logs` da katalogdan oldingi yozuvlar bor — ular yashirilmaydi.
  assert.equal(auditEventLabel("candidate.update"), "candidate.update");
  assert.equal(auditEventSpec("candidate.update"), null);

  for (const value of ["toString", "__proto__", "constructor", "", 42, null, undefined]) {
    assert.equal(isAuditEventKey(value), false, `hodisa deb qabul qilindi: ${String(value)}`);
  }
});

test("audit katalogi ikki repoda bayt-baytigacha bir xil", { skip: NEEDS_OTHER }, () => {
  assert.equal(readFileSync(CATALOG, "utf8"), readFileSync(join(OTHER, CATALOG), "utf8"));
});

test("tozalash moduli ikki repoda bayt-baytigacha bir xil", { skip: NEEDS_OTHER }, () => {
  assert.equal(readFileSync(FIELDS, "utf8"), readFileSync(join(OTHER, FIELDS), "utf8"));
});

test("audit testining o'zi ikki repoda bir xil", { skip: NEEDS_OTHER }, () => {
  // Bir repoda qoida yumshatilsa, ikkinchisi buni ko'rsatadi.
  const self = "tests/vip-audit.test.ts";
  assert.equal(readFileSync(self, "utf8"), readFileSync(join(OTHER, self), "utf8"));
});

test("jurnal yozuvchisi ikki repoda faqat admin mijozining nomi bilan farq qiladi", { skip: NEEDS_OTHER }, () => {
  const normalize = (text: string) =>
    text.replace(/\bcreateSupabaseAdminClient\b/g, "ADMIN_CLIENT").replace(/\bcreateAdminClient\b/g, "ADMIN_CLIENT");
  assert.equal(normalize(readFileSync(WRITER, "utf8")), normalize(readFileSync(join(OTHER, WRITER), "utf8")));
});

/* ------------------------------------------------------------------ *
 * YOZUVCHI
 * ------------------------------------------------------------------ */

test("yozuvchi tur va jiddiylikni katalogdan oladi, xatoni amalga otmaydi", () => {
  const source = readFileSync(WRITER, "utf8");
  assert.match(source, /^import "server-only";/);
  assert.match(source, /action: event,/);
  assert.match(source, /entity_type: spec\.entity,/);
  assert.match(source, /severity: spec\.severity,/);
  assert.match(source, /old_value: cleanAuditFields\(input\.before\)/);
  assert.match(source, /new_value: cleanAuditFields\(input\.after\)/);
  assert.match(source, /metadata: cleanAuditFields\(input\.metadata\) \?\? \{\}/);
  assert.match(source, /reason: cleanAuditReason\(input\.reason\)/);
  // Jurnal amaldan keyin yoziladi: uning xatosi bajarilgan amalni "xato" qilmaydi.
  assert.doesNotMatch(source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, ""), /\bthrow\b/);
  assert.match(source, /catch \(err\)/);
});

test("sir bo'lishi mumkin bo'lgan kalitlar yashiriladi", () => {
  const secret = [
    "token", "access_token", "refresh_token", "link_token", "password", "password_hash",
    "passwd", "api_key", "apikey", "secret", "client_secret", "hash", "signature", "TOKEN",
  ];
  const fields = Object.fromEntries(secret.map((key) => [key, "maxfiy-qiymat"]));
  const cleaned = cleanAuditFields(fields);
  for (const key of secret) {
    assert.equal(isSecretAuditKey(key), true, key);
    assert.equal(cleaned?.[key], AUDIT_REDACTED, key);
  }
});

test("foydali kalitlar keng andoza tufayli yo'qolmaydi", () => {
  // `/key/` kabi andoza bularni ham yashirib, jurnalni befoyda qilardi.
  for (const key of ["theme_key", "idempotency_key", "tokens_count", "hashtag", "integration_key", "state"]) {
    assert.equal(isSecretAuditKey(key), false, key);
    assert.equal(cleanAuditFields({ [key]: "ko'rinadi" })?.[key], "ko'rinadi", key);
  }
});

test("uzun matn va uzun ro'yxat qisqartiriladi, oddiy qiymat tegilmaydi", () => {
  const long = "a".repeat(AUDIT_MAX_TEXT + 40);
  const list = Array.from({ length: AUDIT_MAX_LIST + 10 }, (_, i) => `id-${i}`);
  const input = Object.freeze({ bio: long, ids: list, count: 3, flag: false, none: null, short: "qisqa" });

  const cleaned = cleanAuditFields(input);
  assert.equal((cleaned?.bio as string).length, AUDIT_MAX_TEXT + 1);
  assert.ok((cleaned?.bio as string).endsWith("…"));
  assert.equal((cleaned?.ids as string[]).length, AUDIT_MAX_LIST);
  assert.equal(cleaned?.count, 3);
  assert.equal(cleaned?.flag, false);
  assert.equal(cleaned?.none, null);
  assert.equal(cleaned?.short, "qisqa");

  // Kirish obyekti o'zgarmaydi (muzlatilgan obyekt xato bermadi).
  assert.equal(input.bio.length, AUDIT_MAX_TEXT + 40);
  assert.equal(cleanAuditFields(null), null);
  assert.equal(cleanAuditFields(undefined), null);
  assert.deepEqual(cleanAuditFields({}), {});
});

test("sabab: bo'sh bo'lsa yozilmaydi, uzun bo'lsa qisqartiriladi", () => {
  assert.equal(cleanAuditReason(null), null);
  assert.equal(cleanAuditReason(undefined), null);
  assert.equal(cleanAuditReason("   "), null);
  assert.equal(cleanAuditReason("  To'lov tasdiqlandi  "), "To'lov tasdiqlandi");
  assert.equal(cleanAuditReason("x".repeat(AUDIT_MAX_TEXT * 2))?.length, AUDIT_MAX_TEXT);
});

/* ------------------------------------------------------------------ *
 * CHAQIRUV JOYLARI
 * ------------------------------------------------------------------ */

test("kodda recordAudit chaqiruvlari bor (test bo'sh o'tib ketmaydi)", () => {
  // Fayl yo'li o'zgarib, test hech narsa topmay "o'tib" ketishiga yo'l qo'ymaydi.
  const own = CALLS.filter((call) => call.unit.repo === (IS_ADMIN ? "admin" : "web"));
  assert.ok(own.length >= 10, `faqat ${own.length} ta chaqiruv topildi`);
});

test("har bir recordAudit chaqiruvi kutiladi (await)", () => {
  /*
   * Serverless muhitda javob qaytgach tugallanmagan so'rov uziladi:
   * `void recordAudit(...)` yoki `await` siz chaqiruv yozuvni yo'qotardi.
   */
  const missing: string[] = [];
  for (const { unit, node } of CALLS) {
    let parent = node.parent;
    while (parent && ts.isParenthesizedExpression(parent)) parent = parent.parent;
    if (!parent || !ts.isAwaitExpression(parent)) missing.push(where(unit, node));
  }
  assert.deepEqual(missing, [], `await siz chaqiruvlar:\n${missing.join("\n")}`);
});

test("hodisa nomi katalog kaliti sifatida beriladi — yig'ilgan matn emas", () => {
  const bad: string[] = [];
  for (const { unit, node } of CALLS) {
    const raw = node.arguments[0];
    const event = raw && unwrapExpression(raw);
    if (!event) {
      bad.push(`${where(unit, node)}: hodisa yo'q`);
    } else if (raw !== event && !ts.isParenthesizedExpression(raw)) {
      // `as AuditEventKey` tip tekshiruvini chetlab o'tadi.
      bad.push(`${where(unit, node)}: hodisa turi majburlangan (as/!)`);
    } else if (ts.isStringLiteral(event) || ts.isNoSubstitutionTemplateLiteral(event)) {
      if (!isAuditEventKey(event.text)) bad.push(`${where(unit, node)}: katalogda yo'q "${event.text}"`);
    } else if (ts.isTemplateExpression(event) || ts.isBinaryExpression(event) || ts.isCallExpression(event)) {
      // Test bunday nomni katalogdan qidira olmaydi (`"vip." + event`).
      bad.push(`${where(unit, node)}: hodisa nomi yig'ib yasalgan`);
    } else if (!unit.sf.text.includes("AuditEventKey")) {
      // O'zgaruvchi bo'lsa, u katalog turi bilan e'lon qilingan xaritadan kelishi kerak.
      bad.push(`${where(unit, node)}: hodisa o'zgaruvchisi AuditEventKey turida emas`);
    }
  }
  assert.deepEqual(bad, [], bad.join("\n"));
});

function unwrapExpression(expr: ts.Expression): ts.Expression {
  let current = expr;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isNonNullExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

/**
 * Faylda audit turi bilan ANIQ e'lon qilingan o'zgaruvchilar
 * (`const before: Record<string, AuditScalar> = {}`). Ular tip
 * darajasida tekis — ularni berish xavfsiz.
 */
function auditTypedNames(unit: SourceUnit): Set<string> {
  const names = new Set<string>();
  walkNodes(unit.sf, (node) => {
    if (
      (ts.isVariableDeclaration(node) || ts.isParameter(node)) &&
      ts.isIdentifier(node.name) &&
      node.type &&
      /\bAudit(Scalar|Value|Fields)\b/.test(node.type.getText(unit.sf))
    ) {
      names.add(node.name.text);
    }
  });
  return names;
}

/** Shart bilan qo'shiladigan tekis bo'lak: `...(x ? { slug: x } : {})`. */
function isFlatConditionalSpread(expr: ts.Expression): boolean {
  const inner = unwrapExpression(expr);
  if (!ts.isConditionalExpression(inner)) return false;
  return [inner.whenTrue, inner.whenFalse].every((branch) => {
    const value = unwrapExpression(branch);
    return (
      ts.isObjectLiteralExpression(value) &&
      value.properties.every(
        (prop) => ts.isPropertyAssignment(prop) && !ts.isObjectLiteralExpression(unwrapExpression(prop.initializer)),
      )
    );
  });
}

function flatPayloadProblems(name: string, value: ts.Expression, typed: Set<string>): string[] {
  const expr = unwrapExpression(value);
  if (expr.kind === ts.SyntaxKind.NullKeyword) return [];
  if (ts.isIdentifier(expr)) {
    return typed.has(expr.text) ? [] : [`${name} tayyor o'zgaruvchidan olingan (${expr.text})`];
  }
  if (!ts.isObjectLiteralExpression(expr)) return [`${name} joyida yozilgan obyekt emas`];

  const problems: string[] = [];
  for (const field of expr.properties) {
    if (ts.isSpreadAssignment(field)) {
      if (!isFlatConditionalSpread(field.expression)) problems.push(`${name} ichida yoyilgan obyekt (...)`);
    } else if (ts.isPropertyAssignment(field) && ts.isObjectLiteralExpression(unwrapExpression(field.initializer))) {
      problems.push(`${name} ichida ichma-ich obyekt`);
    }
  }
  return problems;
}

test("jurnalga butun obyekt berilmaydi — faqat tekis maydonlar", () => {
  /*
   * `before: row` yoki `metadata: { ...input }` kelajakda qatorga
   * qo'shiladigan har qanday ustunni (token, xesh) jurnalga olib kirardi.
   * Ruxsat etilgani: joyida yozilgan obyekt, shart bilan qo'shiladigan
   * tekis bo'lak va audit turi bilan aniq e'lon qilingan o'zgaruvchi.
   */
  const bad: string[] = [];
  for (const { unit, node } of CALLS) {
    const payload = node.arguments[1] && unwrapExpression(node.arguments[1]);
    if (!payload || !ts.isObjectLiteralExpression(payload)) {
      bad.push(`${where(unit, node)}: ikkinchi argument joyida yozilgan obyekt emas`);
      continue;
    }
    const typed = auditTypedNames(unit);
    for (const prop of payload.properties) {
      if (ts.isSpreadAssignment(prop)) {
        bad.push(`${where(unit, prop)}: yoyilgan obyekt (...)`);
        continue;
      }
      const name = prop.name && ts.isIdentifier(prop.name) ? prop.name.text : null;
      if (!name || !["before", "after", "metadata"].includes(name)) continue;

      const value = ts.isShorthandPropertyAssignment(prop)
        ? prop.name
        : ts.isPropertyAssignment(prop)
          ? prop.initializer
          : null;
      if (!value) {
        bad.push(`${where(unit, prop)}: ${name} qiymati o'qilmadi`);
        continue;
      }
      for (const problem of flatPayloadProblems(name, value, typed)) bad.push(`${where(unit, prop)}: ${problem}`);
    }
  }
  assert.deepEqual(bad, [], bad.join("\n"));
});

test("AuditEventKey turidagi xaritalardagi nomlar katalogda bor", () => {
  /*
   * Hodisa nomi ko'pincha xaritada turadi (`SUBSCRIPTION_AUDIT`,
   * `EDITOR_AUDIT`). Tip tekshiruvi xato nomni to'xtatadi; bu test esa
   * xaritalar haqiqatan katalog turiga bog'langanini va har bir nom
   * katalogda borligini tip tekshiruvisiz ham ko'rsatadi.
   */
  const bad: string[] = [];
  let maps = 0;
  for (const unit of UNITS) {
    walkNodes(unit.sf, (node) => {
      if (
        !ts.isVariableDeclaration(node) ||
        !node.type ||
        !node.initializer ||
        !/\bAuditEventKey\b/.test(node.type.getText(unit.sf))
      ) {
        return;
      }
      maps += 1;
      walkNodes(node.initializer, (inner) => {
        if (ts.isPropertyAssignment(inner)) {
          const value = unwrapExpression(inner.initializer);
          if (ts.isStringLiteral(value) && !isAuditEventKey(value.text)) {
            bad.push(`${where(unit, value)}: "${value.text}"`);
          }
        }
      });
    });
  }
  if (ROOTS.admin) assert.ok(maps >= 2, `admin xaritalari topilmadi (${maps})`);
  assert.deepEqual(bad, [], `katalogda yo'q nomlar:\n${bad.join("\n")}`);
});

test("katalogdagi har bir hodisa kodda kamida bir marta yoziladi", { skip: NEEDS_OTHER }, () => {
  // Ishlatilmaydigan hodisa panel filtrida bo'sh tanlov bo'lib turardi.
  const used = new Set<string>();
  for (const unit of UNITS) {
    for (const { text } of stringLiterals(unit)) if (isAuditEventKey(text)) used.add(text);
  }
  const unused = AUDIT_EVENT_KEYS.filter((key) => !used.has(key));
  assert.deepEqual(unused, [], `hech qayerda yozilmaydigan hodisalar: ${unused.join(", ")}`);
});

test("admin qarorlari faqat admin panelidan yoziladi", { skip: NEEDS_OTHER }, () => {
  /*
   * Ommaviy saytda (`liderlar-web`) "tasdiqlandi", "ishonch berildi"
   * kabi hodisa yozilsa, jurnal a'zoning amalini xodim qarori qilib
   * ko'rsatardi.
   */
  const bad: string[] = [];
  for (const unit of UNITS.filter((item) => item.repo === "web")) {
    for (const { text, node } of stringLiterals(unit)) {
      if (isAuditEventKey(text) && AUDIT_EVENTS[text].actor === "admin") {
        bad.push(`${where(unit, node)}: "${text}"`);
      }
    }
  }
  assert.deepEqual(bad, [], bad.join("\n"));
});
