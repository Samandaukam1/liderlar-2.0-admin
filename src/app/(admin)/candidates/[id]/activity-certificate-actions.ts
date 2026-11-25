"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { parseCalendarDate } from "@/lib/tashkent-day";
import { recordAudit } from "@/lib/vip/audit-log";
import { removeCertificateEvidenceObject } from "@/lib/candidates/certificate-evidence-upload";
import { refreshPublicProfiles } from "@/lib/public-profile-refresh";
import { isUuid } from "@/lib/profile-editor/evidence-rules";

const MAX_CERTIFICATES = 30;

function isCredentialUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

const certificateSchema = z.object({
  title: z.string().trim().min(2, "Sertifikat nomi juda qisqa.").max(300),
  issuer: z.string().trim().max(300).optional(),
  issued_on: z.string().trim()
    .refine((value) => !value || parseCalendarDate(value) !== null, "Berilgan sana noto‘g‘ri.")
    .optional(),
  expires_on: z.string().trim()
    .refine((value) => !value || parseCalendarDate(value) !== null, "Amal qilish muddati noto‘g‘ri.")
    .optional(),
  credential_number: z.string().trim().max(160).optional(),
  credential_url: z.string().trim().max(1000)
    .refine((value) => !value || isCredentialUrl(value), "Tekshirish havolasi HTTPS bo‘lishi kerak.")
    .optional(),
  description: z.string().trim().max(2000).optional(),
}).refine(({ issued_on, expires_on }) => !issued_on || !expires_on || issued_on <= expires_on, {
  message: "Amal qilish muddati berilgan sanadan oldin bo‘lmasin.",
  path: ["expires_on"],
});

function certificateFields(input: z.infer<typeof certificateSchema>) {
  return {
    title: input.title,
    issuer: input.issuer || null,
    issued_on: input.issued_on || null,
    expires_on: input.expires_on || null,
    credential_number: input.credential_number || null,
    credential_url: input.credential_url || null,
    description: input.description || null,
  };
}

export async function addActivityCertificateAction(
  candidateId: string,
  formData: FormData,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const ctx = await requirePermission("candidates.edit");
  if (!z.string().uuid().safeParse(candidateId).success) {
    return { ok: false, error: "Nomzod topilmadi." };
  }

  const parsed = certificateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Sertifikat ma’lumotlarini tekshiring." };
  }

  const admin = createSupabaseAdminClient();
  const [candidate, certificates] = await Promise.all([
    admin.from("candidates").select("id").eq("id", candidateId).is("deleted_at", null).maybeSingle(),
    admin.from("candidate_certificates").select("id", { count: "exact", head: true }).eq("candidate_id", candidateId),
  ]);
  if (candidate.error || certificates.error) {
    return { ok: false, error: "Hozir saqlab bo‘lmadi. Keyinroq urinib ko‘ring." };
  }
  if (!candidate.data) return { ok: false, error: "Nomzod topilmadi." };
  if ((certificates.count ?? 0) >= MAX_CERTIFICATES) {
    return { ok: false, error: `Sertifikatlar soni ${MAX_CERTIFICATES} tadan oshmasligi kerak.` };
  }

  const input = parsed.data;
  const { data, error } = await admin.from("candidate_certificates").insert({
    candidate_id: candidateId,
    submitted_by: null,
    ...certificateFields(input),
    trust: "pending_review",
  }).select("id").single();

  if (error || !data) return { ok: false, error: "Sertifikatni saqlab bo‘lmadi." };

  await recordAudit("profile.certificate.created", {
    actorId: ctx.userId,
    entityId: candidateId,
    after: { title: input.title, issuer: input.issuer || null, trust: "pending_review" },
    metadata: { certificate_id: data.id },
  });
  revalidatePath(`/candidates/${candidateId}`);
  revalidatePath("/profil-tahrirlari");
  return { ok: true, id: data.id };
}

export async function updateActivityCertificateAction(
  candidateId: string,
  certificateId: string,
  updatedAt: string,
  formData: FormData,
) {
  const ctx = await requirePermission("candidates.edit");
  if (!isUuid(candidateId) || !isUuid(certificateId) || !z.iso.datetime({ offset: true }).safeParse(updatedAt).success) {
    return { ok: false, error: "Sertifikat topilmadi." };
  }
  const parsed = certificateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Ma’lumotlarni tekshiring." };

  const fields = certificateFields(parsed.data);
  const db = createSupabaseAdminClient();
  const { data: previous, error: readError } = await db.from("candidate_certificates")
    .select("title, issuer, issued_on, expires_on, credential_number, credential_url, description, trust")
    .eq("id", certificateId).eq("candidate_id", candidateId).eq("updated_at", updatedAt).maybeSingle();
  if (readError || !previous) return { ok: false, error: "Sertifikat yangilangan yoki topilmadi. Sahifani yangilang." };
  if (Object.entries(fields).every(([key, value]) => previous[key as keyof typeof previous] === value)) return { ok: true };

  const { data, error } = await db.from("candidate_certificates")
    .update({ ...fields, trust: "pending_review", reviewed_at: null, reviewed_by: null, review_note: null })
    .eq("id", certificateId).eq("candidate_id", candidateId).eq("updated_at", updatedAt).select("id").maybeSingle();
  if (error || !data) return { ok: false, error: "Sertifikatni saqlab bo‘lmadi. Sahifani yangilang." };

  await recordAudit("profile.certificate.updated", {
    actorId: ctx.userId, entityId: candidateId,
    before: { title: previous.title, trust: previous.trust },
    after: { title: fields.title, trust: "pending_review" }, metadata: { certificate_id: certificateId },
  });
  refreshCertificateViews(candidateId);
  return { ok: true };
}

export async function deleteActivityCertificateAction(candidateId: string, certificateId: string, updatedAt: string) {
  const ctx = await requirePermission("candidates.edit");
  if (!isUuid(candidateId) || !isUuid(certificateId) || !z.iso.datetime({ offset: true }).safeParse(updatedAt).success) {
    return { ok: false, error: "Sertifikat topilmadi." };
  }
  const db = createSupabaseAdminClient();
  const { data: evidence, error: evidenceError } = await db.from("certificate_evidence")
    .select("path").eq("certificate_id", certificateId).eq("candidate_id", candidateId).maybeSingle();
  if (evidenceError) return { ok: false, error: "Dalil ma’lumotini o‘qib bo‘lmadi." };

  const { data, error } = await db.from("candidate_certificates").delete()
    .eq("id", certificateId).eq("candidate_id", candidateId).eq("updated_at", updatedAt)
    .select("title, trust").maybeSingle();
  if (error || !data) return { ok: false, error: "Sertifikatni o‘chirib bo‘lmadi. Sahifani yangilang." };
  if (typeof evidence?.path === "string") await removeCertificateEvidenceObject(db, evidence.path, candidateId, certificateId);

  await recordAudit("profile.certificate.deleted", {
    actorId: ctx.userId, entityId: candidateId,
    before: { title: data.title, trust: data.trust },
    metadata: { certificate_id: certificateId, had_evidence: Boolean(evidence) },
  });
  refreshCertificateViews(candidateId);
  return { ok: true };
}

function refreshCertificateViews(candidateId: string) {
  revalidatePath(`/candidates/${candidateId}`);
  revalidatePath("/profil-tahrirlari");
  refreshPublicProfiles([candidateId]);
}
