/**
 * Per-bucket upload constraints, shared by the signing and commit routes.
 *
 * These limits are enforced server-side before a signed upload URL is handed
 * out. The browser then uploads straight to Supabase Storage, so nothing here
 * is bounded by the platform's request body limit (Vercel caps serverless
 * request bodies at ~4.5 MB, which is far below several of these buckets).
 */
export interface BucketRule {
  maxBytes: number;
  mime: string[];
  isPublic: boolean;
}

export const BUCKET_RULES: Record<string, BucketRule> = {
  "candidate-avatars": {
    maxBytes: 4 * 1024 * 1024,
    mime: ["image/jpeg", "image/png", "image/webp"],
    isPublic: true,
  },
  "candidate-gallery": {
    maxBytes: 8 * 1024 * 1024,
    mime: ["image/jpeg", "image/png", "image/webp"],
    isPublic: true,
  },
  "monthly-update-media": {
    maxBytes: 15 * 1024 * 1024,
    mime: ["image/jpeg", "image/png", "image/webp", "application/pdf"],
    isPublic: false,
  },
  "journal-covers": {
    maxBytes: 6 * 1024 * 1024,
    mime: ["image/jpeg", "image/png", "image/webp"],
    isPublic: true,
  },
  "journal-pdfs": {
    maxBytes: 50 * 1024 * 1024,
    mime: ["application/pdf"],
    isPublic: false,
  },
  "podcast-media": {
    maxBytes: 10 * 1024 * 1024,
    mime: ["image/jpeg", "image/png", "image/webp", "audio/mpeg"],
    isPublic: true,
  },
  "application-files": {
    maxBytes: 15 * 1024 * 1024,
    mime: ["image/jpeg", "image/png", "image/webp", "application/pdf"],
    isPublic: false,
  },
  "admin-private-files": {
    maxBytes: 25 * 1024 * 1024,
    mime: ["image/jpeg", "image/png", "image/webp", "application/pdf", "text/csv"],
    isPublic: false,
  },
  "ai-assistant": {
    maxBytes: 20 * 1024 * 1024,
    mime: [
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/gif",
      "image/svg+xml",
      "video/mp4",
      "video/webm",
    ],
    isPublic: true,
  },
  "corner-video": {
    maxBytes: 40 * 1024 * 1024,
    mime: ["image/jpeg", "image/png", "image/webp", "video/mp4", "video/webm"],
    isPublic: true,
  },
};

/** Validates a proposed upload, returning an Uzbek error message when rejected. */
export function validateUpload(
  bucket: string,
  mimeType: string,
  size: number,
): { rule: BucketRule } | { error: string } {
  const rule = BUCKET_RULES[bucket];
  if (!rule) return { error: "Noto‘g‘ri bucket" };
  if (!rule.mime.includes(mimeType)) {
    return { error: `Fayl turi qo‘llab-quvvatlanmaydi (${mimeType || "noma’lum"})` };
  }
  if (!Number.isFinite(size) || size <= 0) {
    return { error: "Fayl bo‘sh yoki o‘lchami noma’lum" };
  }
  if (size > rule.maxBytes) {
    return { error: `Fayl juda katta (maksimum ${Math.round(rule.maxBytes / 1024 / 1024)} MB)` };
  }
  return { rule };
}

/** Storage object key: month-prefixed folder plus a random, extension-preserving name. */
export function buildObjectPath(fileName: string) {
  const ext = fileName.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || "bin";
  return `${new Date().toISOString().slice(0, 7)}/${crypto.randomUUID()}.${ext}`;
}
