"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, Plus } from "lucide-react";
import { Badge } from "@/components/admin/badges";
import { ConfirmDialog, Modal } from "@/components/ui/overlays";
import { Button, FormField, Input, Textarea } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import type { TrustChoice } from "@/lib/profile-editor/certificate-trust";
import type { Accent } from "@/lib/statuses";
import { formatDate } from "@/lib/utils";
import { addActivityCertificateAction, deleteActivityCertificateAction, updateActivityCertificateAction } from "./activity-certificate-actions";
import { ActivityCertificateEvidence } from "./activity-certificate-evidence";

export interface ActivityCertificate {
  id: string;
  title: string;
  issuer: string | null;
  issued_on: string | null;
  expires_on: string | null;
  credential_number: string | null;
  credential_url: string | null;
  description?: string | null;
  evidence_url?: string | null;
  trust: TrustChoice | "pending_review";
  hasEvidence: boolean;
  updated_at: string;
}

const CERTIFICATE_STATUS: Record<ActivityCertificate["trust"], { label: string; accent: Accent }> = {
  pending_review: { label: "Tekshiruvda", accent: "amber" },
  user_entered: { label: "Foydalanuvchi kiritgan", accent: "brand" },
  verified: { label: "Tasdiqlangan", accent: "green" },
  rejected: { label: "Qaytarilgan", accent: "coral" },
};

export function ActivityCertificates({
  candidateId,
  canEdit,
  certificates,
}: {
  candidateId: string;
  canEdit: boolean;
  certificates: ActivityCertificate[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ActivityCertificate | null>(null);
  const [deleting, setDeleting] = useState<ActivityCertificate | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function closeForm() {
    if (!pending) setOpen(false);
  }

  function saveCertificate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const formData = new FormData(event.currentTarget);
    setError(null);
    startTransition(async () => {
      try {
        const result = editing
          ? await updateActivityCertificateAction(candidateId, editing.id, editing.updated_at, formData)
          : await addActivityCertificateAction(candidateId, formData);
        if (!result.ok) {
          setError(result.error ?? "Sertifikatni saqlab bo‘lmadi.");
          return;
        }
        setOpen(false);
        toast("success", editing ? "Sertifikat saqlandi" : "Sertifikat qo‘shildi");
        router.refresh();
      } catch {
        setError("Sertifikatni saqlab bo‘lmadi. Qayta urinib ko‘ring.");
      }
    });
  }

  function deleteCertificate() {
    if (!deleting || pending) return;
    startTransition(async () => {
      try {
        const result = await deleteActivityCertificateAction(candidateId, deleting.id, deleting.updated_at);
        if (!result.ok) {
          toast("error", "Sertifikat o‘chirilmadi", result.error);
          return;
        }
        setDeleting(null);
        toast("success", "Sertifikat o‘chirildi");
        router.refresh();
      } catch {
        toast("error", "Sertifikatni o‘chirib bo‘lmadi");
      }
    });
  }

  return (
    <section className="rounded-card border border-line bg-card p-5 shadow-card">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-bold text-ink">Sertifikatlar</h3>
        {canEdit && (
          <Button variant="ghost" size="sm" type="button" onClick={() => { setError(null); setEditing(null); setOpen(true); }}>
            <Plus className="h-4 w-4" aria-hidden="true" /> Qo‘shish
          </Button>
        )}
      </div>

      {certificates.length === 0 ? (
        <p className="py-3 text-sm text-ink-soft">Hozircha sertifikat yo‘q</p>
      ) : (
        <ul className="space-y-3">
          {certificates.map((certificate) => {
            const status = CERTIFICATE_STATUS[certificate.trust];
            return (
              <li key={certificate.id} className="rounded-[14px] border border-line/70 p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="break-words text-sm font-bold text-ink">{certificate.title}</p>
                    {certificate.issuer && <p className="break-words text-xs text-ink-soft">{certificate.issuer}</p>}
                  </div>
                  <Badge accent={status.accent}>{status.label}</Badge>
                </div>
                {(certificate.issued_on || certificate.expires_on || certificate.credential_number) && (
                  <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs">
                    {certificate.issued_on && (
                      <div>
                        <dt className="text-ink-soft">Berilgan sana</dt>
                        <dd className="font-semibold text-ink">{formatDate(certificate.issued_on)}</dd>
                      </div>
                    )}
                    {certificate.expires_on && (
                      <div>
                        <dt className="text-ink-soft">Amal qilish muddati</dt>
                        <dd className="font-semibold text-ink">{formatDate(certificate.expires_on)}</dd>
                      </div>
                    )}
                    {certificate.credential_number && (
                      <div className="min-w-0">
                        <dt className="text-ink-soft">Sertifikat raqami</dt>
                        <dd className="break-words font-semibold text-ink">{certificate.credential_number}</dd>
                      </div>
                    )}
                  </dl>
                )}
                {certificate.description && (
                  <p className="mt-2 whitespace-pre-wrap break-words text-xs text-ink-soft">{certificate.description}</p>
                )}
                {certificate.credential_url && /^https?:\/\//i.test(certificate.credential_url) && (
                  <a
                    href={certificate.credential_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-brand hover:underline"
                  >
                    Tekshirish havolasi <ExternalLink className="h-3 w-3" aria-hidden="true" />
                  </a>
                )}
                {canEdit && (
                  <div className="mt-2">
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" variant="secondary" size="sm" onClick={() => {
                        setError(null);
                        setEditing(certificate);
                        setOpen(true);
                      }}>Tahrirlash</Button>
                      <Button type="button" variant="ghost" size="sm" onClick={() => setDeleting(certificate)}>O‘chirish</Button>
                    </div>
                    <ActivityCertificateEvidence
                      candidateId={candidateId}
                      certificateId={certificate.id}
                      hasEvidence={certificate.hasEvidence}
                      legacyEvidenceUrl={certificate.evidence_url}
                    />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {canEdit && (
        <Modal open={open} onClose={closeForm} title={editing ? "Sertifikatni tahrirlash" : "Sertifikat qo‘shish"}>
          <form key={editing?.id ?? "new"} onSubmit={saveCertificate} className="space-y-4">
            <fieldset disabled={pending} className="space-y-4">
              <FormField label="Sertifikat nomi" htmlFor="activity-certificate-title">
                <Input id="activity-certificate-title" name="title" defaultValue={editing?.title ?? ""} required minLength={2} maxLength={300} />
              </FormField>
              <FormField label="Beruvchi tashkilot" htmlFor="activity-certificate-issuer">
                <Input id="activity-certificate-issuer" name="issuer" defaultValue={editing?.issuer ?? ""} maxLength={300} />
              </FormField>
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField label="Berilgan sana" htmlFor="activity-certificate-issued">
                  <Input id="activity-certificate-issued" name="issued_on" defaultValue={editing?.issued_on ?? ""} type="date" />
                </FormField>
                <FormField label="Amal qilish muddati" htmlFor="activity-certificate-expires">
                  <Input id="activity-certificate-expires" name="expires_on" defaultValue={editing?.expires_on ?? ""} type="date" />
                </FormField>
              </div>
              <FormField label="Sertifikat raqami" htmlFor="activity-certificate-number">
                <Input id="activity-certificate-number" name="credential_number" defaultValue={editing?.credential_number ?? ""} maxLength={160} />
              </FormField>
              <FormField label="Tekshirish havolasi" htmlFor="activity-certificate-url">
                <Input id="activity-certificate-url" name="credential_url" defaultValue={editing?.credential_url ?? ""} type="url" maxLength={1000} placeholder="https://" />
              </FormField>
              <FormField label="Izoh" htmlFor="activity-certificate-description">
                <Textarea id="activity-certificate-description" name="description" defaultValue={editing?.description ?? ""} maxLength={2000} rows={3} />
              </FormField>
            </fieldset>
            {editing && <p className="text-xs text-ink-soft">Ma’lumot o‘zgarsa, sertifikat qayta tekshiruvga yuboriladi.</p>}
            {error && <p role="alert" className="text-xs font-semibold text-[#a33232]">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" disabled={pending} onClick={closeForm}>
                Bekor qilish
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "Saqlanmoqda…" : "Saqlash"}
              </Button>
            </div>
          </form>
        </Modal>
      )}
      <ConfirmDialog
        open={canEdit && deleting !== null}
        onClose={() => { if (!pending) setDeleting(null); }}
        onConfirm={deleteCertificate}
        title="Sertifikatni o‘chirish"
        description={`“${deleting?.title ?? ""}” sertifikati va unga biriktirilgan dalil o‘chiriladi.`}
        confirmLabel="O‘chirish"
        loading={pending}
        danger
      />
    </section>
  );
}
