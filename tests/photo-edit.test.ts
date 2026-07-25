import { test } from "node:test";
import assert from "node:assert/strict";
import {
  OpenAIImageEditError,
  assertStorageUploadSucceeded,
  buildOpenAIImageEditRequest,
  decodeOpenAIImageEditResult,
  photoEditErrorResponse,
  preparePhotoEditSource,
} from "../src/lib/intake/photo-edit.ts";

const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

test("JPG manba MIME va extension bilan mos tayyorlanadi", () => {
  const source = preparePhotoEditSource({ imageBytes: JPEG_BYTES, mime: "image/jpg; charset=binary" });
  assert.equal(source.mime, "image/jpeg");
  assert.equal(source.fileName, "candidate-source.jpg");
});

test("PNG manba MIME va extension bilan mos tayyorlanadi", () => {
  const source = preparePhotoEditSource({ imageBytes: PNG_BYTES, mime: "image/png" });
  assert.equal(source.mime, "image/png");
  assert.equal(source.fileName, "candidate-source.png");
});

test("fayl tarkibi haqiqiy MIME sifatida ishlatiladi", () => {
  const source = preparePhotoEditSource({ imageBytes: JPEG_BYTES, mime: "image/png" });
  assert.equal(source.mime, "image/jpeg");
  assert.equal(source.fileName, "candidate-source.jpg");
});

test("noto‘g‘ri MIME va HTML javob rad etiladi", () => {
  assert.throws(
    () =>
      preparePhotoEditSource({
        imageBytes: Buffer.from("<html>storage error</html>"),
        mime: "text/html",
      }),
    /Storage rasm o‘rniga text\/html qaytardi/,
  );
});

test("image MIME bilan yashirilgan HTML yoki JSON rad etiladi", () => {
  assert.throws(
    () =>
      preparePhotoEditSource({
        imageBytes: Buffer.from('{"error":"storage denied"}'),
        mime: "image/jpeg",
      }),
    /HTML yoki JSON xato javobini qaytardi/,
  );
});

test("bo‘sh source image rad etiladi", () => {
  assert.throws(
    () => preparePhotoEditSource({ imageBytes: new Uint8Array(), mime: "image/jpeg" }),
    /Source image bo‘sh/,
  );
});

test("gpt-image-2 request faqat minimal parametrlarni yuboradi", () => {
  const request = buildOpenAIImageEditRequest({
    model: "gpt-image-2",
    image: "file",
    prompt: "portrait",
  });
  assert.deepEqual(request, {
    model: "gpt-image-2",
    image: "file",
    prompt: "portrait",
    size: "1024x1536",
    quality: "high",
  });
  assert.equal("input_fidelity" in request, false);
  assert.equal("response_format" in request, false);
  assert.equal("background" in request, false);
});

test("OpenAI 400 foydalanuvchiga xavfsiz xabar qaytaradi", () => {
  const error = new OpenAIImageEditError({
    status: 400,
    code: "invalid_value",
    type: "invalid_request_error",
    message: "Unsupported parameter",
    requestID: "req_123",
  });
  assert.deepEqual(photoEditErrorResponse(error), {
    status: 400,
    message: "Rasmni qayta ishlash so‘rovi noto‘g‘ri shakllangan. Administrator xabardor qilindi.",
  });
  assert.equal(error.details.requestId, "req_123");
});

test("moderation_blocked tushunarli xabar qaytaradi", () => {
  const error = new OpenAIImageEditError({
    status: 400,
    error: {
      code: "moderation_blocked",
      type: "image_generation_user_error",
      message: "blocked",
      moderation_details: { moderation_stage: "input" },
    },
  });
  assert.deepEqual(photoEditErrorResponse(error), {
    status: 400,
    message:
      "Rasm yoki rasmni qayta ishlash ko‘rsatmasi xavfsizlik tekshiruvidan o‘tmadi. Boshqa rasm yoki neytralroq ko‘rsatma bilan qayta urinib ko‘ring.",
  });
  assert.deepEqual(error.details.moderationDetails, { moderation_stage: "input" });
});

test("muvaffaqiyatli b64_json Buffer ga aylantiriladi", () => {
  const expected = Buffer.from("png-result");
  const result = decodeOpenAIImageEditResult({
    data: [{ b64_json: expected.toString("base64") }],
  });
  assert.deepEqual(result, expected);
});

test("Storage upload xatosi tashlanadi", () => {
  assert.throws(
    () => assertStorageUploadSucceeded({ message: "bucket unavailable" }),
    /Storage upload failed: bucket unavailable/,
  );
});
