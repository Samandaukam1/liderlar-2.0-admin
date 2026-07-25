import { notFound } from "next/navigation";
import {
  BookOpen,
  Award,
  CalendarDays,
  FolderKanban,
  HeartHandshake,
  GraduationCap,
  Briefcase,
  FileBadge,
  StickyNote,
  Paperclip,
} from "lucide-react";
import { requirePermission } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/admin/page-header";
import { Card } from "@/components/ui/primitives";
import { CandidateMiniCard, StatusBadge, Badge } from "@/components/admin/badges";
import { formatDate } from "@/lib/utils";
import type { MonthlyUpdate, MonthlyUpdateItem } from "@/lib/types";
import { FinalTextEditor, ReviewActions, UpdateAIPanel } from "./review-actions";

export const dynamic = "force-dynamic";

const KIND_META: Record<string, { label: string; icon: typeof BookOpen }> = {
  book: { label: "O‘qilgan kitob", icon: BookOpen },
  achievement: { label: "Yutuq", icon: Award },
  event: { label: "Tadbir", icon: CalendarDays },
  project: { label: "Loyiha", icon: FolderKanban },
  volunteering: { label: "Volontyorlik", icon: HeartHandshake },
  education: { label: "Ta’lim", icon: GraduationCap },
  work: { label: "Ish", icon: Briefcase },
  certificate: { label: "Sertifikat", icon: FileBadge },
  other: { label: "Boshqa", icon: StickyNote },
};

export default async function MonthlyUpdateDetailPage(props: {
  params: Promise<{ id: string }>;
}) {
  const ctx = await requirePermission("updates.view");
  const { id } = await props.params;
  const admin = createSupabaseAdminClient();

  const { data } = await admin
    .from("monthly_updates")
    .select("*, candidates(full_name, avatar_url, slug)")
    .eq("id", id)
    .maybeSingle();
  if (!data) notFound();
  const update = data as unknown as MonthlyUpdate;

  const [{ data: items }, { data: media }] = await Promise.all([
    admin
      .from("monthly_update_items")
      .select("*")
      .eq("update_id", id)
      .order("sort_order"),
    admin
      .from("monthly_update_media")
      .select("id, file_name, mime_type, bucket, path, size_bytes")
      .eq("update_id", id),
  ]);

  // Signed URLs for private media
  const mediaWithUrls = await Promise.all(
    ((media ?? []) as Array<{ id: string; file_name: string; mime_type: string | null; bucket: string; path: string; size_bytes: number | null }>).map(
      async (m) => {
        const { data: signed } = await admin.storage
          .from(m.bucket)
          .createSignedUrl(m.path, 3600);
        return { ...m, url: signed?.signedUrl ?? null };
      },
    ),
  );

  const canReview = hasPermission(ctx.roles, "updates.review");
  const canMerge = hasPermission(ctx.roles, "updates.merge");
  const candidateName = update.candidates?.full_name ?? "Nomzod";
  const originalText = update.free_text?.trim() || "";

  return (
    <>
      <PageHeader
        title={`${candidateName} — oylik yangilanish`}
        breadcrumbs={[
          { label: "Yuborilgan yangilanishlar", href: "/monthly-updates" },
          { label: candidateName },
        ]}
        actions={
          canReview ? (
            <ReviewActions updateId={id} status={update.status} canMerge={canMerge} />
          ) : undefined
        }
      />

      <div className="mb-5 flex flex-wrap items-center gap-4 rounded-card border border-line bg-card p-4 shadow-card">
        <CandidateMiniCard
          name={candidateName}
          avatarUrl={update.candidates?.avatar_url}
          href={`/candidates/${update.candidate_id}`}
        />
        <StatusBadge status={update.status} />
        <span className="text-xs text-ink-soft">
          Yuborilgan: <b className="text-ink">{formatDate(update.submitted_at, true)}</b>
        </span>
        {update.reviewed_at && (
          <span className="text-xs text-ink-soft">
            Tekshirilgan: <b className="text-ink">{formatDate(update.reviewed_at, true)}</b>
          </span>
        )}
      </div>

      {update.reviewer_comment && (
        <div className="mb-5 rounded-card border border-peach/50 bg-peach/10 p-4 text-sm">
          <b className="text-[#b3611f]">Tekshiruvchi izohi:</b>{" "}
          <span className="text-ink">{update.reviewer_comment}</span>
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <div className="min-w-0 space-y-5 xl:col-span-2">
          {/* Structured items */}
          <Card className="p-5">
            <h2 className="mb-4 text-sm font-bold text-ink">
              Yuborilgan yozuvlar ({(items ?? []).length})
            </h2>
            {(items ?? []).length === 0 ? (
              <p className="text-sm text-ink-soft">Strukturali yozuvlar yo‘q</p>
            ) : (
              <ul className="space-y-3">
                {((items ?? []) as MonthlyUpdateItem[]).map((item) => {
                  const meta = KIND_META[item.kind] ?? KIND_META.other;
                  const Icon = meta.icon;
                  return (
                    <li key={item.id} className="flex items-start gap-3 rounded-[16px] border border-line/70 p-3.5">
                      <span className="rounded-xl bg-cyan/10 p-2 text-brand">
                        <Icon className="h-4 w-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-bold text-ink">{item.title}</p>
                          <Badge accent="sky">{meta.label}</Badge>
                        </div>
                        {item.description && (
                          <p className="mt-1 text-xs leading-relaxed text-ink-soft">{item.description}</p>
                        )}
                        <div className="mt-1 flex flex-wrap gap-3 text-[11px] text-ink-soft">
                          {item.occurred_at && <span>{formatDate(item.occurred_at)}</span>}
                          {item.link_url && (
                            <a href={item.link_url} target="_blank" rel="noreferrer" className="text-electric hover:underline">
                              Havola
                            </a>
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          {/* AI improve flow on the free text */}
          {originalText.length >= 20 && canReview && (
            <UpdateAIPanel
              updateId={id}
              original={originalText}
              aiText={update.ai_text}
              candidateName={candidateName}
            />
          )}

          {originalText && (
            <Card className="p-5">
              <h2 className="mb-2 text-sm font-bold text-ink">Nomzod yuborgan erkin matn</h2>
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink-soft">{originalText}</p>
            </Card>
          )}

          {/* Final text */}
          {canReview && (
            <Card className="p-5">
              <h2 className="mb-3 text-sm font-bold text-ink">
                Profilga qo‘shiladigan yakuniy ko‘rinish
              </h2>
              <FinalTextEditor updateId={id} finalText={update.final_text} />
            </Card>
          )}
        </div>

        {/* Media side panel */}
        <aside className="space-y-4">
          <Card className="p-5">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-ink">
              <Paperclip className="h-4 w-4 text-brand" /> Biriktirilgan fayllar ({mediaWithUrls.length})
            </h3>
            {mediaWithUrls.length === 0 ? (
              <p className="text-sm text-ink-soft">Fayl biriktirilmagan</p>
            ) : (
              <ul className="space-y-2">
                {mediaWithUrls.map((m) => (
                  <li key={m.id}>
                    <a
                      href={m.url ?? "#"}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-3 rounded-[14px] border border-line p-3 transition hover:border-brand/40 hover:bg-surface"
                    >
                      {m.mime_type?.startsWith("image/") && m.url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={m.url} alt="" width={44} height={44} className="h-11 w-11 rounded-lg border border-line object-cover" />
                      ) : (
                        <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-coral/10 text-[11px] font-bold text-coral">
                          {m.mime_type === "application/pdf" ? "PDF" : "FILE"}
                        </span>
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-bold text-ink">{m.file_name}</span>
                        <span className="block text-[11px] text-ink-soft">
                          {m.size_bytes ? `${(m.size_bytes / 1024 / 1024).toFixed(1)} MB` : ""}
                        </span>
                      </span>
                    </a>
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
