import "server-only";

import OpenAI from "openai";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { candidateAiOutputSchema, type CandidateAiOutput, type CandidateStructuredData } from "./schema.ts";
import { serializeCandidateData } from "./serializer.ts";

let client: OpenAI | null = null;

function openai(): OpenAI {
  if (!client) client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return client;
}

const CANDIDATE_OUTPUT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "fullName", "description", "birthYear", "birthPlace", "currentLocation",
    "education", "activityField", "languages", "sections",
  ],
  properties: {
    fullName: { type: "string" },
    description: { type: "array", items: { type: "string" } },
    birthYear: { type: "string" },
    birthPlace: { type: "string" },
    currentLocation: { type: "string" },
    education: { type: "string" },
    activityField: { type: "string" },
    languages: { type: "array", items: { type: "string" } },
    sections: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "content", "order"],
        properties: {
          title: { type: "string" },
          content: { type: "string" },
          order: { type: "integer" },
        },
      },
    },
  },
} as const;

const SYSTEM_PROMPT = `Sen Liderlar.uz platformasidagi "Jaxongir AI" professional biografik muharririsan.
Nomzodning xom javoblari va mavjud draftini qat'iy JSON sxemaga ajrat.

Qoidalar:
- hech qanday fakt, sana, yutuq, lavozim, til yoki tashkilot nomini o'zingdan qo'shma;
- tushunarsiz yoki berilmagan qiymatni bo'sh qoldir;
- ism, joy va nomlarni o'zgartirma; faqat aniq imlo xatosini tuzat;
- description va languages qisqa, takrorlanmaydigan elementlardan iborat bo'lsin;
- maqolani mazmunli, takrorlanmaydigan bo'limlarga ajrat;
- HTML, Markdown, marker yoki qo'shimcha izoh qaytarma;
- mavjud admin ma'lumotini faqat raw javob aniqroq bo'lsa yangila.`;

export interface CandidateAiResult {
  data: CandidateAiOutput;
  model: string;
  rawResponse: unknown;
}

export async function structureCandidateWithAi(params: {
  rawText: string;
  current: CandidateStructuredData;
  actorId: string;
  candidateId?: string | null;
  intakeId?: string | null;
}): Promise<CandidateAiResult> {
  const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";
  const admin = createSupabaseAdminClient();
  const entityId = params.candidateId ?? params.intakeId ?? null;
  const { data: job } = await admin
    .from("ai_jobs")
    .insert({
      kind: "candidate.structure",
      status: "running",
      entity_type: params.candidateId ? "candidate" : "candidate_intake",
      entity_id: entityId,
      input_chars: params.rawText.length,
      model,
      created_by: params.actorId,
    })
    .select("id")
    .single();

  try {
    const completion = await openai().chat.completions.create({
      model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            "MAVJUD STRUKTURALANGAN DRAFT:",
            serializeCandidateData(params.current) || "(bo‘sh)",
            "",
            "NOMZODNING XOM MA’LUMOTLARI:",
            params.rawText.slice(0, 120_000),
          ].join("\n"),
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: "candidate_profile", strict: true, schema: CANDIDATE_OUTPUT_JSON_SCHEMA },
      },
    });
    const message = completion.choices[0]?.message;
    if (message?.refusal) throw new Error(`AI so‘rovni rad etdi: ${message.refusal}`);
    const raw = message?.content ?? "{}";
    const json = JSON.parse(raw) as unknown;
    const parsed = candidateAiOutputSchema.safeParse(json);
    if (!parsed.success) throw new Error("AI javobi candidate sxemasiga mos kelmadi");

    if (job?.id) {
      await admin.from("ai_jobs").update({
        status: "succeeded",
        output_chars: raw.length,
        finished_at: new Date().toISOString(),
      }).eq("id", job.id);
    }
    await logAudit({
      actorId: params.actorId,
      action: "candidate.ai.structure",
      entityType: params.candidateId ? "candidate" : "candidate_intake",
      entityId,
      metadata: { model, inputChars: params.rawText.length, sections: parsed.data.sections.length },
    });
    return { data: parsed.data, model, rawResponse: json };
  } catch (error) {
    if (job?.id) {
      await admin.from("ai_jobs").update({
        status: "failed",
        error: error instanceof Error ? error.message.slice(0, 500) : "unknown",
        finished_at: new Date().toISOString(),
      }).eq("id", job.id);
    }
    throw error;
  }
}

