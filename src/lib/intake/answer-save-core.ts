/**
 * The answer-save logic itself, with the database passed in so the tests can
 * drive it with a fake client (`answers.ts` passes the real one). No `@/`
 * imports and no `server-only`: the type import below is erased at runtime.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { canAdvanceAnswer, type AnswerState } from "./constants.ts";
import { answerSignature } from "./answer-signature.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type IntakeDb = SupabaseClient<any, any, any>;

export interface IntakeSaveDeps {
  db: IntakeDb;
  /**
   * `intake_progress(p_intake)`. Passed in rather than called on `db` so the
   * RPC stays on a client the caller visibly created with the service role
   * (tests/rls-hardening.test.ts checks every `.rpc` receiver).
   */
  progress: (intakeId: string) => Promise<{ total: number; answered: number } | null>;
}

export interface SaveAnswerArgs {
  intakeId: string;
  questionNo: number;
  answerState: AnswerState;
  richContent: unknown;
  plainText: string;
  lockVersion: number;
  source: "public" | "admin" | "clarification";
  editedBy?: string | null;
  /**
   * The intake row, when the caller has just read it (the public autosave
   * route resolves the link and the intake together). Saves a round trip per
   * autosave; the same status and deleted_at checks are applied either way.
   */
  intake?: IntakeForSave | null;
}

/** The intake columns an answer save needs. */
export interface IntakeForSave {
  id: string;
  template_id: string;
  status: string;
  current_question_no: number | null;
  last_completed_question_no: number | null;
  deleted_at?: string | null;
}

export type SaveAnswerOutcome =
  | { ok: true; answerId: string; lockVersion: number; savedAt: string; progress: { answered: number; total: number } }
  | {
      ok: false;
      conflict: true;
      server: { answer_state: string; rich_content: unknown; plain_text: string; lock_version: number };
    }
  | { ok: false; error: string };

async function latestServerAnswer(
  admin: IntakeDb,
  intakeId: string,
  questionId: string,
): Promise<Extract<SaveAnswerOutcome, { conflict: true }> | null> {
  const { data } = await admin
    .from("candidate_intake_answers")
    .select("answer_state, rich_content, plain_text, lock_version")
    .eq("intake_id", intakeId)
    .eq("question_id", questionId)
    .maybeSingle();
  if (!data) return null;
  return {
    ok: false,
    conflict: true,
    server: {
      answer_state: data.answer_state as string,
      rich_content: data.rich_content,
      plain_text: data.plain_text as string,
      lock_version: data.lock_version as number,
    },
  };
}

/**
 * Persists one answer with optimistic concurrency (lock_version), writes a
 * revision snapshot, and advances progress. Shared by the public autosave route
 * and the admin manual-entry flow.
 */
export async function saveIntakeAnswerWith(deps: IntakeSaveDeps, args: SaveAnswerArgs): Promise<SaveAnswerOutcome> {
  const admin = deps.db;
  const preloaded = args.intake && args.intake.id === args.intakeId && !args.intake.deleted_at ? args.intake : null;
  const intake =
    preloaded ??
    (
      await admin
        .from("candidate_intakes")
        .select("id, template_id, status, current_question_no, last_completed_question_no")
        .eq("id", args.intakeId)
        .is("deleted_at", null)
        .maybeSingle()
    ).data;
  if (!intake) return { ok: false, error: "Anketa topilmadi" };
  if (!["draft", "needs_clarification"].includes(intake.status as string)) {
    return { ok: false, error: "Anketa tahrirlash uchun yopiq" };
  }

  const { data: question } = await admin
    .from("candidate_intake_questions")
    .select("id")
    .eq("template_id", intake.template_id)
    .eq("question_no", args.questionNo)
    .maybeSingle();
  if (!question) return { ok: false, error: "Savol topilmadi" };

  const { data: existing } = await admin
    .from("candidate_intake_answers")
    .select("id, lock_version, answer_state, rich_content, plain_text")
    .eq("intake_id", args.intakeId)
    .eq("question_id", question.id)
    .maybeSingle();

  // Optimistic concurrency: surface both versions on mismatch.
  if (existing && (existing.lock_version as number) !== args.lockVersion) {
    return {
      ok: false,
      conflict: true,
      server: {
        answer_state: existing.answer_state as string,
        rich_content: existing.rich_content,
        plain_text: existing.plain_text as string,
        lock_version: existing.lock_version as number,
      },
    };
  }

  const savedAt = new Date().toISOString();
  const rich = args.richContent ?? {};
  let answerId = existing?.id as string | undefined;

  /*
   * Nothing changed since the stored version: no UPDATE, no revision row, no
   * lock bump. Progress and last_autosave_at below are still recorded, so the
   * applicant's position and activity are tracked exactly as before.
   */
  const unchanged =
    existing !== null &&
    existing !== undefined &&
    answerSignature({
      answerState: existing.answer_state as string,
      plainText: (existing.plain_text as string) ?? "",
      richContent: existing.rich_content,
    }) === answerSignature({ answerState: args.answerState, plainText: args.plainText, richContent: rich });
  const newLock = unchanged
    ? (existing!.lock_version as number)
    : ((existing?.lock_version as number) ?? 0) + 1;

  if (existing && !unchanged) {
    const { data: updated, error } = await admin
      .from("candidate_intake_answers")
      .update({
        answer_state: args.answerState,
        rich_content: rich,
        plain_text: args.plainText,
        lock_version: newLock,
      })
      .eq("id", existing.id)
      .eq("lock_version", args.lockVersion)
      .select("id")
      .maybeSingle();
    if (error) return { ok: false, error: error.message };
    // A different device may have won between the initial SELECT and UPDATE.
    // Supabase treats an UPDATE matching zero rows as success, so explicitly
    // convert that race into the same optimistic-concurrency response.
    if (!updated) {
      return (await latestServerAnswer(admin, args.intakeId, question.id as string)) ?? {
        ok: false,
        error: "Javobning so‘nggi versiyasini yuklab bo‘lmadi",
      };
    }
  } else if (!existing) {
    const { data, error } = await admin
      .from("candidate_intake_answers")
      .insert({
        intake_id: args.intakeId,
        question_id: question.id,
        question_no: args.questionNo,
        answer_state: args.answerState,
        rich_content: rich,
        plain_text: args.plainText,
        lock_version: newLock,
      })
      .select("id")
      .single();
    if (error || !data) {
      // Simultaneous first saves can race on the canonical unique key. Return
      // the winning row as a conflict instead of losing either local draft.
      const conflict = await latestServerAnswer(admin, args.intakeId, question.id as string);
      return conflict ?? { ok: false, error: error?.message ?? "Saqlab bo‘lmadi" };
    }
    answerId = data.id as string;
  }

  const advanced = canAdvanceAnswer(args.answerState, args.plainText);
  /*
   * The answer row is written above; these three only depend on it, not on
   * each other (intake_progress reads the answers and the template, not the
   * progress columns), so they go out together instead of one after another.
   */
  const [, , prog] = await Promise.all([
    // Snapshot every save/edit that changed the answer.
    unchanged
      ? Promise.resolve()
      : admin.from("candidate_intake_answer_revisions").insert({
          intake_id: args.intakeId,
          answer_id: answerId,
          question_no: args.questionNo,
          answer_state: args.answerState,
          rich_content: rich,
          plain_text: args.plainText,
          source: args.source,
          edited_by: args.editedBy ?? null,
          lock_version: newLock,
        }),
    admin
      .from("candidate_intakes")
      .update({
        current_question_no: Math.max((intake.current_question_no as number) ?? 0, args.questionNo),
        last_completed_question_no: Math.max(
          (intake.last_completed_question_no as number) ?? 0,
          advanced ? args.questionNo : 0,
        ),
        last_autosave_at: savedAt,
      })
      .eq("id", args.intakeId),
    deps.progress(args.intakeId),
  ]);

  return {
    ok: true,
    answerId: answerId!,
    lockVersion: newLock,
    savedAt,
    progress: { answered: prog?.answered ?? 0, total: prog?.total ?? 0 },
  };
}
