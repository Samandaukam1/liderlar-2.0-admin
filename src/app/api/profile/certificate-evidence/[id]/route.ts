import { NextResponse } from "next/server";
import { checkPermission } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { recordAudit } from "@/lib/vip/audit-log";
import {
  EVIDENCE_BUCKET,
  EVIDENCE_LINK_SECONDS,
  evidenceDownloadName,
  isUuid,
} from "@/lib/profile-editor/evidence-rules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/profile/certificate-evidence/<sertifikat id>
 *
 * Tahririyat xodimini yopiq bucketdagi dalilga 60 soniyalik imzolangan
 * havola orqali yo'naltiradi.
 *
 * RUXSAT: `candidates.edit` — sertifikatni tasdiqlash huquqi bor
 * xodim. Ko'rish huquqi (`candidates.view`) yetmaydi: dalilda shaxsiy
 * ma'lumot bo'lishi mumkin va uni faqat qaror qiladigan odam ochadi.
 *
 * Har bir ochish jurnalga yoziladi (`profile.certificate.evidence_viewed`).
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const notFound = () =>
    NextResponse.json(
      { error: "Dalil topilmadi." },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );

  const ctx = await checkPermission("candidates.edit");
  if (!ctx) {
    return NextResponse.json(
      { error: "Ruxsat yo'q." },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  }

  const { id } = await context.params;
  if (!isUuid(id)) return notFound();

  const db = createSupabaseAdminClient();
  const { data, error } = await db
    .from("certificate_evidence")
    .select("path, mime_type, candidate_id")
    .eq("certificate_id", id.toLowerCase())
    .maybeSingle();

  if (error) {
    console.error("[dalil] o'qilmadi:", error.message);
    return NextResponse.json(
      { error: "Dalilni o'qib bo'lmadi." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (!data) return notFound();

  const { data: signed, error: signError } = await db.storage
    .from(EVIDENCE_BUCKET)
    .createSignedUrl(data.path as string, EVIDENCE_LINK_SECONDS, {
      download: evidenceDownloadName(data.mime_type as string),
    });

  if (signError || !signed) {
    console.error("[dalil] havola berilmadi:", signError?.message);
    return notFound();
  }

  await recordAudit("profile.certificate.evidence_viewed", {
    actorId: ctx.userId,
    entityId: data.candidate_id as string,
    metadata: { certificate_id: id.toLowerCase() },
  });

  return NextResponse.redirect(signed.signedUrl, {
    status: 303,
    headers: {
      // Imzoli havola keshda va "Referer" sarlavhasida qolmasin.
      "Cache-Control": "private, no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
}
