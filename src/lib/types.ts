/** Hand-maintained row types for the canonical Liderlar.uz schema. */

export type CandidateStatus = "draft" | "review" | "published" | "archived";

export interface Candidate {
  id: string;
  integration_key: string;
  slug: string;
  full_name: string;
  short_bio: string | null;
  avatar_url: string | null;
  birth_date: string | null;
  region_id: string | null;
  category_id: string | null;
  status: CandidateStatus;
  is_top100: boolean;
  top100_position: number | null;
  user_id: string | null;
  seo_title: string | null;
  seo_description: string | null;
  phone: string | null;
  email: string | null;
  last_update_requested_at: string | null;
  last_updated_at: string | null;
  next_update_due_at: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  regions?: { name: string } | null;
  categories?: { name: string; color: string | null } | null;
}

export type ArticleStatus =
  | "draft"
  | "review"
  | "scheduled"
  | "published"
  | "archived";

export interface Article {
  id: string;
  candidate_id: string | null;
  title: string;
  subtitle: string | null;
  slug: string;
  excerpt: string | null;
  content: string;
  cover_url: string | null;
  status: ArticleStatus;
  scheduled_at: string | null;
  published_at: string | null;
  seo_title: string | null;
  seo_description: string | null;
  created_by: string | null;
  updated_at: string;
  created_at: string;
  deleted_at: string | null;
  candidates?: { full_name: string; slug: string } | null;
}

export type MonthlyUpdateStatus =
  | "draft"
  | "submitted"
  | "under_review"
  | "needs_changes"
  | "approved"
  | "merged"
  | "rejected";

export interface MonthlyUpdate {
  id: string;
  candidate_id: string;
  token_id: string | null;
  status: MonthlyUpdateStatus;
  free_text: string | null;
  ai_text: string | null;
  final_text: string | null;
  reviewer_id: string | null;
  reviewer_comment: string | null;
  submitted_at: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
  candidates?: { full_name: string; avatar_url: string | null; slug: string } | null;
}

export interface MonthlyUpdateItem {
  id: string;
  update_id: string;
  kind:
    | "book"
    | "achievement"
    | "event"
    | "project"
    | "volunteering"
    | "education"
    | "work"
    | "certificate"
    | "other";
  title: string;
  description: string | null;
  occurred_at: string | null;
  link_url: string | null;
  sort_order: number;
}

export interface MonthlyUpdateToken {
  id: string;
  candidate_id: string;
  token_hash: string;
  status: "active" | "used" | "revoked";
  expires_at: string | null;
  used_at: string | null;
  created_by: string | null;
  revoked_at: string | null;
  created_at: string;
  candidates?: {
    full_name: string;
    avatar_url: string | null;
    next_update_due_at: string | null;
    last_updated_at: string | null;
  } | null;
}

export interface Podcast {
  id: string;
  title: string;
  description: string | null;
  starts_at: string | null;
  location: string | null;
  online_url: string | null;
  host_name: string | null;
  banner_url: string | null;
  media_url: string | null;
  status: "planned" | "announced" | "live" | "recorded" | "published" | "cancelled";
  cancel_reason: string | null;
  registration_limit: number | null;
  created_at: string;
  updated_at: string;
}

export interface Journal {
  id: string;
  issue_number: number;
  title: string;
  description: string | null;
  cover_url: string | null;
  pdf_url: string | null;
  published_at: string | null;
  status: "draft" | "published";
  is_featured: boolean;
  downloads_count: number;
  created_at: string;
}

export interface Quote {
  id: string;
  candidate_id: string | null;
  author_name: string | null;
  text: string;
  is_featured: boolean;
  status: "draft" | "published";
  accent: string | null;
  created_at: string;
  candidates?: { full_name: string; avatar_url: string | null } | null;
}

export type ApplicationStatus =
  | "new"
  | "in_review"
  | "needs_info"
  | "accepted"
  | "rejected"
  | "converted";

export interface Application {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  region_id: string | null;
  category_id: string | null;
  motivation: string | null;
  status: ApplicationStatus;
  assignee_id: string | null;
  duplicate_of: string | null;
  candidate_id: string | null;
  created_at: string;
  updated_at: string;
  regions?: { name: string } | null;
  categories?: { name: string } | null;
}

export interface AuditLog {
  id: string;
  actor_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  old_value: unknown;
  new_value: unknown;
  reason: string | null;
  severity: "info" | "warning" | "critical";
  metadata: Record<string, unknown>;
  created_at: string;
  profiles?: { full_name: string; avatar_url: string | null } | null;
}

export interface Region {
  id: string;
  name: string;
  slug: string;
  sort_order: number;
}

export interface Category {
  id: string;
  name: string;
  slug: string;
  color: string | null;
  icon: string | null;
  sort_order: number;
}

export interface MediaAsset {
  id: string;
  bucket: string;
  path: string;
  file_name: string;
  mime_type: string | null;
  size_bytes: number | null;
  candidate_id: string | null;
  kind: string | null;
  uploaded_by: string | null;
  created_at: string;
  deleted_at: string | null;
}

export interface AiJob {
  id: string;
  kind: string;
  status: "pending" | "running" | "succeeded" | "failed";
  entity_type: string | null;
  entity_id: string | null;
  input_chars: number | null;
  output_chars: number | null;
  model: string | null;
  error: string | null;
  created_by: string | null;
  created_at: string;
  finished_at: string | null;
}

export interface NotificationRow {
  id: string;
  recipient_id: string | null;
  title: string;
  body: string | null;
  kind: string;
  link: string | null;
  read_at: string | null;
  created_at: string;
}

export interface AdminUser {
  id: string;
  full_name: string;
  avatar_url: string | null;
  email: string | null;
  is_active: boolean;
  created_at: string;
  roles: string[];
}
