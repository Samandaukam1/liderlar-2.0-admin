import type { NextRequest } from "next/server";
import { extractRawToken } from "@/lib/intake/tokens";
import {
  resolveActiveLink,
  loadPublicIntakeState,
  getIntakeSettings,
  touchLinkUsage,
} from "@/lib/intake/data";
import { enforceRateLimit } from "@/lib/intake/rate-limit";
import { clientIpHash, jsonError, noStoreJson, readJsonBody } from "@/lib/intake/http";

export const dynamic = "force-dynamic";

/** POST /api/intake/resolve — exchange a raw secure-link token for form state. */
export async function POST(request: NextRequest) {
  const rl = enforceRateLimit("resolve", clientIpHash(request.headers));
  if (!rl.ok) return jsonError(429, "Juda ko‘p urinish. Birozdan so‘ng qayta urining.", { retryAfterSeconds: rl.retryAfterSeconds });

  const body = await readJsonBody(request);
  const rawToken = extractRawToken(request.headers, body.token);
  if (!rawToken) return jsonError(400, "Havola topilmadi");

  const resolved = await resolveActiveLink(rawToken);
  if (!resolved) return jsonError(404, "Havola yaroqsiz yoki muddati tugagan");

  await touchLinkUsage(resolved.linkId);
  const [state, settings] = await Promise.all([
    loadPublicIntakeState(resolved.intakeId),
    getIntakeSettings(),
  ]);
  if (!state) return jsonError(404, "Anketa topilmadi");

  // Client never receives the intake id, token, or service key.
  return noStoreJson({
    ok: true,
    full_name: state.intake.full_name,
    status: state.intake.status,
    progress: {
      current: state.intake.current_question_no,
      lastCompleted: state.intake.last_completed_question_no,
    },
    contact: {
      phone: state.intake.phone_e164,
      telegram: state.intake.telegram_username,
      consent: state.intake.consent_given,
    },
    template: {
      intro: state.template.intro_text,
      photoTitle: state.template.photo_stage_title,
      photoInstruction: state.template.photo_stage_instruction,
      footer: state.template.footer_text,
      questions: state.template.questions.map((q) => ({
        question_no: q.question_no,
        prompt: q.prompt,
        help: q.help_text,
        required: q.is_required,
        allowNoAnswer: q.allow_no_answer,
      })),
    },
    answers: state.answers.map((a) => ({
      question_no: a.question_no,
      answer_state: a.answer_state,
      rich_content: a.rich_content,
      plain_text: a.plain_text,
      lock_version: a.lock_version,
    })),
    photo: state.primaryPhoto
      ? { file_name: state.primaryPhoto.file_name, url: state.primaryPhoto.signedUrl }
      : null,
    settings: {
      consentText: settings.consentText,
      consentVersion: settings.consentVersion,
      maxUploadBytes: settings.maxUploadBytes,
    },
    expiresAt: resolved.expiresAt,
  });
}
