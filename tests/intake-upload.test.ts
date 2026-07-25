import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bestEffortPreviewUrl,
  buildIntakeUploadPath,
  jsonSafeSizeBytes,
  normalizeUploadRequestId,
  serializePublicUploadAttachment,
  uploadDedupTarget,
} from "../src/lib/intake/upload-response.ts";

test("attachment insert natijasi oddiy public JSON shakliga o‘tkaziladi", () => {
  const attachment = serializePublicUploadAttachment({
    id: "attachment-1",
    intake_id: "intake-1",
    file_name: "photo.jpg",
    mime_type: "image/jpeg",
    size_bytes: 2048,
    kind: "image",
    created_at: "2026-07-25T10:00:00.000Z",
  });

  assert.deepEqual(attachment, {
    id: "attachment-1",
    intakeId: "intake-1",
    fileName: "photo.jpg",
    mimeType: "image/jpeg",
    sizeBytes: 2048,
    kind: "image",
    createdAt: "2026-07-25T10:00:00.000Z",
  });
  assert.doesNotThrow(() => JSON.stringify({ ok: true, attachment }));
});

test("BigInt size_bytes JSON uchun stringga aylanadi", () => {
  assert.equal(jsonSafeSizeBytes(9007199254740993n), "9007199254740993");
  const attachment = serializePublicUploadAttachment({
    id: "a",
    intake_id: "i",
    file_name: "large.bin",
    mime_type: "application/octet-stream",
    size_bytes: 9007199254740993n,
    kind: "file",
    created_at: "now",
  });
  assert.equal(attachment.sizeBytes, "9007199254740993");
  assert.doesNotThrow(() => JSON.stringify(attachment));
});

test("signed URL xatosi durable uploadni yiqitmaydi", async () => {
  const preview = await bestEffortPreviewUrl(async () => {
    throw new Error("signing unavailable");
  });
  assert.equal(preview, null);
});

test("bir xil request ID aynan bir xil storage path va dedup target beradi", () => {
  const requestId = "8afc45b0-4021-4c0a-82f0-c160ccd78879";
  const normalized = normalizeUploadRequestId(requestId, "fallback");
  const first = buildIntakeUploadPath({
    intakeId: "intake-1",
    scope: "answer-3",
    requestId: normalized,
    extension: "pdf",
  });
  const second = buildIntakeUploadPath({
    intakeId: "intake-1",
    scope: "answer-3",
    requestId: normalized,
    extension: "pdf",
  });

  assert.equal(first, second);
  assert.deepEqual(uploadDedupTarget("attachment", "answer-3"), {
    field: "answer_id",
    value: "answer-3",
  });
  assert.deepEqual(uploadDedupTarget("photo", null), {
    field: "is_primary_photo",
    value: true,
  });
});

test("noto‘g‘ri client request ID xavfsiz fallback bilan almashtiriladi", () => {
  assert.equal(normalizeUploadRequestId("../../bad", "safe-fallback"), "safe-fallback");
});
