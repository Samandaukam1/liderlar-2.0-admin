import { ShieldCheck } from "lucide-react";
import { requirePermission } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/admin/page-header";
import { DataTable, type Column } from "@/components/admin/data-table";
import { Avatar, RoleBadge, Badge } from "@/components/admin/badges";
import { EmptyState } from "@/components/ui/feedback";
import { formatDate } from "@/lib/utils";
import { ROLE_PERMISSIONS, ROLE_LABELS, ROLES } from "@/lib/permissions";
import { AdminRowControls, InviteAdminButton } from "./admin-controls";
import type { AdminUser } from "@/lib/types";

export const metadata = { title: "Adminlar va rollar" };
export const dynamic = "force-dynamic";

export default async function AdminsPage() {
  const ctx = await requirePermission("admins.manage");
  const admin = createSupabaseAdminClient();

  const { data: profiles, error } = await admin
    .from("profiles")
    .select("id, full_name, avatar_url, is_active, created_at, user_roles(roles(slug))")
    .order("created_at");

  const { data: authUsers } = await admin.auth.admin.listUsers({ perPage: 200 });
  const emailById = new Map((authUsers?.users ?? []).map((u) => [u.id, u.email ?? ""]));

  const rows: AdminUser[] = (
    (profiles ?? []) as unknown as Array<{
      id: string;
      full_name: string;
      avatar_url: string | null;
      is_active: boolean;
      created_at: string;
      user_roles: Array<{ roles: { slug: string } | null }>;
    }>
  )
    .map((p) => ({
      id: p.id,
      full_name: p.full_name,
      avatar_url: p.avatar_url,
      email: emailById.get(p.id) ?? null,
      is_active: p.is_active,
      created_at: p.created_at,
      roles: p.user_roles.map((r) => r.roles?.slug).filter((s): s is string => Boolean(s)),
    }))
    .filter((p) => p.roles.length > 0 || !p.is_active);

  const columns: Column<AdminUser>[] = [
    {
      key: "user",
      header: "Admin",
      render: (u) => (
        <span className="flex items-center gap-3">
          <Avatar name={u.full_name} src={u.avatar_url} size={36} />
          <span className="min-w-0">
            <span className="block truncate text-sm font-bold text-ink">{u.full_name}</span>
            <span className="block truncate text-xs text-ink-soft">{u.email ?? "—"}</span>
          </span>
        </span>
      ),
    },
    {
      key: "roles",
      header: "Rollar",
      render: (u) => (
        <span className="flex flex-wrap gap-1">
          {u.roles.length === 0 ? <span className="text-xs text-ink-soft">—</span> : u.roles.map((r) => <RoleBadge key={r} role={r} />)}
        </span>
      ),
    },
    {
      key: "active",
      header: "Holat",
      render: (u) =>
        u.is_active ? <Badge accent="mint">Faol</Badge> : <Badge accent="coral">Bloklangan</Badge>,
    },
    {
      key: "created",
      header: "Qo‘shilgan",
      desktopOnly: true,
      render: (u) => <span className="text-xs text-ink-soft">{formatDate(u.created_at)}</span>,
    },
    {
      key: "controls",
      header: "",
      className: "w-28 text-right",
      render: (u) => (
        <AdminRowControls
          userId={u.id}
          fullName={u.full_name}
          roles={u.roles}
          isActive={u.is_active}
          isSelf={u.id === ctx.userId}
        />
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Adminlar va rollar"
        description="Faqat super admin boshqara oladi — barcha o‘zgarishlar audit log’da"
        breadcrumbs={[{ label: "Adminlar" }]}
        actions={<InviteAdminButton />}
      />
      <DataTable
        columns={columns}
        rows={rows}
        empty={
          <EmptyState
            icon={<ShieldCheck className="h-7 w-7" />}
            title={error ? "Jadval topilmadi" : "Adminlar yo‘q"}
            description={error ? "Supabase migrationlarni ishga tushiring." : "Birinchi adminni taklif qiling."}
          />
        }
      />

      <section className="mt-8">
        <h2 className="mb-3 font-display text-lg font-semibold uppercase tracking-wide text-ink">
          Rollar va vakolatlar matritsasi
        </h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {ROLES.map((role) => (
            <div key={role} className="rounded-card border border-line bg-card p-5 shadow-card">
              <div className="mb-3 flex items-center justify-between">
                <RoleBadge role={role} />
                <span className="text-xs text-ink-soft">{ROLE_PERMISSIONS[role].length} ta ruxsat</span>
              </div>
              <p className="text-sm font-bold text-ink">{ROLE_LABELS[role]}</p>
              <p className="mt-1 line-clamp-4 text-xs leading-relaxed text-ink-soft">
                {ROLE_PERMISSIONS[role].slice(0, 12).join(", ")}
                {ROLE_PERMISSIONS[role].length > 12 ? "…" : ""}
              </p>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
