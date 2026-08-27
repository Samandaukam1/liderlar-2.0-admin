import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * Storage helpers for Post Studio assets.
 *
 * Everything lives in the public `candidate-post-assets` bucket under a
 * per-candidate prefix. The candidate's original photo is never touched: the
 * transparent cut-out and the rendered post are separate objects, so a re-run
 * can always start from the untouched source again.
 */

export const POST_ASSET_BUCKET = "candidate-post-assets";

export type PostAssetKind = "portrait-transparent" | "render" | "thumbnail";

const EXTENSIONS: Record<PostAssetKind, { ext: string; contentType: string }> = {
  "portrait-transparent": { ext: "png", contentType: "image/png" },
  render: { ext: "png", contentType: "image/png" },
  thumbnail: { ext: "webp", contentType: "image/webp" },
};

export function postAssetPath(candidateId: string, kind: PostAssetKind): string {
  return `${candidateId}/${kind}.${EXTENSIONS[kind].ext}`;
}

/**
 * Uploads (replacing any previous version) and returns a cache-busted public
 * URL — the path is stable per candidate, so without the version query the
 * admin would keep seeing a stale render after a re-render.
 */
export async function uploadPostAsset(
  candidateId: string,
  kind: PostAssetKind,
  body: Buffer,
): Promise<string> {
  const db = createSupabaseAdminClient();
  const path = postAssetPath(candidateId, kind);

  const { error } = await db.storage.from(POST_ASSET_BUCKET).upload(path, body, {
    contentType: EXTENSIONS[kind].contentType,
    upsert: true,
  });
  if (error) throw new Error(`Post asset upload failed (${kind}): ${error.message}`);

  const { data } = db.storage.from(POST_ASSET_BUCKET).getPublicUrl(path);
  return `${data.publicUrl}?v=${Date.now()}`;
}

/** Fetches an asset back as a buffer (used when re-sending an existing post). */
export async function downloadPostAsset(
  candidateId: string,
  kind: PostAssetKind,
): Promise<Buffer | null> {
  const db = createSupabaseAdminClient();
  const { data, error } = await db.storage
    .from(POST_ASSET_BUCKET)
    .download(postAssetPath(candidateId, kind));

  if (error || !data) return null;
  return Buffer.from(await data.arrayBuffer());
}
