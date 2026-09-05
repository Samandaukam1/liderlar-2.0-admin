import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { polishQuoteWithAi } from "./ai";
import {
  checkQuote,
  isBlankQuote,
  quoteFingerprint,
  QUOTE_MAX_WORDS_PER_SENTENCE,
  QUOTE_MIN_WORDS_PER_SENTENCE,
  QUOTE_SENTENCE_COUNT,
} from "./quote-rules";

/**
 * Post iqtibosini talabga moslash va — bo'sh bo'lsa — yaratish.
 *
 * Nomzod eslatmani o'qiydi, lekin baribir bitta gap, imlo xatosi yoki umuman
 * javobsiz yuborishi mumkin. Iqtibos posterga AYNAN shu holicha chiqqani uchun
 * u shu yerda talabga keltiriladi va saqlanadi.
 *
 * MUHIM: nomzodning XOM javobi (`plain_text`) hech qachon o'zgartirilmaydi.
 * Sayqallangan variant alohida ustunda turadi, ya'ni asl matn har doim
 * qaytarib olinadi.
 */

/** How many times the model is asked again when its answer breaks a rule. */
const MAX_ATTEMPTS = 3;

/** Recent quotes compared against, so the same line never ships twice. */
const UNIQUENESS_WINDOW = 2000;

export interface PolishedQuote {
  text: string;
  /** True when the candidate wrote nothing and this was written for them. */
  generated: boolean;
  attempts: number;
}

/**
 * Every quote already in play, fingerprinted.
 *
 * Both sources matter: `post_quote` is what a future poster will carry, and
 * `candidate_social_posts.quote` is what past ones already did. Comparing
 * against only one of them would let a line repeat across the boundary.
 */
async function existingFingerprints(excludeIntakeId: string): Promise<Set<string>> {
  const db = createSupabaseAdminClient();
  const [{ data: intakes }, { data: posts }] = await Promise.all([
    db
      .from("candidate_intakes")
      .select("post_quote")
      .not("post_quote", "is", null)
      .neq("id", excludeIntakeId)
      .limit(UNIQUENESS_WINDOW),
    db
      .from("candidate_social_posts")
      .select("quote")
      .not("quote", "is", null)
      .limit(UNIQUENESS_WINDOW),
  ]);

  const seen = new Set<string>();
  for (const row of intakes ?? []) {
    const fingerprint = quoteFingerprint(row.post_quote as string);
    if (fingerprint) seen.add(fingerprint);
  }
  for (const row of posts ?? []) {
    const fingerprint = quoteFingerprint(row.quote as string);
    if (fingerprint) seen.add(fingerprint);
  }
  return seen;
}

export interface PolishQuoteParams {
  intakeId: string;
  fullName: string;
  /** The candidate's raw answer. Empty means "write one for them". */
  raw: string | null | undefined;
  actorId: string | null;
}

/**
 * Brings a quote up to the stated rules, or writes one from scratch.
 *
 * The model is re-asked while its answer breaks a rule or repeats a quote
 * already in use, with the specific failure named each time. If every attempt
 * fails the best candidate is still returned rather than nothing — a poster
 * with a slightly-off quote beats a run that stops.
 */
export async function polishOrGenerateQuote(
  params: PolishQuoteParams,
): Promise<PolishedQuote> {
  const raw = (params.raw ?? "").trim();
  const generated = isBlankQuote(raw);
  const seen = await existingFingerprints(params.intakeId);

  let best = "";
  const problems: string[] = [];

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const text = (
      await polishQuoteWithAi({
        original: generated ? null : raw,
        fullName: params.fullName,
        problems,
        rules: {
          sentences: QUOTE_SENTENCE_COUNT,
          minWords: QUOTE_MIN_WORDS_PER_SENTENCE,
          maxWords: QUOTE_MAX_WORDS_PER_SENTENCE,
        },
      })
    ).trim();

    if (!text) continue;
    best ||= text;

    const check = checkQuote(text);
    const duplicate = seen.has(quoteFingerprint(text));

    if (check.ok && !duplicate) {
      return { text, generated, attempts: attempt };
    }

    // Name the exact failure so the next attempt is a correction, not a reroll.
    problems.length = 0;
    problems.push(...check.problems);
    if (duplicate) {
      problems.push("Bu iqtibos allaqachon ishlatilgan — butunlay boshqasini yozing.");
    }
    // The closest attempt so far is what survives if every try fails.
    if (check.ok) best = text;
  }

  console.warn(
    `[quote] rules not met after ${MAX_ATTEMPTS} attempts intake=${params.intakeId}`,
  );
  return { text: best || raw, generated, attempts: MAX_ATTEMPTS };
}

/**
 * Polishes and stores the quote for one intake.
 *
 * Written to `candidate_intakes.post_quote`, never over the answer row: the
 * candidate's raw wording stays exactly as they typed it and remains the thing
 * an editor sees next to the polished version.
 */
export async function applyPostQuote(params: PolishQuoteParams): Promise<PolishedQuote> {
  const result = await polishOrGenerateQuote(params);
  if (!result.text.trim()) return result;

  const db = createSupabaseAdminClient();
  await db
    .from("candidate_intakes")
    .update({
      post_quote: result.text,
      post_quote_generated: result.generated,
      post_quote_at: new Date().toISOString(),
    })
    .eq("id", params.intakeId);

  await logAudit({
    actorId: params.actorId,
    action: result.generated ? "intake.quote_generated" : "intake.quote_polished",
    entityType: "candidate_intake",
    entityId: params.intakeId,
    severity: "info",
    metadata: { generated: result.generated, attempts: result.attempts },
  });

  return result;
}
