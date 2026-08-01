import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSiteUrl } from "@/lib/site-url";

export interface CertificateCandidate {
  id: string;
  slug: string;
  status: string;
}

export type CertificateTargetResolution =
  | { ok: true; url: string; source: "article" | "candidate" }
  | { ok: false; reason: "not-published" }
  | { ok: false; reason: "missing-slug" }
  | { ok: false; reason: "query-failed"; message: string };

/**
 * QR target priority: a published article about the candidate first (a
 * fuller bio read), falling back to the candidate's own public profile.
 * Always returns *why* it couldn't resolve a target — a plain `null` here
 * previously collapsed "not published" and "published but slug is empty"
 * into the same UI state, which made a real data problem look identical to
 * normal pre-publish behavior.
 */
export async function resolveCertificateTargetUrl(
  candidate: CertificateCandidate
): Promise<CertificateTargetResolution> {
  const admin = createSupabaseAdminClient();
  const { data: article, error: articleError } = await admin
    .from("articles")
    .select("slug, published_at")
    .eq("candidate_id", candidate.id)
    .eq("status", "published")
    .is("deleted_at", null)
    .order("published_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (articleError) {
    return { ok: false, reason: "query-failed", message: articleError.message };
  }

  const siteUrl = getSiteUrl();

  if (article?.slug) {
    return { ok: true, url: `${siteUrl}/maqola/${encodeURIComponent(article.slug)}`, source: "article" };
  }
  if (candidate.status !== "published") {
    return { ok: false, reason: "not-published" };
  }
  if (!candidate.slug?.trim()) {
    return { ok: false, reason: "missing-slug" };
  }
  return { ok: true, url: `${siteUrl}/liderlar/${encodeURIComponent(candidate.slug)}`, source: "candidate" };
}
