import type { NextRequest } from "next/server";
import { extractRawToken, hashIntakeToken } from "@/lib/intake/tokens";
import { resolveActiveLink, getIntakeSettings } from "@/lib/intake/data";
import { uploadIntakeFile } from "@/lib/intake/attachments";
import { enforceRateLimit } from "@/lib/intake/rate-limit";
import { jsonError, noStoreJson, originAllowed } from "@/lib/intake/http";

export const dynamic = "force-dynamic";

/** POST /api/intake/upload — token-gated file upload to the private bucket. */
export async function POST(request: NextRequest) {
  if (!originAllowed(request.headers)) return jsonError(403, "Ruxsat etilmagan manba");

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return jsonError(400, "Fayl yuborilmadi");
  }

  const rawToken = extractRawToken(request.headers, form.get("token"));
  if (!rawToken) return jsonError(400, "Havola topilmadi");

  const rl = enforceRateLimit("upload", hashIntakeToken(rawToken));
  if (!rl.ok) return jsonError(429, "Yuklashlar juda tez-tez", { retryAfterSeconds: rl.retryAfterSeconds });

  const file = form.get("file");
  if (!(file instanceof File)) return jsonError(400, "Fayl topilmadi");

  const purpose = form.get("purpose") === "photo" ? "photo" : "attachment";
  const questionNoRaw = form.get("question_no");
  const questionNo = questionNoRaw != null ? Number(questionNoRaw) : null;

  const resolved = await resolveActiveLink(rawToken);
  if (!resolved) return jsonError(404, "Havola yaroqsiz yoki muddati tugagan");

  const settings = await getIntakeSettings();
  const bytes = new Uint8Array(await file.arrayBuffer());

  const outcome = await uploadIntakeFile({
    intakeId: resolved.intakeId,
    bytes,
    declaredMime: file.type,
    originalName: file.name,
    purpose,
    questionNo,
    maxBytes: settings.maxUploadBytes,
    uploadedBy: null,
  });

  if (!outcome.ok) return jsonError(outcome.status ?? 400, outcome.error);
  return noStoreJson({ ok: true, attachment: outcome.attachment });
}
