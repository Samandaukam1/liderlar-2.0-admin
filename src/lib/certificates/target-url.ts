import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSiteUrl } from "@/lib/site-url";

export interface CertificateCandidate {
  id: string;
  slug: string;
  status: string;
}

export interface CertificateTargetUrl {
  url: string;
  source: "article" | "candidate";
}

/**
 * QR target priority: a published article about the candidate first (a
 * fuller bio read), falling back to the candidate's own public profile.
 * Returns null when neither is publicly reachable yet — the caller should
 * block certificate generation in that case (see the 409 in the API route).
 */
export async function resolveCertificateTargetUrl(
  candidate: CertificateCandidate
): Promise<CertificateTargetUrl | null> {
  const admin = createSupabaseAdminClient();
  const { data: article } = await admin
    .from("articles")
    .select("slug, published_at")
    .eq("candidate_id", candidate.id)
    .eq("status", "published")
    .is("deleted_at", null)
    .order("published_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const siteUrl = getSiteUrl();

  if (article?.slug) {
    return { url: `${siteUrl}/maqola/${encodeURIComponent(article.slug)}`, source: "article" };
  }
  if (candidate.status === "published" && candidate.slug) {
    return { url: `${siteUrl}/liderlar/${encodeURIComponent(candidate.slug)}`, source: "candidate" };
  }
  return null;
}
