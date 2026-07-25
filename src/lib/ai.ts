import "server-only";
import OpenAI from "openai";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";

let client: OpenAI | null = null;

function getOpenAI(): OpenAI {
  if (!client) client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return client;
}

export interface ImproveResult {
  improved: string;
  facts: string[];
  warnings: string[];
}

const SYSTEM_PROMPT = `Sen Liderlar.uz platformasining professional muharriri "Jaxongir AI"san.
Vazifang — nomzod yuborgan xom matnni professional biografik uslubga keltirish.

QOIDALAR:
1. Imlo va uslubiy xatolarni tuzat, takrorlarni kamaytir, gaplarni ravon yoz.
2. Birinchi shaxsni uchinchi shaxsga o'tkaz: "men tadbirda qatnashdim" -> "u tadbirda qatnashdi" yoki nomzod ismi bilan.
3. Sana, ism, tashkilot, yutuq va raqamlarni O'ZGARTIRMA.
4. Mavjud bo'lmagan faktni QO'SHMA. Nomzod fikrini boshqa ma'noga BURMA.
5. Mazmunni dinamik, professional va motivatsion uslubda yoz. Matn o'zbek tilida bo'lsin.
6. Matndagi barcha muhim faktlarni (sana, ism, tashkilot, raqam, yutuq) "facts" ro'yxatiga chiqaz.
7. Ishonching komil bo'lmagan yoki tekshirish kerak bo'lgan joylarni "warnings" ro'yxatiga yoz.

Javobni faqat quyidagi JSON formatida qaytar:
{"improved": "...", "facts": ["..."], "warnings": ["..."]}`;

/**
 * Runs the Jaxongir AI editorial pass. Server-only: the OpenAI key never
 * reaches the client. Every call is recorded in ai_jobs + audit_logs.
 */
export async function improveText(options: {
  text: string;
  candidateName?: string;
  context?: string;
  entityType: string;
  entityId?: string | null;
  actorId: string;
}): Promise<ImproveResult> {
  const admin = createSupabaseAdminClient();
  const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

  const { data: job } = await admin
    .from("ai_jobs")
    .insert({
      kind: "improve_text",
      status: "running",
      entity_type: options.entityType,
      entity_id: options.entityId ?? null,
      input_chars: options.text.length,
      model,
      created_by: options.actorId,
    })
    .select("id")
    .single();

  try {
    const userPrompt = [
      options.candidateName ? `Nomzod ismi: ${options.candidateName}` : null,
      options.context ? `Kontekst: ${options.context}` : null,
      "Quyidagi matnni qoidalarga muvofiq qayta ishla:",
      "---",
      options.text,
    ]
      .filter(Boolean)
      .join("\n");

    const completion = await getOpenAI().chat.completions.create({
      model,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    let parsed: Partial<ImproveResult>;
    try {
      parsed = JSON.parse(raw) as Partial<ImproveResult>;
    } catch {
      parsed = { improved: raw };
    }

    const result: ImproveResult = {
      improved: typeof parsed.improved === "string" ? parsed.improved : options.text,
      facts: Array.isArray(parsed.facts) ? parsed.facts.map(String) : [],
      warnings: Array.isArray(parsed.warnings) ? parsed.warnings.map(String) : [],
    };

    if (job) {
      await admin
        .from("ai_jobs")
        .update({
          status: "succeeded",
          output_chars: result.improved.length,
          finished_at: new Date().toISOString(),
        })
        .eq("id", job.id);
    }

    await logAudit({
      actorId: options.actorId,
      action: "ai.improve",
      entityType: options.entityType,
      entityId: options.entityId ?? null,
      severity: "info",
      metadata: {
        model,
        input_chars: options.text.length,
        output_chars: result.improved.length,
        warnings: result.warnings.length,
      },
    });

    return result;
  } catch (err) {
    if (job) {
      await admin
        .from("ai_jobs")
        .update({
          status: "failed",
          error: err instanceof Error ? err.message.slice(0, 500) : "unknown",
          finished_at: new Date().toISOString(),
        })
        .eq("id", job.id);
    }
    throw err;
  }
}
