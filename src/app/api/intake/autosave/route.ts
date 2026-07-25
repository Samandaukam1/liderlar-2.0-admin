import type { NextRequest } from "next/server";
import { extractRawToken, hashIntakeToken } from "@/lib/intake/tokens";
import { resolveActiveLink } from "@/lib/intake/data";
import { saveIntakeAnswer } from "@/lib/intake/answers";
import { autosaveSchema } from "@/lib/intake/schemas";
import { enforceRateLimit } from "@/lib/intake/rate-limit";
import { jsonError, noStoreJson, originAllowed, readJsonBody } from "@/lib/intake/http";

export const dynamic = "force-dynamic";

/** POST /api/intake/autosave — persist one answer (optimistic concurrency). */
export async function POST(request: NextRequest) {
  if (!originAllowed(request.headers)) return jsonError(403, "Ruxsat etilmagan manba");

  const body = await readJsonBody(request);
  const rawToken = extractRawToken(request.headers, body.token);
  if (!rawToken) return jsonError(400, "Havola topilmadi");

  // Per-link rate limit keyed by token HASH, never the raw token.
  const rl = enforceRateLimit("autosave", hashIntakeToken(rawToken));
  if (!rl.ok) return jsonError(429, "Juda tez saqlanmoqda", { retryAfterSeconds: rl.retryAfterSeconds });

  const parsed = autosaveSchema.safeParse({
    question_no: body.question_no,
    answer_state: body.answer_state,
    rich_content: body.rich_content,
    plain_text: body.plain_text,
    lock_version: body.lock_version,
  });
  if (!parsed.success) return jsonError(400, parsed.error.issues[0]?.message ?? "So‘rov noto‘g‘ri");

  // Bound payload size (rich_content can be arbitrary JSON).
  if (JSON.stringify(parsed.data.rich_content ?? {}).length > 200_000) {
    return jsonError(413, "Javob hajmi juda katta");
  }

  const resolved = await resolveActiveLink(rawToken);
  if (!resolved) return jsonError(404, "Havola yaroqsiz yoki muddati tugagan");

  const outcome = await saveIntakeAnswer({
    intakeId: resolved.intakeId,
    questionNo: parsed.data.question_no,
    answerState: parsed.data.answer_state,
    richContent: parsed.data.rich_content,
    plainText: parsed.data.plain_text,
    lockVersion: parsed.data.lock_version,
    source: "public",
    editedBy: null,
  });

  if (!outcome.ok) {
    if ("conflict" in outcome) {
      return noStoreJson({ ok: false, conflict: true, server: outcome.server }, 409);
    }
    return jsonError(400, outcome.error);
  }

  return noStoreJson({
    ok: true,
    lock_version: outcome.lockVersion,
    saved_at: outcome.savedAt,
    progress: outcome.progress,
  });
}
