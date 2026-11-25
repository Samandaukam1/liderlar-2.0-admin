import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { checkPermission } from "@/lib/auth";
import {
  readCertificateEvidenceReceipt,
  removeCertificateEvidenceObject,
  signCertificateEvidenceReceipt,
} from "@/lib/candidates/certificate-evidence-upload";
import {
  buildEvidencePath,
  EVIDENCE_BUCKET,
  EVIDENCE_TYPE_ERROR,
  isUuid,
  matchesEvidenceBytes,
  validEvidenceMeta,
  validEvidencePath,
} from "@/lib/profile-editor/evidence-rules";
import { refreshPublicProfiles } from "@/lib/public-profile-refresh";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { recordAudit } from "@/lib/vip/audit-log";

type Params = { candidateId: string; certificateId: string };
type Context = { params: Promise<Params> };
type Admin = ReturnType<typeof createSupabaseAdminClient>;

const requestSchema = z.discriminatedUnion("step", [
  z.object({ step: z.literal("sign"), mimeType: z.string(), size: z.number() }),
  z.object({ step: z.literal("confirm"), receipt: z.string().max(1900) }),
]);
const privateHeaders = { "Cache-Control": "private, no-store" };

function fail(error: string, status: number) {
  return Response.json({ error }, { status, headers: privateHeaders });
}

async function currentEvidencePath(admin: Admin, { candidateId, certificateId }: Params) {
  const { data, error } = await admin.from("certificate_evidence")
    .select("path")
    .eq("candidate_id", candidateId)
    .eq("certificate_id", certificateId)
    .maybeSingle<{ path: string }>();
  if (error) throw error;
  return data?.path ?? null;
}

export async function POST(request: Request, context: Context) {
  const ctx = await checkPermission("candidates.edit");
  if (!ctx) return fail("Ruxsat yo‘q.", 403);

  const { candidateId, certificateId } = await context.params;
  if (!isUuid(candidateId) || !isUuid(certificateId)) return fail("Sertifikat topilmadi.", 404);
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") {
    return fail("So‘rov formati noto‘g‘ri.", 415);
  }
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail("So‘rov ma’lumotlari noto‘g‘ri.", 400);

  try {
    const admin = createSupabaseAdminClient();
    const storage = admin.storage.from(EVIDENCE_BUCKET);
    const input = parsed.data;

    if (input.step === "sign") {
      if (!validEvidenceMeta(input.mimeType, input.size)) return fail(EVIDENCE_TYPE_ERROR, 400);
      const { data: certificate, error: lookupError } = await admin.from("candidate_certificates")
        .select("id")
        .eq("id", certificateId)
        .eq("candidate_id", candidateId)
        .maybeSingle();
      if (lookupError) throw lookupError;
      if (!certificate) return fail("Sertifikat topilmadi.", 404);

      const previousPath = await currentEvidencePath(admin, { candidateId, certificateId });
      const path = buildEvidencePath(candidateId, certificateId, randomUUID(), input.mimeType);
      if (!path) return fail(EVIDENCE_TYPE_ERROR, 400);
      const { data, error } = await storage.createSignedUploadUrl(path);
      if (error) throw error;

      const receipt = signCertificateEvidenceReceipt({
        path, previousPath, mimeType: input.mimeType, size: input.size,
      }, ctx.userId);
      return Response.json({ ok: true, path, token: data.token, receipt }, { headers: privateHeaders });
    }

    const receipt = readCertificateEvidenceReceipt(input.receipt, ctx.userId);
    if (!receipt || !validEvidencePath(receipt.path, candidateId, certificateId)) {
      return fail("Yuklash muddati tugagan yoki tasdiq noto‘g‘ri. Faylni qayta tanlang.", 400);
    }

    const { data: blob, error: downloadError } = await storage.download(receipt.path);
    if (downloadError) throw downloadError;
    const header = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
    if (
      blob.size !== receipt.size ||
      blob.type.split(";")[0].trim() !== receipt.mimeType ||
      !matchesEvidenceBytes(header, receipt.mimeType)
    ) {
      await removeCertificateEvidenceObject(admin, receipt.path, candidateId, certificateId);
      return fail("Fayl mazmuni tanlangan tur yoki hajmga mos kelmadi.", 400);
    }

    const current = await currentEvidencePath(admin, { candidateId, certificateId });
    if (current === receipt.path) {
      return Response.json({ ok: true }, { headers: privateHeaders });
    }
    if (current !== receipt.previousPath) {
      await removeCertificateEvidenceObject(admin, receipt.path, candidateId, certificateId);
      return fail("Dalil boshqa oynada yangilangan. Qaytadan urinib ko‘ring.", 409);
    }

    // The existing cabinet RPC locks the certificate, replaces evidence, and resets its review.
    const { data: oldPath, error: attachError } = await admin.rpc("attach_certificate_evidence", {
      p_certificate_id: certificateId,
      p_candidate_id: candidateId,
      p_profile_id: ctx.userId,
      p_path: receipt.path,
      p_mime: receipt.mimeType,
      p_size: receipt.size,
    });
    if (attachError?.code === "P0002") {
      await removeCertificateEvidenceObject(admin, receipt.path, candidateId, certificateId);
      return fail("Sertifikat topilmadi.", 404);
    }
    if (attachError) throw attachError;
    if (typeof oldPath === "string" && oldPath !== receipt.path) {
      await removeCertificateEvidenceObject(admin, oldPath, candidateId, certificateId);
    }

    await recordAudit("profile.certificate.evidence_attached", {
      actorId: ctx.userId,
      entityId: candidateId,
      after: { mime_type: receipt.mimeType, size_bytes: receipt.size },
      metadata: { certificate_id: certificateId, replaced: Boolean(oldPath) },
    });
    revalidatePath(`/candidates/${candidateId}`);
    revalidatePath("/profil-tahrirlari");
    refreshPublicProfiles([candidateId]);
    return Response.json({ ok: true }, { headers: privateHeaders });
  } catch (error) {
    console.error("[admin certificate evidence] upload failed:", error);
    return fail("Dalilni yuklab bo‘lmadi. Qaytadan urinib ko‘ring.", 500);
  }
}
