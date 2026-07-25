"use client";

import { useMemo } from "react";
import {
  IntakeForm,
  type IntakeTransport,
  type IntakeTemplateView,
  type IntakeAnswerView,
  type IntakeAttachmentView,
} from "@/components/intake/intake-form";
import { saveManualAnswerAction, submitManualIntakeAction } from "@/lib/actions/intakes";

/** Manual intake entry inside the admin panel — same engine, server-action transport. */
export function AdminIntakeEditor({
  intakeId,
  template,
  answers,
  photo,
  attachments,
  contact,
  consentText,
  maxUploadBytes,
}: {
  intakeId: string;
  template: IntakeTemplateView;
  answers: IntakeAnswerView[];
  photo: { url: string | null; file_name: string } | null;
  attachments: IntakeAttachmentView[];
  contact: { phone: string | null; telegram: string | null; consent: boolean };
  consentText: string;
  maxUploadBytes: number;
}) {
  const transport = useMemo<IntakeTransport>(
    () => ({
      async autosave(p) {
        const r = await saveManualAnswerAction(intakeId, {
          questionNo: p.question_no,
          answerState: p.answer_state,
          richContent: p.rich_content,
          plainText: p.plain_text,
          lockVersion: p.lock_version,
        });
        return {
          ok: r.ok,
          lock_version: r.lockVersion,
          conflict: r.conflict,
          server: r.server as AutosaveServer | undefined,
          error: r.error,
        };
      },
      async upload(file, opts) {
        const fd = new FormData();
        fd.set("file", file);
        fd.set("purpose", opts.purpose);
        if (opts.question_no != null) fd.set("question_no", String(opts.question_no));
        const res = await fetch(`/api/admin/intakes/${intakeId}/upload`, { method: "POST", body: fd });
        return res.json();
      },
      async submit(c) {
        const r = await submitManualIntakeAction(intakeId, c);
        return { ok: r.ok, errors: r.error ? [r.error] : undefined };
      },
      async heartbeat() {
        /* admin session heartbeat handled by the panel itself */
      },
    }),
    [intakeId],
  );

  return (
    <IntakeForm
      mode="admin"
      template={template}
      initialAnswers={answers}
      initialPhoto={photo}
      initialAttachments={attachments}
      initialContact={contact}
      consentText={consentText}
      maxUploadBytes={maxUploadBytes}
      draftKey={intakeId}
      transport={transport}
    />
  );
}

interface AutosaveServer {
  answer_state: string;
  rich_content: unknown;
  plain_text: string;
  lock_version: number;
}
