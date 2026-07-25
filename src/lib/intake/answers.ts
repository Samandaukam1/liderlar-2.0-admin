import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { canAdvanceAnswer, type AnswerState } from "./constants";

export interface SaveAnswerArgs {
  intakeId: string;
  questionNo: number;
  answerState: AnswerState;
  richContent: unknown;
  plainText: string;
  lockVersion: number;
  source: "public" | "admin" | "clarification";
  editedBy?: string | null;
}

export type SaveAnswerOutcome =
  | { ok: true; answerId: string; lockVersion: number; savedAt: string; progress: { answered: number; total: number } }
  | {
      ok: false;
      conflict: true;
      server: { answer_state: string; rich_content: unknown; plain_text: string; lock_version: number };
    }
  | { ok: false; error: string };

/**
 * Persists one answer with optimistic concurrency (lock_version), writes a
 * revision snapshot, and advances progress. Shared by the public autosave route
 * and the admin manual-entry flow.
 */
export async function saveIntakeAnswer(args: SaveAnswerArgs): Promise<SaveAnswerOutcome> {
  const admin = createSupabaseAdminClient();

  const { data: intake } = await admin
    .from("candidate_intakes")
    .select("id, template_id, status, current_question_no, last_completed_question_no")
    .eq("id", args.intakeId)
    .is("deleted_at", null)
    .maybeSingle();
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

  const newLock = ((existing?.lock_version as number) ?? 0) + 1;
  const savedAt = new Date().toISOString();
  const rich = args.richContent ?? {};
  let answerId = existing?.id as string | undefined;

  if (existing) {
    const { error } = await admin
      .from("candidate_intake_answers")
      .update({
        answer_state: args.answerState,
        rich_content: rich,
        plain_text: args.plainText,
        lock_version: newLock,
      })
      .eq("id", existing.id)
      .eq("lock_version", args.lockVersion);
    if (error) return { ok: false, error: error.message };
  } else {
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
    if (error || !data) return { ok: false, error: error?.message ?? "Saqlab bo‘lmadi" };
    answerId = data.id as string;
  }

  // Snapshot every save/edit.
  await admin.from("candidate_intake_answer_revisions").insert({
    intake_id: args.intakeId,
    answer_id: answerId,
    question_no: args.questionNo,
    answer_state: args.answerState,
    rich_content: rich,
    plain_text: args.plainText,
    source: args.source,
    edited_by: args.editedBy ?? null,
    lock_version: newLock,
  });

  const advanced = canAdvanceAnswer(args.answerState, args.plainText);
  await admin
    .from("candidate_intakes")
    .update({
      current_question_no: Math.max((intake.current_question_no as number) ?? 0, args.questionNo),
      last_completed_question_no: Math.max(
        (intake.last_completed_question_no as number) ?? 0,
        advanced ? args.questionNo : 0,
      ),
      last_autosave_at: savedAt,
    })
    .eq("id", args.intakeId);

  const { data: prog } = await admin
    .rpc("intake_progress", { p_intake: args.intakeId })
    .single<{ total: number; answered: number }>();

  return {
    ok: true,
    answerId: answerId!,
    lockVersion: newLock,
    savedAt,
    progress: { answered: prog?.answered ?? 0, total: prog?.total ?? 0 },
  };
}
