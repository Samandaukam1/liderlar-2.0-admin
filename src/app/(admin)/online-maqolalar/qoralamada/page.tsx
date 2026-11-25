import { ArticlePublicationList } from "../article-publication-list";

export const metadata = { title: "Qoralamaga qaytarilgan Liderlar Online maqolalari" };

/** Avval nashr qilingan va qoralamaga qaytarilgan maqolalar sahifasi. */
export default function UnpublishedArticlesPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <ArticlePublicationList state="draft" searchParams={searchParams} />;
}
