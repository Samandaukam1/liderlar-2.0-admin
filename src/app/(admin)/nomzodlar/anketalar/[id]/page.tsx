import Link from "next/link";
import { notFound } from "next/navigation";
import { PencilLine, Link2, ExternalLink } from "lucide-react";
import { requirePermission } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/admin/page-header";
import { StatusBadge, Badge } from "@/components/admin/badges";
import { Card } from "@/components/ui/primitives";
import { formatDate, timeAgo } from "@/lib/utils";
import { signIntakeFileUrl, getIntakeSettings } from "@/lib/intake/data";
import { AdminIntakeEditor } from "@/components/intake/admin-intake-editor";
import {
  IntakeReview,
  type AnswerFull,
  type FactPreservationView,
  type PhotoEditView,
} from "@/components/intake/intake-review";
import { LinkPanel } from "@/components/intake/link-panel";
import type {
  IntakeAnswerView,
  IntakeAttachmentView,
  IntakeTemplateView,
} from "@/components/intake/intake-form";

export const metadata = { title: "Anketa" };
export const dynamic = "force-dynamic";

export default async function IntakeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requirePermission("intakes.view");
  const { id } = await params;
  const admin = createSupabaseAdminClient();

  const { data: intake } = await admin.from("candidate_intakes").select("*").eq("id", id).maybeSingle();
  if (!intake || intake.deleted_at) notFound();

  const [{ data: tpl }, { data: questions }, { data: answers }, { data: attachments }, { data: edits }, { data: link }, settings] =
    await Promise.all([
      admin.from("candidate_intake_templates").select("*").eq("id", intake.template_id).maybeSingle(),
      admin.from("candidate_intake_questions").select("id, question_no, canonical_key, prompt, help_text, is_required, allow_no_answer, answer_type").eq("template_id", intake.template_id).order("question_no"),
      admin.from("candidate_intake_answers").select("*").eq("intake_id", id).order("question_no"),
      admin.from("candidate_intake_attachments").select("*").eq("intake_id", id).eq("status", "active"),
      admin.from("candidate_intake_photo_edits").select("*").eq("intake_id", id).order("created_at", { ascending: false }),
      admin.from("candidate_intake_links").select("token_prefix, expires_at").eq("intake_id", id).eq("status", "active").maybeSingle(),
      getIntakeSettings(),
    ]);

  const questionRows = (questions ?? []) as { id: string; question_no: number; canonical_key: string | null; prompt: string; help_text: string | null; is_required: boolean; allow_no_answer: boolean; answer_type: string }[];
  const answerRows = (answers ?? []) as Record<string, unknown>[];
  const attachmentRows = (attachments ?? []) as Record<string, unknown>[];
  const editRows = (edits ?? []) as Record<string, unknown>[];

  // answer_id -> question_no map for per-question attachments
  const qnoByAnswerId = new Map<string, number>();
  for (const a of answerRows) qnoByAnswerId.set(a.id as string, a.question_no as number);
  const promptByNo = new Map(questionRows.map((q) => [q.question_no, q.prompt]));

  // Sign all URLs in parallel
  const primaryRow = attachmentRows.find((a) => a.is_primary_photo === true);
  const nonPrimary = attachmentRows.filter((a) => a.is_primary_photo !== true);
  const [primaryUrl, attachmentUrls, editUrls] = await Promise.all([
    primaryRow ? signIntakeFileUrl(primaryRow.path as string) : Promise.resolve(null),
    Promise.all(nonPrimary.map((a) => signIntakeFileUrl(a.path as string))),
    Promise.all(editRows.map((e) => (e.result_path ? signIntakeFileUrl(e.result_path as string) : Promise.resolve(null)))),
  ]);

  const template: IntakeTemplateView = {
    intro: (tpl?.intro_text as string) ?? "",
    photoTitle: (tpl?.photo_stage_title as string) ?? "0-bosqich — Rasm",
    photoInstruction: (tpl?.photo_stage_instruction as string) ?? "",
    footer: (tpl?.footer_text as string) ?? "",
    questions: questionRows.map((q) => ({
      question_no: q.question_no,
      canonicalKey: q.canonical_key,
      prompt: q.prompt,
      help: q.help_text,
      required: q.is_required,
      allowNoAnswer: q.allow_no_answer,
    })),
  };

  const initialAnswers: IntakeAnswerView[] = answerRows.map((a) => ({
    question_no: a.question_no as number,
    answer_state: a.answer_state as IntakeAnswerView["answer_state"],
    rich_content: a.rich_content,
    plain_text: (a.plain_text as string) ?? "",
    lock_version: (a.lock_version as number) ?? 0,
  }));

  const attachmentViews: IntakeAttachmentView[] = nonPrimary.map((a, i) => ({
    id: a.id as string,
    file_name: a.file_name as string,
    mime_type: a.mime_type as string,
    kind: a.kind as string,
    size_bytes: (a.size_bytes as number) ?? 0,
    signedUrl: attachmentUrls[i],
    question_no: a.answer_id ? qnoByAnswerId.get(a.answer_id as string) ?? null : null,
  }));

  const primaryPhoto = primaryRow ? { url: primaryUrl, file_name: primaryRow.file_name as string } : null;

  const methodBadge =
    intake.intake_method === "manual" ? (
      <Badge accent="cyan"><PencilLine className="h-3 w-3" /> Qo‘lda</Badge>
    ) : (
      <Badge accent="lavender"><Link2 className="h-3 w-3" /> Havola</Badge>
    );

  const isManualDraft = intake.status === "draft" && intake.intake_method === "manual";
  const isSecureDraft = intake.status === "draft" && intake.intake_method === "secure_link";
  const isReview = ["submitted", "ai_reviewing", "needs_clarification", "approved", "promoted", "published"].includes(intake.status as string);

  const answersFull: AnswerFull[] = answerRows.map((a) => ({
    question_no: a.question_no as number,
    prompt: promptByNo.get(a.question_no as number) ?? "",
    plain_text: (a.plain_text as string) ?? "",
    ai_improved_text: (a.ai_improved_text as string) ?? null,
    ai_removed_segments: (a.ai_removed_segments as { text: string; reason: string }[]) ?? [],
    ai_fact_flags: (a.ai_fact_flags as { type: string; claim: string; explanation: string }[]) ?? [],
    ai_clarification_questions: (a.ai_clarification_questions as string[]) ?? [],
    ai_confidence: (a.ai_confidence as number) ?? null,
    // Answers improved before the fact check shipped have an empty object here;
    // treat those as "no report" rather than rendering a false all-clear.
    ai_fact_preservation:
      a.ai_fact_preservation && typeof (a.ai_fact_preservation as { ok?: unknown }).ok === "boolean"
        ? (a.ai_fact_preservation as FactPreservationView)
        : null,
    final_text: (a.final_text as string) ?? null,
    editor_state: (a.editor_state as string) ?? "pending",
    moderation_flagged: (a.moderation_flagged as boolean) ?? false,
  }));

  const photoEditViews: PhotoEditView[] = editRows.map((e, i) => ({
    id: e.id as string,
    url: editUrls[i],
    is_selected: (e.is_selected as boolean) ?? false,
    status: e.status as string,
    prompt: (e.prompt as string) ?? "",
  }));

  return (
    <>
      <PageHeader
        title={intake.full_name as string}
        breadcrumbs={[{ label: "Nomzod anketalari", href: "/nomzodlar/anketalar" }, { label: intake.full_name as string }]}
        actions={
          <div className="flex items-center gap-2">
            {methodBadge}
            <StatusBadge status={intake.status as string} />
          </div>
        }
      />

      {/* Timeline strip */}
      <Card className="mb-6 !p-4">
        <div className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
          <Info label="Yaratilgan" value={formatDate(intake.created_at as string)} />
          <Info label="Yuborilgan" value={intake.submitted_at ? formatDate(intake.submitted_at as string) : "—"} />
          <Info label="Oxirgi saqlash" value={intake.last_autosave_at ? timeAgo(intake.last_autosave_at as string) : "—"} />
          <Info label="Telefon / TG" value={`${intake.phone_e164 ?? "—"} · ${intake.telegram_username ?? "—"}`} />
        </div>
        {(intake.candidate_id || intake.article_id) && (
          <div className="mt-3 flex flex-wrap gap-3 border-t border-line pt-3 text-sm">
            {intake.candidate_id && (
              <Link href={`/candidates/${intake.candidate_id}`} className="inline-flex items-center gap-1 font-semibold text-brand hover:underline">
                <ExternalLink className="h-3.5 w-3.5" /> Nomzod profili
              </Link>
            )}
            {intake.article_id && (
              <Link href={`/articles`} className="inline-flex items-center gap-1 font-semibold text-brand hover:underline">
                <ExternalLink className="h-3.5 w-3.5" /> Biografik maqola
              </Link>
            )}
          </div>
        )}
      </Card>

      {/* Secure link management (any status for link method) */}
      {intake.intake_method === "secure_link" && (
        <div className="mb-6 max-w-md">
          <LinkPanel
            intakeId={id}
            link={link ? { prefix: link.token_prefix as string, expiresAt: link.expires_at as string } : null}
          />
        </div>
      )}

      {/* Body */}
      {isManualDraft && (
        <AdminIntakeEditor
          intakeId={id}
          template={template}
          answers={initialAnswers}
          photo={primaryPhoto}
          attachments={attachmentViews}
          contact={{ phone: intake.phone_e164 as string | null, telegram: intake.telegram_username as string | null, consent: intake.consent_given as boolean }}
          consentText={settings.consentText}
          maxUploadBytes={settings.maxUploadBytes}
        />
      )}

      {isSecureDraft && (
        <Card>
          <p className="text-sm text-ink-soft">
            Nomzod xavfsiz havola orqali anketani to‘ldirmoqda. Javoblar real vaqtda sinxronlanadi va yuborilgach shu
            yerda ko‘rib chiqish uchun ochiladi.
          </p>
          {answersFull.some((a) => a.plain_text) && (
            <div className="mt-4 space-y-2">
              {answersFull.filter((a) => a.plain_text).map((a) => (
                <div key={a.question_no} className="rounded-field border border-line bg-surface/40 p-3">
                  <p className="text-xs font-bold text-ink-soft">{a.question_no}. {a.prompt}</p>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-ink">{a.plain_text}</p>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {isReview && (
        <IntakeReview
          intakeId={id}
          status={intake.status as string}
          fullName={intake.full_name as string}
          answers={answersFull}
          original={primaryPhoto}
          photoEdits={photoEditViews}
          photoPrompts={{ default: settings.defaultPhotoPrompt, male: settings.malePhotoPrompt, female: settings.femalePhotoPrompt }}
          globalAi={{
            biography_draft: intake.biography_draft as string | null,
            short_bio: intake.short_bio as string | null,
            editorial_commentary: intake.editorial_commentary as string | null,
            moderation_summary: intake.moderation_summary as string | null,
            global_fact_conflicts: (intake.global_fact_conflicts as string[]) ?? [],
            ai_ready_for_review: (intake.ai_ready_for_review as boolean) ?? false,
          }}
        />
      )}
    </>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] font-bold uppercase tracking-wide text-ink-soft">{label}</p>
      <p className="mt-0.5 truncate text-ink">{value}</p>
    </div>
  );
}
