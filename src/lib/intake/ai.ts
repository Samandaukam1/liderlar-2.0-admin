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
  short_bio: z.string(),
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
    "candidate_name", "answers", "biography_draft", "short_bio",
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
          "question_no", "original_text", "improved_text", "removed_segments",
          "fact_flags", "clarification_questions", "moderation_notes", "confidence",
        ],
        properties: {
          question_no: { type: "integer" },
          original_text: { type: "string" },
          improved_text: { type: "string" },
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
    short_bio: { type: "string" },
    global_fact_conflicts: { type: "array", items: { type: "string" } },
    editorial_commentary: { type: "string" },
    moderation_summary: { type: "string" },
    ready_for_editor_review: { type: "boolean" },
  },
} as const;

const SYSTEM_PROMPT = `Sen Liderlar.uz platformasining professional muharriri "Jaxongir AI"san.
Nomzod bergan xom biografik javoblarni professional adabiy uslubga keltirasan.

QAT'IY TAQIQLAR — AI HECH QACHON:
- yangi fakt ixtiro qilmaydi;
- sanani, tashkilot nomini, mukofot darajasini, lavozimni O'ZGARTIRMAYDI yoki OSHIRMAYDI;
- mavjud bo'lmagan yutuq qo'shmaydi;
- noaniq faktni "aniq fakt" qilib yozmaydi.

AI QILADI:
- imlo va uslub xatolarini tuzatadi, takrorlarni kamaytiradi, ravon yozadi;
- birinchi shaxsni UCHINCHI shaxsga o'tkazadi (nomzod ismi yoki "u" bilan);
  masalan "Men Edinburg universitetida o'qiganman" -> "U Edinburg universitetida tahsil olgan";
- so'kinish, haqorat va nomaqbul iboralarni yakuniy matndan olib tashlaydi va
  ularni removed_segments'ga sabab bilan yozadi;
- bir-biriga zid faktlarni fact_flags va global_fact_conflicts'ga chiqaradi;
- aniqlashtirish kerak bo'lgan joylarga clarification_questions yozadi;
- tahliliy editorial_commentary va ishonch darajasini (confidence 0..1) qaytaradi.

Har bir javob uchun original_text'ni O'ZGARTIRMASDAN qaytar, improved_text'ni alohida ber.
Barcha matn o'zbek tilida. Faqat berilgan JSON sxemaga mos javob qaytar.`;

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
  actorId: string;
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
 * Runs the structured editorial pass over a set of answers. Throws on OpenAI
 * refusal, timeout, or output that fails schema validation.
 */
export async function reviewIntakeAnswers(params: {
  intakeId: string;
  candidateName: string;
  answers: ReviewInputAnswer[];
  actorId: string;
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
