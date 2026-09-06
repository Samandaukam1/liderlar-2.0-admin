import Link from "next/link";
import { notFound } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { requirePermission } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/admin/page-header";
import { Card } from "@/components/ui/primitives";
import { Badge, StatusBadge } from "@/components/admin/badges";
import { formatDate } from "@/lib/utils";
import { getSiteUrl } from "@/lib/site-url";
import { LegacyEditForm } from "./edit-form";

export const metadata = { title: "Liderlar 1.0 posti" };
export const dynamic = "force-dynamic";

/** O'zgartirib bo'lmaydigan manba maydonlari — faqat ko'rsatiladi. */
function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-ink-soft">{label}</p>
      <p className="mt-1 break-words text-sm text-ink">{value}</p>
    </div>
  );
}

export default async function LegacyPostDetailPage(props: { params: Promise<{ id: string }> }) {
  await requirePermission("candidates.edit");
  const { id } = await props.params;

  const admin = createSupabaseAdminClient();
  const { data: post } = await admin
    .from("legacy_posts")
    .select("*")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!post) notFound();

  const publicUrl = `${getSiteUrl()}${post.legacy_path as string}`;
  const categories = (post.legacy_categories as string[] | null) ?? [];

  return (
    <>
      <PageHeader
        title={post.title as string}
        description="Liderlar 1.0 arxivi — eski manzil o‘zgarmaydi"
        breadcrumbs={[
          { label: "Nomzodlar" },
          { label: "Liderlar 1.0 postlari", href: "/liderlar-1-0" },
          { label: post.title as string },
        ]}
        actions={
          <a
            href={publicUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-10 items-center gap-2 rounded-[14px] border border-line px-4 text-sm font-bold text-ink transition hover:border-brand hover:text-brand"
          >
            Saytda ko‘rish <ExternalLink className="h-3.5 w-3.5" />
          </a>
        }
      />

      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <Card className="p-5">
          <LegacyEditForm
            post={{
              id: post.id as string,
              title: post.title as string,
              summary: (post.summary as string | null) ?? null,
              legacy_status: post.legacy_status as string,
              cover_image_url: (post.cover_image_url as string | null) ?? null,
              content_html: (post.content_html as string) ?? "",
              candidate_id: (post.candidate_id as string | null) ?? null,
            }}
          />
        </Card>

        <Card className="h-fit space-y-4 p-5">
          <p className="font-display text-sm font-semibold uppercase tracking-wide text-ink">
            Manba (o‘zgartirilmaydi)
          </p>
          <Info label="Manba" value={`Liderlar ${post.source_version as string}`} />
          <Info label="Post ID" value={<span className="font-mono">{post.legacy_source_id as string}</span>} />
          <Info label="Legacy slug" value={<span className="font-mono">{post.legacy_slug as string}</span>} />
          <Info label="Eski URL" value={<span className="font-mono">{post.legacy_path as string}</span>} />
          <Info
            label="Original qo‘shilgan sana"
            value={
              post.legacy_created_at ? (
                formatDate(post.legacy_created_at as string)
              ) : (
                // Manbada sana bo'lmasa shunday qoladi — import sanasi bu
                // yerga hech qachon yozilmaydi.
                <span className="text-ink-soft">noma’lum</span>
              )
            }
          />
          <Info label="Status" value={<StatusBadge status={post.legacy_status as string} />} />
          <Info
            label="Yo‘nalish"
            value={
              categories.length > 0 ? (
                <span className="flex flex-wrap gap-1">
                  {categories.map((category) => (
                    <Badge key={category} accent="sky">
                      {category}
                    </Badge>
                  ))}
                </span>
              ) : (
                <span className="text-ink-soft">—</span>
              )
            }
          />
          {post.legacy_author ? <Info label="Muallif" value={post.legacy_author as string} /> : null}
          <Info
            label="Import qilingan"
            value={<span className="text-ink-soft">{formatDate(post.imported_at as string)}</span>}
          />
          {post.candidate_id ? (
            <Link
              href={`/candidates/${post.candidate_id as string}`}
              className="inline-flex text-sm font-semibold text-brand hover:underline"
            >
              2.0 profiliga o‘tish →
            </Link>
          ) : null}
        </Card>
      </div>
    </>
  );
}
