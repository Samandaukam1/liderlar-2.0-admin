import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { slugify } from "@/lib/utils";

/**
 * "Bu odam avval chiqqanmi?" — saytning o'zidan so'raladi.
 *
 * Nomzod ikkinchi marta anketa to'ldirsa (yoki bir xil ism bilan yangi anketa
 * kelsa), qayta ishlash JONLI maqolani qaytadan yozib, o'sha odamni yangidek
 * qilib post qilib yuboradi. Shuning uchun nashrdan oldin tekshiriladi.
 *
 * Alohida modulda: uni ham batch (publish-batch.ts), ham avtomatik oqim
 * (pipeline.ts) chaqiradi, ular esa bir-birini import qiladi.
 */

export interface PublishedNamesake {
  candidateId: string;
  slug: string;
}

/**
 * The site's identity for a person is their slug: the publish flow derives
 * every candidate slug from `slugify(full_name)`, and the slug is unique among
 * live candidates. Asking by slug is therefore the same question the site
 * itself would answer — not a fuzzy guess at name similarity.
 *
 * `excludeCandidateId` is this intake's OWN candidate. An intake promoted
 * earlier matches its own slug, and that is continuation, not duplication.
 */
export async function findPublishedNamesake(
  fullName: string,
  excludeCandidateId: string | null,
): Promise<PublishedNamesake | null> {
  const slug = slugify(fullName);
  if (!slug) return null;

  const db = createSupabaseAdminClient();
  const { data, error } = await db
    .from("candidates")
    .select("id, slug")
    .eq("slug", slug)
    .eq("status", "published")
    .is("deleted_at", null)
    .maybeSingle();

  if (error) {
    // Fail LOUD but OPEN: a lookup failure must not silently green-light a
    // republish, so the caller sees null and the reason reaches the logs.
    console.error("[namesake] lookup failed", error.message);
    return null;
  }
  if (!data || (excludeCandidateId && data.id === excludeCandidateId)) return null;
  return { candidateId: data.id as string, slug: data.slug as string };
}

/** Message shown wherever a duplicate is held back. */
export const NAMESAKE_SKIP_MESSAGE =
  "Bu ismli nomzod avval chop etilgan — maqola qayta ishlanmadi.";
