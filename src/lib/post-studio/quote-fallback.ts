import "server-only";
import OpenAI from "openai";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { resolveModel } from "@/lib/ai-models";
import {
  checkQuote,
  QUOTE_MAX_WORDS_PER_SENTENCE,
  QUOTE_MIN_WORDS_PER_SENTENCE,
  QUOTE_SENTENCE_COUNT,
} from "@/lib/intake/quote-rules";

/**
 * IQTIBOS YOZILMAGANDA — nomzod nomidan yozib beriladi.
 *
 * NEGA KERAK: 15-savolga javob bermagan nomzodning posti
 * `needs_review` ga tushib, "iqtibosni qo'lda kiriting" deb turib
 * qolardi. Amalda bu post umuman chiqmasligini anglatardi.
 *
 * NEGA XAVFSIZ: model FAKT o'ylab topmaydi. Unga faqat nomzodning
 * O'Z materiali beriladi (qisqa tavsif va maqola matni) va undan
 * umumiy, shaxsiy fakt da'vo qilmaydigan ikki gap so'raladi — sana,
 * raqam, tashkilot nomi va yutuq TAQIQLANADI. Ya'ni chiqadigan gap
 * "men har kuni o'z ustimda ishlayman" turidagi qarash bo'ladi,
 * "men 2019-yilda falon mukofotni oldim" emas.
 *
 * Natija ALOHIDA manba (`ai_generated`) sifatida belgilanadi, shuning
 * uchun admin uni bir qarashda ajratadi va xohlasa almashtiradi.
 */

let client: OpenAI | null = null;
function openai(): OpenAI {
  if (!client) client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return client;
}

/** Ikkinchi urinishdan keyin to'xtaydi — bu bezak, sotuv emas. */
const MAX_ATTEMPTS = 2;
/** Modelga beriladigan material chegarasi. */
const MAX_SOURCE_CHARS = 6000;

const SYSTEM_PROMPT = `Sen Liderlar.uz ensiklopediyasi uchun post iqtiboslarini tayyorlaysan.

Senga nomzodning O'Z materiali beriladi. Undan nomzod NOMIDAN, birinchi
shaxsda ayta oladigan qisqa iqtibos yoz.

QAT'IY QOIDALAR:
1. AYNAN ${QUOTE_SENTENCE_COUNT} ta gap. Har gapda ${QUOTE_MIN_WORDS_PER_SENTENCE}-${QUOTE_MAX_WORDS_PER_SENTENCE} ta so'z.
2. Har gap nuqta, undov yoki so'roq belgisi bilan tugasin.
3. FAKT AYTMA: sana, raqam, foiz, mukofot nomi, tashkilot nomi, lavozim
   va yutuq YOZMA. Bular tekshirilmagan da'vo bo'lib qoladi.
4. Umumiy hayotiy qarash yoki tamoyil yoz — nomzodning faoliyat
   yo'nalishiga mos, lekin aniq voqeaga bog'lanmagan.
5. Birinchi shaxsda: "men", "-man", "-yman" shaklida.
6. Tirnoq belgisi qo'yma, faqat gaplarning o'zini yoz.
7. O'zbek tilida, lotin yozuvida.

Javobni FAQAT quyidagi JSON shaklida qaytar:
{"quote": "Birinchi gap. Ikkinchi gap."}`;

export interface FallbackQuoteInput {
  candidateId: string;
  fullName: string;
  shortBioItems: readonly string[];
  /** Maqola matni — nomzodning o'z materiali. */
  articleText?: string | null;
  actorId?: string | null;
}

export interface FallbackQuoteResult {
  ok: boolean;
  text: string | null;
  /** Nega chiqmagani — post izohida ko'rinadi. */
  error?: string;
  attempts: number;
}

/** Modelga beriladigan material. */
function buildSourceText(input: FallbackQuoteInput): string {
  return [
    `Nomzod: ${input.fullName}`,
    input.shortBioItems.length > 0 ? `Yo'nalishi: ${input.shortBioItems.join(", ")}` : null,
    input.articleText?.trim()
      ? `Maqolasidan parcha:\n${input.articleText.trim().slice(0, MAX_SOURCE_CHARS)}`
      : null,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export async function generateFallbackQuote(
  input: FallbackQuoteInput,
): Promise<FallbackQuoteResult> {
  if (!process.env.OPENAI_API_KEY) {
    return { ok: false, text: null, error: "OPENAI_API_KEY sozlanmagan", attempts: 0 };
  }

  const model = resolveModel("intake");
  const source = buildSourceText(input);
  let attempts = 0;
  let lastProblem = "";

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    attempts += 1;
    try {
      const completion = await openai().chat.completions.create({
        model,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: lastProblem
              ? `${source}\n\nOLDINGI URINISH QOIDAGA MOS KELMADI:\n${lastProblem}\nQaytadan yoz.`
              : source,
          },
        ],
      });

      const raw = completion.choices[0]?.message?.content ?? "{}";
      const parsed = JSON.parse(raw) as { quote?: unknown };
      const text = typeof parsed.quote === "string" ? parsed.quote.trim() : "";
      if (!text) {
        lastProblem = "Javob bo'sh keldi.";
        continue;
      }

      // Qoidalar nomzodning o'ziga ko'rsatilgani bilan AYNI — iqtibos
      // posterga o'sha qutiga chiqadi va o'lchamlari bir xil bo'lishi kerak.
      const check = checkQuote(text);
      if (check.ok) {
        await recordJob(input, model, text, attempts, null);
        return { ok: true, text, attempts };
      }
      lastProblem = check.problems.join(" ");
    } catch (err) {
      lastProblem = err instanceof Error ? err.message : String(err);
    }
  }

  await recordJob(input, model, null, attempts, lastProblem);
  return {
    ok: false,
    text: null,
    error: lastProblem || "Iqtibos yaratilmadi",
    attempts,
  };
}

/** Yugurish `ai_jobs` ga yoziladi — sarf ko'rinib tursin. */
async function recordJob(
  input: FallbackQuoteInput,
  model: string,
  text: string | null,
  attempts: number,
  error: string | null,
): Promise<void> {
  try {
    const admin = createSupabaseAdminClient();
    await admin.from("ai_jobs").insert({
      kind: "post.fallback_quote",
      status: text ? "succeeded" : "failed",
      entity_type: "candidate",
      entity_id: input.candidateId,
      output_chars: text?.length ?? 0,
      model,
      attempts,
      error,
      created_by: input.actorId ?? null,
      finished_at: new Date().toISOString(),
    });
  } catch {
    // O'lchov yozuvi asosiy ishni to'xtatmaydi.
  }
}
