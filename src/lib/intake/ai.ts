import "server-only";
import OpenAI from "openai";
import { z } from "zod";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import {
  preparePhotoEditSource,
  requestOpenAIImageEdit,
  standardizePhotoEditSource,
} from "./photo-edit";
import type { AnswerImprover } from "./answer-improvement";
import { formatMissingFactsPrompt } from "./fact-preservation";

let client: OpenAI | null = null;
function openai(): OpenAI {
  if (!client) client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return client;
}

export function textModel(): string {
  return process.env.OPENAI_MODEL ?? "gpt-4o-mini";
}
export function imageModel(): string {
  return process.env.OPENAI_IMAGE_MODEL ?? "gpt-image-2";
}
export function moderationModel(): string {
  return process.env.OPENAI_MODERATION_MODEL ?? "omni-moderation-latest";
}

/* ============================================================
 * Structured text review (Jaxongir AI editorial pass)
 * ============================================================ */

export const removedSegmentSchema = z.object({ text: z.string(), reason: z.string() });
export const factFlagSchema = z.object({
  type: z.enum(["conflict", "unclear", "missing_context", "unverified"]),
  claim: z.string(),
  explanation: z.string(),
});
export const reviewedAnswerSchema = z.object({
  question_no: z.number().int(),
  original_text: z.string(),
  improved_text: z.string(),
  preserved_facts: z.array(z.string()),
  removed_segments: z.array(removedSegmentSchema),
  fact_flags: z.array(factFlagSchema),
  clarification_questions: z.array(z.string()),
  moderation_notes: z.array(z.string()),
  confidence: z.number(),
});
export const intakeReviewSchema = z.object({
  candidate_name: z.string(),
  answers: z.array(reviewedAnswerSchema),
  biography_draft: z.string(),
  short_bio_items: z.array(z.string()),
  global_fact_conflicts: z.array(z.string()),
  editorial_commentary: z.string(),
  moderation_summary: z.string(),
  ready_for_editor_review: z.boolean(),
});
export type IntakeReview = z.infer<typeof intakeReviewSchema>;

/**
 * Strict JSON Schema mirror of intakeReviewSchema (additionalProperties:false,
 * every field required) — used with OpenAI Structured Outputs. Kept in hand so
 * the build never depends on a zod→json-schema helper matching the Zod version.
 */
const INTAKE_REVIEW_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "candidate_name", "answers", "biography_draft", "short_bio_items",
    "global_fact_conflicts", "editorial_commentary", "moderation_summary",
    "ready_for_editor_review",
  ],
  properties: {
    candidate_name: { type: "string" },
    answers: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "question_no", "original_text", "improved_text", "preserved_facts",
          "removed_segments", "fact_flags", "clarification_questions",
          "moderation_notes", "confidence",
        ],
        properties: {
          question_no: { type: "integer" },
          original_text: { type: "string" },
          improved_text: { type: "string" },
          preserved_facts: { type: "array", items: { type: "string" } },
          removed_segments: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["text", "reason"],
              properties: { text: { type: "string" }, reason: { type: "string" } },
            },
          },
          fact_flags: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["type", "claim", "explanation"],
              properties: {
                type: { type: "string", enum: ["conflict", "unclear", "missing_context", "unverified"] },
                claim: { type: "string" },
                explanation: { type: "string" },
              },
            },
          },
          clarification_questions: { type: "array", items: { type: "string" } },
          moderation_notes: { type: "array", items: { type: "string" } },
          confidence: { type: "number" },
        },
      },
    },
    biography_draft: { type: "string" },
    short_bio_items: { type: "array", items: { type: "string" } },
    global_fact_conflicts: { type: "array", items: { type: "string" } },
    editorial_commentary: { type: "string" },
    moderation_summary: { type: "string" },
    ready_for_editor_review: { type: "boolean" },
  },
} as const;

const SYSTEM_PROMPT = `SEN BIOGRAFIK MA'LUMOTLARNI TAHRIR QILUVCHI MUHARRIRSAN.

VAZIFANG — JAVOBNI QISQARTIRISH EMAS. Bu tahrir bosqichi, xulosa bosqichi emas.

Nomzod bergan BARCHA fakt, sana, son, foiz, tashkilot, universitet, fakultet,
kurs, lavozim, mukofot, ko'krak nishoni, sertifikat, loyiha, tanlov, tadbir,
til, qiziqish, shior, iqtibos, orzu va maqsadni TO'LIQ saqla.

Hech qanday aniq ma'lumotni umumiy jumlaga almashtirma.

NOTO'G'RI: "U turli yutuqlarga erishgan."
TO'G'RI:  "U 2024-yilda xalqaro do'stlik festivalida ishtirok etgan,
           'Do'stlik elchisi' ko'krak nishoni va tashakkurnomalarga sazovor bo'lgan."

NOTO'G'RI: "U buxgalteriya sohasida faoliyat yuritadi."
TO'G'RI:  "U 2024-yilda faoliyatini 3 ta korxona bilan boshlagan. Bugungi kunda
           esa 23 ta xususiy korxonaning hisob-kitoblarini yuritib kelmoqda."

Har bir son va sana aynan saqlansin. Ikki javobni bitta umumiy gapga birlashtirma.

FAQAT QUYIDAGILARNI O'ZGARTIR:
- imlo va tinish belgilari xatolari;
- uslub va gap tuzilishi;
- birinchi shaxsni UCHINCHI shaxsga o'tkazish
  ("Men Edinburg universitetida o'qiganman" -> "U Edinburg universitetida tahsil olgan");
- chalkash jumlalarni tushunarli qilish;
- faktlarni mantiqiy tartibga solish;
- nomaqbul so'z va iboralarni olib tashlash (removed_segments'ga sabab bilan yoz).

QAT'IY TAQIQLAR — HECH QACHON:
- yangi fakt to'qima;
- sanani, tashkilot nomini, mukofot darajasini yoki lavozimni o'zgartirma yoki oshirma;
- noaniq faktni "aniq fakt" qilib yozma;
- nomzod aytmagan yutuqni qo'shma.

Javobda noaniqlik yoki ziddiyat bo'lsa, faktni O'ZGARTIRMA — uni fact_flags va
clarification_questions'ga chiqar.

Har bir javob uchun:
- original_text'ni O'ZGARTIRMASDAN qaytar;
- improved_text'ni alohida ber;
- preserved_facts'ga o'sha javobdagi har bir aniq ma'lumotni (sana, son,
  tashkilot, mukofot, iqtibos) alohida element sifatida yoz.

short_bio_items — nomzodni ifodalovchi juda qisqa yorliqlar ro'yxati:
ko'pi bilan 5 ta, har biri 1-5 so'z va 40 belgidan oshmasin, to'liq gap bo'lmasin,
nuqta bilan tugamasin. Masalan: ["Filolog", "Kitobxon", "Yosh volontyor"].
Bu maydonga uzun xatboshi yozish QAT'IYAN taqiqlanadi.

Barcha matn o'zbek tilida. Faqat berilgan JSON sxemaga mos javob qaytar.`;

/**
 * Retry prompt for a single answer that lost facts on the previous pass. It
 * carries the explicit missing list so the model repairs the omission instead
 * of rewriting the answer from scratch.
 */
const ANSWER_RETRY_SYSTEM_PROMPT = `Sen biografik ma'lumotlarni tahrir qiluvchi muharrirsan.

Oldingi tahriring nomzod bergan ba'zi aniq ma'lumotlarni TUSHIRIB QOLDIRDI.

Endi javobni qayta yoz. Yo'qolgan ma'lumotlarning HAMMASI qaytarilsin va
oldingi tahrirdagi to'g'ri qismlar saqlansin.

Qoidalar:
- matnni qisqartirma, aksincha yo'qolgan faktlarni qaytar;
- har bir son, sana, tashkilot, mukofot va iqtibosni aynan yoz;
- yangi fakt to'qima — faqat ORIGINAL javobdagi ma'lumotlar bilan ishla;
- uchinchi shaxsda yoz;
- o'zbek tilida yoz.

Faqat tayyor tahrirlangan matnni qaytar. Izoh, sarlavha yoki marker yozma.`;

export interface ReviewInputAnswer {
  question_no: number;
  prompt: string;
  plain_text: string;
}

async function recordAiRun(params: {
  intakeId: string;
  kind: string;
  status: "completed" | "failed";
  model: string;
  /** Null for automated (pipeline) runs that have no human actor. */
  actorId: string | null;
  idempotencyKey?: string | null;
  inputSummary: Record<string, unknown>;
  output?: unknown;
  error?: string;
}) {
  // Audit is best-effort: a duplicate idempotency_key or transient error must
  // never break the AI flow itself.
  try {
    const admin = createSupabaseAdminClient();
    const { data: job } = await admin
      .from("ai_jobs")
      .insert({
        kind: `intake.${params.kind}`,
        status: params.status === "completed" ? "succeeded" : "failed",
        entity_type: "candidate_intake",
        entity_id: params.intakeId,
        model: params.model,
        created_by: params.actorId,
        finished_at: new Date().toISOString(),
        error: params.error ?? null,
      })
      .select("id")
      .single();

    await admin.from("candidate_intake_ai_runs").insert({
      intake_id: params.intakeId,
      ai_job_id: job?.id ?? null,
      kind: params.kind,
      status: params.status,
      model: params.model,
      idempotency_key: params.idempotencyKey ?? null,
      input_summary: params.inputSummary,
      output: params.output ?? null,
      error: params.error ?? null,
      created_by: params.actorId,
      finished_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error("intake ai-run audit write failed");
    void err;
  }
}

/**
 * Re-edits a single answer that dropped facts. Driven by
 * enforceFactPreservation(), which decides whether the result is good enough to
 * keep — this function only performs the call.
 */
export const improveAnswerPreservingFacts: AnswerImprover = async (request) => {
  const completion = await openai().chat.completions.create({
    model: textModel(),
    messages: [
      { role: "system", content: ANSWER_RETRY_SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          `SAVOL: ${request.questionPrompt}`,
          "",
          "NOMZODNING ASL JAVOBI:",
          request.original,
          "",
          "SENING OLDINGI TAHRIRING:",
          request.previousAttempt,
          "",
          formatMissingFactsPrompt(request.missingFacts),
        ].join("\n"),
      },
    ],
  });
  return completion.choices[0]?.message?.content?.trim() ?? "";
};

/**
 * Runs the structured editorial pass over a set of answers. Throws on OpenAI
 * refusal, timeout, or output that fails schema validation.
 */
export async function reviewIntakeAnswers(params: {
  intakeId: string;
  candidateName: string;
  answers: ReviewInputAnswer[];
  /** Null when the automated pipeline runs the pass with no human actor. */
  actorId: string | null;
  idempotencyKey?: string | null;
}): Promise<IntakeReview> {
  const model = textModel();
  const userPrompt = [
    `Nomzod ismi: ${params.candidateName}`,
    "Quyidagi savollar va nomzodning xom javoblari:",
    ...params.answers.map(
      (a) => `#${a.question_no}. ${a.prompt}\nJAVOB: ${a.plain_text || "(bo'sh)"}`,
    ),
  ].join("\n\n");

  try {
    const completion = await openai().chat.completions.create({
      model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: "intake_review", strict: true, schema: INTAKE_REVIEW_JSON_SCHEMA },
      },
    });

    const message = completion.choices[0]?.message;
    if (message?.refusal) {
      throw new Error(`AI rad etdi: ${message.refusal}`);
    }
    const raw = message?.content ?? "{}";
    const parsed = intakeReviewSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      throw new Error("AI javobi kutilgan sxemaga mos kelmadi");
    }

    await recordAiRun({
      intakeId: params.intakeId,
      kind: "improve_all",
      status: "completed",
      model,
      actorId: params.actorId,
      idempotencyKey: params.idempotencyKey,
      inputSummary: { answers: params.answers.length, chars: userPrompt.length },
      output: { ready: parsed.data.ready_for_editor_review, answers: parsed.data.answers.length },
    });
    await logAudit({
      actorId: params.actorId,
      action: "intake.ai.improve_all",
      entityType: "candidate_intake",
      entityId: params.intakeId,
      metadata: { model, answers: params.answers.length },
    });

    return parsed.data;
  } catch (err) {
    await recordAiRun({
      intakeId: params.intakeId,
      kind: "improve_all",
      status: "failed",
      model,
      actorId: params.actorId,
      idempotencyKey: params.idempotencyKey,
      inputSummary: { answers: params.answers.length },
      error: err instanceof Error ? err.message.slice(0, 500) : "unknown",
    });
    throw err;
  }
}

/* ============================================================
 * Moderation (text + image; audio -> manual/transcript)
 * ============================================================ */

export interface ModerationResult {
  flagged: boolean;
  categories: string[];
}

export async function moderateContent(inputs: {
  texts?: string[];
  imageUrls?: string[];
}): Promise<ModerationResult> {
  const input: Array<
    { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }
  > = [];
  for (const t of inputs.texts ?? []) if (t.trim()) input.push({ type: "text", text: t.slice(0, 8000) });
  for (const u of inputs.imageUrls ?? []) input.push({ type: "image_url", image_url: { url: u } });
  if (input.length === 0) return { flagged: false, categories: [] };

  const res = await openai().moderations.create({ model: moderationModel(), input });
  const flaggedCats = new Set<string>();
  let flagged = false;
  for (const r of res.results) {
    if (r.flagged) flagged = true;
    for (const [cat, on] of Object.entries(r.categories)) if (on) flaggedCats.add(cat);
  }
  return { flagged, categories: [...flaggedCats] };
}

/* ============================================================
 * Image standardization (OpenAI Image edit)
 * ============================================================ */

export interface PhotoEditResult {
  outputBuffer: Buffer;
}

/**
 * Edits an existing portrait into a standardized professional photo. The model
 * comes from OPENAI_IMAGE_MODEL (never hardcoded). Returns base64 PNG data for
 * the caller to store in the private bucket.
 */
export async function editIntakePhoto(params: {
  imageBytes: Uint8Array;
  mime: string;
  prompt: string;
}): Promise<PhotoEditResult> {
  const model = imageModel();
  const uploadedSource = preparePhotoEditSource({
    imageBytes: params.imageBytes,
    mime: params.mime,
  });
  const source = await standardizePhotoEditSource(uploadedSource);
  return {
    outputBuffer: await requestOpenAIImageEdit({
      source,
      model,
      prompt: params.prompt,
      apiKey: process.env.OPENAI_API_KEY,
      diagnosticSource: {
        mime: uploadedSource.mime,
        bytes: uploadedSource.buffer.length,
      },
    }),
  };
}
