import { NextResponse } from "next/server";
import { z } from "zod";
import { checkPermission } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { generateCertificatePdf } from "@/lib/certificates/generate";
import { resolveCertificateTargetUrl } from "@/lib/certificates/target-url";

// Font/QR/SVG rasterization needs real Node APIs (fs, sharp) — not Edge.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ candidateId: string }> };

const uuidSchema = z.string().uuid();

function certificateError(code: string, error: string, status: number): NextResponse {
  return NextResponse.json({ ok: false, code, error }, { status });
}

function safeFilenameSegment(input: string): string {
  const slug = input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return slug || "nomzod";
}

export async function GET(_request: Request, context: RouteContext) {
  const auth = await checkPermission("candidates.view");
  if (!auth) return certificateError("FORBIDDEN", "Ruxsat yo'q.", 403);

  const { candidateId } = await context.params;
  if (!uuidSchema.safeParse(candidateId).success) {
    return certificateError("INVALID_ID", "Nomzod ID noto'g'ri.", 400);
  }

  const admin = createSupabaseAdminClient();
  const { data: candidate, error } = await admin
    .from("candidates")
    .select("id, slug, full_name, status")
    .eq("id", candidateId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) {
    console.error("CERTIFICATE_CANDIDATE_LOOKUP_FAILED", { code: error.code, message: error.message });
    return certificateError("CANDIDATE_LOOKUP_FAILED", "Nomzodni tekshirib bo'lmadi.", 500);
  }
  if (!candidate) {
    return certificateError("CANDIDATE_NOT_FOUND", "Nomzod topilmadi.", 404);
  }
  if (!candidate.full_name?.trim()) {
    return certificateError("MISSING_NAME", "Nomzod ismi topilmagan.", 422);
  }

  let target: Awaited<ReturnType<typeof resolveCertificateTargetUrl>>;
  try {
    target = await resolveCertificateTargetUrl(candidate);
  } catch (err) {
    console.error("CERTIFICATE_TARGET_URL_FAILED", err instanceof Error ? err.message : err);
    return certificateError("TARGET_URL_FAILED", "Sertifikat manzilini aniqlab bo'lmadi.", 500);
  }
  if (!target.ok) {
    if (target.reason === "query-failed") {
      console.error("CERTIFICATE_TARGET_QUERY_FAILED", target.message);
      return certificateError("TARGET_URL_FAILED", "Sertifikat manzilini aniqlab bo'lmadi.", 500);
    }
    const message =
      target.reason === "missing-slug"
        ? "Nomzod nashr qilingan, lekin uning slug maydoni bo'sh — profilni tahrirlab slug kiriting."
        : "Sertifikat QR kodi uchun nomzodning public maqolasi yoki profili avval nashr qilinishi kerak.";
    return certificateError("NOT_PUBLISHED", message, 409);
  }

  let pdfBytes: Uint8Array;
  try {
    pdfBytes = await generateCertificatePdf({
      fullName: candidate.full_name,
      targetUrl: target.url,
      metadata: {
        title: `${candidate.full_name} — Liderlar.uz sertifikati`,
        author: "O'zbekiston Lider Yoshlar Ensiklopediyasi",
        subject: "Nomzodning rasmiy sertifikati",
        creator: "Liderlar.uz Certificate Generator",
      },
    });
  } catch (err) {
    console.error("CERTIFICATE_GENERATION_FAILED", err instanceof Error ? err.message : err);
    return certificateError("GENERATION_FAILED", "Sertifikat generatsiya qilishda xatolik.", 500);
  }

  void logAudit({
    actorId: auth.userId,
    action: "candidate.certificate.generated",
    entityType: "candidate",
    entityId: candidate.id,
    newValue: { full_name: candidate.full_name, target_url: target.url, source: target.source },
  });

  const filename = `${safeFilenameSegment(candidate.full_name)}-liderlar-sertifikati.pdf`;

  return new NextResponse(Buffer.from(pdfBytes), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
