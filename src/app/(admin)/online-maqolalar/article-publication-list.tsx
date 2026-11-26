import Link from "next/link";
import Image from "next/image";
import { ImageIcon, PenLine } from "lucide-react";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/admin/page-header";
import { Pagination } from "@/components/admin/pagination";
import { DataTableToolbar } from "@/components/admin/toolbar";
import { Card } from "@/components/ui/primitives";
import { ARTICLE_PAGE_SIZE, ARTICLE_SEARCH_MAX_LENGTH, getArticlePageRange, getArticleSearch } from "@/lib/articles/list-search";
import { requirePermission } from "@/lib/auth";
import { parseListParams } from "@/lib/list";
import { hasPermission } from "@/lib/permissions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { formatDate } from "@/lib/utils";
import { ArticlePublicationButton } from "./article-publication-button";
import { ArticleSectionNav } from "./article-section-nav";

const LISTS = {
  published: {
    path: "/online-maqolalar/nashrda",
    label: "Nashrda",
    title: "Nashrdagi maqolalar",
    description: "Nomzodlar yozgan va Liderlar Online’da nashr etilgan maqolalar.",
    dateField: "published_at",
    emptyMessage: "Hozircha nashrdagi maqolalar yo‘q.",
  },
  draft: {
    path: "/online-maqolalar/qoralamada",
    label: "Qoralamada",
    title: "Qoralamaga qaytarilgan maqolalar",
    description: "Nashrdan olinib, qoralamaga qaytarilgan maqolalar.",
    dateField: "reviewed_at",
    emptyMessage: "Hozircha qoralamaga qaytarilgan maqolalar yo‘q.",
  },
} as const;

type PublicationListArticle = {
  id: string;
  title: string;
  hero_url: string | null;
  hero_alt: string | null;
  list_date: string | null;
  candidates: { full_name: string | null } | null;
};

/** Nashrdagi yoki nashrdan qaytgan maqolalarning sarlavha, muallif va sanalarini sahifalab oladi. */
export async function ArticlePublicationList({ state, searchParams }: {
  state: keyof typeof LISTS;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const list = LISTS[state];
  const ctx = await requirePermission("articles.view");
  const canEdit = hasPermission(ctx.roles, "articles.edit");
  const params = parseListParams(await searchParams);
  const { page, from, to } = getArticlePageRange(params.page);
  const q = params.q.slice(0, ARTICLE_SEARCH_MAX_LENGTH);
  const search = getArticleSearch(q);
  const db = createSupabaseAdminClient();
  let query = db.from("member_articles")
    .select(
      `id, title, hero_url, hero_alt, list_date:${list.dateField}, candidates(full_name)${search ? ", matching_author:candidates()" : ""}`,
      { count: "exact" },
    )
    .eq("state", state);

  if (state === "draft") {
    // Slugs are assigned at publication and kept when an article returns to draft.
    query = query.not("slug", "is", null);
  }

  if (search) {
    query = query.ilike("matching_author.full_name", search.pattern).or(search.titleOrAuthor);
  }

  const { data, count, error } = await query
    .order(list.dateField, { ascending: false, nullsFirst: false })
    .order("id", { ascending: false })
    .range(from, to)
    .returns<PublicationListArticle[]>();
  if ((error?.code === "PGRST103" || (!error && !data?.length)) && page > 1) {
    redirect(q ? `${list.path}?${new URLSearchParams({ q })}` : list.path);
  }

  return (
    <>
      <PageHeader
        title={list.title}
        description={list.description}
        breadcrumbs={[
          { label: "Liderlar Online maqolalari", href: "/online-maqolalar" },
          { label: list.label },
        ]}
      />
      <ArticleSectionNav active={state} />
      <DataTableToolbar key={state} searchPlaceholder="Sarlavha yoki muallif nomi" searchMaxLength={ARTICLE_SEARCH_MAX_LENGTH} />
      {error ? (
        <Card><p role="alert" className="text-sm text-coral">Maqolalarni yuklab bo‘lmadi. Sahifani yangilang.</p></Card>
      ) : data?.length ? (
        <>
          <Card>
            <ul className="divide-y divide-line">
              {data.map((article) => (
                <li key={article.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3">
                  <div className="flex min-w-0 flex-1 basis-64 items-center gap-3">
                    <div className="flex h-14 w-20 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-line bg-surface sm:h-16 sm:w-24">
                      {article.hero_url ? (
                        <Image
                          src={article.hero_url}
                          alt={article.hero_alt ?? ""}
                          width={192}
                          height={128}
                          loading="lazy"
                          unoptimized
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <ImageIcon className="h-5 w-5 text-ink-soft" aria-label="Maqola rasmi yo‘q" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="break-words text-sm font-bold text-ink">{article.title}</p>
                      <p className="mt-1 text-xs text-ink-soft">
                        {article.candidates?.full_name ?? "Muallif topilmadi"}
                        {article.list_date ? ` · ${formatDate(article.list_date, true)}` : ""}
                      </p>
                    </div>
                  </div>
                  {canEdit && (
                    <div className="flex flex-wrap items-center gap-3">
                      <Link href={`/online-maqolalar/${article.id}/edit`} prefetch={false} className="inline-flex min-h-9 items-center gap-1.5 text-sm font-semibold text-brand hover:underline" aria-label={`${article.title} — tahrirlash`}>
                        <PenLine className="h-4 w-4" aria-hidden="true" />
                        Tahrirlash
                      </Link>
                      <ArticlePublicationButton id={article.id} title={article.title} action={state === "draft" ? "publish" : "unpublish"} />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </Card>
          <Pagination page={page} pageSize={ARTICLE_PAGE_SIZE} total={count ?? 0} prefetch={false} />
        </>
      ) : (
        <Card><p className="text-sm text-ink-soft">{search ? "Qidiruv bo‘yicha maqola topilmadi." : list.emptyMessage}</p></Card>
      )}
    </>
  );
}
