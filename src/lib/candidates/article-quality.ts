/**
 * Article quality gate — pure, unit-tested, no OpenAI import.
 *
 * The generator kept producing a short summary instead of a biographical
 * article, so length, sectioning, fact coverage and repetition are measured
 * here and fed back into a regeneration prompt rather than trusted to the model.
 */

import {
  extractFacts,
  normalizeForCompare,
  stemWord,
  textContainsFact,
  type DetectedFact,
} from "../intake/fact-preservation.ts";

export const ARTICLE_MIN_WORDS = 1800;
export const ARTICLE_TARGET_MIN_WORDS = 2500;
export const ARTICLE_TARGET_MAX_WORDS = 4500;
export const ARTICLE_MAX_WORDS = 5000;

/** A fact repeated more than this many times is padding, not emphasis. */
export const MAX_FACT_REPEATS = 3;
/** Quotations are the candidate's own words; reusing one twice is the ceiling. */
export const MAX_QUOTE_REPEATS = 2;

export const MIN_SECTION_WORDS = 80;
export const MIN_SECTION_PARAGRAPHS = 3;

export interface ArticleSectionInput {
  title: string;
  content: string;
}

export interface ArticleInput {
  introduction: string;
  sections: ArticleSectionInput[];
  conclusion: string;
}

export function countWords(text: string): number {
  if (!text?.trim()) return 0;
  return text
    .split(/\s+/)
    .filter((token) => /[\p{L}\p{N}]/u.test(token))
    .length;
}

export function articleWordCount(article: ArticleInput): number {
  return (
    countWords(article.introduction) +
    article.sections.reduce((sum, section) => sum + countWords(section.title) + countWords(section.content), 0) +
    countWords(article.conclusion)
  );
}

export function articleFullText(article: ArticleInput): string {
  return [
    article.introduction,
    ...article.sections.map((section) => `${section.title}\n${section.content}`),
    article.conclusion,
  ]
    .filter(Boolean)
    .join("\n\n");
}

function paragraphCount(content: string): number {
  return content.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean).length;
}

/** How many times a fact appears across the whole article. */
export function countFactOccurrences(text: string, fact: DetectedFact): number {
  if (fact.kind === "number") {
    const runs = text.match(/\d+(?:[.,]\d+)*/g) ?? [];
    return runs.filter((run) => run.replace(/[^\d]/g, "") === fact.key).length;
  }

  const normalized = normalizeForCompare(text);
  if (fact.kind === "quote") {
    if (!fact.key) return 0;
    return normalized.split(fact.key).length - 1;
  }

  // Proper nouns are counted on their leading stem, so inflected mentions of
  // the same institution are recognised as repeats.
  const [head] = fact.key.split(" ");
  if (!head) return 0;
  return normalized.split(/\s+/).map(stemWord).filter((stem) => stem === head).length;
}

export interface WeakSection {
  title: string;
  words: number;
  paragraphs: number;
}

export interface ArticleQualityReport {
  wordCount: number;
  tooShort: boolean;
  tooLong: boolean;
  belowTarget: boolean;
  sectionCount: number;
  /** Source facts the article never mentions. */
  missingFacts: DetectedFact[];
  /** Facts hammered past the repetition ceiling. */
  repeatedFacts: Array<{ fact: DetectedFact; count: number }>;
  weakSections: WeakSection[];
  untitledSections: number;
  /** 0..100, used by the admin preview and the regeneration decision. */
  score: number;
  ok: boolean;
}

/**
 * Scores a generated article against the source material.
 * `sourceText` is the candidate's own (improved) answers — every anchor in it
 * should surface in the article at least once.
 */
export function evaluateArticle(params: {
  article: ArticleInput;
  sourceText: string;
  minWords?: number;
}): ArticleQualityReport {
  const minWords = params.minWords ?? ARTICLE_MIN_WORDS;
  const fullText = articleFullText(params.article);
  const wordCount = articleWordCount(params.article);

  const sourceFacts = extractFacts(params.sourceText);
  const missingFacts = sourceFacts.filter((fact) => !textContainsFact(fullText, fact));

  const repeatedFacts: Array<{ fact: DetectedFact; count: number }> = [];
  for (const fact of sourceFacts) {
    const limit = fact.kind === "quote" ? MAX_QUOTE_REPEATS : MAX_FACT_REPEATS;
    const count = countFactOccurrences(fullText, fact);
    if (count > limit) repeatedFacts.push({ fact, count });
  }

  const weakSections: WeakSection[] = [];
  let untitledSections = 0;
  for (const section of params.article.sections) {
    if (!section.title?.trim()) untitledSections += 1;
    const words = countWords(section.content);
    const paragraphs = paragraphCount(section.content);
    if (words < MIN_SECTION_WORDS || paragraphs < MIN_SECTION_PARAGRAPHS) {
      weakSections.push({ title: section.title || "(sarlavhasiz)", words, paragraphs });
    }
  }

  const tooShort = wordCount < minWords;
  const tooLong = wordCount > ARTICLE_MAX_WORDS;
  const belowTarget = wordCount < ARTICLE_TARGET_MIN_WORDS;

  // Length and dropped facts dominate the score: those are the two failures
  // that made the old output read as a summary.
  let score = 100;
  if (tooShort) score -= Math.min(40, Math.round(((minWords - wordCount) / minWords) * 100));
  if (tooLong) score -= 10;
  score -= Math.min(30, missingFacts.length * 5);
  score -= Math.min(15, repeatedFacts.length * 5);
  score -= Math.min(15, weakSections.length * 3);
  score -= untitledSections * 5;
  score = Math.max(0, Math.min(100, score));

  return {
    wordCount,
    tooShort,
    tooLong,
    belowTarget,
    sectionCount: params.article.sections.length,
    missingFacts,
    repeatedFacts,
    weakSections,
    untitledSections,
    score,
    ok: !tooShort && missingFacts.length === 0 && untitledSections === 0,
  };
}

export const INTRODUCTION_TITLE = "Kirish";
export const CONCLUSION_TITLE = "Xulosa";

/**
 * Flattens introduction + sections + conclusion into the ordered list stored in
 * candidate_sections. The model returns them separately so it structures the
 * article properly, but storage stays a single ordered table — no new table and
 * no lost intro/outro.
 */
export function composeArticleSections(
  article: ArticleInput,
): Array<{ title: string; content: string; order: number }> {
  const composed: Array<{ title: string; content: string }> = [];
  if (article.introduction?.trim()) {
    composed.push({ title: INTRODUCTION_TITLE, content: article.introduction.trim() });
  }
  for (const section of article.sections) {
    const title = section.title?.trim() ?? "";
    const content = section.content?.trim() ?? "";
    if (!title && !content) continue;
    composed.push({ title, content });
  }
  if (article.conclusion?.trim()) {
    composed.push({ title: CONCLUSION_TITLE, content: article.conclusion.trim() });
  }
  return composed.map((section, order) => ({ ...section, order }));
}

/** The corrective block appended when an article has to be regenerated. */
export function formatArticleFixPrompt(report: ArticleQualityReport): string {
  const lines: string[] = [];
  if (report.tooShort) {
    lines.push(
      `MAQOLA JUDA QISQA: ${report.wordCount} so'z. Kamida ${ARTICLE_MIN_WORDS} so'z bo'lishi shart ` +
        `(tavsiya: ${ARTICLE_TARGET_MIN_WORDS}-${ARTICLE_TARGET_MAX_WORDS} so'z). ` +
        "Matnni sun'iy cho'zma — mavjud faktlarni alohida bo'limlarda kengroq ochib ber.",
    );
  }
  if (report.tooLong) {
    lines.push(`MAQOLA JUDA UZUN: ${report.wordCount} so'z. ${ARTICLE_MAX_WORDS} so'zdan oshmasin.`);
  }
  if (report.missingFacts.length > 0) {
    lines.push(
      "QUYIDAGI MA'LUMOTLAR MAQOLADA UMUMAN YO'Q. Ularni tegishli bo'limlarga kirit:",
      ...report.missingFacts.map((fact) => `- ${fact.value}`),
    );
  }
  if (report.repeatedFacts.length > 0) {
    lines.push(
      "QUYIDAGI MA'LUMOTLAR HADDAN ORTIQ TAKRORLANGAN. Har birini kamaytir:",
      ...report.repeatedFacts.map((entry) => `- ${entry.fact.value} (${entry.count} marta)`),
    );
  }
  if (report.weakSections.length > 0) {
    lines.push(
      "QUYIDAGI BO'LIMLAR JUDA ZAIF (kamida 3 xatboshi va mazmunli hajm talab qilinadi):",
      ...report.weakSections.map((section) => `- ${section.title} (${section.words} so'z, ${section.paragraphs} xatboshi)`),
    );
  }
  if (report.untitledSections > 0) {
    lines.push(`${report.untitledSections} ta bo'lim sarlavhasiz. Har bir bo'limga mazmunli sarlavha yoz.`);
  }
  return lines.join("\n");
}
