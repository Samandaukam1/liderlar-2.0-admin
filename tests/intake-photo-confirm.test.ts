import { test } from "node:test";
import assert from "node:assert/strict";
import {
  evaluatePhotoEditPrecheck,
  type PhotoEditRow,
  type ProcessedAttachmentRow,
} from "../src/lib/intake/photo-confirm.ts";

const INTAKE = "11111111-1111-1111-1111-111111111111";

const readyEdit: PhotoEditRow = {
  intake_id: INTAKE,
  status: "completed",
  processed_attachment_id: "att-1",
};
const readyAttachment: ProcessedAttachmentRow = {
  intake_id: INTAKE,
  kind: "image",
  scan_status: "ready",
  deleted_at: null,
};

test("valid completed AI edit passes precheck", () => {
  const r = evaluatePhotoEditPrecheck({ intakeId: INTAKE, photoEdit: readyEdit, attachment: readyAttachment });
  assert.equal(r.ok, true);
  assert.equal(r.code, null);
});

test("missing photo edit → PHOTO_EDIT_NOT_FOUND", () => {
  const r = evaluatePhotoEditPrecheck({ intakeId: INTAKE, photoEdit: null, attachment: null });
  assert.equal(r.code, "PHOTO_EDIT_NOT_FOUND");
  assert.equal(r.status, 404);
});

test("intake mismatch → PHOTO_EDIT_NOT_FOUND", () => {
  const r = evaluatePhotoEditPrecheck({
    intakeId: INTAKE,
    photoEdit: { ...readyEdit, intake_id: "other" },
    attachment: readyAttachment,
  });
  assert.equal(r.code, "PHOTO_EDIT_NOT_FOUND");
});

test("status not completed → PHOTO_EDIT_NOT_COMPLETED", () => {
  const r = evaluatePhotoEditPrecheck({
    intakeId: INTAKE,
    photoEdit: { ...readyEdit, status: "processing" },
    attachment: readyAttachment,
  });
  assert.equal(r.code, "PHOTO_EDIT_NOT_COMPLETED");
});

test("no processed_attachment_id → PROCESSED_ATTACHMENT_MISSING", () => {
  const r = evaluatePhotoEditPrecheck({
    intakeId: INTAKE,
    photoEdit: { ...readyEdit, processed_attachment_id: null },
    attachment: null,
  });
  assert.equal(r.code, "PROCESSED_ATTACHMENT_MISSING");
});

test("attachment row missing → PROCESSED_ATTACHMENT_MISSING", () => {
  const r = evaluatePhotoEditPrecheck({ intakeId: INTAKE, photoEdit: readyEdit, attachment: null });
  assert.equal(r.code, "PROCESSED_ATTACHMENT_MISSING");
});

test("attachment intake mismatch or deleted → PROCESSED_ATTACHMENT_MISSING", () => {
  assert.equal(
    evaluatePhotoEditPrecheck({
      intakeId: INTAKE,
      photoEdit: readyEdit,
      attachment: { ...readyAttachment, intake_id: "other" },
    }).code,
    "PROCESSED_ATTACHMENT_MISSING",
  );
  assert.equal(
    evaluatePhotoEditPrecheck({
      intakeId: INTAKE,
      photoEdit: readyEdit,
      attachment: { ...readyAttachment, deleted_at: new Date().toISOString() },
    }).code,
    "PROCESSED_ATTACHMENT_MISSING",
  );
});

test("wrong kind → INVALID_ATTACHMENT_KIND", () => {
  const r = evaluatePhotoEditPrecheck({
    intakeId: INTAKE,
    photoEdit: readyEdit,
    attachment: { ...readyAttachment, kind: "document" },
  });
  assert.equal(r.code, "INVALID_ATTACHMENT_KIND");
});

test("scan not ready → ATTACHMENT_NOT_READY", () => {
  const r = evaluatePhotoEditPrecheck({
    intakeId: INTAKE,
    photoEdit: readyEdit,
    attachment: { ...readyAttachment, scan_status: "pending" },
  });
  assert.equal(r.code, "ATTACHMENT_NOT_READY");
  assert.equal(r.status, 409);
});
