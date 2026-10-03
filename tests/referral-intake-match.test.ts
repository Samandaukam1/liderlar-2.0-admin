import { test } from "node:test";
import assert from "node:assert/strict";
import {
  earliest,
  phoneKey,
  pickIntakeForApplication,
  type PaidIntake,
} from "../src/lib/referral/intake-match.ts";

const APPLIED = "2026-10-01T10:00:00Z";

function intake(overrides: Partial<PaidIntake> = {}): PaidIntake {
  return {
    intakeId: "intake-1",
    candidateId: "cand-1",
    paid: true,
    qualifiedAt: "2026-10-02T10:00:00Z",
    ...overrides,
  };
}

test("phoneKey: har xil yozuvlar bir xil kalitga keladi", () => {
  assert.equal(phoneKey("+998901234567"), "901234567");
  assert.equal(phoneKey("+998 (90) 123-45-67"), "901234567");
  assert.equal(phoneKey("901234567"), "901234567");
});

test("phoneKey: qisqa yoki bo'sh raqam kalit bermaydi", () => {
  assert.equal(phoneKey("1234567"), null);
  assert.equal(phoneKey(""), null);
  assert.equal(phoneKey(null), null);
});

test("bitta to'langan anketa va nomzod bor — bog'lanadi", () => {
  const result = pickIntakeForApplication({
    applicationCreatedAt: APPLIED,
    intakes: [intake()],
    claimedCandidateIds: new Set(),
  });
  assert.deepEqual(result, { kind: "match", intakeId: "intake-1", candidateId: "cand-1", paid: true });
});

test("to'langan anketa yo'q — kutiladi", () => {
  const result = pickIntakeForApplication({
    applicationCreatedAt: APPLIED,
    intakes: [],
    claimedCandidateIds: new Set(),
  });
  assert.equal(result.kind, "waiting");
});

test("nomzod hali yaratilmagan — kutiladi", () => {
  const result = pickIntakeForApplication({
    applicationCreatedAt: APPLIED,
    intakes: [intake({ candidateId: null })],
    claimedCandidateIds: new Set(),
  });
  assert.equal(result.kind, "waiting");
});

test("bir raqamda ikki to'langan anketa — avtomatik tanlanmaydi", () => {
  const result = pickIntakeForApplication({
    applicationCreatedAt: APPLIED,
    intakes: [intake(), intake({ intakeId: "intake-2", candidateId: "cand-2" })],
    claimedCandidateIds: new Set(),
  });
  assert.equal(result.kind, "ambiguous");
});

test("to'lov arizadan oldin — bog'lanmaydi (keyin kod yozib ball o'g'irlash yo'q)", () => {
  const result = pickIntakeForApplication({
    applicationCreatedAt: APPLIED,
    intakes: [intake({ qualifiedAt: "2026-09-30T10:00:00Z" })],
    claimedCandidateIds: new Set(),
  });
  assert.equal(result.kind, "paid_before_application");
});

test("nomzod boshqa atributsiyada — ikkinchi tavsiyachi ball olmaydi", () => {
  const result = pickIntakeForApplication({
    applicationCreatedAt: APPLIED,
    intakes: [intake()],
    claimedCandidateIds: new Set(["cand-1"]),
  });
  assert.equal(result.kind, "claimed");
});

test("to'lanmagan, lekin CHOP ETILGAN anketa ham bog'lanadi (VIP nashrga bog'liq)", () => {
  const result = pickIntakeForApplication({
    applicationCreatedAt: APPLIED,
    intakes: [intake({ paid: false })],
    claimedCandidateIds: new Set(),
  });
  assert.deepEqual(result, { kind: "match", intakeId: "intake-1", candidateId: "cand-1", paid: false });
});

test("saralanish vaqti — to'lov va nashrdan ertarog'i", () => {
  assert.equal(earliest("2026-10-02T10:00:00Z", "2026-10-01T10:00:00Z"), "2026-10-01T10:00:00Z");
  assert.equal(earliest(null, "2026-10-01T10:00:00Z"), "2026-10-01T10:00:00Z");
  assert.equal(earliest(null, null), null);
});

test("intake-match.ts hech narsa import qilmaydi (testlar @/ ni ko'rmaydi)", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync("src/lib/referral/intake-match.ts", "utf8");
  assert.doesNotMatch(source, /^\s*import\s/m);
});
