"use server";

import { revalidatePath } from "next/cache";
import { randomBytes } from "crypto";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { ROLES, type Role } from "@/lib/permissions";

export interface AdminActionResult {
  ok: boolean;
  error?: string;
  tempPassword?: string;
}

const inviteSchema = z.object({
  email: z.string().email("Email noto‘g‘ri"),
  full_name: z.string().min(3, "Ism juda qisqa").max(160),
  role: z.enum(ROLES),
});

/** Creates the auth user + profile + role. Temp password is shown once. */
export async function inviteAdminAction(formData: FormData): Promise<AdminActionResult> {
  const ctx = await requirePermission("admins.manage");
  const parsed = inviteSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Forma xatosi" };
  }
  const { email, full_name, role } = parsed.data;
  const admin = createSupabaseAdminClient();

  const tempPassword = randomBytes(9).toString("base64url");
  const { data: created, error } = await admin.auth.admin.createUser({
    email,
    password: tempPassword,
    email_confirm: true,
    user_metadata: { full_name },
  });
  if (error || !created.user) {
    return { ok: false, error: error?.message ?? "Foydalanuvchi yaratib bo‘lmadi" };
  }

  await admin.from("profiles").upsert({
    id: created.user.id,
    full_name,
    is_active: true,
  });

  const { data: roleRow } = await admin.from("roles").select("id").eq("slug", role).maybeSingle();
  if (roleRow) {
    await admin.from("user_roles").insert({
      user_id: created.user.id,
      role_id: roleRow.id,
      granted_by: ctx.userId,
    });
  }

  await logAudit({
    actorId: ctx.userId,
    action: "admin.invite",
    entityType: "admin_user",
    entityId: created.user.id,
    newValue: { email, role },
    severity: "critical",
  });
  revalidatePath("/admins");
  return { ok: true, tempPassword };
}

export async function setAdminRolesAction(
  userId: string,
  roles: Role[],
): Promise<AdminActionResult> {
  const ctx = await requirePermission("admins.manage");
  if (userId === ctx.userId && !roles.includes("super_admin") && ctx.roles.includes("super_admin")) {
    return { ok: false, error: "O‘zingizdan super_admin rolini olib tashlay olmaysiz" };
  }
  const valid = roles.filter((r) => (ROLES as readonly string[]).includes(r));
  const admin = createSupabaseAdminClient();

  const { data: allRoles } = await admin.from("roles").select("id, slug");
  const roleIds = (allRoles ?? [])
    .filter((r: { slug: string }) => valid.includes(r.slug as Role))
    .map((r: { id: string }) => r.id);

  const { data: before } = await admin
    .from("user_roles")
    .select("roles(slug)")
    .eq("user_id", userId);

  await admin.from("user_roles").delete().eq("user_id", userId);
  if (roleIds.length > 0) {
    await admin.from("user_roles").insert(
      roleIds.map((role_id: string) => ({ user_id: userId, role_id, granted_by: ctx.userId })),
    );
  }

  await logAudit({
    actorId: ctx.userId,
    action: "admin.roles.update",
    entityType: "admin_user",
    entityId: userId,
    oldValue: {
      roles: (before ?? []).map((r) => (r.roles as unknown as { slug: string } | null)?.slug),
    },
    newValue: { roles: valid },
    severity: "critical",
  });
  revalidatePath("/admins");
  return { ok: true };
}

export async function setAdminActiveAction(
  userId: string,
  isActive: boolean,
): Promise<AdminActionResult> {
  const ctx = await requirePermission("admins.manage");
  if (userId === ctx.userId) {
    return { ok: false, error: "O‘z akkauntingizni bloklab bo‘lmaydi" };
  }
  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("profiles")
    .update({ is_active: isActive })
    .eq("id", userId);
  if (error) return { ok: false, error: error.message };
  await logAudit({
    actorId: ctx.userId,
    action: isActive ? "admin.activate" : "admin.deactivate",
    entityType: "admin_user",
    entityId: userId,
    severity: "critical",
  });
  revalidatePath("/admins");
  return { ok: true };
}
