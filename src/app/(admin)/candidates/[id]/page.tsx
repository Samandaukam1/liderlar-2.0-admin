import Link from "next/link";
import { notFound } from "next/navigation";
import { ExternalLink, QrCode } from "lucide-react";
import { requirePermission } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/admin/page-header";
import { Card } from "@/components/ui/primitives";
import { Avatar, Badge, StatusBadge } from "@/components/admin/badges";
import { CandidateForm } from "../candidate-form";
import { StatusActions } from "./status-actions";
import { EntriesPanel, type EntryRow } from "./entries-panel";
import { cn, formatDate, daysUntil, timeAgo } from "@/lib/utils";
import type { Candidate } from "@/lib/types";

export const dynamic = "force-dynamic";

const TABS = [
  { key: "profile", label: "Profil" },
  { key: "activity", label: "Faoliyat" },
  { key: "articles", label: "Maqolalar" },
  { key: "history", label: "Tarix" },
] as const;

export default async function CandidateDetailPage(props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const ctx = await requirePermission("candidates.view");
  const { id } = await props.params;
  const { tab = "profile" } = await props.searchParams;
  const admin = createSupabaseAdminClient();

  const { data } = await admin
    .from("candidates")
    .select("*, regions(name), categories(name, color)")
    .eq("id", id)
    .maybeSingle();
  if (!data) notFound();
  const candidate = data as unknown as Candidate;

  const canEdit = hasPermission(ctx.roles, "candidates.edit");
  const canPublish = hasPermission(ctx.roles, "candidates.publish");
  const canArchive = hasPermission(ctx.roles, "candidates.archive");

  const [{ data: regions }, { data: categories }] = await Promise.all([
    admin.from("regions").select("id, name").order("sort_order"),
    admin.from("categories").select("id, name").order("sort_order"),
  ]);

  const entrySelect = "id, title, subtitle, description, date_from, date_to, url";
  const [education, work, achievements, events, books, socials] =
    tab === "activity"
      ? await Promise.all([
          admin.from("education").select(entrySelect).eq("candidate_id", id).order("date_from", { ascending: false }),
          admin.from("work_experiences").select(entrySelect).eq("candidate_id", id).order("date_from", { ascending: false }),
          admin.from("achievements").select(entrySelect).eq("candidate_id", id).order("date_from", { ascending: false }),
          admin.from("events").select(entrySelect).eq("candidate_id", id).order("date_from", { ascending: false }),
          admin.from("books_read").select(entrySelect).eq("candidate_id", id).order("created_at", { ascending: false }),
          admin.from("social_links").select(entrySelect).eq("candidate_id", id).order("created_at"),
        ])
      : [null, null, null, null, null, null];

  const { data: articles } =
    tab === "articles"
      ? await admin
          .from("articles")
          .select("id, title, status, updated_at")
          .eq("candidate_id", id)
          .is("deleted_at", null)
          .order("updated_at", { ascending: false })
      : { data: null };

  const { data: auditRows } =
    tab === "history"
      ? await admin
          .from("audit_logs")
          .select("id, action, created_at, reason, profiles(full_name)")
          .eq("entity_type", "candidate")
          .eq("entity_id", id)
          .order("created_at", { ascending: false })
          .limit(40)
      : { data: null };

  const dueDays = daysUntil(candidate.next_update_due_at);
  const publicUrl = `${process.env.NEXT_PUBLIC_SITE_URL ?? "https://liderlar.uz"}/lider/${candidate.slug}`;

  return (
    <>
      <PageHeader
        title={candidate.full_name}
        breadcrumbs={[
          { label: "Nomzodlar", href: "/candidates" },
          { label: candidate.full_name },
        ]}
        actions={
          <StatusActions
            candidateId={candidate.id}
            status={candidate.status}
            isDeleted={Boolean(candidate.deleted_at)}
            canPublish={canPublish}
            canArchive={canArchive}
          />
        }
      />

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        {/* Main column */}
        <div className="min-w-0 xl:col-span-2">
          <nav className="mb-4 flex gap-1 overflow-x-auto rounded-[16px] border border-line bg-card p-1 shadow-card" aria-label="Nomzod bo‘limlari">
            {TABS.map((t) => (
              <Link
                key={t.key}
                href={`/candidates/${id}?tab=${t.key}`}
                aria-current={tab === t.key ? "page" : undefined}
                className={cn(
                  "whitespace-nowrap rounded-[12px] px-4 py-2 text-sm font-bold transition",
                  tab === t.key
                    ? "bg-gradient-to-r from-brand to-electric text-white shadow-[0_4px_14px_rgba(22,119,255,0.3)]"
                    : "text-ink-soft hover:bg-surface hover:text-ink",
                )}
              >
                {t.label}
              </Link>
            ))}
          </nav>

          {tab === "profile" && (
            <Card>
              {canEdit ? (
                <CandidateForm candidate={candidate} regions={regions ?? []} categories={categories ?? []} />
              ) : (
                <p className="text-sm text-ink-soft">
                  Profilni tahrirlash uchun vakolatingiz yetarli emas.
                </p>
              )}
            </Card>
          )}

          {tab === "activity" && (
            <div className="space-y-4">
              <EntriesPanel candidateId={id} kind="achievement" entries={(achievements?.data ?? []) as EntryRow[]} canEdit={canEdit} />
              <EntriesPanel candidateId={id} kind="education" entries={(education?.data ?? []) as EntryRow[]} canEdit={canEdit} />
              <EntriesPanel candidateId={id} kind="work" entries={(work?.data ?? []) as EntryRow[]} canEdit={canEdit} />
              <EntriesPanel candidateId={id} kind="event" entries={(events?.data ?? []) as EntryRow[]} canEdit={canEdit} />
              <EntriesPanel candidateId={id} kind="book" entries={(books?.data ?? []) as EntryRow[]} canEdit={canEdit} />
              <EntriesPanel candidateId={id} kind="social" entries={(socials?.data ?? []) as EntryRow[]} canEdit={canEdit} />
            </div>
          )}

          {tab === "articles" && (
            <Card>
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-bold text-ink">Biografik maqolalar</h3>
                <Link
                  href={`/articles/new?candidate=${id}`}
                  className="text-xs font-bold text-brand hover:underline"
                >
                  + Yangi maqola
                </Link>
              </div>
              {!articles || articles.length === 0 ? (
                <p className="py-4 text-sm text-ink-soft">Bu nomzod uchun maqola yo‘q</p>
              ) : (
                <ul className="divide-y divide-line/60">
                  {articles.map((a: { id: string; title: string; status: string; updated_at: string }) => (
                    <li key={a.id}>
                      <Link
                        href={`/articles/${a.id}`}
                        className="flex items-center justify-between gap-3 py-3 transition hover:opacity-75"
                      >
                        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">
                          {a.title}
                        </span>
                        <StatusBadge status={a.status} />
                        <span className="text-xs text-ink-soft">{formatDate(a.updated_at)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}

          {tab === "history" && (
            <Card>
              <h3 className="mb-4 text-sm font-bold text-ink">O‘zgarishlar tarixi</h3>
              {!auditRows || auditRows.length === 0 ? (
                <p className="py-4 text-sm text-ink-soft">Tarix bo‘sh</p>
              ) : (
                <ol className="relative space-y-4 border-l-2 border-line pl-5">
                  {(auditRows as unknown as Array<{ id: string; action: string; created_at: string; reason: string | null; profiles: { full_name: string } | null }>).map((a) => (
                    <li key={a.id} className="relative">
                      <span className="absolute -left-[27px] top-1 h-3 w-3 rounded-full border-2 border-card bg-cyan" />
                      <p className="text-sm">
                        <b className="text-ink">{a.profiles?.full_name ?? "Tizim"}</b>{" "}
                        <span className="text-ink-soft">{a.action}</span>
                      </p>
                      {a.reason && <p className="text-xs text-ink-soft">Sabab: {a.reason}</p>}
                      <p className="text-[11px] text-ink-soft/70">{timeAgo(a.created_at)}</p>
                    </li>
                  ))}
                </ol>
              )}
            </Card>
          )}
        </div>

        {/* Context panel */}
        <aside className="space-y-4">
          {/* Preview card — mirrors the public site candidate card */}
          <div className="overflow-hidden rounded-card border border-line bg-gradient-to-br from-navy-deep to-navy-dark p-6 text-white shadow-card">
            <p className="mb-4 font-display text-4xl leading-none text-cyan/60">“</p>
            <div className="flex items-center gap-4">
              <Avatar name={candidate.full_name} src={candidate.avatar_url} size={64} />
              <div className="min-w-0">
                <p className="truncate font-display text-lg font-semibold uppercase tracking-wide">
                  {candidate.full_name}
                </p>
                <p className="truncate text-xs text-cyan-light/80">
                  {candidate.categories?.name ?? "Yo‘nalish tanlanmagan"}
                </p>
              </div>
            </div>
            {candidate.short_bio && (
              <p className="mt-4 line-clamp-3 text-sm leading-relaxed text-white/75">
                {candidate.short_bio}
              </p>
            )}
            <div className="mt-4 flex items-center justify-between">
              <StatusBadge status={candidate.status} />
              <a
                href={publicUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs font-bold text-cyan-light hover:underline"
              >
                Saytda ko‘rish <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          </div>

          <Card className="p-5">
            <h3 className="mb-3 text-sm font-bold text-ink">30 kunlik yangilanish</h3>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-ink-soft">Oxirgi yangilanish</dt>
                <dd className="font-semibold text-ink">{formatDate(candidate.last_updated_at)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-ink-soft">Oxirgi so‘rov</dt>
                <dd className="font-semibold text-ink">{formatDate(candidate.last_update_requested_at)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-ink-soft">Keyingi muddat</dt>
                <dd>
                  {dueDays == null ? (
                    <span className="text-ink-soft">—</span>
                  ) : dueDays < 0 ? (
                    <Badge accent="coral">{Math.abs(dueDays)} kun kechikkan</Badge>
                  ) : dueDays <= 5 ? (
                    <Badge accent="lavender">{dueDays} kun qoldi</Badge>
                  ) : (
                    <span className="font-semibold text-ink">{formatDate(candidate.next_update_due_at)}</span>
                  )}
                </dd>
              </div>
            </dl>
            <Link
              href={`/monthly-links?candidate=${id}`}
              className="mt-4 inline-flex h-9 w-full items-center justify-center rounded-[12px] border border-brand/40 text-xs font-bold text-brand transition hover:bg-brand/8"
            >
              Yangilash havolasini boshqarish
            </Link>
          </Card>

          <Card className="p-5">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-ink">
              <QrCode className="h-4 w-4 text-brand" /> Profil QR-kodi
            </h3>
            <div className="flex items-center gap-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`https://api.qrserver.com/v1/create-qr-code/?size=140x140&data=${encodeURIComponent(publicUrl)}`}
                alt={`${candidate.full_name} profil QR-kodi`}
                width={110}
                height={110}
                className="rounded-xl border border-line"
              />
              <p className="text-xs leading-relaxed text-ink-soft">
                Tadbirlarda ulashish uchun — skaner qilinganda nomzodning ochiq profili ochiladi.
              </p>
            </div>
          </Card>
        </aside>
      </div>
    </>
  );
}
