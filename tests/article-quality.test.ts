import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ARTICLE_MIN_WORDS,
  articleWordCount,
  countFactOccurrences,
  countWords,
  evaluateArticle,
  formatArticleFixPrompt,
  type ArticleInput,
} from "../src/lib/candidates/article-quality.ts";
import { extractFacts } from "../src/lib/intake/fact-preservation.ts";

// Filler must stay free of digits and capitalised words, or it would register
// as facts of its own and mask what the assertions are checking.
const FILLER_WORDS = ["mehnat", "intilish", "tajriba", "yo'nalish", "natija", "faoliyat"];

/** Builds a section whose content has `paragraphs` paragraphs of `perParagraph` words. */
function section(title: string, paragraphs: number, perParagraph: number): { title: string; content: string } {
  const paragraph = Array.from({ length: perParagraph }, (_, i) => FILLER_WORDS[i % FILLER_WORDS.length]).join(" ");
  return { title, content: Array.from({ length: paragraphs }, () => paragraph).join("\n\n") };
}

const SECTION_TITLES = [
  "kirish", "bolalik", "ta'lim", "kasb", "faoliyat", "yutuqlar",
  "qarashlar", "qiziqishlar", "maqsadlar", "yakun",
];

function articleOfWords(totalWords: number): ArticleInput {
  // 10 sections, each 3 paragraphs, sized to reach the requested total.
  const perParagraph = Math.ceil(totalWords / (10 * 3));
  return {
    introduction: "kirish qismi matni",
    sections: SECTION_TITLES.map((title) => section(title, 3, perParagraph)),
    conclusion: "yakuniy qism matni",
  };
}

test("word counting ignores punctuation-only tokens", () => {
  assert.equal(countWords("Bir ikki uch"), 3);
  assert.equal(countWords("Bir,  ikki   —  uch."), 3);
  assert.equal(countWords("   "), 0);
});

test("article word count spans intro, sections and conclusion", () => {
  const article: ArticleInput = {
    introduction: "bir ikki",
    sections: [{ title: "Sarlavha", content: "uch to'rt besh" }],
    conclusion: "olti",
  };
  assert.equal(articleWordCount(article), 2 + 1 + 3 + 1);
});

test("a short summary-style article is rejected as too short", () => {
  const report = evaluateArticle({
    article: {
      introduction: "Ozoda buxgalteriya sohasida ishlaydi.",
      sections: [{ title: "Faoliyat", content: "U turli yutuqlarga erishgan." }],
      conclusion: "Kelajakda korxonasini kengaytirishni istaydi.",
    },
    sourceText: "2024-yilda 3 ta korxona bilan boshladim.",
  });
  assert.equal(report.tooShort, true);
  assert.equal(report.ok, false);
  assert.ok(report.wordCount < ARTICLE_MIN_WORDS);
  assert.ok(report.score < 60);
});

test("an article of the required length with all facts passes", () => {
  const article = articleOfWords(2600);
  article.sections[0].content = `2024-yilda 3 ta korxona bilan boshlagan.\n\n${article.sections[0].content}\n\nHozirda 23 ta korxonaga xizmat ko'rsatadi.`;
  const report = evaluateArticle({
    article,
    sourceText: "2024-yilda 3 ta korxona bilan boshladim, hozir 23 ta korxonaga xizmat ko'rsataman.",
  });
  assert.equal(report.tooShort, false);
  assert.deepEqual(report.missingFacts, []);
  assert.equal(report.ok, true);
  assert.ok(report.wordCount >= ARTICLE_MIN_WORDS);
});

test("facts absent from a long article are still reported", () => {
  const report = evaluateArticle({
    article: articleOfWords(2600),
    sourceText: "2024-yilda 3 ta korxona bilan boshladim, hozir 23 ta korxonaga xizmat ko'rsataman.",
  });
  assert.equal(report.tooShort, false);
  assert.equal(report.ok, false);
  assert.deepEqual(report.missingFacts.map((fact) => fact.key).sort(), ["2024", "23", "3"].sort());
});

test("a fact hammered more than three times is flagged as repetition", () => {
  const article = articleOfWords(2600);
  article.introduction = "2024-yil. 2024-yil. 2024-yil. 2024-yil. 2024-yil.";
  const report = evaluateArticle({ article, sourceText: "2024-yilda boshladim." });
  assert.equal(report.repeatedFacts.length, 1);
  assert.equal(report.repeatedFacts[0].count, 5);
});

test("a quotation may appear twice but not three times", () => {
  const [quote] = extractFacts('U "Mehnat baxt keltiradi" deb hisoblaydi.').filter((f) => f.kind === "quote");
  assert.equal(countFactOccurrences('"Mehnat baxt keltiradi" ... "Mehnat baxt keltiradi"', quote), 2);
  const article = articleOfWords(2600);
  article.introduction = '"Mehnat baxt keltiradi". "Mehnat baxt keltiradi". "Mehnat baxt keltiradi".';
  const report = evaluateArticle({ article, sourceText: 'U "Mehnat baxt keltiradi" deydi.' });
  assert.ok(report.repeatedFacts.some((entry) => entry.fact.kind === "quote"));
});

test("thin and untitled sections are reported as weak", () => {
  const report = evaluateArticle({
    article: {
      introduction: "kirish",
      sections: [section("To'liq bo'lim", 3, 40), { title: "", content: "juda qisqa matn" }],
      conclusion: "yakun",
    },
    sourceText: "",
  });
  assert.equal(report.untitledSections, 1);
  assert.ok(report.weakSections.some((weak) => weak.title === "(sarlavhasiz)"));
  assert.equal(report.ok, false);
});

test("the regeneration prompt names length, missing facts and repeats", () => {
  const report = evaluateArticle({
    article: {
      introduction: "qisqa",
      sections: [{ title: "Bo'lim", content: "juda qisqa" }],
      conclusion: "yakun",
    },
    sourceText: "2024-yilda 3 ta korxona bilan boshladim.",
  });
  const prompt = formatArticleFixPrompt(report);
  assert.match(prompt, /JUDA QISQA/);
  assert.match(prompt, /2024/);
  assert.match(prompt, new RegExp(String(ARTICLE_MIN_WORDS)));
});

test("a clean report produces an empty fix prompt", () => {
  const article = articleOfWords(2600);
  const report = evaluateArticle({ article, sourceText: "" });
  assert.equal(report.ok, true);
  assert.equal(formatArticleFixPrompt(report), "");
});
