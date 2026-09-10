/**
 * Quvur bosqichlari — SOF modul.
 *
 * NEGA `pipeline.ts` DAN AJRATILDI: bosqich nomi bot ro'yxatlarida ham
 * kerak bo'lib qoldi ("texnik xato aynan qayerda bo'ldi"), lekin
 * `pipeline.ts` da `server-only` va Supabase bor — uni bot xabarlarini
 * yasaydigan sof moduldan import qilib bo'lmaydi.
 *
 * Yorliqlar YAGONA manbada qoladi: `pipeline.ts` ularni shu yerdan
 * qayta eksport qiladi, ya'ni ikki nusxa paydo bo'lmaydi.
 */

export type PipelineStage =
  | "ai_improvement"
  | "fact_validation"
  | "approval"
  | "promotion"
  | "publication"
  | "post_draft"
  | "portrait"
  | "render"
  | "caption"
  | "telegram"
  | "done";

/** Uzbek labels for the admin batch table's live "joriy bosqich" column. */
export const PIPELINE_STAGE_LABELS: Record<PipelineStage, string> = {
  ai_improvement: "Jaxongir AI — javoblarni yaxshilash",
  fact_validation: "Faktlarni tekshirish",
  approval: "Tasdiqlanmoqda",
  promotion: "Nomzodga aylantirilmoqda",
  publication: "Nashr qilinmoqda",
  post_draft: "Post yaratilmoqda",
  portrait: "Portret tayyorlanmoqda",
  render: "Post render qilinmoqda",
  caption: "Caption tayyorlanmoqda",
  telegram: "Telegramga yuborilmoqda",
  done: "Tayyor",
};

/** Noma'lum kalit o'z holicha qaytadi — hech narsa yashirilmaydi. */
export function pipelineStageLabel(stage: string): string {
  return PIPELINE_STAGE_LABELS[stage as PipelineStage] ?? stage;
}

/**
 * Xato matnidan bosqichni ajratadi.
 *
 * `fail()` xatoni `"<bosqich>: <matn>"` shaklida yozadi. Bot ro'yxatida
 * "texnik xato aynan qayerda bo'lgani" aynan shu prefiksdan kelib
 * chiqadi; prefiks bo'lmasa butun matn izoh bo'lib qoladi.
 */
export function splitPipelineError(
  raw: string | null | undefined,
): { stage: PipelineStage | null; message: string } {
  const text = (raw ?? "").trim();
  if (text === "") return { stage: null, message: "" };

  const separator = text.indexOf(":");
  if (separator === -1) return { stage: null, message: text };

  const candidate = text.slice(0, separator).trim();
  if (!(candidate in PIPELINE_STAGE_LABELS)) return { stage: null, message: text };

  return {
    stage: candidate as PipelineStage,
    message: text.slice(separator + 1).trim(),
  };
}
