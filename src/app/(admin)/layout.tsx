import { requireAdmin } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { AdminSidebar } from "@/components/admin/sidebar";
import { AdminTopbar } from "@/components/admin/topbar";
import { signOutAction } from "@/lib/actions/auth";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const ctx = await requireAdmin();

  let unreadCount = 0;
  try {
    const admin = createSupabaseAdminClient();
    const { count } = await admin
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .or(`recipient_id.eq.${ctx.userId},recipient_id.is.null`)
      .is("read_at", null);
    unreadCount = count ?? 0;
  } catch {
    // notifications table not migrated yet — panel still works
  }

  const permissions = Array.from(ctx.permissions);

  return (
    <div className="flex min-h-screen">
      <AdminSidebar
        fullName={ctx.fullName}
        email={ctx.email}
        avatarUrl={ctx.avatarUrl}
        roles={ctx.roles}
        permissions={permissions}
        signOutAction={signOutAction}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <AdminTopbar
          fullName={ctx.fullName}
          avatarUrl={ctx.avatarUrl}
          permissions={permissions}
          unreadCount={unreadCount}
        />
        <main className="mx-auto w-full max-w-[1600px] flex-1 px-4 py-6 md:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}
