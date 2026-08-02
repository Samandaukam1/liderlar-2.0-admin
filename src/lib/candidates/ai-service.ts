import "server-only";

import OpenAI from "openai";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { candidateAiOutputSchema, type CandidateAiOutput, type CandidateStructuredData } from "./schema.ts";
import { serializeCandidateData } from "./serializer.ts";
import { normalizeShortBioItems } from "./short-bio.ts";
import {
  ARTICLE_MAX_WORDS,
  ARTICLE_MIN_WORDS,
  ARTICLE_TARGET_MAX_WORDS,
  ARTICLE_TARGET_MIN_WORDS,
  evaluateArticle,
  formatArticleFixPrompt,
  type ArticleQualityReport,
} from "./article-quality.ts";

let client: OpenAI | null = null;

function openai(): OpenAI {
  if (!client) client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return client;
}

/** A full biographical article needs far more room than the SDK default. */
const ARTICLE_MAX_COMPLETION_TOKENS = 16_000;
/** How many corrective re-runs a failed quality gate may trigger. */
export const MAX_ARTICLE_REGENERATIONS = 2;

const CANDIDATE_OUTPUT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "fullName", "shortBioItems", "birthYear", "birthPlace", "currentLocation",
    "education", "activityField", "languages", "keyFacts", "introduction",
    "sections", "conclusion", "quotes", "usedFacts", "unresolvedIssues",
  ],
  properties: {
    fullName: { type: "string" },
    shortBioItems: { type: "array", items: { type: "string" } },
    birthYear: { type: "string" },
    birthPlace: { type: "string" },
    currentLocation: { type: "string" },
    education: { type: "string" },
    activityField: { type: "string" },
    languages: { type: "array", items: { type: "string" } },
    keyFacts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["label", "value"],
        properties: { label: { type: "string" }, value: { type: "string" } },
      },
    },
    introduction: { type: "string" },
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
    conclusion: { type: "string" },
    quotes: { type: "array", items: { type: "string" } },
    usedFacts: { type: "array", items: { type: "string" } },
    unresolvedIssues: { type: "array", items: { type: "string" } },
  },
} as const;

const SYSTEM_PROMPT = `SEN O'ZBEK TILIDA KENG, PROFESSIONAL VA DINAMIK BIOGRAFIK MAQOLALAR YOZADIGAN TAJRIBALI MUALLIFSAN.

Senga nomzodning savollarga bergan barcha javoblari va yaxshilangan javoblari beriladi.

SENING VAZIFANG QISQA XULOSA YOZISH EMAS.

Nomzodning hayot yo'li, ta'limi, faoliyati, yutuqlari, qarashlari, qiziqishlari
va kelajak maqsadlarini BO'LIMLARGA AJRATILGAN KENG BIOGRAFIK MAQOLA shaklida yorit.

QAT'IY QOIDALAR:
1. Hech qanday faktni o'zingdan to'qima.
2. Har bir aniq sana, son, tashkilot, ta'lim muassasasi, mukofot, loyiha va
   iqtibosni saqla.
3. Nomzodning javoblaridagi muhim ma'lumotlarni umumiy gapga almashtirma.
   NOTO'G'RI: "U turli yutuqlarga erishgan."
   TO'G'RI:  "U 2024-yilda xalqaro do'stlik festivalida ishtirok etgan,
              'Do'stlik elchisi' ko'krak nishoni bilan taqdirlangan."
4. Maqola xulosa yoki qisqa tarjimai hol bo'lmasin.
5. Maqola kamida ${ARTICLE_MIN_WORDS} so'z bo'lsin.
6. Ma'lumot yetarli bo'lsa ${ARTICLE_TARGET_MIN_WORDS}-${ARTICLE_TARGET_MAX_WORDS} so'z yoz, ${ARTICLE_MAX_WORDS} so'zdan oshirma.
7. Har bir bo'lim alohida mazmunli sarlavhaga ega bo'lsin.
8. Har bir bo'lim kamida 3-7 xatboshidan iborat bo'lsin va YANGI mazmun bersin.
9. Takroriy gaplardan qoch: bir xil fakt 3 martadan ko'p, bir xil iqtibos
   2 martadan ko'p ishlatilmasin. Kirish va yakun bir xil bo'lmasin.
10. Asossiz balandparvoz maqtov ishlatma ("eng buyuk", "tengsiz", "dunyoga
    mashhur", "o'z sohasining yetakchisi") — nomzod ma'lumotlari buni
    isbotlamasa, bunday ifodalarni yozma.
11. Nomzodning iqtiboslarini AYNAN saqla.
12. Yo'q ma'lumotni "noma'lum" yoki "kiritilmagan" deb yozma — o'sha qatorni
    yoki bo'limni umuman chiqarma.
13. Matn UCHINCHI shaxsda yozilsin.
14. O'zbek tili imlo va uslub qoidalariga rioya qil.
15. Maqola yakuni nomzodning bugungi yo'li va kelajak maqsadini kuchli, ammo
    REALISTIK tarzda bog'lasin.

MATNNI SUN'IY RAVISHDA CHO'ZISH TAQIQLANADI. Kenglik takrorlar bilan emas,
mavjud faktlarni alohida bo'limlarda chuqurroq ochish bilan ta'minlansin.

FAKT VA TAHLIL CHEGARASI:
Mavjud faktlardan kelib chiqib ehtiyotkor tahlil berishing MUMKIN
("...bo'lishi mumkin", "...ni ko'rsatadi", "uning qarashlarida namoyon bo'ladi").
Lekin YANGI biografik fakt yaratma. Nomzod aytmagan voqeani bayon qilma.

BO'LIM TANLASH:
Quyidagi mavzulardan FAQAT nomzod ma'lumotlariga tegishlilarini bo'lim qil:
kirish; tug'ilgan hudud va bolalik muhiti; shaxs sifatida shakllanishi; kasb
tanlashiga ta'sir qilgan omillar; maktab davri; o'rta professional ta'lim; oliy
ta'lim sari yo'l; universitetdagi faoliyat; mutaxassislik mazmuni; faoliyatining
boshlanishi; ish tajribasi; muhim loyihalar; aniq yutuqlar; sertifikat va
mukofotlar; forum, festival va tadbirlar; volontyorlik va jamoatchilik
faoliyati; hayotiy shior va prinsiplar; liderlik haqidagi qarashlari;
qiziqishlari; kitobxonlik yoki ijodiy faoliyat; kelajakdagi kasbiy maqsadlar;
jamiyatga xizmat qilish istagi; yoshlarga murojaat; kuchli yakun.
Majburan hamma bo'limni yozish SHART EMAS — ma'lumot bo'lmagan bo'limni tashla.

MAYDONLAR:
- shortBioItems: nomzodni ifodalovchi juda qisqa yorliqlar. Ko'pi bilan 5 ta,
  har biri 1-5 so'z va 40 belgidan oshmasin, to'liq gap bo'lmasin, nuqta bilan
  tugamasin. Masalan: ["Bo'lajak yurist", "Kitobxon", "Do'stlik elchisi"].
  Bu maydonga uzun xatboshi yozish QAT'IYAN taqiqlanadi.
- keyFacts: maqola boshidagi faktlar kartasi (label/value juftliklari:
  tug'ilgan sana, tug'ilgan joyi, yashash hududi, ta'lim muassasasi, fakulteti,
  yo'nalishi, bosqichi, faoliyat yo'nalishi, muhim yutug'i, qiziqishlari,
  kelajak maqsadi). FAQAT mavjud ma'lumotlarni yoz.
- introduction: maqolaning kirish qismi (bo'limlardan alohida).
- sections: hayot yo'lining ketma-ket bo'limlari.
- conclusion: kuchli yakun.
- quotes: nomzodning aynan saqlangan iqtiboslari.
- usedFacts: maqolada ishlatilgan aniq faktlar ro'yxati.
- unresolvedIssues: ziddiyatli yoki noaniq, muharrir tekshiruvini talab
  qiladigan joylar.

HTML, Markdown, marker yoki qo'shimcha izoh qaytarma. Faqat JSON sxemasi.`;

export interface CandidateAiResult {
  data: CandidateAiOutput;
  model: string;
  rawResponse: unknown;
  quality: ArticleQualityReport;
  /** How many corrective re-runs were needed (0 when the first draft passed). */
  regenerations: number;
}

function toArticleInput(data: CandidateAiOutput) {
  return {
    introduction: data.introduction,
    sections: data.sections.map((section) => ({ title: section.title, content: section.content })),
    conclusion: data.conclusion,
  };
}

/**
 * Generates the biographical article and enforces the quality gate. A draft
 * that came back as a summary — too short, or missing facts the candidate
 * supplied — is regenerated with an explicit corrective block rather than
 * saved. The best attempt is kept if the model never fully complies.
 */
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

  const baseUserContent = [
    "MAVJUD STRUKTURALANGAN DRAFT:",
    serializeCandidateData(params.current) || "(bo‘sh)",
    "",
    "NOMZODNING XOM MA’LUMOTLARI:",
    params.rawText.slice(0, 120_000),
  ].join("\n");

  try {
    let best: { data: CandidateAiOutput; raw: unknown; quality: ArticleQualityReport } | null = null;
    let regenerations = 0;

    for (let attempt = 0; attempt <= MAX_ARTICLE_REGENERATIONS; attempt += 1) {
      const fixBlock = best ? formatArticleFixPrompt(best.quality) : "";
      const completion = await openai().chat.completions.create({
        model,
        max_completion_tokens: ARTICLE_MAX_COMPLETION_TOKENS,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: fixBlock
              ? [
                  baseUserContent,
                  "",
                  "OLDINGI URINISHING QUYIDAGI TALABLARGA JAVOB BERMADI.",
                  "Maqolani shu kamchiliklarni bartaraf etgan holda QAYTA yoz:",
                  fixBlock,
                ].join("\n")
              : baseUserContent,
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

      const quality = evaluateArticle({
        article: toArticleInput(parsed.data),
        sourceText: params.rawText,
      });

      // Keep whichever attempt scored highest, so a failed retry never
      // downgrades an article that was already closer to the requirements.
      if (!best || quality.score > best.quality.score) {
        best = { data: parsed.data, raw: json, quality };
      }
      if (quality.ok) break;
      if (attempt < MAX_ARTICLE_REGENERATIONS) regenerations += 1;
    }

    if (!best) throw new Error("AI maqola qaytarmadi");

    // The badge row is bounded here as well as in the prompt: the schema alone
    // cannot stop the model from writing a sentence.
    const shortBio = normalizeShortBioItems(best.data.shortBioItems);
    const data: CandidateAiOutput = { ...best.data, shortBioItems: shortBio.items };

    if (job?.id) {
      await admin.from("ai_jobs").update({
        status: "succeeded",
        output_chars: JSON.stringify(best.raw).length,
        finished_at: new Date().toISOString(),
      }).eq("id", job.id);
    }
    await logAudit({
      actorId: params.actorId,
      action: "candidate.ai.structure",
      entityType: params.candidateId ? "candidate" : "candidate_intake",
      entityId,
      metadata: {
        model,
        inputChars: params.rawText.length,
        sections: data.sections.length,
        words: best.quality.wordCount,
        score: best.quality.score,
        regenerations,
      },
    });
    return { data, model, rawResponse: best.raw, quality: best.quality, regenerations };
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
