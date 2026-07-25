import { Image as ImageIcon, FileText } from "lucide-react";
import { requirePermission } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { parseListParams } from "@/lib/list";
import { PageHeader } from "@/components/admin/page-header";
import { DataTableToolbar } from "@/components/admin/toolbar";
import { Pagination } from "@/components/admin/data-table";
import { EmptyState } from "@/components/ui/feedback";
import { Badge } from "@/components/admin/badges";
import { formatBytes, formatDate, truncate } from "@/lib/utils";
import { MediaDeleteButton, MediaUploadButton } from "./media-controls";

export const metadata = { title: "Media kutubxonasi" };
export const dynamic = "force-dynamic";

const MEDIA_PAGE_SIZE = 24;

const TYPE_BADGES: Record<string, { label: string; accent: "sky" | "coral" | "mint" | "lavender" }> = {
  image: { label: "Rasm", accent: "sky" },
  pdf: { label: "PDF", accent: "coral" },
  audio: { label: "Audio", accent: "lavender" },
  other: { label: "Fayl", accent: "mint" },
};

function typeOf(mime: string | null): keyof typeof TYPE_BADGES {
  if (!mime) return "other";
  if (mime.startsWith("image/")) return "image";
  if (mime === "application/pdf") return "pdf";
  if (mime.startsWith("audio/")) return "audio";
  return "other";
}

export default async function MediaPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requirePermission("media.view");
  const canUpload = hasPermission(ctx.roles, "media.upload");
  const canDelete = hasPermission(ctx.roles, "media.delete");
  const sp = await props.searchParams;
  const { page, q, filters } = parseListParams(sp, ["bucket"]);
  const admin = createSupabaseAdminClient();

  let query = admin
    .from("candidate_media")
    .select("*, candidates(full_name)", { count: "exact" })
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  if (filters.bucket) query = query.eq("bucket", filters.bucket);
  if (q) query = query.ilike("file_name", `%${q}%`);
  const from = (page - 1) * MEDIA_PAGE_SIZE;
  const { data, count, error } = await query.range(from, from + MEDIA_PAGE_SIZE - 1);

  const assets = await Promise.all(
    ((data ?? []) as Array<{
      id: string;
      bucket: string;
      path: string;
      file_name: string;
      mime_type: string | null;
      size_bytes: number | null;
      created_at: string;
      candidates: { full_name: string } | null;
    }>).map(async (a) => {
      const isPublic = ["candidate-avatars", "candidate-gallery", "journal-covers", "podcast-media"].includes(a.bucket);
      let url: string | null = null;
      if (isPublic) {
        url = admin.storage.from(a.bucket).getPublicUrl(a.path).data.publicUrl;
      } else {
        const { data: signed } = await admin.storage.from(a.bucket).createSignedUrl(a.path, 3600);
        url = signed?.signedUrl ?? null;
      }
      return { ...a, url, isPublic };
    }),
  );

  return (
    <>
      <PageHeader
        title="Media kutubxonasi"
        description="Rasmlar, PDF va fayllar — barcha bucketlar bo‘yicha"
        breadcrumbs={[{ label: "Media" }]}
        actions={canUpload ? <MediaUploadButton /> : undefined}
      />
      <DataTableToolbar
        searchPlaceholder="Fayl nomi bo‘yicha…"
        filters={[
          {
            key: "bucket",
            label: "Bucket",
            options: [
              { value: "candidate-avatars", label: "Nomzod suratlari" },
              { value: "candidate-gallery", label: "Galereya" },
              { value: "monthly-update-media", label: "Oylik yangilanishlar" },
              { value: "journal-covers", label: "Jurnal muqovalari" },
              { value: "journal-pdfs", label: "Jurnal PDF" },
              { value: "podcast-media", label: "Podcast media" },
              { value: "application-files", label: "Ariza fayllari" },
              { value: "admin-private-files", label: "Maxfiy fayllar" },
            ],
          },
        ]}
      />

      {assets.length === 0 ? (
        <EmptyState
          icon={<ImageIcon className="h-7 w-7" />}
          title={error ? "Jadval topilmadi" : "Fayllar yo‘q"}
          description={error ? "Supabase migrationlarni ishga tushiring." : "Birinchi faylni yuklang."}
        />
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
          {assets.map((a) => {
            const t = TYPE_BADGES[typeOf(a.mime_type)];
            return (
              <figure key={a.id} className="group overflow-hidden rounded-card border border-line bg-card shadow-card transition hover:shadow-card-hover">
                <div className="relative aspect-square bg-surface">
                  {typeOf(a.mime_type) === "image" && a.url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={a.url} alt={a.file_name} className="h-full w-full object-cover" loading="lazy" />
                  ) : (
                    <div className="flex h-full items-center justify-center">
                      <FileText className="h-10 w-10 text-ink-soft/40" />
                    </div>
                  )}
                  <span className="absolute left-2 top-2">
                    <Badge accent={t.accent}>{t.label}</Badge>
                  </span>
                </div>
                <figcaption className="p-3">
                  <a
                    href={a.url ?? "#"}
                    target="_blank"
                    rel="noreferrer"
                    className="block truncate text-xs font-bold text-ink hover:text-brand"
                    title={a.file_name}
                  >
                    {truncate(a.file_name, 26)}
                  </a>
                  <p className="mt-0.5 text-[11px] text-ink-soft">
                    {formatBytes(a.size_bytes)} · {formatDate(a.created_at)}
                  </p>
                  {a.candidates?.full_name && (
                    <p className="truncate text-[11px] text-brand">{a.candidates.full_name}</p>
                  )}
                  {canDelete && (
                    <div className="mt-1 flex justify-end opacity-0 transition group-hover:opacity-100">
                      <MediaDeleteButton id={a.id} fileName={a.file_name} />
                    </div>
                  )}
                </figcaption>
              </figure>
            );
          })}
        </div>
      )}

      <Pagination page={page} pageSize={MEDIA_PAGE_SIZE} total={count ?? 0} basePath="/media" params={{ q, ...filters }} />
    </>
  );
}
