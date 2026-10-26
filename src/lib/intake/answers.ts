import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { saveIntakeAnswerWith, type SaveAnswerArgs, type SaveAnswerOutcome } from "./answer-save-core";

export type { IntakeForSave, SaveAnswerArgs, SaveAnswerOutcome } from "./answer-save-core";

/**
 * Persists one answer with optimistic concurrency (lock_version), writes a
 * revision snapshot when the answer changed, and advances progress. Shared by
 * the public autosave route and the admin manual-entry flow. The logic lives
 * in answer-save-core.ts so it can be tested against a fake database.
 */
export function saveIntakeAnswer(args: SaveAnswerArgs): Promise<SaveAnswerOutcome> {
  const admin = createSupabaseAdminClient();
  return saveIntakeAnswerWith(
    {
      db: admin,
      progress: async (intakeId) =>
        (
          await admin
            .rpc("intake_progress", { p_intake: intakeId })
            .single<{ total: number; answered: number }>()
        ).data,
    },
    args,
  );
}
