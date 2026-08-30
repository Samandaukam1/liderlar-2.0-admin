import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/admin/page-header";
import { Card } from "@/components/ui/primitives";
import { Avatar, StatusBadge, Badge } from "@/components/admin/badges";
import { formatDate, timeAgo, formatBytes } from "@/lib/utils";
import type { Application } from "@/lib/types";
import { genderLabel, telegramHref } from "@/lib/application-fields";
import { ApplicationActions } from "./application-actions";

export const dynamic = "force-dynamic";

export default async function ApplicationDetailPage(props: {
  params: Promise<{ id: string }>;
}) {
  const ctx = await requirePermission("applications.view");
  const { id } = await props.params;
  const admin = createSupabaseAdminClient();

  const { data } = await admin
    .from("applications")
    .select("*, regions(name), categories(name)")
    .eq("id", id)
    .maybeSingle();
  if (!data) notFound();
  const app = data as unknown as Application;

  const [{ data: notes }, { data: files }, { data: possibleDuplicates }] = await Promise.all([
    admin
      .from("application_notes")
      .select("id, note, created_at, profiles(full_name)")
      .eq("application_id", id)
      .order("created_at", { ascending: false }),
    admin.from("application_files").select("id, file_name, bucket, path, size_bytes").eq("application_id", id),
    admin
      .from("candidates")
      .select("id, full_name, slug")
      .ilike("full_name", `%${app.full_name.split(" ")[0] ?? ""}%`)
      .is("deleted_at", null)
      .limit(5),
  ]);

  const filesWithUrls = await Promise.all(
    ((files ?? []) as Array<{ id: string; file_name: string; bucket: string; path: string; size_bytes: number | null }>).map(
      async (f) => {
        const { data: signed } = await admin.storage.from(f.bucket).createSignedUrl(f.path, 3600);
        return { ...f, url: signed?.signedUrl ?? null };
      },
    ),
  );

  const canReview = hasPermission(ctx.roles, "applications.review");
  const canConvert = hasPermission(ctx.roles, "applications.convert");

  return (
    <>
      <PageHeader
        title={app.full_name}
        breadcrumbs={[{ label: "Arizalar", href: "/applications" }, { label: app.full_name }]}
        actions={
          canReview ? (
            <ApplicationActions applicationId={id} status={app.status} canConvert={canConvert} />
          ) : undefined
        }
      />

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <div className="min-w-0 space-y-5 xl:col-span-2">
          <Card className="p-5">
            <div className="flex flex-wrap items-center gap-4">
              <Avatar name={app.full_name} size={56} />
              <div className="min-w-0 flex-1">
                <p className="font-display text-xl font-semibold uppercase tracking-wide text-ink">{app.full_name}</p>
                <p className="text-sm text-ink-soft">
                  {[app.phone, app.telegram, app.email].filter(Boolean).join(" · ") || "Kontakt ko‘rsatilmagan"}
                </p>
              </div>
              <StatusBadge status={app.status} />
            </div>
            <dl className="mt-5 grid grid-cols-1 gap-3 border-t border-line/60 pt-4 sm:grid-cols-2">
              <div>
                <dt className="text-[11px] font-bold uppercase tracking-wider text-ink-soft">Telefon raqam</dt>
                <dd className="text-sm font-semibold text-ink">
                  {app.phone ? (
                    <a href={`tel:${app.phone}`} className="text-brand hover:underline">
                      {app.phone}
                    </a>
                  ) : (
                    "—"
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-[11px] font-bold uppercase tracking-wider text-ink-soft">Telegram</dt>
                <dd className="text-sm font-semibold text-ink">
                  {app.telegram ? (
                    telegramHref(app.telegram) ? (
                      <a
                        href={telegramHref(app.telegram) as string}
                        target="_blank"
                        rel="noreferrer"
                        className="text-brand hover:underline"
                      >
                        {app.telegram}
                      </a>
                    ) : (
                      app.telegram
                    )
                  ) : (
                    "—"
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-[11px] font-bold uppercase tracking-wider text-ink-soft">Jinsi</dt>
                <dd className="text-sm font-semibold text-ink">{genderLabel(app.gender)}</dd>
              </div>
              <div>
                <dt className="text-[11px] font-bold uppercase tracking-wider text-ink-soft">Yoshi</dt>
                <dd className="text-sm font-semibold text-ink">{app.age_range ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-[11px] font-bold uppercase tracking-wider text-ink-soft">Promo kod</dt>
                <dd className="text-sm font-semibold text-ink">
                  {app.promo_code ? <Badge accent="lime">{app.promo_code}</Badge> : "—"}
                </dd>
              </div>
              {(app.categories?.name || app.regions?.name) && (
                <div>
                  <dt className="text-[11px] font-bold uppercase tracking-wider text-ink-soft">Yo‘nalish / hudud</dt>
                  <dd className="text-sm font-semibold text-ink">
                    {[app.categories?.name, app.regions?.name].filter(Boolean).join(" · ")}
                  </dd>
                </div>
              )}
              <div>
                <dt className="text-[11px] font-bold uppercase tracking-wider text-ink-soft">Kelgan sana</dt>
                <dd className="text-sm font-semibold text-ink">{formatDate(app.created_at, true)}</dd>
              </div>
              {app.candidate_id && (
                <div>
                  <dt className="text-[11px] font-bold uppercase tracking-wider text-ink-soft">Nomzod profili</dt>
                  <dd>
                    <Link href={`/candidates/${app.candidate_id}`} className="text-sm font-bold text-brand hover:underline">
                      Profilni ochish →
                    </Link>
                  </dd>
                </div>
              )}
            </dl>
            {app.motivation && (
              <div className="mt-4 rounded-[16px] bg-surface p-4">
                <p className="mb-1 text-[11px] font-bold uppercase tracking-wider text-ink-soft">Motivatsiya</p>
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink">{app.motivation}</p>
              </div>
            )}
          </Card>

          <Card className="p-5">
            <h2 className="mb-4 text-sm font-bold text-ink">Moderator izohlari va timeline</h2>
            {(notes ?? []).length === 0 ? (
              <p className="text-sm text-ink-soft">Izohlar yo‘q</p>
            ) : (
              <ol className="relative space-y-4 border-l-2 border-line pl-5">
                {((notes ?? []) as unknown as Array<{ id: string; note: string; created_at: string; profiles: { full_name: string } | null }>).map((n) => (
                  <li key={n.id} className="relative">
                    <span className="absolute -left-[27px] top-1 h-3 w-3 rounded-full border-2 border-card bg-sky" />
                    <p className="text-sm text-ink">{n.note}</p>
                    <p className="text-[11px] text-ink-soft/80">
                      {n.profiles?.full_name ?? "—"} · {timeAgo(n.created_at)}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>

        <aside className="space-y-4">
          <Card className="p-5">
            <h3 className="mb-3 text-sm font-bold text-ink">Fayllar ({filesWithUrls.length})</h3>
            {filesWithUrls.length === 0 ? (
              <p className="text-sm text-ink-soft">Fayl biriktirilmagan</p>
            ) : (
              <ul className="space-y-2">
                {filesWithUrls.map((f) => (
                  <li key={f.id}>
                    <a
                      href={f.url ?? "#"}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center justify-between gap-2 rounded-[14px] border border-line p-3 text-sm transition hover:border-brand/40"
                    >
                      <span className="truncate font-semibold text-ink">{f.file_name}</span>
                      <span className="shrink-0 text-xs text-ink-soft">{formatBytes(f.size_bytes)}</span>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card className="p-5">
            <h3 className="mb-3 text-sm font-bold text-ink">Dublikat tekshiruvi</h3>
            {(possibleDuplicates ?? []).length === 0 ? (
              <p className="text-sm text-ink-soft">O‘xshash nomzod topilmadi</p>
            ) : (
              <ul className="space-y-2">
                {(possibleDuplicates ?? []).map((c: { id: string; full_name: string; slug: string }) => (
                  <li key={c.id} className="flex items-center justify-between gap-2">
                    <Link href={`/candidates/${c.id}`} className="min-w-0 truncate text-sm font-semibold text-brand hover:underline">
                      {c.full_name}
                    </Link>
                    <Badge accent="peach">o‘xshash</Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </aside>
      </div>
    </>
  );
}
