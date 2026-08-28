import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  MAX_FACT_RETRIES,
  enforceFactPreservation,
  type AnswerImproveRequest,
} from "../src/lib/intake/answer-improvement.ts";
import { preserveCanonicalPostQuote } from "../src/lib/intake/canonical-quote.ts";

const ORIGINAL = "2024-yilda 3 ta korxona bilan ish boshladim, hozir 23 ta korxonaga xizmat ko'rsataman.";
const FAITHFUL =
  "U 2024-yilda 3 ta korxona bilan ish boshlagan, hozirda 23 ta korxonaga xizmat ko'rsatmoqda.";
const LOSSY = "U buxgalteriya sohasida faoliyat yuritadi.";

function improverReturning(...responses: string[]) {
  const calls: AnswerImproveRequest[] = [];
  let index = 0;
  const improve = async (request: AnswerImproveRequest) => {
    calls.push(request);
    return responses[Math.min(index++, responses.length - 1)];
  };
  return { improve, calls };
}

test("a clean first pass costs no retries", async () => {
  const { improve, calls } = improverReturning(FAITHFUL);
  const outcome = await enforceFactPreservation({
    original: ORIGINAL,
    questionPrompt: "Faoliyatingiz haqida so'zlab bering",
    firstImproved: FAITHFUL,
    improve,
  });
  assert.equal(outcome.retries, 0);
  assert.equal(calls.length, 0);
  assert.equal(outcome.improvedText, FAITHFUL);
  assert.equal(outcome.fellBackToOriginal, false);
  assert.equal(outcome.report.ok, true);
});

test("a lossy first pass is retried and the recovered text is kept", async () => {
  const { improve, calls } = improverReturning(FAITHFUL);
  const outcome = await enforceFactPreservation({
    original: ORIGINAL,
    questionPrompt: "Faoliyat",
    firstImproved: LOSSY,
    improve,
  });
  assert.equal(outcome.retries, 1);
  assert.equal(outcome.improvedText, FAITHFUL);
  assert.equal(outcome.fellBackToOriginal, false);
  assert.ok(calls[0].missingFacts.some((fact) => fact.key === "2024"));
});

test("the retry prompt receives the missing facts and the previous attempt", async () => {
  const { improve, calls } = improverReturning(FAITHFUL);
  await enforceFactPreservation({
    original: ORIGINAL,
    questionPrompt: "Faoliyat",
    firstImproved: LOSSY,
    improve,
  });
  assert.equal(calls[0].previousAttempt, LOSSY);
  assert.equal(calls[0].original, ORIGINAL);
  assert.equal(calls[0].attempt, 1);
  assert.deepEqual(calls[0].missingFacts.map((fact) => fact.key).sort(), ["2024", "23", "3"].sort());
});

test("after two failed retries the original answer is kept, never the lossy rewrite", async () => {
  const { improve, calls } = improverReturning(LOSSY, LOSSY, LOSSY);
  const outcome = await enforceFactPreservation({
    original: ORIGINAL,
    questionPrompt: "Faoliyat",
    firstImproved: LOSSY,
    improve,
  });
  assert.equal(calls.length, MAX_FACT_RETRIES);
  assert.equal(outcome.retries, MAX_FACT_RETRIES);
  assert.equal(outcome.fellBackToOriginal, true);
  assert.equal(outcome.improvedText, ORIGINAL);
  assert.equal(outcome.report.ok, false);
});

test("a partial recovery is preferred over a worse rewrite", async () => {
  const partial = "U 2024-yilda 3 ta korxona bilan boshlagan.";
  const { improve } = improverReturning(partial, LOSSY);
  const outcome = await enforceFactPreservation({
    original: ORIGINAL,
    questionPrompt: "Faoliyat",
    firstImproved: LOSSY,
    improve,
  });
  // Still incomplete, so the original wins, but the better attempt was the one
  // carried forward rather than the second, worse one.
  assert.equal(outcome.fellBackToOriginal, true);
  assert.deepEqual(outcome.report.missing.map((fact) => fact.key), ["23"]);
});

test("a throwing retry does not lose the work already done", async () => {
  const improve = async () => {
    throw new Error("openai timeout");
  };
  const outcome = await enforceFactPreservation({
    original: ORIGINAL,
    questionPrompt: "Faoliyat",
    firstImproved: LOSSY,
    improve,
  });
  assert.equal(outcome.fellBackToOriginal, true);
  assert.equal(outcome.improvedText, ORIGINAL);
});

test("an empty improvement falls back rather than saving a blank answer", async () => {
  const { improve } = improverReturning("");
  const outcome = await enforceFactPreservation({
    original: ORIGINAL,
    questionPrompt: "Faoliyat",
    firstImproved: "",
    improve,
  });
  assert.equal(outcome.improvedText, ORIGINAL);
});

test("an answer with no extractable facts never triggers a retry", async () => {
  const { improve, calls } = improverReturning("U kitob o'qishni yaxshi ko'radi.");
  const outcome = await enforceFactPreservation({
    original: "Men kitob o'qishni yaxshi ko'raman.",
    questionPrompt: "Qiziqishlaringiz",
    firstImproved: "U kitob o'qishni yaxshi ko'radi.",
    improve,
  });
  assert.equal(calls.length, 0);
  assert.equal(outcome.report.ok, true);
  assert.equal(outcome.fellBackToOriginal, false);
});

test("Jaxongir never generatively rewrites the canonical post quote", async () => {
  const original = "  Xatolar yo‘lning bir qismidir, muvaffaqiyatsizlik emas.  ";
  const preserved = preserveCanonicalPostQuote(original);
  let calls = 0;
  const outcome = await enforceFactPreservation({
    original,
    questionPrompt: "Canonical iqtibos",
    firstImproved: preserved,
    improve: async () => {
      calls += 1;
      return "AI o‘ylab topgan boshqa iqtibos";
    },
    maxRetries: 0,
  });
  assert.equal(calls, 0);
  assert.equal(outcome.improvedText, preserved);

  const service = fs.readFileSync("src/lib/intake/improve-service.ts", "utf8");
  assert.match(
    service,
    /firstImproved: canonicalQuote[\s\S]*?preserveCanonicalPostQuote\(original\)/,
  );
  assert.match(service, /maxRetries: canonicalQuote \? 0/);
});
