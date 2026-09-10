import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  CANONICAL_PUBLIC_SITE_URL,
  candidateArticlePath,
  isVercelDeploymentUrl,
  normalizeEnvPublicUrl,
  normalizePublicWebUrl,
  PUBLIC_WEB_SETTING_KEY,
} from "@/lib/public-site";

/**
 * Resolves the canonical public-site origin used for candidate article links.
 *
 * site_settings first (an admin can change it without a deploy), then the env
 * var, then the canonical domain. Cached briefly so a batch delivery does not
 * re-read it once per subscriber.
 *
 * This used to return null when nothing was configured, which held every post
 * at needs_review: liderlar.uz still served the OLD site and linking there
 * would have sent subscribers to the wrong page. Liderlar 2.0 now owns that
 * domain, so an unconfigured setting resolves to it instead of blocking.
 */

let cached: { value: string; at: number } | null = null;
const CACHE_MS = 60_000;

export async function resolvePublicWebUrl(): Promise<string> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;

  let fromSettings: string | null = null;
  try {
    const db = createSupabaseAdminClient();
    const { data } = await db
      .from("site_settings")
      .select("value")
      .eq("key", PUBLIC_WEB_SETTING_KEY)
      .maybeSingle();
    fromSettings = (data?.value as string | null) ?? null;
  } catch {
    // A settings read failure just leaves this source empty; the env var and
    // the canonical domain still answer.
    fromSettings = null;
  }

  /*
   * SOZLAMADAGI *.vercel.app QIYMATI HAM RAD ETILADI.
   *
   * Ilgari sozlama "inson qarori" deb hisoblanib, unga yozilgan har
   * qanday qiymat hamma narsadan ustun turardi. Amalda o'sha yerda
   * deploy manzili qolib ketgan edi va har bir post, sertifikat QR
   * kodi va Telegram sarlavhasi obunachilarga
   * `liderlar-2-0.vercel.app` havolasini yuborardi.
   *
   * `*.vercel.app` — infratuzilma manzili: u deploy'dan deploy'ga
   * o'zgaradi va saytning ommaviy shaxsi emas. Endi u qayerda
   * turishidan qat'i nazar tashlanadi va log'ga yoziladi, ya'ni
   * sozlamani tuzatish kerakligi ko'rinib turadi.
   */
  const settingValue = normalizePublicWebUrl(fromSettings);
  if (settingValue && isVercelDeploymentUrl(settingValue)) {
    console.warn(
      `[site-origin] ${PUBLIC_WEB_SETTING_KEY} sozlamasida deploy manzili turibdi ` +
        `(${settingValue}) — e'tiborsiz qoldirildi, ${CANONICAL_PUBLIC_SITE_URL} ishlatiladi.`,
    );
  }

  const value =
    (settingValue && !isVercelDeploymentUrl(settingValue) ? settingValue : null) ??
    normalizeEnvPublicUrl(process.env.NEXT_PUBLIC_PUBLIC_WEB_URL) ??
    normalizeEnvPublicUrl(process.env.NEXT_PUBLIC_SITE_URL) ??
    CANONICAL_PUBLIC_SITE_URL;

  cached = { value, at: Date.now() };
  return value;
}

/** Candidate article URL on the public site, or null when the slug is empty. */
export async function buildCandidateArticleUrl(slug: string): Promise<string | null> {
  if (!slug.trim()) return null;
  const base = await resolvePublicWebUrl();
  return `${base}${candidateArticlePath(slug)}`;
}
