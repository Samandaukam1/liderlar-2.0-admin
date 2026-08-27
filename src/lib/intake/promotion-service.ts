import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { normalizeCandidateIntake } from "@/lib/candidates/normalize-intake";
import { structureCandidateWithAi } from "@/lib/candidates/ai-service";
import { composeArticleSections } from "@/lib/candidates/article-quality";
import { serializeCandidateData } from "@/lib/candidates/serializer";
import { saveCandidateProfile, updateCandidateAiMetadata } from "@/lib/candidates/repository";
import { copyFinalPhotoToAvatar } from "@/lib/intake/promote";
import { getCandidatePublicationReadiness } from "@/lib/candidates/publication-service";
import { slugify } from "@/lib/utils";

/**
 * Intake -> candidate promotion and publication, lifted out of the server
 * actions so the automated 2-hour pipeline runs the identical steps with a null
 * actor instead of a signed-in admin. The actions keep the permission checks
 * and cache revalidation; only the work moved here.
 */

export interface IntakeActionResult {
  ok: boolean;
  error?: string;
  candidateId?: string;
  articleId?: string;
  slug?: string;
}

export async function promoteIntakeToDraft(intakeId: string, actorId: string | null): Promise<IntakeActionResult> {

  const admin = createSupabaseAdminClient();

  const { data: intake } = await admin
    .from("candidate_intakes")
    .select("full_name, status, short_bio, biography_draft, template_id")
    .eq("id", intakeId)
    .maybeSingle();
  if (!intake) return { ok: false, error: "Anketa topilmadi" };
  if (intake.status !== "approved") {
    return { ok: false, error: "Avval anketani tasdiqlang (approved)" };
  }

  const [{ data: answerRows, error: answersError }, { data: questionRows, error: questionsError }] = await Promise.all([
    admin
      .from("candidate_intake_answers")
      .select("question_no,plain_text,final_text,ai_improved_text")
      .eq("intake_id", intakeId)
      .order("question_no"),
    admin
      .from("candidate_intake_questions")
      .select("question_no,prompt")
      .eq("template_id", intake.template_id)
      .order("question_no"),
  ]);
  if (answersError || questionsError) return { ok: false, error: answersError?.message ?? questionsError?.message ?? "Anketa javoblarini yuklab bo‘lmadi" };

  const promptByNumber = new Map((questionRows ?? []).map((row) => [row.question_no as number, row.prompt as string]));
  const rawAnswers: Record<string, unknown> = {
    full_name: intake.full_name,
    short_bio: intake.short_bio,
    biography_draft: intake.biography_draft,
  };
  for (const answer of answerRows ?? []) {
    const prompt = promptByNumber.get(answer.question_no as number) ?? `question_${answer.question_no}`;
    rawAnswers[prompt] = answer.final_text || answer.ai_improved_text || answer.plain_text || "";
  }
  const normalized = normalizeCandidateIntake(rawAnswers);
  normalized.data.fullName = String(intake.full_name ?? normalized.data.fullName);

  await admin.from("candidate_intakes").update({ status: "ai_reviewing" }).eq("id", intakeId).eq("status", "approved");
  let aiResult: Awaited<ReturnType<typeof structureCandidateWithAi>>;
  try {
    aiResult = await structureCandidateWithAi({
      rawText: normalized.rawContent,
      current: normalized.data,
      actorId: actorId,
      intakeId,
    });
  } catch (error) {
    await admin.from("candidate_intakes").update({ status: "approved" }).eq("id", intakeId).eq("status", "ai_reviewing");
    return { ok: false, error: error instanceof Error ? `Jaxongir AI xatosi: ${error.message}` : "Jaxongir AI xatosi" };
  }
  await admin.from("candidate_intakes").update({ status: "approved" }).eq("id", intakeId).eq("status", "ai_reviewing");

  const avatarUrl = await copyFinalPhotoToAvatar(intakeId);
  const slug = slugify(intake.full_name as string);

  const { data, error } = await admin.rpc("promote_candidate_intake", {
    p_intake: intakeId,
    p_actor: actorId,
    p_publish: false,
    p_avatar_url: avatarUrl,
    p_slug: slug,
  });
  if (error) return { ok: false, error: error.message };
  const res = data as { candidate_id: string; article_id: string; candidate_slug: string };

  const structured = {
    ...normalized.data,
    candidateId: res.candidate_id,
    fullName: aiResult.data.fullName || String(intake.full_name),
    descriptionItems: aiResult.data.shortBioItems,
    birthYear: aiResult.data.birthYear,
    birthPlace: aiResult.data.birthPlace,
    currentLocation: aiResult.data.currentLocation,
    education: aiResult.data.education,
    activityField: aiResult.data.activityField,
    languages: aiResult.data.languages,
    sections: composeArticleSections({
      introduction: aiResult.data.introduction,
      sections: aiResult.data.sections,
      conclusion: aiResult.data.conclusion,
    }).map((section) => ({ ...section, id: crypto.randomUUID() })),
    profilePhoto: avatarUrl ?? "",
    slug: res.candidate_slug,
    rawContent: normalized.rawContent,
    formattedContent: "",
    unparsedContent: "",
  };
  structured.formattedContent = serializeCandidateData(structured);
  try {
    await saveCandidateProfile(structured, actorId);
    await updateCandidateAiMetadata(res.candidate_id, {
      status: "succeeded",
      model: aiResult.model,
      rawResponse: aiResult.rawResponse,
    });
    // Facts card + quality report drive the admin preview warnings; a failure
    // here must not undo a successfully saved article.
    await admin
      .from("candidates")
      .update({
        key_facts: aiResult.data.keyFacts,
        article_word_count: aiResult.quality.wordCount,
        fact_preservation_report: {
          score: aiResult.quality.score,
          word_count: aiResult.quality.wordCount,
          too_short: aiResult.quality.tooShort,
          below_target: aiResult.quality.belowTarget,
          regenerations: aiResult.regenerations,
          missing_facts: aiResult.quality.missingFacts.map((fact) => fact.value),
          repeated_facts: aiResult.quality.repeatedFacts.map((entry) => ({
            value: entry.fact.value,
            count: entry.count,
          })),
          weak_sections: aiResult.quality.weakSections,
          unresolved_issues: aiResult.data.unresolvedIssues,
        },
      })
      .eq("id", res.candidate_id);
  } catch (saveError) {
    return {
      ok: false,
      candidateId: res.candidate_id,
      error: saveError instanceof Error ? `Draft yaratildi, lekin strukturani saqlashda xato: ${saveError.message}` : "Draft strukturasi saqlanmadi",
    };
  }
  return { ok: true, candidateId: res.candidate_id, articleId: res.article_id, slug: res.candidate_slug };
}

export async function publishPromotedIntake(intakeId: string, actorId: string | null): Promise<IntakeActionResult> {

  const admin = createSupabaseAdminClient();

  const { data: intake } = await admin
    .from("candidate_intakes")
    .select("full_name, status, phone_e164, consent_given, candidate_id")
    .eq("id", intakeId)
    .maybeSingle();
  if (!intake) return { ok: false, error: "Anketa topilmadi" };
  if (intake.status !== "promoted" || !intake.candidate_id) {
    return { ok: false, error: "Avval anketani Jaxongir AI orqali draft nomzodga aylantirib, admin reviewdan o‘tkazing" };
  }
  if (!intake.consent_given) return { ok: false, error: "Rozilik tasdiqlanmagan — nashr etib bo‘lmaydi" };

  const avatarUrl = await copyFinalPhotoToAvatar(intakeId);
  if (!avatarUrl) return { ok: false, error: "Yakuniy portret rasm tanlanmagan" };
  const readiness = await getCandidatePublicationReadiness(intake.candidate_id as string);
  if (!readiness.ready) return { ok: false, error: readiness.errors.join(" · ") };
  const slug = slugify(intake.full_name as string);

  const { data, error } = await admin.rpc("promote_candidate_intake", {
    p_intake: intakeId,
    p_actor: actorId,
    p_publish: true,
    p_avatar_url: avatarUrl,
    p_slug: slug,
  });
  if (error) return { ok: false, error: error.message };
  const res = data as { candidate_id: string; article_id: string; candidate_slug: string };
  return { ok: true, candidateId: res.candidate_id, articleId: res.article_id, slug: res.candidate_slug };
}
