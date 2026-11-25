import { ArticlePublicationList } from "../article-publication-list";

export const metadata = { title: "Nashrdagi Liderlar Online maqolalari" };

/** Nashrda turgan maqolalar sahifasi. */
export default function PublishedArticlesPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <ArticlePublicationList state="published" searchParams={searchParams} />;
}
