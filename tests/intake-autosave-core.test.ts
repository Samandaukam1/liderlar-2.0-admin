import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { answerSignature, stableJson } from "../src/lib/intake/answer-signature.ts";
import { saveIntakeAnswerWith, type IntakeDb, type IntakeSaveDeps, type SaveAnswerArgs } from "../src/lib/intake/answer-save-core.ts";

/*
 * Autosave was ~42% of all database API traffic, ~9 queries per save, and every
 * save wrote a revision row — 18% of them identical to the previous one (the
 * revisions table holds ~980,000 rows, 639 MB). These tests drive the real save
 * logic against an in-memory database and pin what must not change: answers,
 * optimistic locking, progress, and a revision for every real change.
 */

/* ------------------------------------------------------------------ *
 * A minimal in-memory stand-in for the supabase-js calls the save uses.
 * ------------------------------------------------------------------ */

type Row = Record<string, unknown>;

function fakeDb(seed: { intakes: Row[]; questions: Row[]; answers?: Row[] }) {
  const tables: Record<string, Row[]> = {
    candidate_intakes: seed.intakes.map((r) => ({ ...r })),
    candidate_intake_questions: seed.questions.map((r) => ({ ...r })),
    candidate_intake_answers: (seed.answers ?? []).map((r) => ({ ...r })),
    candidate_intake_answer_revisions: [],
  };
  const log: string[] = [];
  let nextId = 1;

  function builder(table: string) {
    let op: "select" | "update" | "insert" = "select";
    let payload: Row = {};
    const filters: Array<(r: Row) => boolean> = [];
    let returning = false;

    const run = () => {
      const rows = tables[table];
      if (op === "insert") {
        // Unique (intake_id, question_id) on answers, like the real table.
        if (
          table === "candidate_intake_answers" &&
          rows.some((r) => r.intake_id === payload.intake_id && r.question_id === payload.question_id)
        ) {
          return { data: null, error: { message: "duplicate key value violates unique constraint" } };
        }
        const row = { id: `row-${nextId++}`, ...payload };
        rows.push(row);
        log.push(`insert ${table}`);
        return { data: returning ? [{ id: row.id }] : null, error: null };
      }
      const matched = rows.filter((r) => filters.every((f) => f(r)));
      if (op === "update") {
        matched.forEach((r) => Object.assign(r, payload));
        log.push(`update ${table}`);
        return { data: returning ? matched.map((r) => ({ id: r.id })) : null, error: null };
      }
      log.push(`select ${table}`);
      return { data: matched.map((r) => ({ ...r })), error: null };
    };

    const one = (required: boolean) => {
      const { data, error } = run();
      if (error) return Promise.resolve({ data: null, error });
      const first = Array.isArray(data) ? data[0] ?? null : data;
      if (required && !first) return Promise.resolve({ data: null, error: { message: "no rows" } });
      return Promise.resolve({ data: first, error: null });
    };

    const b = {
      select() {
        if (op !== "select") returning = true;
        return b;
      },
      update(patch: Row) { op = "update"; payload = patch; return b; },
      insert(row: Row) { op = "insert"; payload = row; return b; },
      eq(col: string, value: unknown) { filters.push((r) => r[col] === value); return b; },
      is(col: string, value: unknown) { filters.push((r) => (r[col] ?? null) === value); return b; },
      maybeSingle: () => one(false),
      single: () => one(true),
      then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
        return Promise.resolve(run()).then(resolve, reject);
      },
    };
    return b;
  }

  const db = { from: (table: string) => builder(table) } as unknown as IntakeDb;
  // Same rule as the SQL function: answered = non-empty "answered" rows of this template.
  const progress = async (intakeId: string) => {
    log.push("rpc intake_progress");
    const intake = tables.candidate_intakes.find((r) => r.id === intakeId)!;
    const qs = tables.candidate_intake_questions.filter((q) => q.template_id === intake.template_id);
    const answered = qs.filter((q) =>
      tables.candidate_intake_answers.some(
        (a) => a.question_id === q.id && a.answer_state === "answered" && String(a.plain_text).trim(),
      ),
    ).length;
    return { total: qs.length, answered };
  };
  return { db, deps: { db, progress } as IntakeSaveDeps, tables, log };
}

const INTAKE = { id: "intake-1", template_id: "tpl-1", status: "draft", current_question_no: 1, last_completed_question_no: 0, deleted_at: null };
const QUESTIONS = [{ id: "q-1", template_id: "tpl-1", question_no: 1 }, { id: "q-2", template_id: "tpl-1", question_no: 2 }];
const doc = (text: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
const args = (over: Partial<SaveAnswerArgs> = {}): SaveAnswerArgs => ({
  intakeId: "intake-1",
  questionNo: 1,
  answerState: "answered",
  richContent: doc("Salom"),
  plainText: "Salom",
  lockVersion: 0,
  source: "public",
  editedBy: null,
  ...over,
});

/* ------------------------------------------------------------------ *
 * SIGNATURE
 * ------------------------------------------------------------------ */

test("signature ignores key order (jsonb vs editor) but not content", () => {
  const editor = { type: "doc", content: [{ type: "paragraph", attrs: { textAlign: null, indent: 0 } }] };
  const jsonb = { content: [{ attrs: { indent: 0, textAlign: null }, type: "paragraph" }], type: "doc" };
  assert.equal(stableJson(editor), stableJson(jsonb));
  const base = { answerState: "answered", plainText: "a", richContent: doc("a") };
  assert.equal(answerSignature(base), answerSignature({ ...base, richContent: JSON.parse(JSON.stringify(doc("a"))) }));
  assert.notEqual(answerSignature(base), answerSignature({ ...base, plainText: "a " }));
  assert.notEqual(answerSignature(base), answerSignature({ ...base, answerState: "no_answer" }));
  assert.notEqual(answerSignature(base), answerSignature({ ...base, richContent: doc("b") }));
  // Array order is content (paragraph order), never normalised away.
  assert.notEqual(stableJson([1, 2]), stableJson([2, 1]));
  assert.equal(answerSignature({ ...base, richContent: undefined }), answerSignature({ ...base, richContent: {} }));
});

/* ------------------------------------------------------------------ *
 * SAVE BEHAVIOUR
 * ------------------------------------------------------------------ */

test("first save inserts the answer and one revision", async () => {
  const { deps, tables } = fakeDb({ intakes: [INTAKE], questions: QUESTIONS });
  const out = await saveIntakeAnswerWith(deps, args());
  assert.equal(out.ok, true);
  assert.equal(tables.candidate_intake_answers.length, 1);
  assert.equal(tables.candidate_intake_answers[0].lock_version, 1);
  assert.equal(tables.candidate_intake_answer_revisions.length, 1);
  assert.deepEqual(out.ok && out.progress, { answered: 1, total: 2 });
});

test("a changed answer updates, bumps the lock and writes a revision", async () => {
  const { deps, tables } = fakeDb({ intakes: [INTAKE], questions: QUESTIONS });
  await saveIntakeAnswerWith(deps, args());
  const out = await saveIntakeAnswerWith(deps, args({ plainText: "Salom dunyo", richContent: doc("Salom dunyo"), lockVersion: 1 }));
  assert.equal(out.ok && out.lockVersion, 2);
  assert.equal(tables.candidate_intake_answers[0].plain_text, "Salom dunyo");
  assert.equal(tables.candidate_intake_answer_revisions.length, 2);
});

test("an identical save writes nothing to the answer or revisions, keeps the lock, still records progress", async () => {
  const { deps, tables, log } = fakeDb({ intakes: [INTAKE], questions: QUESTIONS });
  await saveIntakeAnswerWith(deps, args());
  const revisionsBefore = tables.candidate_intake_answer_revisions.length;
  log.length = 0;

  // Same content, keys in a different order (as jsonb returns them).
  const reordered = { content: [{ content: [{ text: "Salom", type: "text" }], type: "paragraph" }], type: "doc" };
  const out = await saveIntakeAnswerWith(deps, args({ richContent: reordered, lockVersion: 1, questionNo: 1 }));

  assert.equal(out.ok, true);
  assert.equal(out.ok && out.lockVersion, 1, "lock not bumped");
  assert.equal(tables.candidate_intake_answer_revisions.length, revisionsBefore, "no duplicate snapshot");
  assert.ok(!log.includes("update candidate_intake_answers"));
  assert.ok(log.includes("update candidate_intakes"), "last_autosave_at / position still recorded");
  assert.ok(log.includes("rpc intake_progress"));
});

test("a stale lock is a conflict carrying the server version — even for identical text", async () => {
  const { deps, tables } = fakeDb({ intakes: [INTAKE], questions: QUESTIONS });
  await saveIntakeAnswerWith(deps, args());
  await saveIntakeAnswerWith(deps, args({ plainText: "Boshqa qurilma", richContent: doc("Boshqa qurilma"), lockVersion: 1 }));
  const out = await saveIntakeAnswerWith(deps, args({ lockVersion: 1 }));
  assert.equal(out.ok, false);
  assert.ok(!out.ok && "conflict" in out && out.server.lock_version === 2 && out.server.plain_text === "Boshqa qurilma");
  assert.equal(tables.candidate_intake_answers[0].plain_text, "Boshqa qurilma", "the newer write is not overwritten");
});

test("losing the update race to another device becomes a conflict, not a silent success", async () => {
  const { db, deps, tables } = fakeDb({ intakes: [INTAKE], questions: QUESTIONS });
  await saveIntakeAnswerWith(deps, args());
  // Another device bumps the lock between this save's SELECT and UPDATE.
  const realFrom = (db as unknown as { from: (t: string) => unknown }).from;
  let selects = 0;
  (db as unknown as { from: (t: string) => unknown }).from = (table: string) => {
    const b = realFrom(table) as { maybeSingle: () => Promise<unknown> };
    if (table === "candidate_intake_answers") {
      const original = b.maybeSingle;
      b.maybeSingle = async () => {
        const result = await original();
        if (++selects === 1) tables.candidate_intake_answers[0].lock_version = 5;
        return result;
      };
    }
    return b;
  };
  const out = await saveIntakeAnswerWith(deps, args({ plainText: "Yangi", richContent: doc("Yangi"), lockVersion: 1 }));
  assert.equal(out.ok, false);
  assert.ok(!out.ok && "conflict" in out);
  assert.equal(tables.candidate_intake_answer_revisions.length, 1, "no revision for a write that did not happen");
});

test("a submitted or deleted intake is closed to edits", async () => {
  for (const intake of [{ ...INTAKE, status: "submitted" }, { ...INTAKE, deleted_at: "2026-10-01" }]) {
    const { deps, tables } = fakeDb({ intakes: [intake], questions: QUESTIONS });
    const out = await saveIntakeAnswerWith(deps, args({ intake }));
    assert.equal(out.ok, false, JSON.stringify(intake));
    assert.equal(tables.candidate_intake_answers.length, 0);
  }
});

test("a pre-read intake skips the second intake read; a mismatched one is ignored", async () => {
  const { deps, log } = fakeDb({ intakes: [INTAKE], questions: QUESTIONS });
  await saveIntakeAnswerWith(deps, args({ intake: INTAKE }));
  assert.equal(log.filter((l) => l === "select candidate_intakes").length, 0);

  const second = fakeDb({ intakes: [INTAKE], questions: QUESTIONS });
  await saveIntakeAnswerWith(second.deps, args({ intake: { ...INTAKE, id: "other-intake" } }));
  assert.equal(second.log.filter((l) => l === "select candidate_intakes").length, 1);
});

test("progress columns only move forward", async () => {
  const { deps, tables } = fakeDb({ intakes: [{ ...INTAKE, current_question_no: 2, last_completed_question_no: 2 }], questions: QUESTIONS });
  await saveIntakeAnswerWith(deps, args({ questionNo: 1 }));
  assert.equal(tables.candidate_intakes[0].current_question_no, 2);
  assert.equal(tables.candidate_intakes[0].last_completed_question_no, 2);
  assert.ok(tables.candidate_intakes[0].last_autosave_at);
});

test("the autosave route hands the resolved intake to the save", () => {
  assert.match(readFileSync("src/app/api/intake/autosave/route.ts", "utf8"), /intake: resolved\.intake,/);
  assert.match(
    readFileSync("src/lib/intake/data.ts", "utf8"),
    /\.select\("id, status, deleted_at, template_id, current_question_no, last_completed_question_no"\)/,
  );
});
