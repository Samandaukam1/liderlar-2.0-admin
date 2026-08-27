import Link from "next/link";
import Image from "next/image";
import { ImageIcon, Send, Users } from "lucide-react";
import { requirePermission } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { PageHeader } from "@/components/admin/page-header";
import { Badge, Avatar } from "@/components/admin/badges";
import { EmptyState } from "@/components/ui/feedback";
import { Button } from "@/components/ui/primitives";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { listPosts } from "@/lib/post-studio/repository";
import { getSubscriberStats } from "@/lib/post-studio/telegram";
import { getPostTemplate } from "@/lib/post-studio/layout-config";
import {
  POST_STATUSES,
  POST_STATUS_LABELS,
  POST_STATUS_TONES,
  type PostStatus,
} from "@/lib/post-studio/types";
import { PostListFilters } from "./post-list-filters";
import { CreatePostForm } from "./create-post-form";

export const metadata = { title: "Postlar" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 20;

/** Post status tone -> the shared Badge accent vocabulary. */
const TONE_ACCENT = {
  neutral: "neutral",
  info: "sky",
  success: "green",
  warning: "amber",
  danger: "coral",
} as const;

function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("uz-UZ", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export default async function PostlarPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; status?: string; q?: string }>;
}) {
  const ctx = await requirePermission("posts.view");
  const canManage = hasPermission(ctx.roles, "posts.manage");
  const params = await searchParams;

  const page = Math.max(1, Number(params.page ?? "1") || 1);
  const status = POST_STATUSES.includes(params.status as PostStatus)
    ? (params.status as PostStatus)
    : null;

  const admin = createSupabaseAdminClient();
  const [{ items, total }, subscribers, { data: candidateRows }] = await Promise.all([
    listPosts({ page, pageSize: PAGE_SIZE, status, search: params.q ?? null }),
    getSubscriberStats(),
    // Only what the picker needs — never the candidates' content columns.
    canManage
      ? admin
          .from("candidates")
          .select("id, full_name")
          .is("deleted_at", null)
          .order("full_name")
          .limit(500)
      : Promise.resolve({ data: [] as { id: string; full_name: string }[] }),
  ]);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      <PageHeader
        title="Postlar"
        description="Nomzodlar uchun 1080×1080 ijtimoiy tarmoq postlari va Telegram yetkazib berish."
        breadcrumbs={[{ label: "Postlar" }]}
        actions={
          canManage ? (
            <CreatePostForm
              candidates={(candidateRows ?? []).map((c) => ({
                id: c.id as string,
                fullName: c.full_name as string,
              }))}
            />
          ) : null
        }
      />

      {/* Telegram obunachilar statistikasi */}
      <section className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          { label: "Jami obunachilar", value: subscribers.total, icon: Users },
          { label: "Aktiv", value: subscribers.active, icon: Users },
          { label: "To‘xtatgan", value: subscribers.stopped, icon: Users },
          {
            label: "Oxirgi yuborish",
            value: formatDate(subscribers.lastSentAt),
            icon: Send,
          },
        ].map((stat) => (
          <div key={stat.label} className="rounded-card border border-line bg-card p-4">
            <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.08em] text-ink-soft">
              <stat.icon className="h-3.5 w-3.5" />
              {stat.label}
            </div>
            <p className="mt-1 text-xl font-bold text-ink">{stat.value}</p>
          </div>
        ))}
      </section>

      <PostListFilters status={params.status ?? ""} query={params.q ?? ""} />

      {items.length === 0 ? (
        <EmptyState
          title="Post topilmadi"
          description="Nomzod anketasi yuborilganidan 2 soat o‘tgach post avtomatik yaratiladi."
          icon={<ImageIcon className="h-7 w-7" />}
        />
      ) : (
        <div className="overflow-x-auto rounded-card border border-line bg-card">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="border-b border-line text-left text-[11px] font-bold uppercase tracking-[0.08em] text-ink-soft">
              <tr>
                <th className="px-4 py-3">Post</th>
                <th className="px-4 py-3">Nomzod</th>
                <th className="px-4 py-3">Maqola</th>
                <th className="px-4 py-3">Shablon</th>
                <th className="px-4 py-3">Holat</th>
                <th className="px-4 py-3">Telegram</th>
                <th className="px-4 py-3">Yaratilgan</th>
                <th className="px-4 py-3">Oxirgi render</th>
              </tr>
            </thead>
            <tbody>
              {items.map((post) => (
                <tr key={post.id} className="border-b border-line/60 last:border-0">
                  <td className="px-4 py-3">
                    <Link href={`/postlar/${post.id}`} className="block">
                      {/* Thumbnail only — the 1080x1080 render is never loaded in a list. */}
                      {post.renderedThumbnailUrl ? (
                        <Image
                          src={post.renderedThumbnailUrl}
                          alt=""
                          width={64}
                          height={64}
                          unoptimized
                          className="h-16 w-16 rounded-[10px] border border-line object-cover"
                        />
                      ) : (
                        <span className="flex h-16 w-16 items-center justify-center rounded-[10px] border border-dashed border-line-strong text-ink-soft">
                          <ImageIcon className="h-5 w-5" />
                        </span>
                      )}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <Link href={`/postlar/${post.id}`} className="flex items-center gap-2 hover:text-brand">
                      <Avatar src={post.candidateAvatarUrl} name={post.candidateName} />
                      <span className="font-semibold">{post.candidateName}</span>
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-ink-soft">{post.articleTitle ?? "—"}</td>
                  <td className="px-4 py-3 text-ink-soft">
                    {getPostTemplate(post.templateId).label}
                  </td>
                  <td className="px-4 py-3">
                    <Badge accent={TONE_ACCENT[POST_STATUS_TONES[post.status]]}>
                      {POST_STATUS_LABELS[post.status]}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-ink-soft">
                    {post.telegramLastSentAt ? (
                      <span>
                        {post.telegramSentCount} ta
                        {post.telegramFailedCount > 0 ? ` · ${post.telegramFailedCount} xato` : ""}
                      </span>
                    ) : (
                      "Yuborilmagan"
                    )}
                  </td>
                  <td className="px-4 py-3 text-ink-soft">{formatDate(post.createdAt)}</td>
                  <td className="px-4 py-3 text-ink-soft">{formatDate(post.renderedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pageCount > 1 ? (
        <nav className="mt-4 flex items-center justify-between gap-3">
          <p className="text-xs text-ink-soft">
            {total} ta post · {page}/{pageCount}-sahifa
          </p>
          <div className="flex gap-2">
            {page > 1 ? (
              <Link
                href={{ pathname: "/postlar", query: { ...params, page: page - 1 } }}
                scroll={false}
              >
                <Button variant="ghost" size="sm">
                  Oldingi
                </Button>
              </Link>
            ) : null}
            {page < pageCount ? (
              <Link
                href={{ pathname: "/postlar", query: { ...params, page: page + 1 } }}
                scroll={false}
              >
                <Button variant="ghost" size="sm">
                  Keyingi
                </Button>
              </Link>
            ) : null}
          </div>
        </nav>
      ) : null}

      {!canManage ? (
        <p className="mt-4 text-xs text-ink-soft">
          Sizda postlarni tahrirlash ruxsati yo‘q — faqat ko‘rish mumkin.
        </p>
      ) : null}
    </div>
  );
}
