import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import {
  OpenAIImageEditError,
  assertStorageUploadSucceeded,
  decodeOpenAIImageEditResult,
  photoEditErrorResponse,
  preparePhotoEditSource,
  requestOpenAIImageEdit,
  serializePhotoEditError,
  standardizePhotoEditSource,
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

test("CMYK JPEG OpenAI oldidan sRGB PNG ga standartlashtiriladi", async () => {
  const cmykJpeg = await sharp({
    create: {
      width: 16,
      height: 16,
      channels: 3,
      background: "#c06030",
    },
  })
    .toColourspace("cmyk")
    .jpeg()
    .toBuffer();
  const prepared = preparePhotoEditSource({ imageBytes: cmykJpeg, mime: "image/jpeg" });
  const standardized = await standardizePhotoEditSource(prepared);
  const metadata = await sharp(standardized.buffer).metadata();

  assert.equal(standardized.mime, "image/png");
  assert.equal(standardized.fileName, "candidate-source.png");
  assert.equal(metadata.format, "png");
  assert.equal(metadata.space, "srgb");
  assert.equal(metadata.channels, 3);
});

test("gpt-image-2 raw multipart request faqat minimal parametrlarni yuboradi", async () => {
  const source = preparePhotoEditSource({ imageBytes: JPEG_BYTES, mime: "image/jpeg" });
  let requestBody: FormData | null = null;
  const fetchImpl: typeof fetch = async (_input, init) => {
    requestBody = init?.body as FormData;
    return new Response(
      JSON.stringify({ data: [{ b64_json: Buffer.from("png-result").toString("base64") }] }),
      { status: 200, headers: { "x-request-id": "req_success" } },
    );
  };

  const result = await requestOpenAIImageEdit({
    source,
    model: "gpt-image-2",
    prompt: "portrait",
    apiKey: "test-key",
    fetchImpl,
    log: () => undefined,
  });
  assert.deepEqual(result, Buffer.from("png-result"));
  assert.ok(requestBody);
  assert.deepEqual(Array.from(requestBody.keys()), ["image", "model", "prompt", "size", "quality"]);
  assert.equal(requestBody.get("model"), "gpt-image-2");
  assert.equal(requestBody.get("prompt"), "portrait");
  assert.equal(requestBody.get("size"), "1024x1536");
  assert.equal(requestBody.get("quality"), "high");
  const image = requestBody.get("image");
  assert.ok(image instanceof File);
  assert.equal(image.name, "candidate-source.jpg");
  assert.equal(image.type, "image/jpeg");
});

test("OpenAI 400 raw body aniq diagnostik maydonlarga ajratiladi", async () => {
  const diagnostics: Array<{ event: string; payload: Record<string, unknown> }> = [];
  const source = preparePhotoEditSource({ imageBytes: PNG_BYTES, mime: "image/png" });
  const fetchImpl: typeof fetch = async () =>
    new Response(
      JSON.stringify({
        error: {
          message: "Unsupported parameter: quality",
          type: "invalid_request_error",
          code: "invalid_value",
          param: "quality",
        },
      }),
      { status: 400, headers: { "x-request-id": "req_123" } },
    );

  let caught: unknown;
  try {
    await requestOpenAIImageEdit({
      source,
      model: "gpt-image-2",
      prompt: "portrait",
      apiKey: "test-key",
      fetchImpl,
      log: (event, payload) => diagnostics.push({ event, payload }),
    });
  } catch (error: unknown) {
    caught = error;
  }
  assert.ok(caught instanceof OpenAIImageEditError);
  assert.deepEqual(caught.details, {
    status: 400,
    code: "invalid_value",
    type: "invalid_request_error",
    message: "Unsupported parameter: quality",
    param: "quality",
    requestId: "req_123",
    moderationDetails: undefined,
  });
  assert.deepEqual(photoEditErrorResponse(caught), {
    status: 400,
    message: "Rasmni qayta ishlash so‘rovi noto‘g‘ri shakllangan. Administrator xabardor qilindi.",
  });
  assert.deepEqual(diagnostics, [{
    event: "OPENAI_IMAGE_EDIT_ERROR",
    payload: {
      status: 400,
      message: "Unsupported parameter: quality",
      type: "invalid_request_error",
      code: "invalid_value",
      param: "quality",
      requestId: "req_123",
      model: "gpt-image-2",
      sourceMime: "image/png",
      sourceBytes: PNG_BYTES.length,
      promptChars: 8,
    },
  }]);
  assert.deepEqual(JSON.parse(serializePhotoEditError(caught)), {
    status: 400,
    message: "Unsupported parameter: quality",
    code: "invalid_value",
    param: "quality",
    requestId: "req_123",
  });
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
