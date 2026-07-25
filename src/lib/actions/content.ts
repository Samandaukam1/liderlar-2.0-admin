"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { slugify } from "@/lib/utils";
import type { Permission } from "@/lib/permissions";

const optional = (max = 500) => z.string().max(max).optional().or(z.literal(""));

/** Config-driven CRUD for the simpler content tables. */
const RESOURCES = {
  podcasts: {
    table: "podcasts",
    permission: "podcasts.manage" as Permission,
    paths: ["/podcasts", "/podcast-calendar"],
    schema: z.object({
      title: z.string().min(3).max(300),
      description: optional(2000),
      starts_at: optional(40),
      location: optional(300),
      online_url: optional(500),
      host_name: optional(200),
      banner_url: optional(600),
      media_url: optional(600),
      status: z.enum(["planned", "announced", "live", "recorded", "published", "cancelled"]).optional(),
      cancel_reason: optional(500),
      registration_limit: optional(10),
      candidate_id: optional(40),
    }),
  },
  journals: {
    table: "journals",
    permission: "journals.manage" as Permission,
    paths: ["/journals"],
    schema: z.object({
      issue_number: z.coerce.number().int().min(1),
      title: z.string().min(2).max(300),
      description: optional(2000),
      cover_url: optional(600),
      pdf_url: optional(600),
      published_at: optional(40),
      status: z.enum(["draft", "published"]).optional(),
      is_featured: z.coerce.boolean().optional(),
    }),
  },
  quotes: {
    table: "quotes",
    permission: "quotes.manage" as Permission,
    paths: ["/quotes"],
    schema: z.object({
      text: z.string().min(5).max(1000),
      candidate_id: optional(40),
      author_name: optional(200),
      accent: optional(30),
      status: z.enum(["draft", "published"]).optional(),
      is_featured: z.coerce.boolean().optional(),
    }),
  },
  categories: {
    table: "categories",
    permission: "taxonomy.manage" as Permission,
    paths: ["/directions", "/candidates"],
    schema: z.object({
      name: z.string().min(2).max(120),
      slug: optional(120),
      color: optional(30),
      icon: optional(60),
      sort_order: optional(10),
    }),
  },
  regions: {
    table: "regions",
    permission: "taxonomy.manage" as Permission,
    paths: ["/regions", "/candidates"],
    schema: z.object({
      name: z.string().min(2).max(120),
      slug: optional(120),
      sort_order: optional(10),
    }),
  },
} as const;

export type ResourceKind = keyof typeof RESOURCES;

export interface ContentActionResult {
  ok: boolean;
  error?: string;
  id?: string;
}

function clean(values: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(values)) {
    if (v === "" || v === undefined) out[k] = null;
    else out[k] = v;
  }
  return out;
}

export async function upsertContentAction(
  kind: ResourceKind,
  id: string | null,
  formData: FormData,
): Promise<ContentActionResult> {
  const config = RESOURCES[kind];
  if (!config) return { ok: false, error: "Noto‘g‘ri resurs" };
  const ctx = await requirePermission(config.permission);

  const raw = Object.fromEntries(formData.entries());
  const parsed = config.schema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Forma xatosi" };
  }
  const values = clean(parsed.data as Record<string, unknown>);

  if ((kind === "categories" || kind === "regions") && !values.slug) {
    values.slug = slugify(String(values.name ?? ""));
  }
  if ("sort_order" in values && values.sort_order != null) {
    values.sort_order = parseInt(String(values.sort_order), 10) || 0;
  }
  if ("registration_limit" in values && values.registration_limit != null) {
    values.registration_limit = parseInt(String(values.registration_limit), 10) || null;
  }

  const admin = createSupabaseAdminClient();
  let entityId = id;
  if (id) {
    const { error } = await admin.from(config.table).update(values).eq("id", id);
    if (error) return { ok: false, error: error.message };
  } else {
    const { data, error } = await admin
      .from(config.table)
      .insert(values)
      .select("id")
      .single();
    if (error || !data) return { ok: false, error: error?.message ?? "Yaratib bo‘lmadi" };
    entityId = data.id;
  }

  await logAudit({
    actorId: ctx.userId,
    action: `${kind}.${id ? "update" : "create"}`,
    entityType: kind,
    entityId,
    newValue: values,
  });
  for (const p of config.paths) revalidatePath(p);
  return { ok: true, id: entityId ?? undefined };
}

export async function deleteContentAction(
  kind: ResourceKind,
  id: string,
): Promise<ContentActionResult> {
  const config = RESOURCES[kind];
  if (!config) return { ok: false, error: "Noto‘g‘ri resurs" };
  const ctx = await requirePermission(config.permission);
  const admin = createSupabaseAdminClient();

  const { error } = await admin.from(config.table).delete().eq("id", id);
  if (error) {
    if (error.code === "23503") {
      return { ok: false, error: "Bu yozuv boshqa ma’lumotlarga bog‘langan — avval bog‘lanishlarni oching" };
    }
    return { ok: false, error: error.message };
  }
  await logAudit({
    actorId: ctx.userId,
    action: `${kind}.delete`,
    entityType: kind,
    entityId: id,
    severity: "warning",
  });
  for (const p of config.paths) revalidatePath(p);
  return { ok: true };
}

/* ---------------------------- TOP 100 ---------------------------- */

export async function setTop100Action(
  candidateId: string,
  position: number | null,
): Promise<ContentActionResult> {
  const ctx = await requirePermission("top100.manage");
  const admin = createSupabaseAdminClient();
  const inList = position != null;
  if (inList && (position < 1 || position > 100)) {
    return { ok: false, error: "Pozitsiya 1–100 oralig‘ida bo‘lishi kerak" };
  }
  const { error } = await admin
    .from("candidates")
    .update({ is_top100: inList, top100_position: inList ? position : null })
    .eq("id", candidateId);
  if (error) return { ok: false, error: error.message };
  await logAudit({
    actorId: ctx.userId,
    action: inList ? "top100.set" : "top100.remove",
    entityType: "candidate",
    entityId: candidateId,
    newValue: { position },
  });
  revalidatePath("/top100");
  return { ok: true };
}
