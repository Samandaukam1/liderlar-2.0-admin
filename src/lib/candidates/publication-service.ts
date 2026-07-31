import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export interface PublicationReadiness {
  ready: boolean;
  errors: string[];
  warnings: string[];
}

export async function getCandidatePublicationReadiness(candidateId: string): Promise<PublicationReadiness> {
  const admin = createSupabaseAdminClient();
  const { data: candidate, error } = await admin
    .from("candidates")
    .select("id,full_name,slug,avatar_url,description_items,short_bio,deleted_at")
    .eq("id", candidateId)
    .maybeSingle();
  if (error) throw error;
  if (!candidate || candidate.deleted_at) return { ready: false, errors: ["Nomzod topilmadi"], warnings: [] };

  const [{ count: sectionCount }, { count: articleCount }] = await Promise.all([
    admin
      .from("candidate_sections")
      .select("id", { head: true, count: "exact" })
      .eq("candidate_id", candidateId),
    admin
      .from("articles")
      .select("id", { head: true, count: "exact" })
      .eq("candidate_id", candidateId)
      .is("deleted_at", null)
      .neq("content", ""),
  ]);

  const errors: string[] = [];
  const warnings: string[] = [];
  if (!String(candidate.full_name ?? "").trim()) errors.push("Ism-familiya kiritilmagan");
  if (!String(candidate.slug ?? "").trim()) errors.push("Slug kiritilmagan");
  if ((sectionCount ?? 0) + (articleCount ?? 0) < 1) errors.push("Hech bo‘lmasa bitta mazmunli biografik bo‘lim kerak");
  if (!String(candidate.avatar_url ?? "").trim()) warnings.push("Nomzod rasmi kiritilmagan");
  const descriptions = Array.isArray(candidate.description_items) ? candidate.description_items : [];
  if (descriptions.length === 0 && !String(candidate.short_bio ?? "").trim()) warnings.push("Qisqa tavsif kiritilmagan");
  return { ready: errors.length === 0, errors, warnings };
}
