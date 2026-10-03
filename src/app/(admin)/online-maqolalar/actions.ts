"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth";
import {
  applyEditorialAction,
  type EditorialResult,
} from "@/lib/articles/editorial-service";
import type { EditorAction } from "@/lib/articles/state";

/**
 * TAHRIRIYAT AMALLARI.
 *
 * `articles.edit` ruxsati TALAB qiladi va u serverda tekshiriladi:
 * panelda tugmani yashirish avtorizatsiya emas.
 *
 * KO'RUVCHI BRAUZERDAN OLINMAYDI — kontekstdan olinadi, aks holda
 * muharrir boshqa odamning nomidan tasdiqlab qo'yardi (§44).
 */
export async function runEditorialAction(
  articleId: string,
  action: string,
  note: string,
): Promise<EditorialResult> {
  const ctx = await requirePermission("articles.edit");

  if (!isUuid(articleId)) return { ok: false, error: "Maqola tanlanmagan." };
  if (!isEditorAction(action)) return { ok: false, error: "Amal noto'g'ri." };

  const result = await applyEditorialAction({
    articleId,
    action,
    reviewerId: ctx.userId,
    note,
  });

  if (result.ok) {
    revalidatePath("/online-maqolalar");
    // Nashr qilingan maqola ommaviy ro'yxatda ham paydo bo'ladi.
    revalidatePath("/liderlar-online");
  }
  return result;
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
