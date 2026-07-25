"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";

export interface SystemActionResult {
  ok: boolean;
  error?: string;
}

/* --------------------------- Site settings --------------------------- */

const ALLOWED_SETTINGS = [
  "site_title",
  "site_description",
  "contact_email",
  "contact_phone",
  "telegram_url",
  "instagram_url",
  "youtube_url",
  "facebook_url",
  "footer_text",
  "hero_title",
  "hero_subtitle",
  "application_form_enabled",
] as const;

export async function saveSiteSettingsAction(formData: FormData): Promise<SystemActionResult> {
  const ctx = await requirePermission("settings.manage");
  const admin = createSupabaseAdminClient();

  const updates: Array<{ key: string; value: string }> = [];
  for (const key of ALLOWED_SETTINGS) {
    const value = formData.get(key);
    if (typeof value === "string") updates.push({ key, value: value.trim() });
  }
  for (const u of updates) {
    const { error } = await admin
      .from("site_settings")
      .upsert({ key: u.key, value: u.value, updated_by: ctx.userId }, { onConflict: "key" });
    if (error) return { ok: false, error: error.message };
  }

  await logAudit({
    actorId: ctx.userId,
    action: "settings.update",
    entityType: "site_settings",
    newValue: Object.fromEntries(updates.map((u) => [u.key, u.value])),
    severity: "warning",
  });
  revalidatePath("/settings");
  return { ok: true };
}

/* --------------------------- Legal pages --------------------------- */

const LEGAL_SLUGS = ["oferta", "privacy", "terms"] as const;

export async function saveLegalPageAction(
  slug: string,
  title: string,
  content: string,
): Promise<SystemActionResult> {
  const ctx = await requirePermission("legal.manage");
  if (!(LEGAL_SLUGS as readonly string[]).includes(slug)) {
    return { ok: false, error: "Noto‘g‘ri sahifa" };
  }
  if (title.trim().length < 3) return { ok: false, error: "Sarlavha juda qisqa" };
  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("legal_pages").upsert(
    {
      slug,
      title: title.trim(),
      content,
      updated_by: ctx.userId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "slug" },
  );
  if (error) return { ok: false, error: error.message };
  await logAudit({
    actorId: ctx.userId,
    action: "legal.update",
    entityType: "legal_page",
    entityId: slug,
    severity: "warning",
  });
  revalidatePath("/legal");
  return { ok: true };
}

/* --------------------------- Notifications --------------------------- */

export async function markNotificationReadAction(id: string): Promise<SystemActionResult> {
  const ctx = await requirePermission("notifications.view");
  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", id)
    .or(`recipient_id.eq.${ctx.userId},recipient_id.is.null`);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/notifications");
  return { ok: true };
}

export async function broadcastNotificationAction(
  title: string,
  body: string,
): Promise<SystemActionResult> {
  const ctx = await requirePermission("notifications.manage");
  if (title.trim().length < 3) return { ok: false, error: "Sarlavha juda qisqa" };
  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("notifications").insert({
    recipient_id: null,
    title: title.trim(),
    body: body.trim() || null,
    kind: "announcement",
  });
  if (error) return { ok: false, error: error.message };
  await logAudit({
    actorId: ctx.userId,
    action: "notification.broadcast",
    entityType: "notification",
    newValue: { title: title.trim() },
  });
  revalidatePath("/notifications");
  return { ok: true };
}

/* --------------------------- Media --------------------------- */

export async function deleteMediaAction(id: string): Promise<SystemActionResult> {
  const ctx = await requirePermission("media.delete");
  const admin = createSupabaseAdminClient();
  const { data: asset } = await admin
    .from("candidate_media")
    .select("bucket, path, file_name")
    .eq("id", id)
    .maybeSingle();
  if (!asset) return { ok: false, error: "Fayl topilmadi" };

  const { error: storageError } = await admin.storage
    .from(asset.bucket)
    .remove([asset.path]);
  if (storageError) return { ok: false, error: storageError.message };

  await admin
    .from("candidate_media")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id);

  await logAudit({
    actorId: ctx.userId,
    action: "media.delete",
    entityType: "media",
    entityId: id,
    oldValue: { file_name: asset.file_name, bucket: asset.bucket },
    severity: "warning",
  });
  revalidatePath("/media");
  return { ok: true };
}

/* --------------------------- CSV import --------------------------- */

export interface ImportRow {
  full_name: string;
  slug?: string;
  short_bio?: string;
  email?: string;
  phone?: string;
  region?: string;
  category?: string;
}

export interface ImportResult {
  ok: boolean;
  error?: string;
  inserted?: number;
  skippedDuplicates?: number;
  errors?: Array<{ row: number; message: string }>;
}

export async function importCandidatesAction(rows: ImportRow[]): Promise<ImportResult> {
  const ctx = await requirePermission("import.run");
  if (rows.length === 0) return { ok: false, error: "Import qilinadigan qatorlar yo‘q" };
  if (rows.length > 1000) return { ok: false, error: "Bir martada maksimum 1000 qator" };

  const admin = createSupabaseAdminClient();
  const [{ data: regions }, { data: categories }, { data: existing }] = await Promise.all([
    admin.from("regions").select("id, name, slug"),
    admin.from("categories").select("id, name, slug"),
    admin.from("candidates").select("slug"),
  ]);
  const regionMap = new Map(
    (regions ?? []).flatMap((r: { id: string; name: string; slug: string }) => [
      [r.name.toLowerCase(), r.id],
      [r.slug, r.id],
    ]),
  );
  const categoryMap = new Map(
    (categories ?? []).flatMap((c: { id: string; name: string; slug: string }) => [
      [c.name.toLowerCase(), c.id],
      [c.slug, c.id],
    ]),
  );
  const existingSlugs = new Set((existing ?? []).map((c: { slug: string }) => c.slug));

  let inserted = 0;
  let skippedDuplicates = 0;
  const errors: Array<{ row: number; message: string }> = [];
  const { slugify } = await import("@/lib/utils");

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const name = row.full_name?.trim();
    if (!name || name.length < 3) {
      errors.push({ row: i + 1, message: "Ism bo‘sh yoki juda qisqa" });
      continue;
    }
    const slug = row.slug?.trim() || slugify(name);
    if (existingSlugs.has(slug)) {
      skippedDuplicates++;
      continue;
    }
    const { error } = await admin.from("candidates").insert({
      full_name: name,
      slug,
      short_bio: row.short_bio?.trim() || null,
      email: row.email?.trim() || null,
      phone: row.phone?.trim() || null,
      region_id: row.region ? (regionMap.get(row.region.trim().toLowerCase()) ?? null) : null,
      category_id: row.category ? (categoryMap.get(row.category.trim().toLowerCase()) ?? null) : null,
      status: "draft",
    });
    if (error) errors.push({ row: i + 1, message: error.message });
    else {
      inserted++;
      existingSlugs.add(slug);
    }
  }

  await logAudit({
    actorId: ctx.userId,
    action: "import.candidates",
    entityType: "import",
    metadata: { total: rows.length, inserted, skippedDuplicates, errors: errors.length },
    severity: "warning",
  });
  revalidatePath("/candidates");
  return { ok: true, inserted, skippedDuplicates, errors };
}
