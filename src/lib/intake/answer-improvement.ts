/**
 * Fact-preserving retry loop — pure orchestration, no OpenAI import, so the
 * escalation policy is unit-tested without a network call.
 *
 * Policy: an improved answer that dropped a date, number, institution or quote
 * is never saved. It is re-prompted with the explicit list of what went
 * missing, at most MAX_FACT_RETRIES times. If the model still cannot hold on to
 * the facts, the ORIGINAL answer is kept and the admin is warned — a faithful
 * raw answer beats a fluent one that lost the candidate's achievements.
 */

import {
  checkFactPreservation,
  type DetectedFact,
  type FactPreservationReport,
} from "./fact-preservation.ts";

export const MAX_FACT_RETRIES = 2;

export interface AnswerImproveRequest {
  original: string;
  questionPrompt: string;
  previousAttempt: string;
  missingFacts: DetectedFact[];
  attempt: number;
}

export type AnswerImprover = (request: AnswerImproveRequest) => Promise<string>;

export interface AnswerImprovementOutcome {
  /** What should be written to ai_improved_text / final_text. */
  improvedText: string;
  report: FactPreservationReport;
  /** How many extra model calls the retry loop spent (0 when the first pass was clean). */
  retries: number;
  /** True when every attempt lost facts and the original was kept instead. */
  fellBackToOriginal: boolean;
}

/**
 * Takes the first-pass improvement and escalates until the facts survive.
 * A retry that throws is treated as a failed attempt, not a fatal error: the
 * loop still has the previous best text and the original to fall back to.
 */
export async function enforceFactPreservation(params: {
  original: string;
  questionPrompt: string;
  firstImproved: string;
  improve: AnswerImprover;
  maxRetries?: number;
}): Promise<AnswerImprovementOutcome> {
  const maxRetries = params.maxRetries ?? MAX_FACT_RETRIES;
  const original = params.original ?? "";

  let current = (params.firstImproved ?? "").trim() || original;
  let report = checkFactPreservation(original, current);
  let retries = 0;

  while (!report.ok && retries < maxRetries) {
    retries += 1;
    let next: string;
    try {
      next = await params.improve({
        original,
        questionPrompt: params.questionPrompt,
        previousAttempt: current,
        missingFacts: report.missing,
        attempt: retries,
      });
    } catch {
      // A transient model/network failure must not discard the work already
      // done; keep the best text so far and stop retrying.
      break;
    }

    const candidate = (next ?? "").trim();
    if (!candidate) break;

    const candidateReport = checkFactPreservation(original, candidate);
    // Only move forward when the retry actually recovered facts, so a worse
    // rewrite cannot replace a better one.
    if (candidateReport.missing.length < report.missing.length) {
      current = candidate;
      report = candidateReport;
    }
    if (candidateReport.ok) break;
  }

  if (!report.ok) {
    return {
      improvedText: original,
      report,
      retries,
      fellBackToOriginal: true,
    };
  }

  return { improvedText: current, report, retries, fellBackToOriginal: false };
}
