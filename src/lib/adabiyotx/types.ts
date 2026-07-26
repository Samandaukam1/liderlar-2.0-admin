export const ADABIYOTX_CONTENT_TYPES = [
  "book",
  "article",
  "poem",
  "scenario",
  "other",
] as const;

export type AdabiyotXContentType =
  (typeof ADABIYOTX_CONTENT_TYPES)[number];

export const CANDIDATE_ADABIYOTX_RELATIONSHIPS = [
  "own_work",
  "read_book",
] as const;

export type CandidateAdabiyotXRelationship =
  (typeof CANDIDATE_ADABIYOTX_RELATIONSHIPS)[number];

export interface CandidateAdabiyotXItem {
  id: string;
  candidateId: string;
  externalId: string;
  relationshipType: CandidateAdabiyotXRelationship;
  contentType: AdabiyotXContentType;
  title: string;
  authorName: string | null;
  description: string | null;
  coverUrl: string | null;
  externalUrl: string;
  publishedAt: string | null;
  sortOrder: number;
  isVisible: boolean;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface CandidateAdabiyotXRow {
  id: string;
  candidate_id: string;
  external_id: string;
  relationship_type: CandidateAdabiyotXRelationship;
  content_type: AdabiyotXContentType;
  title: string;
  author_name: string | null;
  description: string | null;
  cover_url: string | null;
  external_url: string;
  published_at: string | null;
  sort_order: number;
  is_visible: boolean;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface AdabiyotXSearchItem {
  externalId: string;
  contentType: AdabiyotXContentType;
  title: string;
  authorName: string | null;
  description: string | null;
  coverUrl: string | null;
  externalUrl: string;
  publishedAt: string | null;
}

export interface PublicCandidateAdabiyotXItem {
  id: string;
  externalId: string;
  relationshipType: CandidateAdabiyotXRelationship;
  contentType: AdabiyotXContentType;
  title: string;
  authorName: string | null;
  description: string | null;
  coverUrl: string | null;
  externalUrl: string;
  publishedAt: string | null;
  sortOrder: number;
}

export type PublicCandidateAdabiyotXRow = Pick<
  CandidateAdabiyotXRow,
  | "id"
  | "external_id"
  | "relationship_type"
  | "content_type"
  | "title"
  | "author_name"
  | "description"
  | "cover_url"
  | "external_url"
  | "published_at"
  | "sort_order"
  | "metadata"
>;

export function mapCandidateAdabiyotXRow(
  row: CandidateAdabiyotXRow,
): CandidateAdabiyotXItem {
  return {
    id: row.id,
    candidateId: row.candidate_id,
    externalId: row.external_id,
    relationshipType: row.relationship_type,
    contentType: row.content_type,
    title: row.title,
    authorName: row.author_name,
    description: row.description,
    coverUrl: row.cover_url,
    externalUrl: row.external_url,
    publishedAt: row.published_at,
    sortOrder: row.sort_order,
    isVisible: row.is_visible,
    metadata: row.metadata ?? {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapPublicCandidateAdabiyotXRow(
  row: PublicCandidateAdabiyotXRow,
): PublicCandidateAdabiyotXItem {
  return {
    id: row.id,
    externalId: row.external_id,
    relationshipType: row.relationship_type,
    contentType: row.content_type,
    title: row.title,
    authorName: row.author_name,
    description: row.description,
    coverUrl: row.cover_url,
    externalUrl: row.external_url,
    publishedAt: row.published_at,
    sortOrder: row.sort_order,
  };
}
