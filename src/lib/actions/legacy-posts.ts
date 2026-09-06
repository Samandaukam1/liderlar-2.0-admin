"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { sanitizeLegacyHtml } from "@/lib/legacy/sanitize-html";

/**
 * Liderlar 1.0 arxiv yozuvini tahrirlash.
 *
 * NIMANI TAHRIRLAB BO'LMAYDI va nega:
 *   · legacy_source_id / legacy_slug / legacy_path — bular eski URL'ning O'ZI.
 *     Ularni o'zgartirish tashqi saytlarda va qidiruv indeksida qolgan
 *     havolani sindiradi, ya'ni butun legacy route'ning ma'nosini yo'qotadi.
 *   · legacy_created_at — manbadagi haqiqiy sana. Uni qo'lda "to'g'irlash"
 *     tarixni o'ylab topish bilan barobar; manbada yo'q bo'lsa noma'lum
 *     bo'lib qolaveradi.
 *
 * Matn tahrirlanganda U HAM sanitizatsiyadan o'tadi: admin panelidan kelgan
 * HTML ham import bosqichidagi bir xil oq ro'yxatga bo'ysunadi.
 */

const schema = z.object({
  title: z.string().trim().min(1, "Sarlavha bo‘sh bo‘lmasin").max(300),
  summary: z.string().max(1000).optional().or(z.literal("")),
  legacy_status: z.enum(["published", "draft"]),
  cover_image_url: z.string().url("Rasm manzili to‘liq URL bo‘lishi kerak").optional().or(z.literal("")),
  content_html: z.string().max(200_000).optional().or(z.literal("")),
  candidate_id: z.string().uuid().optional().or(z.literal("")),
});

export interface LegacyActionResult {
  ok: boolean;
  error?: string;
}

const nullable = (value: string | undefined) =>
  value && value.trim() !== "" ? value.trim() : null;

export async function updateLegacyPostAction(
  id: string,
  formData: FormData,
): Promise<LegacyActionResult> {
  const ctx = await requirePermission("candidates.edit");

  const parsed = schema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Forma xatosi" };
  }
  const values = parsed.data;

  // Har qanday manbadan kelgan HTML bir xil filtrdan o'tadi.
  const { html, text } = sanitizeLegacyHtml(values.content_html ?? "");

  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("legacy_posts")
    .update({
      title: values.title.trim(),
      summary: nullable(values.summary),
      legacy_status: values.legacy_status,
      cover_image_url: nullable(values.cover_image_url),
      content_html: html,
      content_text: text,
      candidate_id: nullable(values.candidate_id),
      // Qo'lda tahrirlangan yozuv keyingi importda jimgina qayta yozilib
      // ketmasin: checksum bo'shatiladi, shuning uchun --resume uni
      // "o'zgargan" deb biladi va odam ataylab qayta yugurtirmaguncha
      // hech narsa qilinmaydi.
      import_checksum: null,
    })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };

  await logAudit({
    actorId: ctx.userId,
    action: "legacy_post.update",
    entityType: "legacy_posts",
    entityId: id,
    metadata: { status: values.legacy_status },
  });

  revalidatePath("/liderlar-1-0");
  revalidatePath(`/liderlar-1-0/${id}`);
  return { ok: true };
}
