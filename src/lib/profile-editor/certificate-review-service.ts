import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { recordAudit } from "@/lib/vip/audit-log";
import { isTrustChoice } from "./certificate-trust";
import { describeEvidence } from "./evidence-rules";

/**
 * FOYDALANUVCHI SERTIFIKATLARI — ADMIN KO'RIGI.
 *
 * `certificates` jadvali bilan ARALASHTIRILMAYDI: u platforma
 * beradigan sertifikat va unda ommaviy tekshirish kodi bor. Bu yerdagi
 * yozuv — foydalanuvchining DA'VOSI.
 *
 * ADMIN UCH DARAJADAN BIRINI TANLAYDI:
 *
 *   verified     — mustaqil tekshirdi va tasdiqladi
 *   user_entered — ommaga ochdi, lekin tasdiqlamadi
 *                  (profilda "Foydalanuvchi kiritgan" deb chiqadi)
 *   rejected     — qaytardi
 *
 * `pending_review` ga QAYTARIB BO'LMAYDI: u boshlang'ich holat va
 * adminning qarori emas. Foydalanuvchi sertifikatni o'zgartirsa, u
 * o'zi qaytadan tekshiruvga tushadi.
 */

export interface PendingCertificate {
  id: string;
  candidateId: string;
  candidateName: string;
  title: string;
  issuer: string | null;
  issuedOn: string | null;
  expiresOn: string | null;
  credentialNumber: string | null;
  credentialUrl: string | null;
  description: string | null;
  /** Eski oqimdagi ommaviy dalil rasmi (faqat o'qish uchun). */
  evidenceUrl: string | null;
  /**
   * Yopiq bucketdagi dalil: "PDF · 1,2 MB". Fayl yo'li sahifaga
   * BERILMAYDI — havola server marshrutidan o'tadi va jurnalga yoziladi.
   */
  evidence: { label: string } | null;
  createdAt: string;
}

/**
 * Ko'rik kutayotgan sertifikatlar.
 *
 * ENG ESKI BIRINCHI: navbat odamlar kutgan vaqtga qarab bo'lishi
 * kerak.
 */
export async function loadPendingCertificates(limit = 100): Promise<PendingCertificate[]> {
  const db = createSupabaseAdminClient();

  const { data, error } = await db
    .from("candidate_certificates")
    .select(
      "id, candidate_id, title, issuer, issued_on, expires_on, credential_number, credential_url, description, evidence_url, created_at, candidates(full_name)",
    )
    .eq("trust", "pending_review")
    .order("created_at", { ascending: true })
    .limit(limit);

  /*
   * O'QISH XATOSI "NAVBAT BO'SH" EMAS.
   *
   * Bo'sh ro'yxat "hamma narsa ko'rib chiqilgan" degan yolg'on
   * xotirjamlik berardi — sahifa xato holatini ko'rsatadi.
   */
  if (error) {
    console.error("[sertifikat-korik] navbat o'qilmadi:", error.message);
    throw new Error("Sertifikatlar navbatini o'qib bo'lmadi.");
  }

  const rows = data ?? [];
  const evidence = new Map<string, { label: string }>();

  if (rows.length > 0) {
    const { data: files, error: evidenceError } = await db
      .from("certificate_evidence")
      .select("certificate_id, mime_type, size_bytes")
      .in(
        "certificate_id",
        rows.map((row) => row.id as string),
      );

    if (evidenceError) {
      console.error("[sertifikat-korik] dalillar o'qilmadi:", evidenceError.message);
      throw new Error("Sertifikat dalillarini o'qib bo'lmadi.");
    }

    for (const file of files ?? []) {
      evidence.set(file.certificate_id as string, {
        label: describeEvidence(file.mime_type as string, Number(file.size_bytes)),
      });
    }
  }

  return rows.map((row) => {
    const candidate = row.candidates as { full_name?: string } | null;
    return {
      id: row.id as string,
      candidateId: row.candidate_id as string,
      candidateName: candidate?.full_name?.trim() || "(nomsiz)",
      title: (row.title as string) ?? "",
      issuer: (row.issuer as string | null) ?? null,
      issuedOn: (row.issued_on as string | null) ?? null,
      expiresOn: (row.expires_on as string | null) ?? null,
      credentialNumber: (row.credential_number as string | null) ?? null,
      credentialUrl: (row.credential_url as string | null) ?? null,
      description: (row.description as string | null) ?? null,
      evidenceUrl: (row.evidence_url as string | null) ?? null,
      evidence: evidence.get(row.id as string) ?? null,
      createdAt: row.created_at as string,
    };
  });
}

export { TRUST_CHOICES, TRUST_LABEL, isTrustChoice } from "./certificate-trust";
export type { TrustChoice } from "./certificate-trust";

export type CertificateReviewResult = { ok: true } | { ok: false; error: string };

/**
 * Ishonch darajasini qo'yadi.
 *
 * SABAB `rejected` UCHUN MAJBURIY (§27): foydalanuvchi nima
 * tuzatishni bilishi kerak. Tasdiqlash uchun ixtiyoriy — "tasdiqlandi"
 * dan boshqa izoh kerak emas.
 */
export async function setCertificateTrust(
  certificateId: string,
  choice: unknown,
  reviewerId: string,
  note: string,
): Promise<CertificateReviewResult> {
  if (!isTrustChoice(choice)) {
    return { ok: false, error: "Ishonch darajasi tanlanmagan." };
  }

  const reason = note.trim();
  if (choice === "rejected" && reason.length < 3) {
    return { ok: false, error: "Qaytarish sababini yozing (kamida 3 belgi)." };
  }

  const db = createSupabaseAdminClient();
  const { data, error } = await db
    .from("candidate_certificates")
    .update({
      trust: choice,
      reviewed_by: reviewerId,
      reviewed_at: new Date().toISOString(),
      review_note: reason || null,
    })
    .eq("id", certificateId)
    /*
     * HOLAT SHARTI: faqat kutayotganini ko'rish mumkin.
     *
     * Ikki admin bir vaqtda bosgan bo'lsa, ikkinchisi hech narsa
     * yangilamaydi — aks holda uning qarori birinchisining qarorini
     * bosib ketardi.
     */
    .eq("trust", "pending_review")
    .select("id, candidate_id, title")
    .maybeSingle();

  if (error) {
    console.error("[sertifikat-korik] saqlanmadi:", error.message);
    return { ok: false, error: "Qarorni saqlab bo'lmadi." };
  }
  if (!data) {
    return {
      ok: false,
      error: "Bu sertifikat allaqachon ko'rib chiqilgan. Sahifani yangilang.",
    };
  }

  await recordAudit("profile.certificate.trust_set", {
    actorId: reviewerId,
    entityId: data.candidate_id as string,
    reason: reason || null,
    before: { trust: "pending_review" },
    after: { trust: choice },
    metadata: { certificate_id: certificateId, title: (data.title as string | null) ?? null },
  });

  return { ok: true };
}
