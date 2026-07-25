import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  hasPermission,
  permissionsForRoles,
  type Permission,
  type Role,
} from "@/lib/permissions";

export interface AdminContext {
  userId: string;
  email: string;
  fullName: string;
  avatarUrl: string | null;
  roles: Role[];
  permissions: Set<Permission>;
}

/**
 * Loads the signed-in admin and their roles. Deduplicated per request via
 * React cache. Returns null when there is no session or the user has no
 * admin role (RLS also blocks such users at the database level).
 */
export const getAdminContext = cache(async (): Promise<AdminContext | null> => {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const admin = createSupabaseAdminClient();
  const [{ data: profile }, { data: roleRows }] = await Promise.all([
    admin
      .from("profiles")
      .select("full_name, avatar_url, is_active")
      .eq("id", user.id)
      .maybeSingle(),
    admin
      .from("user_roles")
      .select("roles(slug)")
      .eq("user_id", user.id),
  ]);

  if (profile && profile.is_active === false) return null;

  const roles = (roleRows ?? [])
    .map((r) => (r.roles as unknown as { slug: string } | null)?.slug)
    .filter((s): s is Role => Boolean(s));

  if (roles.length === 0) return null;

  return {
    userId: user.id,
    email: user.email ?? "",
    fullName: (profile?.full_name as string) || user.email || "Admin",
    avatarUrl: (profile?.avatar_url as string) ?? null,
    roles,
    permissions: permissionsForRoles(roles),
  };
});

/** Redirects to /login (no session) or /forbidden (no role). */
export async function requireAdmin(): Promise<AdminContext> {
  const ctx = await getAdminContext();
  if (!ctx) redirect("/login?reason=no-access");
  return ctx;
}

/**
 * The single server-side authorization gate. Every server action and route
 * handler must call this before touching the database with the service role.
 */
export async function requirePermission(
  permission: Permission,
): Promise<AdminContext> {
  const ctx = await requireAdmin();
  if (!hasPermission(ctx.roles, permission)) redirect("/forbidden");
  return ctx;
}

/** Variant for API route handlers: returns null instead of redirecting. */
export async function checkPermission(
  permission: Permission,
): Promise<AdminContext | null> {
  const ctx = await getAdminContext();
  if (!ctx || !hasPermission(ctx.roles, permission)) return null;
  return ctx;
}
