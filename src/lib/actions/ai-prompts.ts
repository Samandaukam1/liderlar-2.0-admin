"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";

export interface PromptActionResult {
  ok: boolean;
  error?: string;
}

/** Update a photo-prompt fragment's text (ai_prompts.edit). */
export async function updateFragmentAction(id: string, text: string): Promise<PromptActionResult> {
  const ctx = await requirePermission("ai_prompts.edit");
  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("photo_prompt_fragments")
    .update({ prompt_text: text, updated_by: ctx.userId })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  await logAudit({
    actorId: ctx.userId,
    action: "ai_prompt.update",
    entityType: "photo_prompt_fragment",
    entityId: id,
    metadata: { chars: text.length },
  });
  revalidatePath("/ai-prompts");
  return { ok: true };
}

/** Toggle a fragment active/inactive (ai_prompts.edit). */
export async function toggleFragmentActiveAction(id: string, isActive: boolean): Promise<PromptActionResult> {
  const ctx = await requirePermission("ai_prompts.edit");
  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("photo_prompt_fragments")
    .update({ is_active: isActive, updated_by: ctx.userId })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  await logAudit({
    actorId: ctx.userId,
    action: "ai_prompt.update",
    entityType: "photo_prompt_fragment",
    entityId: id,
    metadata: { is_active: isActive },
  });
  revalidatePath("/ai-prompts");
  return { ok: true };
}
