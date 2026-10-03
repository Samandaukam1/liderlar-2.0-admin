import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

/*
 * RLS VA FUNKSIYA HUQUQLARI — STATIK QOIDALAR.
 *
 * Postgres xulqining o'zi `supabase/tests/vip_rls_live.sql` da
 * (haqiqiy rollar bilan) tekshiriladi. Bu test esa KELAJAKDAGI
 * o'zgarishni ushlaydi: yangi SECURITY DEFINER funksiya huquqsiz
 * qo'shilsa, profilga yana "o'zini yangilash" siyosati qaytsa yoki
 * kod RPC ni foydalanuvchi sessiyasi bilan chaqira boshlasa.
 */

const MIGRATIONS = "supabase/migrations";
const WEB = existsSync("../liderlar-web/package.json") ? "../liderlar-web" : null;

/** RLS siyosatlari chaqiradigan va ataylab ochiq funksiyalar. */
const OPEN_BY_DESIGN = new Set(["has_permission", "is_admin", "has_any_role", "list_published_candidates_v2"]);

function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith(".sql"))
    .sort();
}

/** SQL izohlarini olib tashlaydi (satr ichidagi `--` ga tegmaydi — migratsiyalarda yo'q). */
function stripSqlComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
}

interface DefinerFunction {
  name: string;
  file: string;
  returnsTrigger: boolean;
}

/** Migratsiyalarda yaratilgan barcha SECURITY DEFINER funksiyalar. */
function definerFunctions(): DefinerFunction[] {
  const found = new Map<string, DefinerFunction>();
  for (const file of migrationFiles()) {
    const sql = stripSqlComments(readFileSync(join(MIGRATIONS, file), "utf8"));
    const pattern =
      /create\s+(?:or\s+replace\s+)?function\s+"?public"?\."?([a-z_0-9]+)"?\s*\(([\s\S]*?)\$(\w*)\$/gi;
    for (const match of sql.matchAll(pattern)) {
      const header = match[2];
      if (!/security\s+definer/i.test(header)) {
        found.delete(match[1]);
        continue;
      }
      found.set(match[1], {
        name: match[1],
        file,
        returnsTrigger: /returns\s+trigger/i.test(header),
      });
    }
  }
  return [...found.values()];
}

test("har bir SECURITY DEFINER funksiya anon/authenticated dan yopilgan yoki ataylab ochiq", () => {
  /*
   * Supabase'da public sxemadagi funksiya standart holatda hammaga ochiq
   * va `/rest/v1/rpc/<nom>` orqali chaqiriladi. DEFINER funksiya RLS'ni
   * chetlab o'tadi — yopilmagani to'g'ridan-to'g'ri teshik
   * (`grant_role_by_email` shunday edi).
   */
  const allSql = migrationFiles()
    .map((file) => stripSqlComments(readFileSync(join(MIGRATIONS, file), "utf8")))
    .join("\n");
  const lockdown = readFileSync(join(MIGRATIONS, "20261003101000_lock_down_definer_functions.sql"), "utf8");

  const functions = definerFunctions();
  // Andoza buzilib, test hech narsa topmay "o'tib" ketmasin.
  assert.ok(functions.length >= 30, `faqat ${functions.length} ta DEFINER funksiya topildi`);

  const open: string[] = [];
  for (const fn of functions) {
    if (fn.returnsTrigger || OPEN_BY_DESIGN.has(fn.name)) continue;
    const revoked = new RegExp(
      `revoke\\s+all\\s+on\\s+function\\s+public\\.${fn.name}\\s*\\([^)]*\\)\\s*from\\s+public\\s*,\\s*anon\\s*,\\s*authenticated`,
      "i",
    ).test(allSql);
    const inLockdown = lockdown.includes(`'public.${fn.name}(`);
    if (!revoked && !inLockdown) open.push(`${fn.name} (${fn.file})`);
  }
  assert.deepEqual(open, [], `yopilmagan SECURITY DEFINER funksiyalar:\n${open.join("\n")}`);
});

test("eng xavfli funksiyalar yopish ro'yxatida", () => {
  const lockdown = readFileSync(join(MIGRATIONS, "20261003101000_lock_down_definer_functions.sql"), "utf8");
  for (const signature of [
    "public.grant_role_by_email(text, text)",
    "public.promote_candidate_intake(uuid, uuid, boolean, text, text)",
    "public.record_profile_view(text, text, uuid, boolean)",
    "public.write_audit_log(uuid, text, text, text, jsonb, jsonb, text, text)",
    "public.recalculate_rankings()",
  ]) {
    assert.ok(lockdown.includes(`'${signature}'`), signature);
  }
  assert.match(lockdown, /revoke all on function %s from public, anon, authenticated/);
  assert.match(lockdown, /grant execute on function %s to service_role/);
  // Bazada yo'q funksiya migratsiyani yiqitmaydi.
  assert.match(lockdown, /to_regprocedure\(v_signature\)/);
});

test("a'zo o'z profilini to'g'ridan-to'g'ri o'zgartira olmaydi", () => {
  const sql = readFileSync(join(MIGRATIONS, "20261003102000_profiles_no_direct_update.sql"), "utf8");
  assert.match(sql, /drop policy if exists "update own profile" on public\.profiles;/);
  assert.match(sql, /revoke insert, update, delete, truncate on table public\.profiles from anon, authenticated;/);

  // Keyingi migratsiyalar bu eshikni qayta ochmasin.
  const later = migrationFiles().filter((file) => file > "20261003102000");
  for (const file of later) {
    const text = stripSqlComments(readFileSync(join(MIGRATIONS, file), "utf8"));
    assert.doesNotMatch(text, /on\s+(public\.)?profiles\s+for\s+(update|insert|delete|all)/i, file);
    assert.doesNotMatch(text, /grant\s+[^;]*\b(update|insert|delete)\b[^;]*on\s+(table\s+)?public\.profiles/i, file);
  }
});

/* ------------------------------------------------------------------ *
 * PT409 — POYGA HOLATI QAYTA URINILMAYDIGAN KOD BILAN
 * ------------------------------------------------------------------ */

test("poyga holatlari 40001 emas, PT409 bilan qaytadi", () => {
  /*
   * 40001 ni PostgREST o'zi qayta urinadi; deterministik shartda bu
   * cheksiz aylanish edi (admin tugmasi qotib qolardi).
   */
  const sql = stripSqlComments(readFileSync(join(MIGRATIONS, "20261002230000_rpc_conflict_codes.sql"), "utf8"));
  assert.doesNotMatch(sql, /serialization_failure|'40001'/);
  assert.equal((sql.match(/errcode = 'PT409'/g) ?? []).length, 2);
  assert.match(sql, /drop function if exists public\.vip_apply_transition\(/);
  assert.match(sql, /p_expected_updated_at timestamptz default null/);

  // Keyingi migratsiyalarda ham biznes sharti uchun 40001 ishlatilmaydi.
  for (const file of migrationFiles().filter((name) => name > "20261002230000")) {
    const text = stripSqlComments(readFileSync(join(MIGRATIONS, file), "utf8"));
    assert.doesNotMatch(text, /errcode\s*=\s*'(serialization_failure|40001|40P01)'/, file);
  }
});

test("server kodi PT409 ni ziddiyat sifatida taniydi va versiyani yuboradi", () => {
  const vip = readFileSync("src/lib/vip/subscription-service.ts", "utf8");
  assert.match(vip, /error\.code === "PT409"/);
  assert.match(vip, /p_expected_updated_at:/);
  const review = readFileSync("src/lib/profile-editor/review-service.ts", "utf8");
  assert.match(review, /error\.code === "PT409"/);
});

/* ------------------------------------------------------------------ *
 * RPC FAQAT SERVICE_ROLE MIJOZI ORQALI
 * ------------------------------------------------------------------ */

const ADMIN_FACTORIES = new Set(["createSupabaseAdminClient", "createAdminClient"]);

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith(".d.ts")) out.push(full);
  }
  return out;
}

function isAdminFactoryCall(node: ts.Node): boolean {
  let current: ts.Node = node;
  while (ts.isAwaitExpression(current) || ts.isParenthesizedExpression(current)) current = current.expression;
  return ts.isCallExpression(current) && ts.isIdentifier(current.expression) && ADMIN_FACTORIES.has(current.expression.text);
}

/** `.rpc(...)` ni chaqirgan obyektning ildizi: `admin`, `db` yoki `createAdminClient()`. */
function receiverRoot(expr: ts.Expression): ts.Expression {
  let current = expr;
  while (ts.isPropertyAccessExpression(current) || ts.isNonNullExpression(current) || ts.isParenthesizedExpression(current)) {
    current = current.expression;
  }
  return current;
}

test("ikkala repoda ham RPC faqat service_role mijozi bilan chaqiriladi", () => {
  /*
   * Yuqoridagi yopish shunga tayanadi: brauzer yoki foydalanuvchi
   * sessiyasi bilan chaqirilgan RPC endi "ruxsat yo'q" oladi. Kimdir
   * shunday chaqiruv qo'shsa, bu test uni darhol ko'rsatadi.
   */
  const roots = ["src", ...(WEB ? [join(WEB, "src")] : [])];
  const bad: string[] = [];
  let calls = 0;

  for (const root of roots) {
    for (const file of sourceFiles(root)) {
      const text = readFileSync(file, "utf8");
      if (!text.includes(".rpc")) continue;
      const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
      const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);

      const adminVariables = new Set<string>();
      const visitDeclarations = (node: ts.Node) => {
        if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && isAdminFactoryCall(node.initializer)) {
          adminVariables.add(node.name.text);
        }
        ts.forEachChild(node, visitDeclarations);
      };
      visitDeclarations(sf);

      const visitCalls = (node: ts.Node) => {
        if (
          ts.isCallExpression(node) &&
          ts.isPropertyAccessExpression(node.expression) &&
          node.expression.name.text === "rpc"
        ) {
          calls += 1;
          const root = receiverRoot(node.expression.expression);
          const ok = isAdminFactoryCall(root) || (ts.isIdentifier(root) && adminVariables.has(root.text));
          if (!ok) {
            const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
            bad.push(`${file}:${line + 1}`);
          }
        }
        ts.forEachChild(node, visitCalls);
      };
      visitCalls(sf);
    }
  }

  assert.ok(calls >= 15, `RPC chaqiruvlari topilmadi (${calls})`);
  assert.deepEqual(bad, [], `service_role bo'lmagan mijoz bilan RPC:\n${bad.join("\n")}`);
});

test("jonli SQL testi yangi migratsiyalarni qamraydi", () => {
  const live = readFileSync("supabase/tests/vip_rls_live.sql", "utf8");
  assert.match(live, /^begin;/m);
  assert.match(live, /^rollback;/m);
  for (const scenario of [
    "grant_role_by_email",
    "promote_candidate_intake",
    "update public.profiles set is_active",
    "certificate-evidence",
    "XATO: PT409",
  ]) {
    assert.ok(live.includes(scenario), scenario);
  }
});
