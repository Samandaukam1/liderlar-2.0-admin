import type { NextRequest } from "next/server";
import { extractRawToken, hashIntakeToken } from "@/lib/intake/tokens";
import { resolveActiveLink, getIntakeSettings } from "@/lib/intake/data";
import {
  uploadIntakeFile,
  type IntakeUploadStage,
} from "@/lib/intake/attachments";
import { enforceRateLimit } from "@/lib/intake/rate-limit";
import { jsonError, noStoreJson, originAllowed } from "@/lib/intake/http";
import {
  normalizeUploadRequestId,
  serializePublicUploadAttachment,
} from "@/lib/intake/upload-response";

export const dynamic = "force-dynamic";

/** POST /api/intake/upload — token-gated file upload to the private bucket. */
export async function POST(request: NextRequest) {
  let stage = "start";
  const traceId = crypto.randomUUID();
  let attachmentPersisted = false;

  try {
    stage = "validate_request";
    if (!originAllowed(request.headers)) return jsonError(403, "Ruxsat etilmagan manba");

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return jsonError(400, "Fayl yuborilmadi");
    }

    const file = form.get("file");
    if (!(file instanceof File)) return jsonError(400, "Fayl topilmadi");
    const purpose = form.get("purpose") === "photo" ? "photo" : "attachment";
    const questionNoRaw = form.get("question_no");
    const questionNo = questionNoRaw != null ? Number(questionNoRaw) : null;
    const requestId = normalizeUploadRequestId(
      form.get("request_id"),
      crypto.randomUUID(),
    );

    stage = "verify_token";
    const rawToken = extractRawToken(request.headers, form.get("token"));
    if (!rawToken) return jsonError(400, "Havola topilmadi");

    const rateLimit = enforceRateLimit("upload", hashIntakeToken(rawToken));
    if (!rateLimit.ok) {
      return jsonError(429, "Yuklashlar juda tez-tez", {
        retryAfterSeconds: rateLimit.retryAfterSeconds,
      });
    }

    stage = "load_intake";
    const resolved = await resolveActiveLink(rawToken);
    if (!resolved) return jsonError(404, "Havola yaroqsiz yoki muddati tugagan");

    stage = "load_settings";
    const settings = await getIntakeSettings();

    stage = "validate_file";
    const fileBuffer = new Uint8Array(await file.arrayBuffer());
    const outcome = await uploadIntakeFile({
      intakeId: resolved.intakeId,
      bytes: fileBuffer,
      declaredMime: file.type,
      originalName: file.name,
      purpose,
      questionNo,
      maxBytes: settings.maxUploadBytes,
      uploadedBy: null,
      requestId,
      onStage(nextStage: IntakeUploadStage) {
        stage = nextStage;
      },
    });

    if (!outcome.ok) {
      if ((outcome.status ?? 400) >= 500) throw new Error(outcome.error);
      return jsonError(outcome.status ?? 400, outcome.error);
    }
    attachmentPersisted = true;

    stage = "build_response";
    const attachment = serializePublicUploadAttachment(outcome.attachment);
    return noStoreJson({ ok: true, attachment }, 201);
  } catch (error: unknown) {
    console.error(
      "INTAKE_UPLOAD_ERROR",
      JSON.stringify({
        traceId,
        stage,
        name: error instanceof Error ? error.name : "UnknownError",
        message: error instanceof Error ? error.message : String(error),
        stack:
          error instanceof Error
            ? error.stack?.split("\n").slice(0, 8).join("\n") ?? null
            : null,
      }),
    );

    return jsonError(
      500,
      attachmentPersisted
        ? "Fayl serverga yuklandi, ammo javobni qayta ishlashda muammo yuz berdi. Sahifani yangilang."
        : "Faylni serverga yuklashda muammo yuz berdi. Qayta urinib ko‘ring.",
      { traceId, attachmentPersisted },
    );
  }
}
