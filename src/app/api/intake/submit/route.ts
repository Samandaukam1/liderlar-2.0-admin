import type { NextRequest } from "next/server";
import { extractRawToken, hashIntakeToken } from "@/lib/intake/tokens";
import { resolveActiveLink, getIntakeSettings } from "@/lib/intake/data";
import { validateContact } from "@/lib/intake/schemas";
import { enforceRateLimit } from "@/lib/intake/rate-limit";
import { clientIpHash, jsonError, noStoreJson, originAllowed, readJsonBody } from "@/lib/intake/http";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { canAdvanceAnswer, type AnswerState } from "@/lib/intake/constants";

export const dynamic = "force-dynamic";

/** POST /api/intake/submit — save final contact/consent then run the validation RPC. */
export async function POST(request: NextRequest) {
  if (!originAllowed(request.headers)) return jsonError(403, "Ruxsat etilmagan manba");

  const body = await readJsonBody(request);
  const rawToken = extractRawToken(request.headers, body.token);
  if (!rawToken) return jsonError(400, "Havola topilmadi");

  const rl = enforceRateLimit("submit", hashIntakeToken(rawToken));
  if (!rl.ok) return jsonError(429, "Juda ko‘p urinish", { retryAfterSeconds: rl.retryAfterSeconds });

  const contact = validateContact({
    phone: String(body.phone ?? ""),
    telegram: String(body.telegram ?? ""),
    consent: body.consent === true,
  });
  if (!contact.ok) return noStoreJson({ ok: false, errors: contact.errors }, 422);

  const resolved = await resolveActiveLink(rawToken);
  if (!resolved) return jsonError(404, "Havola yaroqsiz yoki muddati tugagan");

  const admin = createSupabaseAdminClient();
  const settings = await getIntakeSettings();

  const { data: intake } = await admin
    .from("candidate_intakes")
    .select("template_id, selected_photo_kind, photo_confirmed_at")
    .eq("id", resolved.intakeId)
    .maybeSingle();
  if (!intake) return jsonError(404, "Anketa topilmadi");

  const [
    { data: questions, error: questionsError },
    { data: answers, error: answersError },
    { data: primaryPhoto, error: primaryPhotoError },
  ] = await Promise.all([
    admin
      .from("candidate_intake_questions")
      .select("id")
      .eq("template_id", intake.template_id),
    admin
      .from("candidate_intake_answers")
      .select("question_id, answer_state, plain_text")
      .eq("intake_id", resolved.intakeId),
    admin
      .from("candidate_intake_attachments")
      .select("id")
      .eq("intake_id", resolved.intakeId)
      .eq("is_primary_photo", true)
      .eq("status", "active")
      .maybeSingle(),
  ]);
  if (questionsError || answersError || primaryPhotoError) {
    return jsonError(500, "Anketa validatsiyasini bajarib bo‘lmadi");
  }
  if (!questions?.length) return jsonError(500, "Anketa savollari topilmadi");

  const answerByQuestion = new Map(
    (answers ?? []).map((answer) => [answer.question_id as string, answer]),
  );
  const missingAnswers = (questions ?? []).filter((question) => {
    const answer = answerByQuestion.get(question.id as string);
    return (
      !answer ||
      !canAdvanceAnswer(
        answer.answer_state as AnswerState,
        (answer.plain_text as string) ?? "",
      )
    );
  }).length;
  if (missingAnswers > 0) {
    return noStoreJson(
      {
        ok: false,
        errors: [`${missingAnswers} ta savol javobsiz qolgan`],
      },
      422,
    );
  }

  const selectedKind = intake.selected_photo_kind as string | null;
  if (!primaryPhoto || !intake.photo_confirmed_at || !["original", "ai"].includes(selectedKind ?? "")) {
    return noStoreJson(
      { ok: false, errors: ["Original yoki AI rasmni tasdiqlash shart"] },
      422,
    );
  }
  if (selectedKind === "ai") {
    const { data: selectedEdit } = await admin
      .from("candidate_intake_photo_edits")
      .select("id")
      .eq("intake_id", resolved.intakeId)
      .eq("source_attachment_id", primaryPhoto.id)
      .eq("is_selected", true)
      .eq("status", "completed")
      .not("result_path", "is", null)
      .maybeSingle();
    if (!selectedEdit) {
      return noStoreJson(
        { ok: false, errors: ["Tasdiqlangan AI rasm topilmadi"] },
        422,
      );
    }
  }

  const { error: contactSaveError } = await admin
    .from("candidate_intakes")
    .update({
      phone_e164: contact.phone,
      telegram_username: contact.telegram,
      consent_given: true,
      consent_text_version: settings.consentVersion,
      consent_at: new Date().toISOString(),
      consent_ip_hash: clientIpHash(request.headers),
    })
    .eq("id", resolved.intakeId);
  if (contactSaveError) return jsonError(500, "Yakuniy ma’lumotlarni saqlab bo‘lmadi");

  const { data: result, error } = await admin.rpc("submit_candidate_intake", {
    p_intake: resolved.intakeId,
    p_actor: null,
  });
  if (error) return jsonError(500, "Yuborishda xatolik yuz berdi");

  const res = result as { ok: boolean; errors?: string[] };
  if (!res?.ok) return noStoreJson({ ok: false, errors: res?.errors ?? ["Yuborib bo‘lmadi"] }, 422);

  // A successful (re-)submission resolves any candidate-visible AI feedback.
  await admin
    .from("candidate_intake_ai_feedback")
    .update({ is_resolved: true })
    .eq("intake_id", resolved.intakeId)
    .eq("is_resolved", false);

  return noStoreJson({ ok: true });
}
