import { test } from "node:test";
import assert from "node:assert/strict";

import {
  evaluateValidity,
  containsDeadlineClaim,
  containsTaskPromise,
  suggestFactKind,
  type KnowledgeValidity,
} from "../src/lib/sales/knowledge-validity.ts";
import {
  detectConflicts,
  detectStance,
  conflictedKnowledgeIds,
  type ConflictCandidate,
} from "../src/lib/sales/knowledge-conflict.ts";
import {
  parseCommercial,
  buildCommercialBlock,
} from "../src/lib/sales/commercial-facts.ts";

const NOW = new Date("2026-09-14T12:00:00.000Z");

function validity(overrides: Partial<KnowledgeValidity & { status: string }> = {}) {
  return {
    status: "approved",
    factKind: "permanent_fact" as const,
    validFrom: null,
    validUntil: null,
    neverExpires: true,
    scope: "all" as const,
    scopeRef: null,
    conflictStatus: "none" as const,
    supersededAt: null,
    ...overrides,
  };
}

/* ==================== AMAL QILISH MUDDATI ============================== */

test("doimiy fakt ishlatiladi", () => {
  const verdict = evaluateValidity(validity(), { now: NOW });
  assert.equal(verdict.usableAsFact, true);
});

test("MUDDATI TUGAGAN bilim javobda ISHLATILMAYDI", () => {
  const verdict = evaluateValidity(
    validity({
      factKind: "temporary_offer",
      neverExpires: false,
      validUntil: "2026-09-01T00:00:00.000Z",
    }),
    { now: NOW },
  );
  assert.equal(verdict.usableAsFact, false);
  assert.equal(verdict.reason, "expired");
});

test("SANASIZ “muddatli taklif” ishlatilmaydi — “faqat bugun” muammosi", () => {
  /*
   * AUDIT TOPILMASI (D-band): tasdiqlangan bilimda "chegirma faqat
   * bugun" turgan va u HAR KUNI aytilishi mumkin edi. Muddatli
   * taklif tugash sanasisiz FAKT BO'LA OLMAYDI.
   */
  const verdict = evaluateValidity(
    validity({ factKind: "temporary_offer", neverExpires: false, validUntil: null }),
    { now: NOW },
  );
  assert.equal(verdict.usableAsFact, false);
  assert.equal(verdict.reason, "undated_temporary_offer");
});

test("TARIXIY MISOL joriy haqiqat sifatida ishlatilmaydi", () => {
  const verdict = evaluateValidity(validity({ factKind: "historical_example" }), { now: NOW });
  assert.equal(verdict.usableAsFact, false);
  assert.equal(verdict.reason, "historical_example");
});

test("BAJARILADIGAN VA’DA umumiy bilim emas", () => {
  // "Sertifikatni birozdan so'ng yuboramiz" — bitta mijozga
  // berilgan va'da. Bilim bo'lsa, bot uni hammaga takrorlardi.
  const verdict = evaluateValidity(validity({ factKind: "task_promise" }), { now: NOW });
  assert.equal(verdict.usableAsFact, false);
  assert.equal(verdict.reason, "task_promise");
});

test("ZIDDIYATLI bilim avtonom javobdan CHIQADI", () => {
  const verdict = evaluateValidity(validity({ conflictStatus: "conflicted" }), { now: NOW });
  assert.equal(verdict.usableAsFact, false);
  assert.equal(verdict.reason, "conflicted");
});

test("ALMASHTIRILGAN versiya ishlatilmaydi", () => {
  const verdict = evaluateValidity(
    validity({ supersededAt: "2026-09-10T00:00:00.000Z" }),
    { now: NOW },
  );
  assert.equal(verdict.usableAsFact, false);
  assert.equal(verdict.reason, "superseded");
});

test("TASNIFLANMAGAN bilim fakt sifatida ishlatilmaydi", () => {
  const verdict = evaluateValidity(validity({ factKind: "unclassified" }), { now: NOW });
  assert.equal(verdict.usableAsFact, false);
});

test("tasdiqlanmagan bilim hech qachon ishlatilmaydi", () => {
  const verdict = evaluateValidity(validity({ status: "draft" }), { now: NOW });
  assert.equal(verdict.usableAsFact, false);
  assert.equal(verdict.reason, "not_approved");
});

test("shaxsiy taklif FAQAT o‘sha suhbatda amal qiladi", () => {
  const personal = validity({
    factKind: "customer_specific_offer",
    scope: "conversation",
    scopeRef: "conv-1",
    validUntil: "2026-12-01T00:00:00.000Z",
    neverExpires: false,
  });

  assert.equal(evaluateValidity(personal, { now: NOW, conversationId: "conv-1" }).usableAsFact, true);
  assert.equal(
    evaluateValidity(personal, { now: NOW, conversationId: "conv-2" }).usableAsFact,
    false,
    "boshqa mijozga berilgan taklif aytilmaydi",
  );
});

test("hali boshlanmagan taklif aytilmaydi", () => {
  const verdict = evaluateValidity(
    validity({
      factKind: "temporary_offer",
      neverExpires: false,
      validFrom: "2026-10-01T00:00:00.000Z",
      validUntil: "2026-11-01T00:00:00.000Z",
    }),
    { now: NOW },
  );
  assert.equal(verdict.reason, "not_yet_valid");
});

/* ==================== MUDDAT VA VA'DA DETEKTORI ======================== */

test("muddat da’vosi tanilади", () => {
  assert.ok(containsDeadlineClaim("chegirma faqat bugun amal qiladi"));
  assert.ok(containsDeadlineClaim("ertaga 100 ming bo‘ladi"));
  assert.ok(containsDeadlineClaim("bir kun davomida amal qiladi"));
  assert.ok(!containsDeadlineClaim("sertifikat ham taqdim etiladi"));
});

test("bajariladigan va’da tanilади", () => {
  assert.ok(containsTaskPromise("sertifikatni birozdan so‘ng yuboramiz"));
  assert.ok(containsTaskPromise("hozir tayyorlayman"));
  assert.ok(!containsTaskPromise("narxi 38 000 so‘m"));
});

test("avtomatik tasnif HECH QACHON doimiy fakt bermaydi", () => {
  /*
   * Avtomatik "permanent_fact" qo'yilsa, eski xato yangi nom bilan
   * qaytardi. Shuning uchun taklif faqat KARANTIN turlarini beradi.
   */
  assert.equal(suggestFactKind("chegirma faqat bugun"), "temporary_offer");
  assert.equal(suggestFactKind("birozdan so‘ng yuboraman"), "task_promise");
  assert.equal(suggestFactKind("loyiha MChJga qarashli"), "unclassified");
});

/* ==================== ZIDDIYAT ========================================= */

test("pozitsiyada INKOR ustun — “mumkin emas” tasdiq emas", () => {
  assert.equal(detectStance("Bo‘lib to‘lash mumkin emas."), "deny");
  assert.equal(detectStance("Bo‘lib to‘lash mumkin."), "affirm");
});

test("qarama-qarshi tasdiqlangan javoblar ZIDDIYAT deb belgilanadi", () => {
  const candidates: ConflictCandidate[] = [
    { id: "k1", question: "Bo‘lib to‘lasa bo‘ladimi?", answer: "Ha, bo‘lib to‘lash mumkin.", status: "approved" },
    { id: "k2", question: "Bo‘lib to‘lash bormi?", answer: "Yo‘q, bo‘lib to‘lash mumkin emas.", status: "approved" },
  ];

  const conflicts = detectConflicts(candidates);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].topicKey, "installment");

  const ids = conflictedKnowledgeIds(conflicts);
  assert.ok(ids.has("k1") && ids.has("k2"), "IKKALASI ham javobdan chiqadi");
});

test("bir tomonlama takror ZIDDIYAT EMAS", () => {
  const candidates: ConflictCandidate[] = [
    { id: "k1", question: null, answer: "Sertifikat beriladi.", status: "approved" },
    { id: "k2", question: null, answer: "Ha, sertifikat taqdim etiladi.", status: "approved" },
  ];
  assert.equal(detectConflicts(candidates).length, 0);
});

test("QORALAMA bilim ziddiyat yaratmaydi", () => {
  const candidates: ConflictCandidate[] = [
    { id: "k1", question: null, answer: "Bo‘lib to‘lash mumkin.", status: "approved" },
    { id: "k2", question: null, answer: "Bo‘lib to‘lash mumkin emas.", status: "draft" },
  ];
  assert.equal(detectConflicts(candidates).length, 0, "qoralama javobda ishlatilmaydi");
});

test("boshqa mavzudagi inkor ziddiyat yaratmaydi", () => {
  const candidates: ConflictCandidate[] = [
    { id: "k1", question: null, answer: "Bo‘lib to‘lash mumkin.", status: "approved" },
    { id: "k2", question: null, answer: "Pulni qaytarish mumkin emas.", status: "approved" },
  ];
  assert.equal(detectConflicts(candidates).length, 0);
});

/* ==================== TIJORIY FAKTLAR ================================== */

test("chegirma muddati YO‘Q bo‘lsa model muddat aytishdan TAQIQLANADI", () => {
  const facts = parseCommercial({
    regularPrice: 100000,
    activePrice: 38000,
    discountEnabled: true,
    offerExpiresAt: null,
  });
  const block = buildCommercialBlock(facts, NOW);

  assert.match(block, /TUGASH MUDDATI TASDIQLANMAGAN/);
  assert.match(block, /bugun tugaydi.*AYTMA|AYTMA/s);
});

test("muddati o‘tgan chegirma joriy narx sifatida aytilmaydi", () => {
  const facts = parseCommercial({
    activePrice: 38000,
    discountEnabled: true,
    offerExpiresAt: "2026-09-01T00:00:00.000Z",
  });
  assert.match(buildCommercialBlock(facts, NOW), /muddati TUGAGAN/i);
});

test("bo‘lib to‘lash NOMA’LUM bo‘lsa ikkalasi ham aytilmaydi", () => {
  const facts = parseCommercial({ activePrice: 38000 });
  assert.equal(facts.installmentAvailable, null, "uchinchi holat: noma’lum");
  assert.match(buildCommercialBlock(facts, NOW), /TASDIQLANMAGAN/);
});

test("narx umuman bo‘lmasa model narx AYTMAYDI", () => {
  const block = buildCommercialBlock(parseCommercial({}), NOW);
  assert.match(block, /Narxni AYTMA/);
});

test("nosoz sozlama narxni taxmin qilmaydi", () => {
  const facts = parseCommercial({ activePrice: "juda arzon", regularPrice: -5 });
  assert.equal(facts.activePrice, null);
  assert.equal(facts.regularPrice, null);
});
