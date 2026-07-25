import sharp from "sharp";

const MAX_SOURCE_IMAGE_BYTES = 50 * 1024 * 1024;

export type SupportedImageMime = "image/jpeg" | "image/png" | "image/webp";

export function normalizeImageMime(value: string): SupportedImageMime {
  const mime = value.split(";")[0].trim().toLowerCase();

  if (mime === "image/jpg") return "image/jpeg";

  if (mime === "image/jpeg" || mime === "image/png" || mime === "image/webp") {
    return mime;
  }

  throw new Error(`Qo‘llab-quvvatlanmaydigan rasm turi: ${mime}`);
}

function detectImageMime(bytes: Uint8Array): SupportedImageMime | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

function imageExtension(mime: SupportedImageMime): "jpg" | "png" | "webp" {
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  return "jpg";
}

export function preparePhotoEditSource(params: {
  imageBytes: Uint8Array;
  mime: string;
}): {
  buffer: Buffer;
  mime: SupportedImageMime;
  fileName: string;
} {
  const buffer = Buffer.from(params.imageBytes);
  if (buffer.length === 0) throw new Error("Source image bo‘sh");
  if (buffer.length >= MAX_SOURCE_IMAGE_BYTES) {
    throw new Error("Source image hajmi 50 MB limitdan oshgan");
  }

  const declaredMime = params.mime.split(";")[0].trim().toLowerCase();
  if (!declaredMime.startsWith("image/")) {
    throw new Error(`Storage rasm o‘rniga ${declaredMime || "noma’lum MIME"} qaytardi`);
  }
  normalizeImageMime(declaredMime);

  const actualMime = detectImageMime(buffer);
  if (!actualMime) {
    const prefix = buffer.subarray(0, 512).toString("utf8").trimStart().toLowerCase();
    if (prefix.startsWith("<!doctype html") || prefix.startsWith("<html") || prefix.startsWith("{") || prefix.startsWith("[")) {
      throw new Error("Storage rasm o‘rniga HTML yoki JSON xato javobini qaytardi");
    }
    throw new Error("Source image formati fayl tarkibiga mos kelmadi");
  }

  const extension = imageExtension(actualMime);
  return {
    buffer,
    mime: actualMime,
    fileName: `candidate-source.${extension}`,
  };
}

export async function standardizePhotoEditSource(source: {
  buffer: Buffer;
  mime: SupportedImageMime;
  fileName: string;
}): Promise<{
  buffer: Buffer;
  mime: "image/png";
  fileName: "candidate-source.png";
}> {
  try {
    const buffer = await sharp(source.buffer, { failOn: "error" })
      .rotate()
      .flatten({ background: "#ffffff" })
      .toColourspace("srgb")
      .png()
      .toBuffer();
    return {
      buffer,
      mime: "image/png",
      fileName: "candidate-source.png",
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "unknown decode error";
    throw new Error(`Source image decode failed: ${message}`);
  }
}

export function decodeOpenAIImageEditResult(result: {
  data?: Array<{ b64_json?: string | null }> | null;
}): Buffer {
  const base64 = result.data?.[0]?.b64_json;
  if (!base64) {
    throw new Error("OpenAI image edit natijasida b64_json qaytmadi");
  }
  const outputBuffer = Buffer.from(base64, "base64");
  if (outputBuffer.length === 0) {
    throw new Error("OpenAI image edit natijasida b64_json bo‘sh qaytdi");
  }
  return outputBuffer;
}

export interface OpenAIImageEditErrorDetails {
  status?: number;
  code?: string;
  type?: string;
  message: string;
  param?: string;
  requestId?: string;
  moderationDetails?: unknown;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function extractOpenAIImageEditError(error: unknown): OpenAIImageEditErrorDetails {
  const err = asRecord(error);
  const nested = asRecord(err.error);
  return {
    status: typeof err.status === "number" ? err.status : undefined,
    code: optionalString(err.code) ?? optionalString(nested.code),
    type: optionalString(err.type) ?? optionalString(nested.type),
    message:
      optionalString(err.message) ??
      optionalString(nested.message) ??
      "Unknown OpenAI image edit error",
    param: optionalString(err.param) ?? optionalString(nested.param),
    requestId:
      optionalString(err.request_id) ??
      optionalString(err.requestID) ??
      optionalString(nested.request_id),
    moderationDetails: err.moderation_details ?? nested.moderation_details,
  };
}

export class OpenAIImageEditError extends Error {
  readonly details: OpenAIImageEditErrorDetails;

  constructor(error: unknown) {
    const details = extractOpenAIImageEditError(error);
    super(details.message);
    this.name = "OpenAIImageEditError";
    this.details = details;
  }
}

type SafeDiagnosticLogger = (event: string, payload: Record<string, unknown>) => void;

function defaultDiagnosticLogger(event: string, payload: Record<string, unknown>): void {
  console.error(event, JSON.stringify(payload));
}

export async function requestOpenAIImageEdit(params: {
  source: {
    buffer: Buffer;
    mime: SupportedImageMime;
    fileName: string;
  };
  model: string;
  prompt: string;
  apiKey?: string;
  diagnosticSource?: {
    mime: SupportedImageMime;
    bytes: number;
  };
  fetchImpl?: typeof fetch;
  log?: SafeDiagnosticLogger;
}): Promise<Buffer> {
  const log = params.log ?? defaultDiagnosticLogger;
  const diagnosticSource = params.diagnosticSource ?? {
    mime: params.source.mime,
    bytes: params.source.buffer.length,
  };
  if (!params.apiKey) {
    const error = new OpenAIImageEditError({
      code: "missing_api_key",
      message: "OPENAI_API_KEY sozlanmagan",
    });
    log("OPENAI_IMAGE_EDIT_ERROR", {
      status: null,
      message: error.details.message,
      type: null,
      code: error.details.code,
      param: null,
      requestId: null,
      model: params.model,
      sourceMime: diagnosticSource.mime,
      sourceBytes: diagnosticSource.bytes,
      promptChars: params.prompt.length,
    });
    throw error;
  }

  const formData = new FormData();
  const imageArrayBuffer = new ArrayBuffer(params.source.buffer.length);
  new Uint8Array(imageArrayBuffer).set(params.source.buffer);
  formData.append(
    "image",
    new Blob([imageArrayBuffer], { type: params.source.mime }),
    params.source.fileName,
  );
  formData.append("model", params.model);
  formData.append("prompt", params.prompt);
  formData.append("size", "1024x1536");
  formData.append("quality", "high");

  let response: Response;
  try {
    response = await (params.fetchImpl ?? fetch)("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${params.apiKey}`,
      },
      body: formData,
    });
  } catch (cause: unknown) {
    const error = new OpenAIImageEditError(cause);
    log("OPENAI_IMAGE_EDIT_ERROR", {
      status: null,
      message: error.details.message,
      type: error.details.type ?? null,
      code: error.details.code ?? null,
      param: error.details.param ?? null,
      requestId: error.details.requestId ?? null,
      model: params.model,
      sourceMime: diagnosticSource.mime,
      sourceBytes: diagnosticSource.bytes,
      promptChars: params.prompt.length,
    });
    throw error;
  }

  const rawBody = await response.text();
  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    body = { raw: rawBody.slice(0, 2000) };
  }

  const requestId = response.headers.get("x-request-id") ?? undefined;
  if (!response.ok) {
    const safeError = asRecord(asRecord(body).error);
    const error = new OpenAIImageEditError({
      status: response.status,
      message:
        optionalString(safeError.message) ??
        `OpenAI image edit failed with ${response.status}`,
      type: optionalString(safeError.type),
      code: optionalString(safeError.code),
      param: optionalString(safeError.param),
      request_id: requestId,
      moderation_details: safeError.moderation_details,
    });

    log("OPENAI_IMAGE_EDIT_ERROR", {
      status: response.status,
      message: optionalString(safeError.message) ?? null,
      type: optionalString(safeError.type) ?? null,
      code: optionalString(safeError.code) ?? null,
      param: optionalString(safeError.param) ?? null,
      requestId: requestId ?? null,
      model: params.model,
      sourceMime: diagnosticSource.mime,
      sourceBytes: diagnosticSource.bytes,
      promptChars: params.prompt.length,
    });
    throw error;
  }

  const responseRecord = asRecord(body);
  const data = Array.isArray(responseRecord.data)
    ? (responseRecord.data as Array<{ b64_json?: string | null }>)
    : undefined;
  if (!data?.[0]?.b64_json) {
    log("OPENAI_IMAGE_EDIT_EMPTY_RESULT", {
      requestId: requestId ?? null,
      keys: Object.keys(responseRecord),
    });
  }
  return decodeOpenAIImageEditResult({ data });
}

export function serializePhotoEditError(error: unknown): string {
  if (error instanceof OpenAIImageEditError) {
    return JSON.stringify({
      status: error.details.status ?? null,
      message: error.details.message.slice(0, 500),
      code: error.details.code ?? null,
      type: error.details.type ?? null,
      param: error.details.param ?? null,
      requestId: error.details.requestId ?? null,
    });
  }
  return error instanceof Error ? error.message.slice(0, 500) : "unknown";
}

export function photoEditErrorResponse(error: unknown): { status: number; message: string } {
  if (error instanceof OpenAIImageEditError) {
    if (error.details.code === "moderation_blocked") {
      return {
        status: 400,
        message:
          "Rasm yoki rasmni qayta ishlash ko‘rsatmasi xavfsizlik tekshiruvidan o‘tmadi. Boshqa rasm yoki neytralroq ko‘rsatma bilan qayta urinib ko‘ring.",
      };
    }
    if (error.details.status === 400) {
      return {
        status: 400,
        message: "Rasmni qayta ishlash so‘rovi noto‘g‘ri shakllangan. Administrator xabardor qilindi.",
      };
    }
  }
  return { status: 502, message: "Rasmni qayta ishlashda xatolik yuz berdi" };
}

export function assertStorageUploadSucceeded(error: { message?: string } | null): void {
  if (error) {
    throw new Error(`Storage upload failed: ${error.message || "unknown"}`);
  }
}
