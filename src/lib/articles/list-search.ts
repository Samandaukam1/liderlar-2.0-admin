export const ARTICLE_SEARCH_MAX_LENGTH = 120;
export const ARTICLE_PAGE_SIZE = 10;

/** Barcha maqola ro‘yxatlarida PostgREST uchun bir xil sarlavha va muallif filtrini tayyorlaydi. */
export function getArticleSearch(query: string) {
  const keyword = query.slice(0, ARTICLE_SEARCH_MAX_LENGTH).replace(/[%_*\\]/g, " ").trim();
  if (!keyword) return null;

  const pattern = `%${keyword}%`;
  return {
    pattern,
    titleOrAuthor: `title.ilike.${JSON.stringify(pattern)},matching_author.not.is.null`,
  };
}

/** URLdan kelgan sahifani PostgREST qabul qiladigan, chegaralangan SQL offsetiga aylantiradi. */
export function getArticlePageRange(requestedPage: number) {
  const page = Number.isSafeInteger(requestedPage) ? Math.max(1, requestedPage) : 1;
  const from = Math.min((page - 1) * ARTICLE_PAGE_SIZE, 2_147_483_630);
  return { page, from, to: from + ARTICLE_PAGE_SIZE - 1 };
}
