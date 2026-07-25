import { Medal } from "lucide-react";
import { requirePermission } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/admin/page-header";
import { DataTable, type Column } from "@/components/admin/data-table";
import { CandidateMiniCard, StatusBadge } from "@/components/admin/badges";
import { EmptyState } from "@/components/ui/feedback";
import type { Candidate } from "@/lib/types";
import { AddToTop100, Top100RowControls } from "./top100-controls";

export const metadata = { title: "TOP 100" };
export const dynamic = "force-dynamic";

export default async function Top100Page() {
  const ctx = await requirePermission("top100.view");
  const canManage = hasPermission(ctx.roles, "top100.manage");
  const admin = createSupabaseAdminClient();

  const [{ data, error }, { data: available }] = await Promise.all([
    admin
      .from("candidates")
      .select("id, full_name, avatar_url, slug, status, top100_position, categories(name)")
      .eq("is_top100", true)
      .is("deleted_at", null)
      .order("top100_position", { ascending: true, nullsFirst: false }),
    admin
      .from("candidates")
      .select("id, full_name")
      .eq("is_top100", false)
      .is("deleted_at", null)
      .order("full_name")
      .limit(500),
  ]);
  const rows = (data ?? []) as unknown as Candidate[];

  const columns: Column<Candidate>[] = [
    {
      key: "position",
      header: "O‘rin",
      className: "w-20",
      render: (c) => (
        <span className="font-display text-2xl font-semibold text-brand">
          {c.top100_position ?? "—"}
        </span>
      ),
    },
    {
      key: "candidate",
      header: "Nomzod",
      render: (c) => (
        <CandidateMiniCard
          name={c.full_name}
          avatarUrl={c.avatar_url}
          href={`/candidates/${c.id}`}
          meta={c.categories?.name ?? undefined}
        />
      ),
    },
    { key: "status", header: "Profil holati", render: (c) => <StatusBadge status={c.status} /> },
    {
      key: "controls",
      header: canManage ? "Pozitsiyani boshqarish" : "",
      className: "w-64 text-right",
      render: (c) =>
        canManage ? (
          <Top100RowControls candidateId={c.id} position={c.top100_position} />
        ) : null,
    },
  ];

  return (
    <>
      <PageHeader
        title="TOP 100"
        description={`Yilning eng faol 100 yosh lideri ro‘yxati — hozir ${rows.length} ta`}
        breadcrumbs={[{ label: "TOP 100" }]}
        actions={canManage ? <AddToTop100 candidates={available ?? []} /> : undefined}
      />
      <DataTable
        columns={columns}
        rows={rows}
        empty={
          <EmptyState
            icon={<Medal className="h-7 w-7" />}
            title={error ? "Jadval topilmadi" : "TOP 100 ro‘yxati bo‘sh"}
            description={error ? "Supabase migrationlarni ishga tushiring." : "Nomzodlarni ro‘yxatga qo‘shing."}
          />
        }
      />
    </>
  );
}
