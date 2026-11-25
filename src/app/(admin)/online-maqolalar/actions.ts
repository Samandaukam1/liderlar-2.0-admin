"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { refreshPublicProfiles } from "@/lib/public-profile-refresh";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  applyEditorialAction,
  type EditorialResult,
} from "@/lib/articles/editorial-service";
import { checkSubmittable, SUBMIT_PROBLEM_TEXT, TITLE_MAX_LENGTH, TITLE_MIN_LENGTH, type EditorAction } from "@/lib/articles/state";

/** Muharrir ruxsatini tekshiradi, amalni bajaradi va tegishli ro‘yxatlarni yangilaydi. */
export async function runEditorialAction(
  articleId: string,
  action: string,
  note: string,
): Promise<EditorialResult> {
  const ctx = await requirePermission("articles.edit");

  if (!isUuid(articleId)) return { ok: false, error: "Maqola tanlanmagan." };
  if (!isEditorAction(action)) return { ok: false, error: "Amal noto'g'ri." };
  if (typeof note !== "string") return { ok: false, error: "Izoh noto‘g‘ri." };

  const result = await applyEditorialAction({
    articleId,
    action,
    reviewerId: ctx.userId,
    note,
  });

  if (!result.ok) return result;

  revalidateArticleLists(result.candidateId);
  revalidatePath("/liderlar-online");
  return { ok: true };
}

const memberArticleSchema = z.object({
  title: z.string().trim().min(TITLE_MIN_LENGTH, "Sarlavha kamida 5 belgidan iborat bo‘lsin.").max(TITLE_MAX_LENGTH),
  subtitle: z.string().trim().max(500),
  excerpt: z.string().trim().max(600),
  content: z.string().max(200_000),
  hero_url: z.url().max(1000).optional(),
  hero_width: z.coerce.number().int().min(1).max(20_000).optional(),
  hero_height: z.coerce.number().int().min(1).max(20_000).optional(),
});

/** Matn va bannerni saqlaydi. `updatedAt` bir vaqtda qilingan tahrirni bosib ketishdan saqlaydi. */
export async function updateMemberArticleAction(articleId: string, updatedAt: string, form: FormData): Promise<EditorialResult> {
  const ctx = await requirePermission("articles.edit");
  if (!isUuid(articleId) || !z.iso.datetime({ offset: true }).safeParse(updatedAt).success) {
    return { ok: false, error: "Maqola topilmadi." };
  }
  const parsed = memberArticleSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Ma’lumotlarni tekshiring." };

  const db = createSupabaseAdminClient();
  const { data: previous, error: readError } = await db.from("member_articles")
    .select("candidate_id, title, state, hero_url")
    .eq("id", articleId).eq("updated_at", updatedAt).maybeSingle();
  if (readError || !previous) return { ok: false, error: "Maqola o‘zgargan yoki topilmadi. Sahifani yangilang." };

  const { title, subtitle, excerpt, content, hero_url, hero_width, hero_height } = parsed.data;
  if (hero_url) {
    const gallery = db.storage.from("candidate-gallery");
    const prefix = gallery.getPublicUrl("").data.publicUrl.replace(/\/?$/, "/");
    const path = hero_url.startsWith(prefix) ? hero_url.slice(prefix.length) : "";
    if (!path || !hero_width || !hero_height || gallery.getPublicUrl(path).data.publicUrl !== hero_url) {
      return { ok: false, error: "Banner rasmi noto‘g‘ri." };
    }
    const { data: media, error: mediaError } = await db.from("candidate_media")
      .select("id")
      .eq("bucket", "candidate-gallery")
      .eq("path", path)
      .eq("candidate_id", previous.candidate_id)
      .eq("uploaded_by", ctx.userId)
      .in("mime_type", ["image/jpeg", "image/png", "image/webp"])
      .maybeSingle();
    if (mediaError || !media) return { ok: false, error: "Yuklangan banner tasdiqlanmadi." };
  }
  if (["submitted", "in_review", "approved", "published"].includes(previous.state)) {
    const check = checkSubmittable({ title, heroUrl: hero_url ?? previous.hero_url, content });
    if (!check.ok) return { ok: false, error: check.problems.map((problem) => SUBMIT_PROBLEM_TEXT[problem]).join(" ") };
  }

  const { data, error } = await db.from("member_articles")
    .update({
      title, subtitle: subtitle || null, excerpt: excerpt || null, content,
      ...(hero_url && { hero_url, hero_width, hero_height, hero_alt: null }),
    })
    .eq("id", articleId).eq("updated_at", updatedAt).select("updated_at").maybeSingle();
  if (error || !data) return { ok: false, error: "Maqolani saqlab bo‘lmadi. Sahifani yangilang." };

  await logAudit({
    actorId: ctx.userId, action: "article.updated", entityType: "member_article", entityId: articleId,
    oldValue: { title: previous.title }, newValue: { title },
    metadata: { candidate_id: previous.candidate_id, banner_changed: Boolean(hero_url) },
  });
  revalidateArticleLists(previous.candidate_id);
  revalidatePath(`/online-maqolalar/${articleId}/edit`);
  refreshPublicProfiles([previous.candidate_id]);
  return { ok: true };
}

/** Server amali ro‘yxatlar va nomzod sahifasini yangilaydi. Brauzer alohida refresh yubormaydi. */
function revalidateArticleLists(candidateId: string) {
  revalidatePath("/online-maqolalar");
  revalidatePath("/online-maqolalar/nashrda");
  revalidatePath("/online-maqolalar/qoralamada");
  revalidatePath(`/candidates/${candidateId}`);
}

const ACTIONS = [
  "start_review",
  "request_changes",
  "approve",
  "publish",
  "reject",
  "archive",
  "unpublish",
] as const;

function isEditorAction(value: unknown): value is EditorAction {
  return typeof value === "string" && (ACTIONS as readonly string[]).includes(value);
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  );
}
