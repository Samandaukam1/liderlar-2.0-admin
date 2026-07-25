import { test } from "node:test";
import assert from "node:assert/strict";
import {
  autosaveRetryDelay,
  canSubmitCandidateFinal,
  mergeAutosaveConflict,
  photoPollingDelay,
} from "../src/lib/intake/client-flow.ts";

test("409 merge local rich/plain javobni almashtirmaydi", () => {
  const richContent = {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: "Local yangi matn" }] }],
  };
  const local = {
    answerState: "answered",
    richContent,
    plainText: "Local yangi matn",
    lockVersion: 3,
    dirty: true,
    localRevision: 8,
  };

  const merged = mergeAutosaveConflict(local, 7);
  assert.equal(merged.plainText, "Local yangi matn");
  assert.equal(merged.richContent, richContent);
  assert.equal(merged.localRevision, 8);
  assert.equal(merged.lockVersion, 7);
  assert.equal(merged.dirty, true);
});

test("autosave exponential retry 1s dan 16s capgacha oshadi", () => {
  assert.deepEqual(
    [1, 2, 3, 4, 5, 6, 20].map(autosaveRetryDelay),
    [1000, 2000, 4000, 8000, 16000, 16000, 16000],
  );
});

test("photo polling visible tabda 3s, background tabda sekin", () => {
  assert.equal(photoPollingDelay(false), 3000);
  assert.equal(photoPollingDelay(true), 12000);
});

test("final submit rasm tasdiqlanmaguncha yopiq", () => {
  assert.equal(
    canSubmitCandidateFinal({
      everyAnswerValid: true,
      contactValid: true,
      photoConfirmed: false,
    }),
    false,
  );
  assert.equal(
    canSubmitCandidateFinal({
      everyAnswerValid: true,
      contactValid: true,
      photoConfirmed: true,
    }),
    true,
  );
});
