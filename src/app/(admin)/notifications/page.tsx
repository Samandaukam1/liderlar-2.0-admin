import Link from "next/link";
import { Bell } from "lucide-react";
import { requirePermission } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/admin/page-header";
import { EmptyState } from "@/components/ui/feedback";
import { Badge } from "@/components/admin/badges";
import { cn, timeAgo } from "@/lib/utils";
import type { NotificationRow } from "@/lib/types";
import { BroadcastButton, MarkReadButton } from "./notification-controls";

export const metadata = { title: "Bildirishnomalar" };
export const dynamic = "force-dynamic";

const KIND_ACCENTS: Record<string, "cyan" | "mint" | "peach" | "lavender"> = {
  announcement: "lavender",
  system: "peach",
  update: "cyan",
  application: "mint",
};

export default async function NotificationsPage() {
  const ctx = await requirePermission("notifications.view");
  const canManage = hasPermission(ctx.roles, "notifications.manage");
  const admin = createSupabaseAdminClient();

  const { data, error } = await admin
    .from("notifications")
    .select("*")
    .or(`recipient_id.eq.${ctx.userId},recipient_id.is.null`)
    .order("created_at", { ascending: false })
    .limit(60);
  const rows = (data ?? []) as NotificationRow[];

  return (
    <>
      <PageHeader
        title="Bildirishnomalar"
        description="Tizim xabarlari va admin e’lonlari"
        breadcrumbs={[{ label: "Bildirishnomalar" }]}
        actions={canManage ? <BroadcastButton /> : undefined}
      />

      {rows.length === 0 ? (
        <EmptyState
          icon={<Bell className="h-7 w-7" />}
          title={error ? "Jadval topilmadi" : "Bildirishnomalar yo‘q"}
          description={error ? "Supabase migrationlarni ishga tushiring." : "Yangi xabarlar shu yerda ko‘rinadi."}
        />
      ) : (
        <ul className="space-y-2.5">
          {rows.map((n) => (
            <li
              key={n.id}
              className={cn(
                "flex items-start gap-3 rounded-card border bg-card p-4 shadow-card",
                n.read_at ? "border-line opacity-75" : "border-cyan/40",
              )}
            >
              <span className={cn("mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full", n.read_at ? "bg-ink-soft/30" : "bg-cyan")} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-bold text-ink">{n.title}</p>
                  <Badge accent={KIND_ACCENTS[n.kind] ?? "cyan"}>{n.kind}</Badge>
                </div>
                {n.body && <p className="mt-0.5 text-sm text-ink-soft">{n.body}</p>}
                <p className="mt-1 text-[11px] text-ink-soft/70">{timeAgo(n.created_at)}</p>
                {n.link && (
                  <Link href={n.link} className="mt-1 inline-block text-xs font-bold text-brand hover:underline">
                    Ko‘rish →
                  </Link>
                )}
              </div>
              {!n.read_at && <MarkReadButton id={n.id} />}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
