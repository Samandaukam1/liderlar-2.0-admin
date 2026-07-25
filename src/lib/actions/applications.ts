"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { slugify } from "@/lib/utils";
import type { ApplicationStatus } from "@/lib/types";

export interface AppActionResult {
  ok: boolean;
  error?: string;
  candidateId?: string;
}

const REVIEW_STATUSES: ApplicationStatus[] = ["in_review", "needs_info", "accepted", "rejected"];

export async function setApplicationStatusAction(
  applicationId: string,
  status: ApplicationStatus,
  comment?: string,
): Promise<AppActionResult> {
  const ctx = await requirePermission("applications.review");
  if (!REVIEW_STATUSES.includes(status)) return { ok: false, error: "Noto‘g‘ri status" };
  const admin = createSupabaseAdminClient();
  const { data: before } = await admin
    .from("applications")
    .select("status")
    .eq("id", applicationId)
    .maybeSingle();
  const { error } = await admin
    .from("applications")
    .update({ status, assignee_id: ctx.userId })
    .eq("id", applicationId);
  if (error) return { ok: false, error: error.message };

  if (comment?.trim()) {
    await admin.from("application_notes").insert({
      application_id: applicationId,
      author_id: ctx.userId,
      note: comment.trim(),
    });
  }

  await logAudit({
    actorId: ctx.userId,
    action: `application.${status}`,
    entityType: "application",
    entityId: applicationId,
    oldValue: { status: before?.status },
    newValue: { status },
    reason: comment?.trim() || null,
  });
  revalidatePath("/applications");
  revalidatePath(`/applications/${applicationId}`);
  return { ok: true };
}

export async function addApplicationNoteAction(
  applicationId: string,
  note: string,
): Promise<AppActionResult> {
  const ctx = await requirePermission("applications.review");
  if (note.trim().length < 2) return { ok: false, error: "Izoh juda qisqa" };
  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("application_notes").insert({
    application_id: applicationId,
    author_id: ctx.userId,
    note: note.trim(),
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/applications/${applicationId}`);
  return { ok: true };
}

/** Converts an accepted application into a draft candidate profile. */
export async function convertApplicationAction(
  applicationId: string,
): Promise<AppActionResult> {
  const ctx = await requirePermission("applications.convert");
  const admin = createSupabaseAdminClient();

  const { data: app } = await admin
    .from("applications")
    .select("*")
    .eq("id", applicationId)
    .maybeSingle();
  if (!app) return { ok: false, error: "Ariza topilmadi" };
  if (app.candidate_id) return { ok: false, error: "Bu ariza allaqachon nomzodga aylantirilgan" };

  let slug = slugify(app.full_name);
  const { count: slugCount } = await admin
    .from("candidates")
    .select("id", { count: "exact", head: true })
    .eq("slug", slug);
  if ((slugCount ?? 0) > 0) slug = `${slug}-${Math.random().toString(36).slice(2, 6)}`;

  const { data: candidate, error } = await admin
    .from("candidates")
    .insert({
      full_name: app.full_name,
      slug,
      email: app.email,
      phone: app.phone,
      region_id: app.region_id,
      category_id: app.category_id,
      short_bio: app.motivation ? String(app.motivation).slice(0, 600) : null,
      status: "draft",
    })
    .select("id")
    .single();
  if (error || !candidate) return { ok: false, error: error?.message ?? "Yaratib bo‘lmadi" };

  await admin
    .from("applications")
    .update({ status: "converted", candidate_id: candidate.id })
    .eq("id", applicationId);

  await logAudit({
    actorId: ctx.userId,
    action: "application.convert",
    entityType: "application",
    entityId: applicationId,
    newValue: { candidate_id: candidate.id },
  });
  revalidatePath("/applications");
  revalidatePath("/candidates");
  return { ok: true, candidateId: candidate.id };
}
