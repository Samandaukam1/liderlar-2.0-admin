"use client";

import { createSupabaseBrowserClient } from "@/lib/supabase/client";

/**
 * Reads an error out of a failed response. The body is not always JSON — a
 * platform-level rejection (413, 502, gateway HTML) arrives as plain text, and
 * blindly calling .json() on it produced the useless "Unexpected token 'R'".
 */
async function readError(res: Response) {
  const text = await res.text();
  try {
    const parsed = JSON.parse(text) as { error?: string };
    if (parsed.error) return parsed.error;
  } catch {
    /* not JSON — fall through to the raw text */
  }
  const trimmed = text.trim();
  if (res.status === 413) return "Fayl juda katta";
  return trimmed ? trimmed.slice(0, 200) : `Server xatosi (${res.status})`;
}

/**
 * Uploads a file to a storage bucket and returns the URL to persist.
 *
 * The bytes go browser → Supabase Storage directly via a short-lived signed
 * URL, so uploads are not limited by the serverless request body cap. The
 * server still authorises the upload and validates type/size up front, then
 * records the object in the media library on commit.
 */
export async function uploadToBucket(
  file: File,
  bucket: string,
  candidateId?: string | null,
): Promise<string> {
  const signRes = await fetch("/api/upload/sign", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      bucket,
      fileName: file.name,
      mimeType: file.type,
      size: file.size,
    }),
  });
  if (!signRes.ok) throw new Error(await readError(signRes));
  const { path, token } = (await signRes.json()) as { path: string; token: string };

  const supabase = createSupabaseBrowserClient();
  const { error } = await supabase.storage
    .from(bucket)
    .uploadToSignedUrl(path, token, file, { contentType: file.type });
  if (error) throw new Error(error.message);

  const commitRes = await fetch("/api/upload/commit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      bucket,
      path,
      fileName: file.name,
      mimeType: file.type,
      candidateId: candidateId ?? null,
    }),
  });
  if (!commitRes.ok) throw new Error(await readError(commitRes));
  const { url } = (await commitRes.json()) as { url?: string };
  if (!url) throw new Error("Fayl manzili olinmadi");
  return url;
}
