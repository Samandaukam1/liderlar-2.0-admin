export const ROLES = [
  "super_admin",
  "admin",
  "editor",
  "moderator",
  "analyst",
  "viewer",
] as const;

export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  "dashboard.view",
  "candidates.view",
  "candidates.create",
  "candidates.edit",
  "candidates.publish",
  "candidates.archive",
  "articles.view",
  "articles.create",
  "articles.edit",
  "articles.submit",
  "articles.publish",
  "updates.view",
  "updates.review",
  "updates.merge",
  "tokens.view",
  "tokens.manage",
  "rankings.view",
  "rankings.manage",
  "rankings.adjust",
  "rankings.weights",
  "podcasts.view",
  "podcasts.manage",
  "journals.view",
  "journals.manage",
  "quotes.view",
  "quotes.manage",
  "top100.view",
  "top100.manage",
  "taxonomy.view",
  "taxonomy.manage",
  "applications.view",
  "applications.review",
  "applications.convert",
  "intakes.view",
  "intakes.create",
  "intakes.edit",
  "intakes.link",
  "intakes.review",
  "intakes.approve",
  "intakes.promote",
  "intakes.publish",
  "media.view",
  "media.upload",
  "media.delete",
  "ai.use",
  "ai_prompts.view",
  "ai_prompts.edit",
  "notifications.view",
  "notifications.manage",
  "admins.manage",
  "audit.view",
  "settings.manage",
  "legal.manage",
  "import.run",
  "export.run",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const VIEW_ONLY: Permission[] = PERMISSIONS.filter((p) =>
  p.endsWith(".view"),
) as Permission[];

/**
 * Central role → permission matrix. Server actions, route handlers and RLS
 * policies must agree with this map; the SQL mirror lives in
 * supabase/migrations/0006_admin_and_audit.sql (role_permissions seed).
 */
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  super_admin: PERMISSIONS,
  admin: PERMISSIONS.filter(
    (p) => !["admins.manage", "settings.manage", "rankings.weights"].includes(p),
  ) as Permission[],
  editor: [
    "dashboard.view",
    "candidates.view",
    "articles.view",
    "articles.create",
    "articles.edit",
    "articles.submit",
    "quotes.view",
    "journals.view",
    "intakes.view",
    "intakes.create",
    "intakes.edit",
    "intakes.link",
    "intakes.review",
    "media.view",
    "media.upload",
    "ai.use",
  ],
  moderator: [
    "dashboard.view",
    "candidates.view",
    "updates.view",
    "updates.review",
    "tokens.view",
    "applications.view",
    "applications.review",
    "intakes.view",
    "intakes.review",
    "media.view",
    "media.upload",
    "notifications.view",
  ],
  analyst: [
    "dashboard.view",
    "candidates.view",
    "rankings.view",
    "articles.view",
    "podcasts.view",
    "journals.view",
    "applications.view",
    "intakes.view",
    "export.run",
  ],
  viewer: VIEW_ONLY,
};

export function permissionsForRoles(roles: readonly string[]): Set<Permission> {
  const set = new Set<Permission>();
  for (const role of roles) {
    const perms = ROLE_PERMISSIONS[role as Role];
    if (perms) for (const p of perms) set.add(p);
  }
  return set;
}

export function hasPermission(
  roles: readonly string[],
  permission: Permission,
): boolean {
  return permissionsForRoles(roles).has(permission);
}

export const ROLE_LABELS: Record<Role, string> = {
  super_admin: "Super admin",
  admin: "Admin",
  editor: "Muharrir",
  moderator: "Moderator",
  analyst: "Tahlilchi",
  viewer: "Kuzatuvchi",
};
