import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { recordAudit } from "@/lib/vip/audit-log";

/**
 * BIOGRAFIYA BO'LIMLARI — ADMIN KO'RIGI.
 *
 * A'zo profil muharririda yozgan biografiya matni. U o'z jadvalida
 * (`candidate_sections`) `pending_review` holatida turadi va
 * tasdiqlanmaguncha ommaviy biografiyada KO'RINMAYDI.
 *
 * NEGA TUZILGAN YOZUVLARDAN ALOHIDA XIZMAT: bu yerda ko'rilayotgan
 * narsa UZUN MATN — adminga sarlavha va to'liq matn ko'rsatiladi,
 * sana/havola ustunlari esa yo'q.
 */

export interface PendingSection {
  id: string;
  candidateId: string;
  candidateName: string;
  candidateSlug: string;
  title: string;
  content: string;
  createdAt: string;
}

/**
 * Ko'rik kutayotgan bo'limlar.
 *
 * ENG ESKI BIRINCHI: navbat tartibi odamlar kutgan vaqtga qarab
 * bo'lishi kerak, aks holda eski so'rovlar pastda qolib ketardi.
 */
export async function loadPendingSections(limit = 100): Promise<PendingSection[]> {
  const db = createSupabaseAdminClient();

  const { data, error } = await db
    .from("candidate_sections")
    .select("id, candidate_id, title, content, created_at, candidates(full_name, slug)")
    .eq("review_state", "pending_review")
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) {
    console.error("[bolim-korik] o'qilmadi:", error.message);
    return [];
  }

  return (data ?? []).map((row): PendingSection => {
    const candidate = row.candidates as { full_name?: string; slug?: string } | null;
    return {
      id: row.id as string,
      candidateId: row.candidate_id as string,
      candidateName: candidate?.full_name?.trim() || "(nomsiz)",
      candidateSlug: candidate?.slug ?? "",
      title: ((row.title as string | null) ?? "").trim(),
      content: ((row.content as string | null) ?? "").trim(),
      createdAt: row.created_at as string,
    };
  });
}

export type SectionReviewResult = { ok: true } | { ok: false; error: string };

/** Bo'limni tasdiqlaydi — ommaviy biografiyada ko'rinadi. */
export async function approveSection(
  sectionId: string,
  reviewerId: string,
  note: string | null,
): Promise<SectionReviewResult> {
  const db = createSupabaseAdminClient();
  const { data, error } = await db
    .from("candidate_sections")
    .update({
      review_state: "published",
      reviewed_by: reviewerId,
      reviewed_at: new Date().toISOString(),
      review_note: note?.trim() || null,
    })
    .eq("id", sectionId)
    /*
     * HOLAT SHARTI: faqat kutayotganini tasdiqlash mumkin.
     *
     * Ikki admin bir vaqtda bosgan bo'lsa, ikkinchisi hech narsa
     * yangilamaydi va "allaqachon ko'rilgan" javobini oladi — aks
     * holda ikkinchisining izohi birinchisining izohini bosib
     * ketardi.
     */
    .eq("review_state", "pending_review")
    .select("id, candidate_id, title")
    .maybeSingle();

  if (error) {
    console.error("[bolim-korik] tasdiqlanmadi:", error.message);
    return { ok: false, error: "Bo'limni tasdiqlab bo'lmadi." };
  }
  if (!data) {
    return { ok: false, error: "Bu bo'lim allaqachon ko'rib chiqilgan. Sahifani yangilang." };
  }

  await recordAudit("profile.section.approved", {
    actorId: reviewerId,
    entityId: data.candidate_id as string,
    reason: note?.trim() || null,
    metadata: { section_id: sectionId, title: (data.title as string | null) ?? null },
  });

  return { ok: true };
}

/**
 * Bo'limni qaytaradi.
 *
 * O'CHIRILMAYDI — `rejected` holatiga o'tadi. O'chirish odamning
 * yozganini yo'q qilardi va u nima yuborganini ham ko'rmasdi;
 * `rejected` holatida esa matn muharrirda izoh bilan turadi va
 * tuzatilishi mumkin.
 *
 * SABAB MAJBURIY (§27): foydalanuvchi nima tuzatishni bilishi kerak.
 */
export async function rejectSection(
  sectionId: string,
  reviewerId: string,
  note: string,
): Promise<SectionReviewResult> {
  const reason = note.trim();
  if (reason.length < 3) {
    return { ok: false, error: "Qaytarish sababini yozing (kamida 3 belgi)." };
  }

  const db = createSupabaseAdminClient();
  const { data, error } = await db
    .from("candidate_sections")
    .update({
      review_state: "rejected",
      reviewed_by: reviewerId,
      reviewed_at: new Date().toISOString(),
      review_note: reason,
    })
    .eq("id", sectionId)
    .eq("review_state", "pending_review")
    .select("id, candidate_id, title")
    .maybeSingle();

  if (error) {
    console.error("[bolim-korik] qaytarilmadi:", error.message);
    return { ok: false, error: "Bo'limni qaytarib bo'lmadi." };
  }
  if (!data) {
    return { ok: false, error: "Bu bo'lim allaqachon ko'rib chiqilgan. Sahifani yangilang." };
  }

  await recordAudit("profile.section.rejected", {
    actorId: reviewerId,
    entityId: data.candidate_id as string,
    reason,
    metadata: { section_id: sectionId, title: (data.title as string | null) ?? null },
  });

  return { ok: true };
}
