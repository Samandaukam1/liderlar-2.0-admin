import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { recordAudit } from "@/lib/vip/audit-log";

/**
 * TUZILGAN YOZUVLAR — ADMIN KO'RIGI.
 *
 * Foydalanuvchi profil muharririda qo'shgan ta'lim, ish tajribasi,
 * yutuq va tadbir yozuvlari. Ular o'z jadvalida `pending_review`
 * holatida turadi va tasdiqlanmaguncha ommaviy profilda
 * KO'RINMAYDI.
 *
 * NEGA ALOHIDA XIZMAT: `candidate_profile_edits` navbati
 * `candidates` USTUNLARI uchun — u yerda eski/yangi qiymat juftligi
 * bor, qator yo'q. Bu yerda esa ko'rilayotgan narsa qatorning o'zi.
 */

/**
 * Ko'rik qilinadigan jadvallar.
 *
 * FAQAT `review` siyosatidagi turlar. `books_read` va `social_links`
 * darhol nashr bo'ladi, ya'ni ularda kutayotgan yozuv paydo
 * bo'lmaydi — ro'yxatga qo'shish bo'sh so'rovlar qilardi.
 */
const REVIEWED_KINDS = [
  "education",
  "work_experiences",
  "achievements",
  "events",
] as const;

export type ReviewedKind = (typeof REVIEWED_KINDS)[number];

const KIND_LABEL: Readonly<Record<ReviewedKind, string>> = {
  education: "Ta'lim",
  work_experiences: "Ish tajribasi",
  achievements: "Yutuqlar",
  events: "Tadbirlar",
};

export function isReviewedKind(value: unknown): value is ReviewedKind {
  return typeof value === "string" && (REVIEWED_KINDS as readonly string[]).includes(value);
}

export interface PendingEntry {
  id: string;
  kind: ReviewedKind;
  kindLabel: string;
  candidateId: string;
  candidateName: string;
  title: string;
  subtitle: string | null;
  description: string | null;
  dateFrom: string | null;
  dateTo: string | null;
  url: string | null;
  createdAt: string;
}

/**
 * Barcha kutayotgan yozuvlar — to'rtta jadvaldan.
 *
 * Har jadval alohida so'rov: PostgREST turli jadvallarni bitta
 * so'rovda birlashtirmaydi. Ular parallel ketadi va natija vaqt
 * bo'yicha saralanadi — admin uchun muhimi "kim uzoq kutgan",
 * qaysi jadvalda turgani emas.
 */
export async function loadPendingEntries(limit = 100): Promise<PendingEntry[]> {
  const db = createSupabaseAdminClient();

  const results = await Promise.all(
    REVIEWED_KINDS.map(async (kind) => {
      const { data, error } = await db
        .from(kind)
        .select(
          "id, candidate_id, title, subtitle, description, date_from, date_to, url, created_at, candidates(full_name)",
        )
        .eq("review_state", "pending_review")
        .order("created_at", { ascending: true })
        .limit(limit);

      if (error) {
        console.error("[yozuv-korik] o'qilmadi:", { kind, message: error.message });
        return [] as PendingEntry[];
      }

      return (data ?? []).map((row): PendingEntry => {
        const candidate = row.candidates as { full_name?: string } | null;
        return {
          id: row.id as string,
          kind,
          kindLabel: KIND_LABEL[kind],
          candidateId: row.candidate_id as string,
          candidateName: candidate?.full_name?.trim() || "(nomsiz)",
          title: (row.title as string) ?? "",
          subtitle: (row.subtitle as string | null) ?? null,
          description: (row.description as string | null) ?? null,
          dateFrom: (row.date_from as string | null) ?? null,
          dateTo: (row.date_to as string | null) ?? null,
          url: (row.url as string | null) ?? null,
          createdAt: row.created_at as string,
        };
      });
    }),
  );

  // Eng uzoq kutgan birinchi.
  return results
    .flat()
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .slice(0, limit);
}

export type EntryReviewResult = { ok: true } | { ok: false; error: string };

/**
 * Yozuvni tasdiqlaydi — ommaviy profilda ko'rinadi.
 */
export async function approveEntry(
  kind: unknown,
  entryId: string,
  reviewerId: string,
  note: string | null,
): Promise<EntryReviewResult> {
  if (!isReviewedKind(kind)) return { ok: false, error: "Bo'lim noto'g'ri." };

  const db = createSupabaseAdminClient();
  const { data, error } = await db
    .from(kind)
    .update({
      review_state: "published",
      reviewed_by: reviewerId,
      reviewed_at: new Date().toISOString(),
      review_note: note?.trim() || null,
    })
    .eq("id", entryId)
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
    console.error("[yozuv-korik] tasdiqlanmadi:", { kind, message: error.message });
    return { ok: false, error: "Yozuvni tasdiqlab bo'lmadi." };
  }
  if (!data) {
    return {
      ok: false,
      error: "Bu yozuv allaqachon ko'rib chiqilgan. Sahifani yangilang.",
    };
  }

  await recordAudit("profile.entry.approved", {
    actorId: reviewerId,
    entityId: data.candidate_id as string,
    reason: note?.trim() || null,
    metadata: { kind, entry_id: entryId, title: (data.title as string | null) ?? null },
  });

  return { ok: true };
}

/**
 * Yozuvni qaytaradi.
 *
 * O'CHIRILMAYDI — `rejected` holatiga o'tadi. O'chirish odamning
 * yozganini yo'q qilardi va u nima yuborganini ham ko'rmasdi;
 * `rejected` holatida esa u muharrirda izoh bilan turadi va
 * tuzatilishi mumkin.
 *
 * SABAB MAJBURIY (§27): foydalanuvchi nima tuzatishni bilishi kerak.
 */
export async function rejectEntry(
  kind: unknown,
  entryId: string,
  reviewerId: string,
  note: string,
): Promise<EntryReviewResult> {
  if (!isReviewedKind(kind)) return { ok: false, error: "Bo'lim noto'g'ri." };

  const reason = note.trim();
  if (reason.length < 3) {
    return { ok: false, error: "Qaytarish sababini yozing (kamida 3 belgi)." };
  }

  const db = createSupabaseAdminClient();
  const { data, error } = await db
    .from(kind)
    .update({
      review_state: "rejected",
      reviewed_by: reviewerId,
      reviewed_at: new Date().toISOString(),
      review_note: reason,
    })
    .eq("id", entryId)
    .eq("review_state", "pending_review")
    .select("id, candidate_id, title")
    .maybeSingle();

  if (error) {
    console.error("[yozuv-korik] qaytarilmadi:", { kind, message: error.message });
    return { ok: false, error: "Yozuvni qaytarib bo'lmadi." };
  }
  if (!data) {
    return {
      ok: false,
      error: "Bu yozuv allaqachon ko'rib chiqilgan. Sahifani yangilang.",
    };
  }

  await recordAudit("profile.entry.rejected", {
    actorId: reviewerId,
    entityId: data.candidate_id as string,
    reason,
    metadata: { kind, entry_id: entryId, title: (data.title as string | null) ?? null },
  });

  return { ok: true };
}
