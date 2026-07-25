"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { slugify } from "@/lib/utils";

const candidateSchema = z.object({
  full_name: z.string().min(3, "Ism juda qisqa").max(160),
  slug: z.string().max(120).optional().or(z.literal("")),
  short_bio: z.string().max(600).optional().or(z.literal("")),
  birth_date: z.string().optional().or(z.literal("")),
  region_id: z.string().uuid().optional().or(z.literal("")),
  category_id: z.string().uuid().optional().or(z.literal("")),
  phone: z.string().max(40).optional().or(z.literal("")),
  email: z.string().email().optional().or(z.literal("")),
  avatar_url: z.string().url().optional().or(z.literal("")),
  seo_title: z.string().max(160).optional().or(z.literal("")),
  seo_description: z.string().max(300).optional().or(z.literal("")),
  is_top100: z.coerce.boolean().optional(),
  top100_position: z.coerce.number().int().min(1).max(100).optional().or(z.literal("")),
});

export interface ActionResult {
  ok: boolean;
  error?: string;
  id?: string;
}

function nullable(v: string | undefined | null) {
  return v && v.trim() !== "" ? v.trim() : null;
}

export async function upsertCandidateAction(
  candidateId: string | null,
  formData: FormData,
): Promise<ActionResult> {
  const ctx = await requirePermission(candidateId ? "candidates.edit" : "candidates.create");
  const raw = Object.fromEntries(formData.entries());
  const parsed = candidateSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Forma xatosi" };
  }
  const v = parsed.data;
  const admin = createSupabaseAdminClient();

  const slug = nullable(v.slug) ?? slugify(v.full_name);
  const payload = {
    full_name: v.full_name.trim(),
    slug,
    short_bio: nullable(v.short_bio),
    birth_date: nullable(v.birth_date),
    region_id: nullable(v.region_id),
    category_id: nullable(v.category_id),
    phone: nullable(v.phone),
    email: nullable(v.email),
    avatar_url: nullable(v.avatar_url),
    seo_title: nullable(v.seo_title),
    seo_description: nullable(v.seo_description),
    is_top100: Boolean(v.is_top100),
    top100_position:
      typeof v.top100_position === "number" ? v.top100_position : null,
  };

  // slug uniqueness among non-deleted candidates
  const dupQuery = admin
    .from("candidates")
    .select("id", { head: true, count: "exact" })
    .eq("slug", slug)
    .is("deleted_at", null);
  const { count: dupCount } = candidateId
    ? await dupQuery.neq("id", candidateId)
    : await dupQuery;
  if ((dupCount ?? 0) > 0) {
    return { ok: false, error: `“${slug}” slug allaqachon band` };
  }

  if (candidateId) {
    const { data: before } = await admin
      .from("candidates")
      .select("full_name, slug, status, short_bio, region_id, category_id")
      .eq("id", candidateId)
      .maybeSingle();
    const { error } = await admin.from("candidates").update(payload).eq("id", candidateId);
    if (error) return { ok: false, error: error.message };
    await logAudit({
      actorId: ctx.userId,
      action: "candidate.update",
      entityType: "candidate",
      entityId: candidateId,
      oldValue: before,
      newValue: payload,
    });
    revalidatePath(`/candidates/${candidateId}`);
    revalidatePath("/candidates");
    return { ok: true, id: candidateId };
  }

  const { data, error } = await admin
    .from("candidates")
    .insert({ ...payload, status: "draft" })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? "Yaratib bo‘lmadi" };
  await logAudit({
    actorId: ctx.userId,
    action: "candidate.create",
    entityType: "candidate",
    entityId: data.id,
    newValue: payload,
  });
  revalidatePath("/candidates");
  return { ok: true, id: data.id };
}

const STATUS_FLOW = ["draft", "review", "published", "archived"] as const;

export async function setCandidateStatusAction(
  candidateId: string,
  status: (typeof STATUS_FLOW)[number],
): Promise<ActionResult> {
  const ctx = await requirePermission(
    status === "published" ? "candidates.publish" : "candidates.edit",
  );
  if (!STATUS_FLOW.includes(status)) return { ok: false, error: "Noto‘g‘ri status" };
  const admin = createSupabaseAdminClient();
  const { data: before } = await admin
    .from("candidates")
    .select("status")
    .eq("id", candidateId)
    .maybeSingle();
  const patch: Record<string, unknown> = { status };
  if (status === "published" && !before?.status?.startsWith("publ")) {
    // First publish starts the 30-day update cycle.
    patch.next_update_due_at = new Date(Date.now() + 30 * 86400000).toISOString();
  }
  const { error } = await admin.from("candidates").update(patch).eq("id", candidateId);
  if (error) return { ok: false, error: error.message };
  await logAudit({
    actorId: ctx.userId,
    action: `candidate.status.${status}`,
    entityType: "candidate",
    entityId: candidateId,
    oldValue: { status: before?.status },
    newValue: { status },
  });
  revalidatePath(`/candidates/${candidateId}`);
  revalidatePath("/candidates");
  return { ok: true };
}

/** Soft delete — candidates are never hard-deleted from the admin panel. */
export async function archiveCandidateAction(candidateId: string): Promise<ActionResult> {
  const ctx = await requirePermission("candidates.archive");
  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("candidates")
    .update({ deleted_at: new Date().toISOString(), status: "archived" })
    .eq("id", candidateId);
  if (error) return { ok: false, error: error.message };
  await logAudit({
    actorId: ctx.userId,
    action: "candidate.archive",
    entityType: "candidate",
    entityId: candidateId,
    severity: "warning",
  });
  revalidatePath("/candidates");
  redirect("/candidates");
}

export async function restoreCandidateAction(candidateId: string): Promise<ActionResult> {
  const ctx = await requirePermission("candidates.archive");
  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("candidates")
    .update({ deleted_at: null, status: "draft" })
    .eq("id", candidateId);
  if (error) return { ok: false, error: error.message };
  await logAudit({
    actorId: ctx.userId,
    action: "candidate.restore",
    entityType: "candidate",
    entityId: candidateId,
  });
  revalidatePath(`/candidates/${candidateId}`);
  revalidatePath("/candidates");
  return { ok: true };
}

/* ---------------- Candidate sub-entries (ta'lim, ish, yutuqlar...) -------- */

const ENTRY_TABLES = {
  education: "education",
  work: "work_experiences",
  achievement: "achievements",
  event: "events",
  book: "books_read",
  social: "social_links",
} as const;

export type EntryKind = keyof typeof ENTRY_TABLES;

const entrySchema = z.object({
  title: z.string().min(2).max(300),
  subtitle: z.string().max(300).optional().or(z.literal("")),
  description: z.string().max(2000).optional().or(z.literal("")),
  date_from: z.string().optional().or(z.literal("")),
  date_to: z.string().optional().or(z.literal("")),
  url: z.string().max(500).optional().or(z.literal("")),
});

export async function addCandidateEntryAction(
  candidateId: string,
  kind: EntryKind,
  formData: FormData,
): Promise<ActionResult> {
  const ctx = await requirePermission("candidates.edit");
  const table = ENTRY_TABLES[kind];
  if (!table) return { ok: false, error: "Noto‘g‘ri bo‘lim" };
  const parsed = entrySchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Forma xatosi" };
  }
  const v = parsed.data;
  const admin = createSupabaseAdminClient();
  const { error } = await admin.from(table).insert({
    candidate_id: candidateId,
    title: v.title.trim(),
    subtitle: nullable(v.subtitle),
    description: nullable(v.description),
    date_from: nullable(v.date_from),
    date_to: nullable(v.date_to),
    url: nullable(v.url),
  });
  if (error) return { ok: false, error: error.message };
  await logAudit({
    actorId: ctx.userId,
    action: `candidate.${kind}.add`,
    entityType: "candidate",
    entityId: candidateId,
    newValue: { title: v.title },
  });
  revalidatePath(`/candidates/${candidateId}`);
  return { ok: true };
}

export async function deleteCandidateEntryAction(
  candidateId: string,
  kind: EntryKind,
  entryId: string,
): Promise<ActionResult> {
  const ctx = await requirePermission("candidates.edit");
  const table = ENTRY_TABLES[kind];
  if (!table) return { ok: false, error: "Noto‘g‘ri bo‘lim" };
  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from(table)
    .delete()
    .eq("id", entryId)
    .eq("candidate_id", candidateId);
  if (error) return { ok: false, error: error.message };
  await logAudit({
    actorId: ctx.userId,
    action: `candidate.${kind}.delete`,
    entityType: "candidate",
    entityId: candidateId,
    oldValue: { entry_id: entryId },
  });
  revalidatePath(`/candidates/${candidateId}`);
  return { ok: true };
}
