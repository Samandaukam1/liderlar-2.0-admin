drop extension if exists "pg_net";

create extension if not exists "citext" with schema "public";

create extension if not exists "pg_trgm" with schema "public";

create extension if not exists "unaccent" with schema "public";

drop trigger if exists "trg_candidate_adabiyotx_items_updated" on "public"."candidate_adabiyotx_items";

drop trigger if exists "trg_applications_updated" on "public"."applications";

drop trigger if exists "trg_articles_updated" on "public"."articles";

drop trigger if exists "trg_intake_answers_updated" on "public"."candidate_intake_answers";

drop trigger if exists "trg_intake_templates_updated" on "public"."candidate_intake_templates";

drop trigger if exists "trg_intakes_updated" on "public"."candidate_intakes";

drop trigger if exists "trg_candidates_updated" on "public"."candidates";

drop trigger if exists "trg_monthly_update_merged" on "public"."monthly_updates";

drop trigger if exists "trg_monthly_updates_updated" on "public"."monthly_updates";

drop trigger if exists "trg_podcasts_updated" on "public"."podcasts";

drop trigger if exists "trg_profiles_updated" on "public"."profiles";

drop trigger if exists "trg_ranking_scores_updated" on "public"."ranking_scores";

drop trigger if exists "trg_ranking_weights_updated" on "public"."ranking_weights";

drop policy "admins read all candidate adabiyotx items" on "public"."candidate_adabiyotx_items";

drop policy "candidate editors delete adabiyotx items" on "public"."candidate_adabiyotx_items";

drop policy "candidate editors insert adabiyotx items" on "public"."candidate_adabiyotx_items";

drop policy "candidate editors update adabiyotx items" on "public"."candidate_adabiyotx_items";

drop policy "visible candidate adabiyotx items are public" on "public"."candidate_adabiyotx_items";

drop policy "admins read all" on "public"."achievements";

drop policy "public candidate sections" on "public"."achievements";

drop policy "own ai chat messages" on "public"."ai_chat_messages";

drop policy "ai job viewers" on "public"."ai_jobs";

drop policy "admins read all" on "public"."application_files";

drop policy "admins read all" on "public"."application_notes";

drop policy "admins read all" on "public"."applications";

drop policy "admins read all" on "public"."article_revisions";

drop policy "admins read all" on "public"."articles";

drop policy "article writers" on "public"."articles";

drop policy "audit viewers" on "public"."audit_logs";

drop policy "admins read all" on "public"."books_read";

drop policy "public candidate sections" on "public"."books_read";

drop policy "intake admins read" on "public"."candidate_intake_ai_runs";

drop policy "intake admins read" on "public"."candidate_intake_answer_revisions";

drop policy "intake writers" on "public"."candidate_intake_answer_revisions";

drop policy "intake admins read" on "public"."candidate_intake_answer_tables";

drop policy "intake writers" on "public"."candidate_intake_answer_tables";

drop policy "intake admins read" on "public"."candidate_intake_answers";

drop policy "intake writers" on "public"."candidate_intake_answers";

drop policy "intake admins read" on "public"."candidate_intake_attachments";

drop policy "intake writers" on "public"."candidate_intake_attachments";

drop policy "intake admins read" on "public"."candidate_intake_links";

drop policy "intake link managers" on "public"."candidate_intake_links";

drop policy "intake admins read" on "public"."candidate_intake_photo_edits";

drop policy "intake writers" on "public"."candidate_intake_photo_edits";

drop policy "intake admins read" on "public"."candidate_intake_questions";

drop policy "intake question managers" on "public"."candidate_intake_questions";

drop policy "intake admins read" on "public"."candidate_intake_review_comments";

drop policy "intake writers" on "public"."candidate_intake_review_comments";

drop policy "intake admins read" on "public"."candidate_intake_templates";

drop policy "intake template managers" on "public"."candidate_intake_templates";

drop policy "intake admins read" on "public"."candidate_intakes";

drop policy "intake writers" on "public"."candidate_intakes";

drop policy "admins read all" on "public"."candidate_media";

drop policy "admins read all" on "public"."candidates";

drop policy "candidate writers" on "public"."candidates";

drop policy "taxonomy managers write categories" on "public"."categories";

drop policy "admins read all" on "public"."education";

drop policy "public candidate sections" on "public"."education";

drop policy "admins read all" on "public"."events";

drop policy "public candidate sections" on "public"."events";

drop policy "admins read all" on "public"."journal_articles";

drop policy "journal articles of published journals" on "public"."journal_articles";

drop policy "admins read all" on "public"."journals";

drop policy "content managers write journals" on "public"."journals";

drop policy "update item viewers" on "public"."monthly_update_items";

drop policy "update media viewers" on "public"."monthly_update_media";

drop policy "token viewers" on "public"."monthly_update_tokens";

drop policy "update viewers" on "public"."monthly_updates";

drop policy "mark own notifications read" on "public"."notifications";

drop policy "own notifications" on "public"."notifications";

drop policy "admins read all" on "public"."podcast_guests";

drop policy "admins read all" on "public"."podcasts";

drop policy "content managers write podcasts" on "public"."podcasts";

drop policy "admins read all" on "public"."profile_views";

drop policy "admins read profiles" on "public"."profiles";

drop policy "admins read all" on "public"."quotes";

drop policy "content managers write quotes" on "public"."quotes";

drop policy "admins read all" on "public"."ranking_adjustments";

drop policy "admins read all" on "public"."ranking_events";

drop policy "admins read all" on "public"."ranking_periods";

drop policy "admins read all" on "public"."ranking_scores";

drop policy "published rankings are public" on "public"."ranking_scores";

drop policy "admins read all" on "public"."ranking_weights";

drop policy "taxonomy managers write regions" on "public"."regions";

drop policy "admins read role_permissions" on "public"."role_permissions";

drop policy "admins read roles" on "public"."roles";

drop policy "admins read all" on "public"."social_links";

drop policy "public candidate sections" on "public"."social_links";

drop policy "admins read user_roles" on "public"."user_roles";

drop policy "admins read all" on "public"."work_experiences";

drop policy "public candidate sections" on "public"."work_experiences";

alter table "public"."candidate_adabiyotx_items" drop constraint "chk_candidate_adabiyotx_read_book";

alter table "public"."candidate_adabiyotx_items" drop constraint "uq_candidate_adabiyotx_relationship";

alter table "public"."candidate_intakes" drop constraint "candidate_intakes_selected_photo_kind_check";

alter table "public"."achievements" drop constraint "achievements_candidate_id_fkey";

alter table "public"."ai_chat_messages" drop constraint "ai_chat_messages_session_id_fkey";

alter table "public"."application_files" drop constraint "application_files_application_id_fkey";

alter table "public"."application_notes" drop constraint "application_notes_application_id_fkey";

alter table "public"."applications" drop constraint "applications_candidate_id_fkey";

alter table "public"."applications" drop constraint "applications_category_id_fkey";

alter table "public"."applications" drop constraint "applications_duplicate_of_fkey";

alter table "public"."applications" drop constraint "applications_region_id_fkey";

alter table "public"."article_revisions" drop constraint "article_revisions_article_id_fkey";

alter table "public"."articles" drop constraint "articles_candidate_id_fkey";

alter table "public"."articles" drop constraint "articles_source_intake_fk";

alter table "public"."books_read" drop constraint "books_read_candidate_id_fkey";

alter table "public"."candidate_adabiyotx_items" drop constraint "candidate_adabiyotx_items_candidate_id_fkey";

alter table "public"."candidate_intake_ai_runs" drop constraint "candidate_intake_ai_runs_ai_job_id_fkey";

alter table "public"."candidate_intake_ai_runs" drop constraint "candidate_intake_ai_runs_intake_id_fkey";

alter table "public"."candidate_intake_answer_revisions" drop constraint "candidate_intake_answer_revisions_answer_id_fkey";

alter table "public"."candidate_intake_answer_revisions" drop constraint "candidate_intake_answer_revisions_intake_id_fkey";

alter table "public"."candidate_intake_answer_tables" drop constraint "candidate_intake_answer_tables_answer_id_fkey";

alter table "public"."candidate_intake_answer_tables" drop constraint "candidate_intake_answer_tables_intake_id_fkey";

alter table "public"."candidate_intake_answers" drop constraint "candidate_intake_answers_intake_id_fkey";

alter table "public"."candidate_intake_answers" drop constraint "candidate_intake_answers_question_id_fkey";

alter table "public"."candidate_intake_attachments" drop constraint "candidate_intake_attachments_answer_id_fkey";

alter table "public"."candidate_intake_attachments" drop constraint "candidate_intake_attachments_intake_id_fkey";

alter table "public"."candidate_intake_links" drop constraint "candidate_intake_links_intake_id_fkey";

alter table "public"."candidate_intake_photo_edits" drop constraint "candidate_intake_photo_edits_ai_run_id_fkey";

alter table "public"."candidate_intake_photo_edits" drop constraint "candidate_intake_photo_edits_intake_id_fkey";

alter table "public"."candidate_intake_photo_edits" drop constraint "candidate_intake_photo_edits_source_attachment_id_fkey";

alter table "public"."candidate_intake_questions" drop constraint "candidate_intake_questions_template_id_fkey";

alter table "public"."candidate_intake_review_comments" drop constraint "candidate_intake_review_comments_answer_id_fkey";

alter table "public"."candidate_intake_review_comments" drop constraint "candidate_intake_review_comments_intake_id_fkey";

alter table "public"."candidate_intakes" drop constraint "candidate_intakes_article_id_fkey";

alter table "public"."candidate_intakes" drop constraint "candidate_intakes_candidate_id_fkey";

alter table "public"."candidate_intakes" drop constraint "candidate_intakes_template_id_fkey";

alter table "public"."candidate_media" drop constraint "candidate_media_candidate_id_fkey";

alter table "public"."candidates" drop constraint "candidates_category_id_fkey";

alter table "public"."candidates" drop constraint "candidates_region_id_fkey";

alter table "public"."candidates" drop constraint "candidates_source_intake_fk";

alter table "public"."education" drop constraint "education_candidate_id_fkey";

alter table "public"."events" drop constraint "events_candidate_id_fkey";

alter table "public"."journal_articles" drop constraint "journal_articles_article_id_fkey";

alter table "public"."journal_articles" drop constraint "journal_articles_candidate_id_fkey";

alter table "public"."journal_articles" drop constraint "journal_articles_journal_id_fkey";

alter table "public"."monthly_update_items" drop constraint "monthly_update_items_update_id_fkey";

alter table "public"."monthly_update_media" drop constraint "monthly_update_media_update_id_fkey";

alter table "public"."monthly_update_tokens" drop constraint "monthly_update_tokens_candidate_id_fkey";

alter table "public"."monthly_updates" drop constraint "monthly_updates_candidate_id_fkey";

alter table "public"."monthly_updates" drop constraint "monthly_updates_token_id_fkey";

alter table "public"."podcast_guests" drop constraint "podcast_guests_candidate_id_fkey";

alter table "public"."podcast_guests" drop constraint "podcast_guests_podcast_id_fkey";

alter table "public"."podcasts" drop constraint "podcasts_candidate_id_fkey";

alter table "public"."profile_views" drop constraint "profile_views_candidate_id_fkey";

alter table "public"."quotes" drop constraint "quotes_candidate_id_fkey";

alter table "public"."ranking_adjustments" drop constraint "ranking_adjustments_candidate_id_fkey";

alter table "public"."ranking_adjustments" drop constraint "ranking_adjustments_period_id_fkey";

alter table "public"."ranking_events" drop constraint "ranking_events_candidate_id_fkey";

alter table "public"."ranking_scores" drop constraint "ranking_scores_candidate_id_fkey";

alter table "public"."ranking_scores" drop constraint "ranking_scores_period_id_fkey";

alter table "public"."ranking_weights" drop constraint "ranking_weights_period_id_fkey";

alter table "public"."role_permissions" drop constraint "role_permissions_role_slug_fkey";

alter table "public"."social_links" drop constraint "social_links_candidate_id_fkey";

alter table "public"."user_roles" drop constraint "user_roles_role_id_fkey";

alter table "public"."work_experiences" drop constraint "work_experiences_candidate_id_fkey";

drop function if exists "public"."confirm_candidate_intake_photo"(p_intake uuid, p_kind text, p_edit uuid);

drop function if exists "public"."reorder_candidate_adabiyotx_items"(p_candidate_id uuid, p_items jsonb);

drop index if exists "public"."idx_candidate_adabiyotx_listing";

drop index if exists "public"."uq_candidate_adabiyotx_relationship";

drop index if exists "public"."uq_candidate_photo_processing_job";

drop index if exists "public"."uq_candidates_integration_key";


  create table "public"."candidate_intake_access_logs" (
    "id" bigint generated by default as identity not null,
    "intake_id" uuid,
    "link_id" uuid,
    "action" text not null,
    "success" boolean not null default true,
    "ip_hash" text,
    "user_agent_hash" text,
    "metadata" jsonb not null default '{}'::jsonb,
    "created_at" timestamp with time zone not null default now()
      );


alter table "public"."candidate_intake_access_logs" enable row level security;


  create table "public"."candidate_intake_ai_feedback" (
    "id" uuid not null default gen_random_uuid(),
    "intake_id" uuid not null,
    "answer_id" uuid,
    "question_no" integer,
    "feedback_text" text not null,
    "feedback_type" text not null default 'summary'::text,
    "is_visible_to_candidate" boolean not null default true,
    "is_resolved" boolean not null default false,
    "created_by_ai" boolean not null default true,
    "created_by" uuid,
    "created_at" timestamp with time zone not null default now(),
    "resolved_at" timestamp with time zone
      );


alter table "public"."candidate_intake_ai_feedback" enable row level security;


  create table "public"."photo_prompt_fragments" (
    "id" uuid not null default gen_random_uuid(),
    "fragment_type" text not null,
    "gender" text,
    "clothing_type" text,
    "color" text,
    "label" text not null,
    "prompt_text" text not null,
    "is_active" boolean not null default true,
    "sort_order" integer not null default 0,
    "updated_by" uuid,
    "created_at" timestamp with time zone not null default now(),
    "updated_at" timestamp with time zone not null default now()
      );


alter table "public"."photo_prompt_fragments" enable row level security;

alter table "public"."candidate_intake_photo_edits" add column "gender_snapshot" text;

alter table "public"."candidate_intakes" drop column "selected_photo_kind";

alter table "public"."candidate_intakes" add column "gender" text;

alter table "public"."candidate_intakes" add column "photo_confirmation_metadata" jsonb not null default '{}'::jsonb;

alter table "public"."candidate_intakes" add column "selected_original_attachment_id" uuid;

alter table "public"."candidate_intakes" add column "selected_photo_edit_id" uuid;

alter table "public"."candidate_intakes" add column "selected_photo_source" text;

alter table "public"."candidates" add column "consent_at" timestamp with time zone;

alter table "public"."candidates" add column "consent_processing" boolean not null default false;

alter table "public"."candidates" add column "telegram_username" text;

CREATE UNIQUE INDEX articles_source_intake_unique_idx ON public.articles USING btree (source_intake_id) WHERE ((source_intake_id IS NOT NULL) AND (deleted_at IS NULL));

CREATE UNIQUE INDEX candidate_adabiyotx_items_candidate_id_external_id_relation_key ON public.candidate_adabiyotx_items USING btree (candidate_id, external_id, relationship_type);

CREATE INDEX candidate_intake_access_logs_link_idx ON public.candidate_intake_access_logs USING btree (link_id, created_at DESC);

CREATE UNIQUE INDEX candidate_intake_access_logs_pkey ON public.candidate_intake_access_logs USING btree (id);

CREATE UNIQUE INDEX candidate_intake_ai_feedback_pkey ON public.candidate_intake_ai_feedback USING btree (id);

CREATE UNIQUE INDEX candidate_intake_one_active_photo_job_idx ON public.candidate_intake_photo_edits USING btree (intake_id) WHERE (status = ANY (ARRAY['queued'::text, 'processing'::text]));

CREATE INDEX candidate_intake_photo_edits_status_idx ON public.candidate_intake_photo_edits USING btree (intake_id, status, created_at DESC);

CREATE INDEX candidate_intakes_photo_confirmation_idx ON public.candidate_intakes USING btree (photo_confirmed_at) WHERE (photo_confirmed_at IS NOT NULL);

CREATE INDEX candidate_intakes_selected_ai_photo_idx ON public.candidate_intakes USING btree (selected_photo_edit_id) WHERE (selected_photo_edit_id IS NOT NULL);

CREATE INDEX candidate_intakes_selected_original_photo_idx ON public.candidate_intakes USING btree (selected_original_attachment_id) WHERE (selected_original_attachment_id IS NOT NULL);

CREATE UNIQUE INDEX candidates_integration_key_unique_idx ON public.candidates USING btree (integration_key);

CREATE UNIQUE INDEX candidates_source_intake_unique_idx ON public.candidates USING btree (source_intake_id) WHERE (source_intake_id IS NOT NULL);

CREATE INDEX idx_candidate_adabiyotx_items_candidate ON public.candidate_adabiyotx_items USING btree (candidate_id, relationship_type, is_visible, sort_order);

CREATE INDEX idx_candidate_intakes_photo_confirmed ON public.candidate_intakes USING btree (photo_confirmed_at) WHERE (photo_confirmed_at IS NOT NULL);

CREATE INDEX idx_candidate_intakes_selected_ai_photo ON public.candidate_intakes USING btree (selected_photo_edit_id) WHERE (selected_photo_edit_id IS NOT NULL);

CREATE INDEX idx_candidate_intakes_selected_original_photo ON public.candidate_intakes USING btree (selected_original_attachment_id) WHERE (selected_original_attachment_id IS NOT NULL);

CREATE INDEX idx_intake_ai_feedback_answer ON public.candidate_intake_ai_feedback USING btree (answer_id) WHERE (answer_id IS NOT NULL);

CREATE INDEX idx_intake_ai_feedback_intake ON public.candidate_intake_ai_feedback USING btree (intake_id, created_at DESC);

CREATE INDEX idx_intakes_gender ON public.candidate_intakes USING btree (gender);

CREATE INDEX idx_photo_prompt_fragments_type ON public.photo_prompt_fragments USING btree (fragment_type, is_active);

CREATE UNIQUE INDEX photo_prompt_fragments_pkey ON public.photo_prompt_fragments USING btree (id);

CREATE UNIQUE INDEX uq_photo_prompt_base_scene ON public.photo_prompt_fragments USING btree (gender) WHERE ((fragment_type = 'base_scene'::text) AND (is_active = true));

CREATE UNIQUE INDEX uq_photo_prompt_clothing ON public.photo_prompt_fragments USING btree (gender, clothing_type) WHERE ((fragment_type = 'clothing'::text) AND (is_active = true));

CREATE UNIQUE INDEX uq_photo_prompt_color ON public.photo_prompt_fragments USING btree (color) WHERE ((fragment_type = 'color'::text) AND (is_active = true));

alter table "public"."candidate_intake_access_logs" add constraint "candidate_intake_access_logs_pkey" PRIMARY KEY using index "candidate_intake_access_logs_pkey";

alter table "public"."candidate_intake_ai_feedback" add constraint "candidate_intake_ai_feedback_pkey" PRIMARY KEY using index "candidate_intake_ai_feedback_pkey";

alter table "public"."photo_prompt_fragments" add constraint "photo_prompt_fragments_pkey" PRIMARY KEY using index "photo_prompt_fragments_pkey";

alter table "public"."candidate_adabiyotx_items" add constraint "candidate_adabiyotx_items_candidate_id_external_id_relation_key" UNIQUE using index "candidate_adabiyotx_items_candidate_id_external_id_relation_key";

alter table "public"."candidate_intake_access_logs" add constraint "candidate_intake_access_logs_action_check" CHECK ((action = ANY (ARRAY['open'::text, 'load'::text, 'autosave'::text, 'upload'::text, 'submit'::text, 'invalid_token'::text, 'rate_limited'::text]))) not valid;

alter table "public"."candidate_intake_access_logs" validate constraint "candidate_intake_access_logs_action_check";

alter table "public"."candidate_intake_ai_feedback" add constraint "candidate_intake_ai_feedback_answer_id_fkey" FOREIGN KEY (answer_id) REFERENCES public.candidate_intake_answers(id) ON DELETE SET NULL not valid;

alter table "public"."candidate_intake_ai_feedback" validate constraint "candidate_intake_ai_feedback_answer_id_fkey";

alter table "public"."candidate_intake_ai_feedback" add constraint "candidate_intake_ai_feedback_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL not valid;

alter table "public"."candidate_intake_ai_feedback" validate constraint "candidate_intake_ai_feedback_created_by_fkey";

alter table "public"."candidate_intake_ai_feedback" add constraint "candidate_intake_ai_feedback_feedback_type_check" CHECK ((feedback_type = ANY (ARRAY['summary'::text, 'clarification'::text, 'fact_flag'::text, 'general'::text]))) not valid;

alter table "public"."candidate_intake_ai_feedback" validate constraint "candidate_intake_ai_feedback_feedback_type_check";

alter table "public"."candidate_intake_ai_feedback" add constraint "candidate_intake_ai_feedback_intake_id_fkey" FOREIGN KEY (intake_id) REFERENCES public.candidate_intakes(id) ON DELETE CASCADE not valid;

alter table "public"."candidate_intake_ai_feedback" validate constraint "candidate_intake_ai_feedback_intake_id_fkey";

alter table "public"."candidate_intake_photo_edits" add constraint "candidate_intake_photo_edits_clothing_type_check" CHECK ((clothing_type = ANY (ARRAY['suit'::text, 'shirt_dress'::text, 'own_clothes'::text]))) not valid;

alter table "public"."candidate_intake_photo_edits" validate constraint "candidate_intake_photo_edits_clothing_type_check";

alter table "public"."candidate_intake_photo_edits" add constraint "candidate_intake_photo_edits_color_check" CHECK ((color = ANY (ARRAY['black'::text, 'white'::text, 'navy'::text]))) not valid;

alter table "public"."candidate_intake_photo_edits" validate constraint "candidate_intake_photo_edits_color_check";

alter table "public"."candidate_intake_photo_edits" add constraint "candidate_intake_photo_edits_gender_snapshot_check" CHECK ((gender_snapshot = ANY (ARRAY['male'::text, 'female'::text]))) not valid;

alter table "public"."candidate_intake_photo_edits" validate constraint "candidate_intake_photo_edits_gender_snapshot_check";

alter table "public"."candidate_intakes" add constraint "candidate_intakes_gender_check" CHECK ((gender = ANY (ARRAY['male'::text, 'female'::text]))) not valid;

alter table "public"."candidate_intakes" validate constraint "candidate_intakes_gender_check";

alter table "public"."candidate_intakes" add constraint "candidate_intakes_photo_selection_consistency" CHECK ((((selected_photo_source IS NULL) AND (selected_original_attachment_id IS NULL) AND (selected_photo_edit_id IS NULL) AND (photo_confirmed_at IS NULL)) OR ((selected_photo_source = 'original'::text) AND (selected_original_attachment_id IS NOT NULL) AND (selected_photo_edit_id IS NULL) AND (photo_confirmed_at IS NOT NULL)) OR ((selected_photo_source = 'ai'::text) AND (selected_original_attachment_id IS NULL) AND (selected_photo_edit_id IS NOT NULL) AND (photo_confirmed_at IS NOT NULL)))) not valid;

alter table "public"."candidate_intakes" validate constraint "candidate_intakes_photo_selection_consistency";

alter table "public"."candidate_intakes" add constraint "candidate_intakes_selected_original_attachment_id_fkey" FOREIGN KEY (selected_original_attachment_id) REFERENCES public.candidate_intake_attachments(id) ON DELETE SET NULL not valid;

alter table "public"."candidate_intakes" validate constraint "candidate_intakes_selected_original_attachment_id_fkey";

alter table "public"."candidate_intakes" add constraint "candidate_intakes_selected_photo_edit_id_fkey" FOREIGN KEY (selected_photo_edit_id) REFERENCES public.candidate_intake_photo_edits(id) ON DELETE SET NULL not valid;

alter table "public"."candidate_intakes" validate constraint "candidate_intakes_selected_photo_edit_id_fkey";

alter table "public"."candidate_intakes" add constraint "candidate_intakes_selected_photo_source_check" CHECK (((selected_photo_source IS NULL) OR (selected_photo_source = ANY (ARRAY['original'::text, 'ai'::text])))) not valid;

alter table "public"."candidate_intakes" validate constraint "candidate_intakes_selected_photo_source_check";

alter table "public"."photo_prompt_fragments" add constraint "photo_prompt_fragments_clothing_type_check" CHECK ((clothing_type = ANY (ARRAY['suit'::text, 'shirt_dress'::text, 'own_clothes'::text]))) not valid;

alter table "public"."photo_prompt_fragments" validate constraint "photo_prompt_fragments_clothing_type_check";

alter table "public"."photo_prompt_fragments" add constraint "photo_prompt_fragments_color_check" CHECK ((color = ANY (ARRAY['black'::text, 'white'::text, 'navy'::text]))) not valid;

alter table "public"."photo_prompt_fragments" validate constraint "photo_prompt_fragments_color_check";

alter table "public"."photo_prompt_fragments" add constraint "photo_prompt_fragments_fragment_type_check" CHECK ((fragment_type = ANY (ARRAY['base_scene'::text, 'clothing'::text, 'color'::text]))) not valid;

alter table "public"."photo_prompt_fragments" validate constraint "photo_prompt_fragments_fragment_type_check";

alter table "public"."photo_prompt_fragments" add constraint "photo_prompt_fragments_gender_check" CHECK ((gender = ANY (ARRAY['male'::text, 'female'::text]))) not valid;

alter table "public"."photo_prompt_fragments" validate constraint "photo_prompt_fragments_gender_check";

alter table "public"."photo_prompt_fragments" add constraint "photo_prompt_fragments_updated_by_fkey" FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL not valid;

alter table "public"."photo_prompt_fragments" validate constraint "photo_prompt_fragments_updated_by_fkey";

alter table "public"."achievements" add constraint "achievements_candidate_id_fkey" FOREIGN KEY (candidate_id) REFERENCES public.candidates(id) ON DELETE CASCADE not valid;

alter table "public"."achievements" validate constraint "achievements_candidate_id_fkey";

alter table "public"."ai_chat_messages" add constraint "ai_chat_messages_session_id_fkey" FOREIGN KEY (session_id) REFERENCES public.ai_chat_sessions(id) ON DELETE CASCADE not valid;

alter table "public"."ai_chat_messages" validate constraint "ai_chat_messages_session_id_fkey";

alter table "public"."application_files" add constraint "application_files_application_id_fkey" FOREIGN KEY (application_id) REFERENCES public.applications(id) ON DELETE CASCADE not valid;

alter table "public"."application_files" validate constraint "application_files_application_id_fkey";

alter table "public"."application_notes" add constraint "application_notes_application_id_fkey" FOREIGN KEY (application_id) REFERENCES public.applications(id) ON DELETE CASCADE not valid;

alter table "public"."application_notes" validate constraint "application_notes_application_id_fkey";

alter table "public"."applications" add constraint "applications_candidate_id_fkey" FOREIGN KEY (candidate_id) REFERENCES public.candidates(id) ON DELETE SET NULL not valid;

alter table "public"."applications" validate constraint "applications_candidate_id_fkey";

alter table "public"."applications" add constraint "applications_category_id_fkey" FOREIGN KEY (category_id) REFERENCES public.categories(id) ON DELETE SET NULL not valid;

alter table "public"."applications" validate constraint "applications_category_id_fkey";

alter table "public"."applications" add constraint "applications_duplicate_of_fkey" FOREIGN KEY (duplicate_of) REFERENCES public.applications(id) ON DELETE SET NULL not valid;

alter table "public"."applications" validate constraint "applications_duplicate_of_fkey";

alter table "public"."applications" add constraint "applications_region_id_fkey" FOREIGN KEY (region_id) REFERENCES public.regions(id) ON DELETE SET NULL not valid;

alter table "public"."applications" validate constraint "applications_region_id_fkey";

alter table "public"."article_revisions" add constraint "article_revisions_article_id_fkey" FOREIGN KEY (article_id) REFERENCES public.articles(id) ON DELETE CASCADE not valid;

alter table "public"."article_revisions" validate constraint "article_revisions_article_id_fkey";

alter table "public"."articles" add constraint "articles_candidate_id_fkey" FOREIGN KEY (candidate_id) REFERENCES public.candidates(id) ON DELETE SET NULL not valid;

alter table "public"."articles" validate constraint "articles_candidate_id_fkey";

alter table "public"."articles" add constraint "articles_source_intake_fk" FOREIGN KEY (source_intake_id) REFERENCES public.candidate_intakes(id) ON DELETE SET NULL not valid;

alter table "public"."articles" validate constraint "articles_source_intake_fk";

alter table "public"."books_read" add constraint "books_read_candidate_id_fkey" FOREIGN KEY (candidate_id) REFERENCES public.candidates(id) ON DELETE CASCADE not valid;

alter table "public"."books_read" validate constraint "books_read_candidate_id_fkey";

alter table "public"."candidate_adabiyotx_items" add constraint "candidate_adabiyotx_items_candidate_id_fkey" FOREIGN KEY (candidate_id) REFERENCES public.candidates(id) ON DELETE CASCADE not valid;

alter table "public"."candidate_adabiyotx_items" validate constraint "candidate_adabiyotx_items_candidate_id_fkey";

alter table "public"."candidate_intake_ai_runs" add constraint "candidate_intake_ai_runs_ai_job_id_fkey" FOREIGN KEY (ai_job_id) REFERENCES public.ai_jobs(id) ON DELETE SET NULL not valid;

alter table "public"."candidate_intake_ai_runs" validate constraint "candidate_intake_ai_runs_ai_job_id_fkey";

alter table "public"."candidate_intake_ai_runs" add constraint "candidate_intake_ai_runs_intake_id_fkey" FOREIGN KEY (intake_id) REFERENCES public.candidate_intakes(id) ON DELETE CASCADE not valid;

alter table "public"."candidate_intake_ai_runs" validate constraint "candidate_intake_ai_runs_intake_id_fkey";

alter table "public"."candidate_intake_answer_revisions" add constraint "candidate_intake_answer_revisions_answer_id_fkey" FOREIGN KEY (answer_id) REFERENCES public.candidate_intake_answers(id) ON DELETE SET NULL not valid;

alter table "public"."candidate_intake_answer_revisions" validate constraint "candidate_intake_answer_revisions_answer_id_fkey";

alter table "public"."candidate_intake_answer_revisions" add constraint "candidate_intake_answer_revisions_intake_id_fkey" FOREIGN KEY (intake_id) REFERENCES public.candidate_intakes(id) ON DELETE CASCADE not valid;

alter table "public"."candidate_intake_answer_revisions" validate constraint "candidate_intake_answer_revisions_intake_id_fkey";

alter table "public"."candidate_intake_answer_tables" add constraint "candidate_intake_answer_tables_answer_id_fkey" FOREIGN KEY (answer_id) REFERENCES public.candidate_intake_answers(id) ON DELETE CASCADE not valid;

alter table "public"."candidate_intake_answer_tables" validate constraint "candidate_intake_answer_tables_answer_id_fkey";

alter table "public"."candidate_intake_answer_tables" add constraint "candidate_intake_answer_tables_intake_id_fkey" FOREIGN KEY (intake_id) REFERENCES public.candidate_intakes(id) ON DELETE CASCADE not valid;

alter table "public"."candidate_intake_answer_tables" validate constraint "candidate_intake_answer_tables_intake_id_fkey";

alter table "public"."candidate_intake_answers" add constraint "candidate_intake_answers_intake_id_fkey" FOREIGN KEY (intake_id) REFERENCES public.candidate_intakes(id) ON DELETE CASCADE not valid;

alter table "public"."candidate_intake_answers" validate constraint "candidate_intake_answers_intake_id_fkey";

alter table "public"."candidate_intake_answers" add constraint "candidate_intake_answers_question_id_fkey" FOREIGN KEY (question_id) REFERENCES public.candidate_intake_questions(id) ON DELETE CASCADE not valid;

alter table "public"."candidate_intake_answers" validate constraint "candidate_intake_answers_question_id_fkey";

alter table "public"."candidate_intake_attachments" add constraint "candidate_intake_attachments_answer_id_fkey" FOREIGN KEY (answer_id) REFERENCES public.candidate_intake_answers(id) ON DELETE SET NULL not valid;

alter table "public"."candidate_intake_attachments" validate constraint "candidate_intake_attachments_answer_id_fkey";

alter table "public"."candidate_intake_attachments" add constraint "candidate_intake_attachments_intake_id_fkey" FOREIGN KEY (intake_id) REFERENCES public.candidate_intakes(id) ON DELETE CASCADE not valid;

alter table "public"."candidate_intake_attachments" validate constraint "candidate_intake_attachments_intake_id_fkey";

alter table "public"."candidate_intake_links" add constraint "candidate_intake_links_intake_id_fkey" FOREIGN KEY (intake_id) REFERENCES public.candidate_intakes(id) ON DELETE CASCADE not valid;

alter table "public"."candidate_intake_links" validate constraint "candidate_intake_links_intake_id_fkey";

alter table "public"."candidate_intake_photo_edits" add constraint "candidate_intake_photo_edits_ai_run_id_fkey" FOREIGN KEY (ai_run_id) REFERENCES public.candidate_intake_ai_runs(id) ON DELETE SET NULL not valid;

alter table "public"."candidate_intake_photo_edits" validate constraint "candidate_intake_photo_edits_ai_run_id_fkey";

alter table "public"."candidate_intake_photo_edits" add constraint "candidate_intake_photo_edits_intake_id_fkey" FOREIGN KEY (intake_id) REFERENCES public.candidate_intakes(id) ON DELETE CASCADE not valid;

alter table "public"."candidate_intake_photo_edits" validate constraint "candidate_intake_photo_edits_intake_id_fkey";

alter table "public"."candidate_intake_photo_edits" add constraint "candidate_intake_photo_edits_source_attachment_id_fkey" FOREIGN KEY (source_attachment_id) REFERENCES public.candidate_intake_attachments(id) ON DELETE SET NULL not valid;

alter table "public"."candidate_intake_photo_edits" validate constraint "candidate_intake_photo_edits_source_attachment_id_fkey";

alter table "public"."candidate_intake_questions" add constraint "candidate_intake_questions_template_id_fkey" FOREIGN KEY (template_id) REFERENCES public.candidate_intake_templates(id) ON DELETE CASCADE not valid;

alter table "public"."candidate_intake_questions" validate constraint "candidate_intake_questions_template_id_fkey";

alter table "public"."candidate_intake_review_comments" add constraint "candidate_intake_review_comments_answer_id_fkey" FOREIGN KEY (answer_id) REFERENCES public.candidate_intake_answers(id) ON DELETE SET NULL not valid;

alter table "public"."candidate_intake_review_comments" validate constraint "candidate_intake_review_comments_answer_id_fkey";

alter table "public"."candidate_intake_review_comments" add constraint "candidate_intake_review_comments_intake_id_fkey" FOREIGN KEY (intake_id) REFERENCES public.candidate_intakes(id) ON DELETE CASCADE not valid;

alter table "public"."candidate_intake_review_comments" validate constraint "candidate_intake_review_comments_intake_id_fkey";

alter table "public"."candidate_intakes" add constraint "candidate_intakes_article_id_fkey" FOREIGN KEY (article_id) REFERENCES public.articles(id) ON DELETE SET NULL not valid;

alter table "public"."candidate_intakes" validate constraint "candidate_intakes_article_id_fkey";

alter table "public"."candidate_intakes" add constraint "candidate_intakes_candidate_id_fkey" FOREIGN KEY (candidate_id) REFERENCES public.candidates(id) ON DELETE SET NULL not valid;

alter table "public"."candidate_intakes" validate constraint "candidate_intakes_candidate_id_fkey";

alter table "public"."candidate_intakes" add constraint "candidate_intakes_template_id_fkey" FOREIGN KEY (template_id) REFERENCES public.candidate_intake_templates(id) ON DELETE SET NULL not valid;

alter table "public"."candidate_intakes" validate constraint "candidate_intakes_template_id_fkey";

alter table "public"."candidate_media" add constraint "candidate_media_candidate_id_fkey" FOREIGN KEY (candidate_id) REFERENCES public.candidates(id) ON DELETE SET NULL not valid;

alter table "public"."candidate_media" validate constraint "candidate_media_candidate_id_fkey";

alter table "public"."candidates" add constraint "candidates_category_id_fkey" FOREIGN KEY (category_id) REFERENCES public.categories(id) ON DELETE SET NULL not valid;

alter table "public"."candidates" validate constraint "candidates_category_id_fkey";

alter table "public"."candidates" add constraint "candidates_region_id_fkey" FOREIGN KEY (region_id) REFERENCES public.regions(id) ON DELETE SET NULL not valid;

alter table "public"."candidates" validate constraint "candidates_region_id_fkey";

alter table "public"."candidates" add constraint "candidates_source_intake_fk" FOREIGN KEY (source_intake_id) REFERENCES public.candidate_intakes(id) ON DELETE SET NULL not valid;

alter table "public"."candidates" validate constraint "candidates_source_intake_fk";

alter table "public"."education" add constraint "education_candidate_id_fkey" FOREIGN KEY (candidate_id) REFERENCES public.candidates(id) ON DELETE CASCADE not valid;

alter table "public"."education" validate constraint "education_candidate_id_fkey";

alter table "public"."events" add constraint "events_candidate_id_fkey" FOREIGN KEY (candidate_id) REFERENCES public.candidates(id) ON DELETE CASCADE not valid;

alter table "public"."events" validate constraint "events_candidate_id_fkey";

alter table "public"."journal_articles" add constraint "journal_articles_article_id_fkey" FOREIGN KEY (article_id) REFERENCES public.articles(id) ON DELETE SET NULL not valid;

alter table "public"."journal_articles" validate constraint "journal_articles_article_id_fkey";

alter table "public"."journal_articles" add constraint "journal_articles_candidate_id_fkey" FOREIGN KEY (candidate_id) REFERENCES public.candidates(id) ON DELETE SET NULL not valid;

alter table "public"."journal_articles" validate constraint "journal_articles_candidate_id_fkey";

alter table "public"."journal_articles" add constraint "journal_articles_journal_id_fkey" FOREIGN KEY (journal_id) REFERENCES public.journals(id) ON DELETE CASCADE not valid;

alter table "public"."journal_articles" validate constraint "journal_articles_journal_id_fkey";

alter table "public"."monthly_update_items" add constraint "monthly_update_items_update_id_fkey" FOREIGN KEY (update_id) REFERENCES public.monthly_updates(id) ON DELETE CASCADE not valid;

alter table "public"."monthly_update_items" validate constraint "monthly_update_items_update_id_fkey";

alter table "public"."monthly_update_media" add constraint "monthly_update_media_update_id_fkey" FOREIGN KEY (update_id) REFERENCES public.monthly_updates(id) ON DELETE CASCADE not valid;

alter table "public"."monthly_update_media" validate constraint "monthly_update_media_update_id_fkey";

alter table "public"."monthly_update_tokens" add constraint "monthly_update_tokens_candidate_id_fkey" FOREIGN KEY (candidate_id) REFERENCES public.candidates(id) ON DELETE CASCADE not valid;

alter table "public"."monthly_update_tokens" validate constraint "monthly_update_tokens_candidate_id_fkey";

alter table "public"."monthly_updates" add constraint "monthly_updates_candidate_id_fkey" FOREIGN KEY (candidate_id) REFERENCES public.candidates(id) ON DELETE CASCADE not valid;

alter table "public"."monthly_updates" validate constraint "monthly_updates_candidate_id_fkey";

alter table "public"."monthly_updates" add constraint "monthly_updates_token_id_fkey" FOREIGN KEY (token_id) REFERENCES public.monthly_update_tokens(id) ON DELETE SET NULL not valid;

alter table "public"."monthly_updates" validate constraint "monthly_updates_token_id_fkey";

alter table "public"."podcast_guests" add constraint "podcast_guests_candidate_id_fkey" FOREIGN KEY (candidate_id) REFERENCES public.candidates(id) ON DELETE SET NULL not valid;

alter table "public"."podcast_guests" validate constraint "podcast_guests_candidate_id_fkey";

alter table "public"."podcast_guests" add constraint "podcast_guests_podcast_id_fkey" FOREIGN KEY (podcast_id) REFERENCES public.podcasts(id) ON DELETE CASCADE not valid;

alter table "public"."podcast_guests" validate constraint "podcast_guests_podcast_id_fkey";

alter table "public"."podcasts" add constraint "podcasts_candidate_id_fkey" FOREIGN KEY (candidate_id) REFERENCES public.candidates(id) ON DELETE SET NULL not valid;

alter table "public"."podcasts" validate constraint "podcasts_candidate_id_fkey";

alter table "public"."profile_views" add constraint "profile_views_candidate_id_fkey" FOREIGN KEY (candidate_id) REFERENCES public.candidates(id) ON DELETE CASCADE not valid;

alter table "public"."profile_views" validate constraint "profile_views_candidate_id_fkey";

alter table "public"."quotes" add constraint "quotes_candidate_id_fkey" FOREIGN KEY (candidate_id) REFERENCES public.candidates(id) ON DELETE SET NULL not valid;

alter table "public"."quotes" validate constraint "quotes_candidate_id_fkey";

alter table "public"."ranking_adjustments" add constraint "ranking_adjustments_candidate_id_fkey" FOREIGN KEY (candidate_id) REFERENCES public.candidates(id) ON DELETE CASCADE not valid;

alter table "public"."ranking_adjustments" validate constraint "ranking_adjustments_candidate_id_fkey";

alter table "public"."ranking_adjustments" add constraint "ranking_adjustments_period_id_fkey" FOREIGN KEY (period_id) REFERENCES public.ranking_periods(id) ON DELETE CASCADE not valid;

alter table "public"."ranking_adjustments" validate constraint "ranking_adjustments_period_id_fkey";

alter table "public"."ranking_events" add constraint "ranking_events_candidate_id_fkey" FOREIGN KEY (candidate_id) REFERENCES public.candidates(id) ON DELETE CASCADE not valid;

alter table "public"."ranking_events" validate constraint "ranking_events_candidate_id_fkey";

alter table "public"."ranking_scores" add constraint "ranking_scores_candidate_id_fkey" FOREIGN KEY (candidate_id) REFERENCES public.candidates(id) ON DELETE CASCADE not valid;

alter table "public"."ranking_scores" validate constraint "ranking_scores_candidate_id_fkey";

alter table "public"."ranking_scores" add constraint "ranking_scores_period_id_fkey" FOREIGN KEY (period_id) REFERENCES public.ranking_periods(id) ON DELETE CASCADE not valid;

alter table "public"."ranking_scores" validate constraint "ranking_scores_period_id_fkey";

alter table "public"."ranking_weights" add constraint "ranking_weights_period_id_fkey" FOREIGN KEY (period_id) REFERENCES public.ranking_periods(id) ON DELETE CASCADE not valid;

alter table "public"."ranking_weights" validate constraint "ranking_weights_period_id_fkey";

alter table "public"."role_permissions" add constraint "role_permissions_role_slug_fkey" FOREIGN KEY (role_slug) REFERENCES public.roles(slug) ON DELETE CASCADE not valid;

alter table "public"."role_permissions" validate constraint "role_permissions_role_slug_fkey";

alter table "public"."social_links" add constraint "social_links_candidate_id_fkey" FOREIGN KEY (candidate_id) REFERENCES public.candidates(id) ON DELETE CASCADE not valid;

alter table "public"."social_links" validate constraint "social_links_candidate_id_fkey";

alter table "public"."user_roles" add constraint "user_roles_role_id_fkey" FOREIGN KEY (role_id) REFERENCES public.roles(id) ON DELETE CASCADE not valid;

alter table "public"."user_roles" validate constraint "user_roles_role_id_fkey";

alter table "public"."work_experiences" add constraint "work_experiences_candidate_id_fkey" FOREIGN KEY (candidate_id) REFERENCES public.candidates(id) ON DELETE CASCADE not valid;

alter table "public"."work_experiences" validate constraint "work_experiences_candidate_id_fkey";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.candidate_intake_photo_is_confirmed(p_intake_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  select
    exists (
      select 1
      from public.candidate_intakes intake
      join public.candidate_intake_attachments attachment
        on attachment.id = intake.selected_original_attachment_id
      where intake.id = p_intake_id
        and intake.selected_photo_source = 'original'
        and intake.photo_confirmed_at is not null
        and attachment.intake_id = intake.id
    )
    or
    exists (
      select 1
      from public.candidate_intakes intake
      join public.candidate_intake_photo_edits photo_edit
        on photo_edit.id = intake.selected_photo_edit_id
      where intake.id = p_intake_id
        and intake.selected_photo_source = 'ai'
        and intake.photo_confirmed_at is not null
        and photo_edit.intake_id = intake.id
        and photo_edit.status = 'completed'
        and photo_edit.is_selected = true
        and nullif(btrim(photo_edit.result_bucket), '') is not null
        and nullif(btrim(photo_edit.result_path), '') is not null
    );
$function$
;

CREATE OR REPLACE FUNCTION public.candidate_intake_set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
begin
  new.updated_at := now();
  if tg_table_name = 'candidate_intakes' then
    new.lock_version := coalesce(old.lock_version, 0) + 1;
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.candidate_intake_slugify(p_value text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select trim(both '-' from regexp_replace(lower(coalesce(p_value,'')), '[^a-z0-9]+', '-', 'g'));
$function$
;

CREATE OR REPLACE FUNCTION public.candidate_intake_validate_submission(p_intake_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_missing jsonb := '[]'::jsonb;
  v_missing_count integer := 0;
  v_contact_ok boolean := false;
  v_photo_ok boolean := false;
  v_phone_ok boolean := false;
  v_telegram_ok boolean := false;
  v_consent_ok boolean := false;
  v_intake public.candidate_intakes%rowtype;
begin
  -- Intake mavjudligini tekshirish
  select *
  into v_intake
  from public.candidate_intakes
  where id = p_intake_id;

  if not found then
    return jsonb_build_object(
      'ready', false,
      'error', 'intake_not_found',
      'missing_count', 0,
      'missing_questions', '[]'::jsonb,
      'contact_ok', false,
      'photo_ok', false,
      'phone_ok', false,
      'telegram_ok', false,
      'consent_ok', false
    );
  end if;

  -- Majburiy, ammo javobsiz qolgan savollarni topish
  select
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'question_id', q.id,
          'question_no', q.question_no,
          'label',
            coalesce(
              to_jsonb(q) ->> 'label',
              to_jsonb(q) ->> 'question_text',
              to_jsonb(q) ->> 'question',
              to_jsonb(q) ->> 'title',
              'Savol ' || q.question_no::text
            )
        )
        order by q.question_no
      ),
      '[]'::jsonb
    ),
    count(*)::integer
  into
    v_missing,
    v_missing_count
  from public.candidate_intake_questions q
  left join public.candidate_intake_answers a
    on a.intake_id = p_intake_id
   and a.question_id = q.id
  where q.template_id = v_intake.template_id
    and q.is_active = true
    and q.is_required = true
    and (
      a.id is null

      -- Noma’lum yoki noto‘g‘ri javob holati
      or a.answer_state not in ('answered', 'no_answer')

      -- Faqat answered holatida matn majburiy
      or (
        a.answer_state = 'answered'
        and nullif(btrim(coalesce(a.plain_text, '')), '') is null
      )
    );

  -- Rasm serverda tasdiqlanganligini tekshirish
  select public.candidate_intake_photo_is_confirmed(p_intake_id)
  into v_photo_ok;

  v_photo_ok := coalesce(v_photo_ok, false);

  -- Telefon validatsiyasi
  v_phone_ok :=
    v_intake.phone is not null
    and v_intake.phone ~ '^\+[1-9][0-9]{7,14}$';

  -- Telegram username validatsiyasi
  v_telegram_ok :=
    v_intake.telegram_username is not null
    and v_intake.telegram_username ~ '^@?[A-Za-z0-9_]{5,32}$';

  -- Rozilik
  v_consent_ok :=
    v_intake.consent_processing = true
    and v_intake.consent_at is not null;

  v_contact_ok :=
    v_phone_ok
    and v_telegram_ok
    and v_consent_ok;

  return jsonb_build_object(
    'ready',
      (
        v_missing_count = 0
        and v_contact_ok
        and v_photo_ok
      ),
    'missing_count', v_missing_count,
    'missing_questions', v_missing,
    'contact_ok', v_contact_ok,
    'photo_ok', v_photo_ok,
    'photo_source', v_intake.selected_photo_source,
    'photo_confirmed_at', v_intake.photo_confirmed_at,
    'phone_ok', v_phone_ok,
    'telegram_ok', v_telegram_ok,
    'consent_ok', v_consent_ok
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.confirm_candidate_intake_photo(p_intake_id uuid, p_source text, p_original_attachment_id uuid DEFAULT NULL::uuid, p_photo_edit_id uuid DEFAULT NULL::uuid, p_actor uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'auth'
AS $function$
declare
  v_role text;
  v_actor uuid;
  v_result_bucket text;
  v_result_path text;
begin
  v_role := coalesce(auth.role(), '');
  v_actor := coalesce(auth.uid(), p_actor);

  -- Faqat server service role yoki admin
  if not (
    v_role = 'service_role'
    or public.is_admin()
  ) then
    raise exception using
      errcode = '42501',
      message = 'permission_denied';
  end if;

  if p_source not in ('original', 'ai') then
    raise exception using
      errcode = '22023',
      message = 'invalid_photo_source';
  end if;

  -- Intake mavjudligini tekshirish va row lock
  perform 1
  from public.candidate_intakes
  where id = p_intake_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'intake_not_found';
  end if;

  -- ==========================================================
  -- Original rasm tanlash
  -- ==========================================================

  if p_source = 'original' then
    if p_original_attachment_id is null then
      raise exception using
        errcode = '22023',
        message = 'original_attachment_required';
    end if;

    -- Attachment shu intake'ga tegishli bo'lishi kerak
    perform 1
    from public.candidate_intake_attachments attachment
    where attachment.id = p_original_attachment_id
      and attachment.intake_id = p_intake_id;

    if not found then
      raise exception using
        errcode = 'P0002',
        message = 'original_attachment_not_found';
    end if;

    -- Oldingi AI rasm tanlovini bekor qilish
    update public.candidate_intake_photo_edits
    set is_selected = false
    where intake_id = p_intake_id
      and is_selected = true;

    update public.candidate_intakes
    set
      selected_photo_source = 'original',
      selected_original_attachment_id = p_original_attachment_id,
      selected_photo_edit_id = null,
      photo_confirmed_at = now(),
      photo_confirmation_metadata = jsonb_build_object(
        'source', 'original',
        'attachment_id', p_original_attachment_id,
        'confirmed_at', now()
      ),
      updated_at = now()
    where id = p_intake_id;

    insert into public.audit_logs (
      actor_id,
      action,
      entity_type,
      entity_id,
      new_value,
      severity,
      metadata
    )
    values (
      v_actor,
      'candidate_intake.photo_confirmed',
      'candidate_intake',
      p_intake_id::text,
      jsonb_build_object(
        'source', 'original',
        'attachment_id', p_original_attachment_id
      ),
      'info',
      '{}'::jsonb
    );

    return jsonb_build_object(
      'ok', true,
      'intake_id', p_intake_id,
      'source', 'original',
      'original_attachment_id', p_original_attachment_id,
      'photo_edit_id', null,
      'confirmed_at', now()
    );
  end if;

  -- ==========================================================
  -- AI orqali tayyorlangan rasmni tanlash
  -- ==========================================================

  if p_photo_edit_id is null then
    raise exception using
      errcode = '22023',
      message = 'photo_edit_id_required';
  end if;

  select
    photo_edit.result_bucket,
    photo_edit.result_path
  into
    v_result_bucket,
    v_result_path
  from public.candidate_intake_photo_edits photo_edit
  where photo_edit.id = p_photo_edit_id
    and photo_edit.intake_id = p_intake_id
    and photo_edit.status = 'completed'
    and nullif(btrim(photo_edit.result_bucket), '') is not null
    and nullif(btrim(photo_edit.result_path), '') is not null;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'completed_ai_photo_not_found';
  end if;

  -- Shu intake uchun oldingi tanlovlarni o'chirish
  update public.candidate_intake_photo_edits
  set is_selected = false
  where intake_id = p_intake_id
    and is_selected = true;

  -- Tanlangan AI rasmni belgilash
  update public.candidate_intake_photo_edits
  set is_selected = true
  where id = p_photo_edit_id
    and intake_id = p_intake_id
    and status = 'completed';

  update public.candidate_intakes
  set
    selected_photo_source = 'ai',
    selected_original_attachment_id = null,
    selected_photo_edit_id = p_photo_edit_id,
    photo_confirmed_at = now(),
    photo_confirmation_metadata = jsonb_build_object(
      'source', 'ai',
      'photo_edit_id', p_photo_edit_id,
      'result_bucket', v_result_bucket,
      'result_path', v_result_path,
      'confirmed_at', now()
    ),
    updated_at = now()
  where id = p_intake_id;

  insert into public.audit_logs (
    actor_id,
    action,
    entity_type,
    entity_id,
    new_value,
    severity,
    metadata
  )
  values (
    v_actor,
    'candidate_intake.photo_confirmed',
    'candidate_intake',
    p_intake_id::text,
    jsonb_build_object(
      'source', 'ai',
      'photo_edit_id', p_photo_edit_id
    ),
    'info',
    '{}'::jsonb
  );

  return jsonb_build_object(
    'ok', true,
    'intake_id', p_intake_id,
    'source', 'ai',
    'original_attachment_id', null,
    'photo_edit_id', p_photo_edit_id,
    'result_bucket', v_result_bucket,
    'result_path', v_result_path,
    'confirmed_at', now()
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.grant_role_by_email(p_email text, p_role text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user uuid;
  v_role uuid;
begin
  select id into v_user from auth.users where lower(email) = lower(p_email);
  if v_user is null then
    return 'Foydalanuvchi topilmadi: ' || p_email;
  end if;
  select id into v_role from public.roles where slug = p_role;
  if v_role is null then
    return 'Rol topilmadi: ' || p_role;
  end if;
  insert into public.profiles (id, full_name)
  values (v_user, split_part(p_email, '@', 1))
  on conflict (id) do nothing;
  insert into public.user_roles (user_id, role_id)
  values (v_user, v_role)
  on conflict (user_id, role_id) do nothing;
  return 'OK: ' || p_email || ' → ' || p_role;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.refresh_candidate_intake_progress()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_intake_id uuid;
  v_template_id uuid;
  v_first_missing integer;
  v_max_question integer;
begin
  if tg_op = 'DELETE' then
    v_intake_id := old.intake_id;
  else
    v_intake_id := new.intake_id;
  end if;

  select template_id
    into v_template_id
  from public.candidate_intakes
  where id = v_intake_id;

  if v_template_id is null then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  select min(q.question_no), max(q.question_no)
    into v_first_missing, v_max_question
  from public.candidate_intake_questions q
  left join public.candidate_intake_answers a
    on a.intake_id = v_intake_id
   and a.question_id = q.id
  where q.template_id = v_template_id
    and q.is_active = true
    and q.is_required = true
    and (
      a.id is null
      or a.answer_state not in ('answered','no_answer')
      or nullif(btrim(a.plain_text), '') is null
    );

  select max(question_no)
    into v_max_question
  from public.candidate_intake_questions
  where template_id = v_template_id
    and is_active = true;

  if v_first_missing is null then
    update public.candidate_intakes
       set last_completed_question_no = coalesce(v_max_question, 0),
           current_question_no = coalesce(v_max_question, 0) + 1,
           last_autosaved_at = now()
     where id = v_intake_id;
  else
    update public.candidate_intakes
       set last_completed_question_no = greatest(v_first_missing - 1, 0),
           current_question_no = v_first_missing,
           last_autosaved_at = now()
     where id = v_intake_id;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.select_candidate_intake_photo_edit(p_photo_edit_id uuid, p_actor uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'auth'
AS $function$
declare
  v_intake_id uuid;
begin
  select intake_id
  into v_intake_id
  from public.candidate_intake_photo_edits
  where id = p_photo_edit_id
    and status = 'completed'
    and nullif(btrim(result_bucket), '') is not null
    and nullif(btrim(result_path), '') is not null;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'completed_photo_edit_not_found';
  end if;

  return public.confirm_candidate_intake_photo(
    v_intake_id,
    'ai',
    null,
    p_photo_edit_id,
    p_actor
  );
end;
$function$
;

grant delete on table "public"."achievements" to "anon";

grant insert on table "public"."achievements" to "anon";

grant select on table "public"."achievements" to "anon";

grant update on table "public"."achievements" to "anon";

grant delete on table "public"."achievements" to "authenticated";

grant insert on table "public"."achievements" to "authenticated";

grant select on table "public"."achievements" to "authenticated";

grant update on table "public"."achievements" to "authenticated";

grant delete on table "public"."achievements" to "service_role";

grant insert on table "public"."achievements" to "service_role";

grant select on table "public"."achievements" to "service_role";

grant update on table "public"."achievements" to "service_role";

grant delete on table "public"."ai_chat_messages" to "anon";

grant insert on table "public"."ai_chat_messages" to "anon";

grant select on table "public"."ai_chat_messages" to "anon";

grant update on table "public"."ai_chat_messages" to "anon";

grant delete on table "public"."ai_chat_messages" to "authenticated";

grant insert on table "public"."ai_chat_messages" to "authenticated";

grant select on table "public"."ai_chat_messages" to "authenticated";

grant update on table "public"."ai_chat_messages" to "authenticated";

grant delete on table "public"."ai_chat_messages" to "service_role";

grant insert on table "public"."ai_chat_messages" to "service_role";

grant select on table "public"."ai_chat_messages" to "service_role";

grant update on table "public"."ai_chat_messages" to "service_role";

grant delete on table "public"."ai_chat_sessions" to "anon";

grant insert on table "public"."ai_chat_sessions" to "anon";

grant select on table "public"."ai_chat_sessions" to "anon";

grant update on table "public"."ai_chat_sessions" to "anon";

grant delete on table "public"."ai_chat_sessions" to "authenticated";

grant insert on table "public"."ai_chat_sessions" to "authenticated";

grant select on table "public"."ai_chat_sessions" to "authenticated";

grant update on table "public"."ai_chat_sessions" to "authenticated";

grant delete on table "public"."ai_chat_sessions" to "service_role";

grant insert on table "public"."ai_chat_sessions" to "service_role";

grant select on table "public"."ai_chat_sessions" to "service_role";

grant update on table "public"."ai_chat_sessions" to "service_role";

grant delete on table "public"."ai_jobs" to "anon";

grant insert on table "public"."ai_jobs" to "anon";

grant select on table "public"."ai_jobs" to "anon";

grant update on table "public"."ai_jobs" to "anon";

grant delete on table "public"."ai_jobs" to "authenticated";

grant insert on table "public"."ai_jobs" to "authenticated";

grant select on table "public"."ai_jobs" to "authenticated";

grant update on table "public"."ai_jobs" to "authenticated";

grant delete on table "public"."ai_jobs" to "service_role";

grant insert on table "public"."ai_jobs" to "service_role";

grant select on table "public"."ai_jobs" to "service_role";

grant update on table "public"."ai_jobs" to "service_role";

grant delete on table "public"."application_files" to "anon";

grant insert on table "public"."application_files" to "anon";

grant select on table "public"."application_files" to "anon";

grant update on table "public"."application_files" to "anon";

grant delete on table "public"."application_files" to "authenticated";

grant insert on table "public"."application_files" to "authenticated";

grant select on table "public"."application_files" to "authenticated";

grant update on table "public"."application_files" to "authenticated";

grant delete on table "public"."application_files" to "service_role";

grant insert on table "public"."application_files" to "service_role";

grant select on table "public"."application_files" to "service_role";

grant update on table "public"."application_files" to "service_role";

grant delete on table "public"."application_notes" to "anon";

grant insert on table "public"."application_notes" to "anon";

grant select on table "public"."application_notes" to "anon";

grant update on table "public"."application_notes" to "anon";

grant delete on table "public"."application_notes" to "authenticated";

grant insert on table "public"."application_notes" to "authenticated";

grant select on table "public"."application_notes" to "authenticated";

grant update on table "public"."application_notes" to "authenticated";

grant delete on table "public"."application_notes" to "service_role";

grant insert on table "public"."application_notes" to "service_role";

grant select on table "public"."application_notes" to "service_role";

grant update on table "public"."application_notes" to "service_role";

grant delete on table "public"."applications" to "anon";

grant insert on table "public"."applications" to "anon";

grant select on table "public"."applications" to "anon";

grant update on table "public"."applications" to "anon";

grant delete on table "public"."applications" to "authenticated";

grant insert on table "public"."applications" to "authenticated";

grant select on table "public"."applications" to "authenticated";

grant update on table "public"."applications" to "authenticated";

grant delete on table "public"."applications" to "service_role";

grant insert on table "public"."applications" to "service_role";

grant select on table "public"."applications" to "service_role";

grant update on table "public"."applications" to "service_role";

grant delete on table "public"."article_revisions" to "anon";

grant insert on table "public"."article_revisions" to "anon";

grant select on table "public"."article_revisions" to "anon";

grant update on table "public"."article_revisions" to "anon";

grant delete on table "public"."article_revisions" to "authenticated";

grant insert on table "public"."article_revisions" to "authenticated";

grant select on table "public"."article_revisions" to "authenticated";

grant update on table "public"."article_revisions" to "authenticated";

grant delete on table "public"."article_revisions" to "service_role";

grant insert on table "public"."article_revisions" to "service_role";

grant select on table "public"."article_revisions" to "service_role";

grant update on table "public"."article_revisions" to "service_role";

grant delete on table "public"."articles" to "anon";

grant insert on table "public"."articles" to "anon";

grant select on table "public"."articles" to "anon";

grant update on table "public"."articles" to "anon";

grant delete on table "public"."articles" to "authenticated";

grant insert on table "public"."articles" to "authenticated";

grant select on table "public"."articles" to "authenticated";

grant update on table "public"."articles" to "authenticated";

grant delete on table "public"."articles" to "service_role";

grant insert on table "public"."articles" to "service_role";

grant select on table "public"."articles" to "service_role";

grant update on table "public"."articles" to "service_role";

grant delete on table "public"."audit_logs" to "anon";

grant insert on table "public"."audit_logs" to "anon";

grant select on table "public"."audit_logs" to "anon";

grant update on table "public"."audit_logs" to "anon";

grant delete on table "public"."audit_logs" to "authenticated";

grant insert on table "public"."audit_logs" to "authenticated";

grant select on table "public"."audit_logs" to "authenticated";

grant update on table "public"."audit_logs" to "authenticated";

grant delete on table "public"."audit_logs" to "service_role";

grant insert on table "public"."audit_logs" to "service_role";

grant select on table "public"."audit_logs" to "service_role";

grant update on table "public"."audit_logs" to "service_role";

grant delete on table "public"."books_read" to "anon";

grant insert on table "public"."books_read" to "anon";

grant select on table "public"."books_read" to "anon";

grant update on table "public"."books_read" to "anon";

grant delete on table "public"."books_read" to "authenticated";

grant insert on table "public"."books_read" to "authenticated";

grant select on table "public"."books_read" to "authenticated";

grant update on table "public"."books_read" to "authenticated";

grant delete on table "public"."books_read" to "service_role";

grant insert on table "public"."books_read" to "service_role";

grant select on table "public"."books_read" to "service_role";

grant update on table "public"."books_read" to "service_role";

grant delete on table "public"."candidate_adabiyotx_items" to "anon";

grant insert on table "public"."candidate_adabiyotx_items" to "anon";

grant select on table "public"."candidate_adabiyotx_items" to "anon";

grant update on table "public"."candidate_adabiyotx_items" to "anon";

grant delete on table "public"."candidate_adabiyotx_items" to "authenticated";

grant insert on table "public"."candidate_adabiyotx_items" to "authenticated";

grant select on table "public"."candidate_adabiyotx_items" to "authenticated";

grant update on table "public"."candidate_adabiyotx_items" to "authenticated";

grant delete on table "public"."candidate_adabiyotx_items" to "service_role";

grant insert on table "public"."candidate_adabiyotx_items" to "service_role";

grant select on table "public"."candidate_adabiyotx_items" to "service_role";

grant update on table "public"."candidate_adabiyotx_items" to "service_role";

grant delete on table "public"."candidate_intake_access_logs" to "authenticated";

grant insert on table "public"."candidate_intake_access_logs" to "authenticated";

grant references on table "public"."candidate_intake_access_logs" to "authenticated";

grant select on table "public"."candidate_intake_access_logs" to "authenticated";

grant trigger on table "public"."candidate_intake_access_logs" to "authenticated";

grant truncate on table "public"."candidate_intake_access_logs" to "authenticated";

grant update on table "public"."candidate_intake_access_logs" to "authenticated";

grant delete on table "public"."candidate_intake_access_logs" to "service_role";

grant insert on table "public"."candidate_intake_access_logs" to "service_role";

grant references on table "public"."candidate_intake_access_logs" to "service_role";

grant select on table "public"."candidate_intake_access_logs" to "service_role";

grant trigger on table "public"."candidate_intake_access_logs" to "service_role";

grant truncate on table "public"."candidate_intake_access_logs" to "service_role";

grant update on table "public"."candidate_intake_access_logs" to "service_role";

grant delete on table "public"."candidate_intake_ai_feedback" to "anon";

grant insert on table "public"."candidate_intake_ai_feedback" to "anon";

grant references on table "public"."candidate_intake_ai_feedback" to "anon";

grant select on table "public"."candidate_intake_ai_feedback" to "anon";

grant trigger on table "public"."candidate_intake_ai_feedback" to "anon";

grant truncate on table "public"."candidate_intake_ai_feedback" to "anon";

grant update on table "public"."candidate_intake_ai_feedback" to "anon";

grant delete on table "public"."candidate_intake_ai_feedback" to "authenticated";

grant insert on table "public"."candidate_intake_ai_feedback" to "authenticated";

grant references on table "public"."candidate_intake_ai_feedback" to "authenticated";

grant select on table "public"."candidate_intake_ai_feedback" to "authenticated";

grant trigger on table "public"."candidate_intake_ai_feedback" to "authenticated";

grant truncate on table "public"."candidate_intake_ai_feedback" to "authenticated";

grant update on table "public"."candidate_intake_ai_feedback" to "authenticated";

grant delete on table "public"."candidate_intake_ai_feedback" to "service_role";

grant insert on table "public"."candidate_intake_ai_feedback" to "service_role";

grant references on table "public"."candidate_intake_ai_feedback" to "service_role";

grant select on table "public"."candidate_intake_ai_feedback" to "service_role";

grant trigger on table "public"."candidate_intake_ai_feedback" to "service_role";

grant truncate on table "public"."candidate_intake_ai_feedback" to "service_role";

grant update on table "public"."candidate_intake_ai_feedback" to "service_role";

grant delete on table "public"."candidate_intake_ai_runs" to "anon";

grant insert on table "public"."candidate_intake_ai_runs" to "anon";

grant select on table "public"."candidate_intake_ai_runs" to "anon";

grant update on table "public"."candidate_intake_ai_runs" to "anon";

grant delete on table "public"."candidate_intake_ai_runs" to "authenticated";

grant insert on table "public"."candidate_intake_ai_runs" to "authenticated";

grant select on table "public"."candidate_intake_ai_runs" to "authenticated";

grant update on table "public"."candidate_intake_ai_runs" to "authenticated";

grant delete on table "public"."candidate_intake_ai_runs" to "service_role";

grant insert on table "public"."candidate_intake_ai_runs" to "service_role";

grant select on table "public"."candidate_intake_ai_runs" to "service_role";

grant update on table "public"."candidate_intake_ai_runs" to "service_role";

grant delete on table "public"."candidate_intake_answer_revisions" to "anon";

grant insert on table "public"."candidate_intake_answer_revisions" to "anon";

grant select on table "public"."candidate_intake_answer_revisions" to "anon";

grant update on table "public"."candidate_intake_answer_revisions" to "anon";

grant delete on table "public"."candidate_intake_answer_revisions" to "authenticated";

grant insert on table "public"."candidate_intake_answer_revisions" to "authenticated";

grant select on table "public"."candidate_intake_answer_revisions" to "authenticated";

grant update on table "public"."candidate_intake_answer_revisions" to "authenticated";

grant delete on table "public"."candidate_intake_answer_revisions" to "service_role";

grant insert on table "public"."candidate_intake_answer_revisions" to "service_role";

grant select on table "public"."candidate_intake_answer_revisions" to "service_role";

grant update on table "public"."candidate_intake_answer_revisions" to "service_role";

grant delete on table "public"."candidate_intake_answer_tables" to "anon";

grant insert on table "public"."candidate_intake_answer_tables" to "anon";

grant select on table "public"."candidate_intake_answer_tables" to "anon";

grant update on table "public"."candidate_intake_answer_tables" to "anon";

grant delete on table "public"."candidate_intake_answer_tables" to "authenticated";

grant insert on table "public"."candidate_intake_answer_tables" to "authenticated";

grant select on table "public"."candidate_intake_answer_tables" to "authenticated";

grant update on table "public"."candidate_intake_answer_tables" to "authenticated";

grant delete on table "public"."candidate_intake_answer_tables" to "service_role";

grant insert on table "public"."candidate_intake_answer_tables" to "service_role";

grant select on table "public"."candidate_intake_answer_tables" to "service_role";

grant update on table "public"."candidate_intake_answer_tables" to "service_role";

grant delete on table "public"."candidate_intake_answers" to "anon";

grant insert on table "public"."candidate_intake_answers" to "anon";

grant select on table "public"."candidate_intake_answers" to "anon";

grant update on table "public"."candidate_intake_answers" to "anon";

grant delete on table "public"."candidate_intake_answers" to "authenticated";

grant insert on table "public"."candidate_intake_answers" to "authenticated";

grant select on table "public"."candidate_intake_answers" to "authenticated";

grant update on table "public"."candidate_intake_answers" to "authenticated";

grant delete on table "public"."candidate_intake_answers" to "service_role";

grant insert on table "public"."candidate_intake_answers" to "service_role";

grant select on table "public"."candidate_intake_answers" to "service_role";

grant update on table "public"."candidate_intake_answers" to "service_role";

grant delete on table "public"."candidate_intake_attachments" to "anon";

grant insert on table "public"."candidate_intake_attachments" to "anon";

grant select on table "public"."candidate_intake_attachments" to "anon";

grant update on table "public"."candidate_intake_attachments" to "anon";

grant delete on table "public"."candidate_intake_attachments" to "authenticated";

grant insert on table "public"."candidate_intake_attachments" to "authenticated";

grant select on table "public"."candidate_intake_attachments" to "authenticated";

grant update on table "public"."candidate_intake_attachments" to "authenticated";

grant delete on table "public"."candidate_intake_attachments" to "service_role";

grant insert on table "public"."candidate_intake_attachments" to "service_role";

grant select on table "public"."candidate_intake_attachments" to "service_role";

grant update on table "public"."candidate_intake_attachments" to "service_role";

grant delete on table "public"."candidate_intake_links" to "anon";

grant insert on table "public"."candidate_intake_links" to "anon";

grant select on table "public"."candidate_intake_links" to "anon";

grant update on table "public"."candidate_intake_links" to "anon";

grant delete on table "public"."candidate_intake_links" to "authenticated";

grant insert on table "public"."candidate_intake_links" to "authenticated";

grant select on table "public"."candidate_intake_links" to "authenticated";

grant update on table "public"."candidate_intake_links" to "authenticated";

grant delete on table "public"."candidate_intake_links" to "service_role";

grant insert on table "public"."candidate_intake_links" to "service_role";

grant select on table "public"."candidate_intake_links" to "service_role";

grant update on table "public"."candidate_intake_links" to "service_role";

grant delete on table "public"."candidate_intake_photo_edits" to "anon";

grant insert on table "public"."candidate_intake_photo_edits" to "anon";

grant select on table "public"."candidate_intake_photo_edits" to "anon";

grant update on table "public"."candidate_intake_photo_edits" to "anon";

grant delete on table "public"."candidate_intake_photo_edits" to "authenticated";

grant insert on table "public"."candidate_intake_photo_edits" to "authenticated";

grant select on table "public"."candidate_intake_photo_edits" to "authenticated";

grant update on table "public"."candidate_intake_photo_edits" to "authenticated";

grant delete on table "public"."candidate_intake_photo_edits" to "service_role";

grant insert on table "public"."candidate_intake_photo_edits" to "service_role";

grant select on table "public"."candidate_intake_photo_edits" to "service_role";

grant update on table "public"."candidate_intake_photo_edits" to "service_role";

grant delete on table "public"."candidate_intake_questions" to "anon";

grant insert on table "public"."candidate_intake_questions" to "anon";

grant select on table "public"."candidate_intake_questions" to "anon";

grant update on table "public"."candidate_intake_questions" to "anon";

grant delete on table "public"."candidate_intake_questions" to "authenticated";

grant insert on table "public"."candidate_intake_questions" to "authenticated";

grant select on table "public"."candidate_intake_questions" to "authenticated";

grant update on table "public"."candidate_intake_questions" to "authenticated";

grant delete on table "public"."candidate_intake_questions" to "service_role";

grant insert on table "public"."candidate_intake_questions" to "service_role";

grant select on table "public"."candidate_intake_questions" to "service_role";

grant update on table "public"."candidate_intake_questions" to "service_role";

grant delete on table "public"."candidate_intake_review_comments" to "anon";

grant insert on table "public"."candidate_intake_review_comments" to "anon";

grant select on table "public"."candidate_intake_review_comments" to "anon";

grant update on table "public"."candidate_intake_review_comments" to "anon";

grant delete on table "public"."candidate_intake_review_comments" to "authenticated";

grant insert on table "public"."candidate_intake_review_comments" to "authenticated";

grant select on table "public"."candidate_intake_review_comments" to "authenticated";

grant update on table "public"."candidate_intake_review_comments" to "authenticated";

grant delete on table "public"."candidate_intake_review_comments" to "service_role";

grant insert on table "public"."candidate_intake_review_comments" to "service_role";

grant select on table "public"."candidate_intake_review_comments" to "service_role";

grant update on table "public"."candidate_intake_review_comments" to "service_role";

grant delete on table "public"."candidate_intake_templates" to "anon";

grant insert on table "public"."candidate_intake_templates" to "anon";

grant select on table "public"."candidate_intake_templates" to "anon";

grant update on table "public"."candidate_intake_templates" to "anon";

grant delete on table "public"."candidate_intake_templates" to "authenticated";

grant insert on table "public"."candidate_intake_templates" to "authenticated";

grant select on table "public"."candidate_intake_templates" to "authenticated";

grant update on table "public"."candidate_intake_templates" to "authenticated";

grant delete on table "public"."candidate_intake_templates" to "service_role";

grant insert on table "public"."candidate_intake_templates" to "service_role";

grant select on table "public"."candidate_intake_templates" to "service_role";

grant update on table "public"."candidate_intake_templates" to "service_role";

grant delete on table "public"."candidate_intakes" to "anon";

grant insert on table "public"."candidate_intakes" to "anon";

grant select on table "public"."candidate_intakes" to "anon";

grant update on table "public"."candidate_intakes" to "anon";

grant delete on table "public"."candidate_intakes" to "authenticated";

grant insert on table "public"."candidate_intakes" to "authenticated";

grant select on table "public"."candidate_intakes" to "authenticated";

grant update on table "public"."candidate_intakes" to "authenticated";

grant delete on table "public"."candidate_intakes" to "service_role";

grant insert on table "public"."candidate_intakes" to "service_role";

grant select on table "public"."candidate_intakes" to "service_role";

grant update on table "public"."candidate_intakes" to "service_role";

grant delete on table "public"."candidate_media" to "anon";

grant insert on table "public"."candidate_media" to "anon";

grant select on table "public"."candidate_media" to "anon";

grant update on table "public"."candidate_media" to "anon";

grant delete on table "public"."candidate_media" to "authenticated";

grant insert on table "public"."candidate_media" to "authenticated";

grant select on table "public"."candidate_media" to "authenticated";

grant update on table "public"."candidate_media" to "authenticated";

grant delete on table "public"."candidate_media" to "service_role";

grant insert on table "public"."candidate_media" to "service_role";

grant select on table "public"."candidate_media" to "service_role";

grant update on table "public"."candidate_media" to "service_role";

grant delete on table "public"."candidates" to "anon";

grant insert on table "public"."candidates" to "anon";

grant select on table "public"."candidates" to "anon";

grant update on table "public"."candidates" to "anon";

grant delete on table "public"."candidates" to "authenticated";

grant insert on table "public"."candidates" to "authenticated";

grant select on table "public"."candidates" to "authenticated";

grant update on table "public"."candidates" to "authenticated";

grant delete on table "public"."candidates" to "service_role";

grant insert on table "public"."candidates" to "service_role";

grant select on table "public"."candidates" to "service_role";

grant update on table "public"."candidates" to "service_role";

grant delete on table "public"."categories" to "anon";

grant insert on table "public"."categories" to "anon";

grant select on table "public"."categories" to "anon";

grant update on table "public"."categories" to "anon";

grant delete on table "public"."categories" to "authenticated";

grant insert on table "public"."categories" to "authenticated";

grant select on table "public"."categories" to "authenticated";

grant update on table "public"."categories" to "authenticated";

grant delete on table "public"."categories" to "service_role";

grant insert on table "public"."categories" to "service_role";

grant select on table "public"."categories" to "service_role";

grant update on table "public"."categories" to "service_role";

grant delete on table "public"."education" to "anon";

grant insert on table "public"."education" to "anon";

grant select on table "public"."education" to "anon";

grant update on table "public"."education" to "anon";

grant delete on table "public"."education" to "authenticated";

grant insert on table "public"."education" to "authenticated";

grant select on table "public"."education" to "authenticated";

grant update on table "public"."education" to "authenticated";

grant delete on table "public"."education" to "service_role";

grant insert on table "public"."education" to "service_role";

grant select on table "public"."education" to "service_role";

grant update on table "public"."education" to "service_role";

grant delete on table "public"."events" to "anon";

grant insert on table "public"."events" to "anon";

grant select on table "public"."events" to "anon";

grant update on table "public"."events" to "anon";

grant delete on table "public"."events" to "authenticated";

grant insert on table "public"."events" to "authenticated";

grant select on table "public"."events" to "authenticated";

grant update on table "public"."events" to "authenticated";

grant delete on table "public"."events" to "service_role";

grant insert on table "public"."events" to "service_role";

grant select on table "public"."events" to "service_role";

grant update on table "public"."events" to "service_role";

grant delete on table "public"."journal_articles" to "anon";

grant insert on table "public"."journal_articles" to "anon";

grant select on table "public"."journal_articles" to "anon";

grant update on table "public"."journal_articles" to "anon";

grant delete on table "public"."journal_articles" to "authenticated";

grant insert on table "public"."journal_articles" to "authenticated";

grant select on table "public"."journal_articles" to "authenticated";

grant update on table "public"."journal_articles" to "authenticated";

grant delete on table "public"."journal_articles" to "service_role";

grant insert on table "public"."journal_articles" to "service_role";

grant select on table "public"."journal_articles" to "service_role";

grant update on table "public"."journal_articles" to "service_role";

grant delete on table "public"."journals" to "anon";

grant insert on table "public"."journals" to "anon";

grant select on table "public"."journals" to "anon";

grant update on table "public"."journals" to "anon";

grant delete on table "public"."journals" to "authenticated";

grant insert on table "public"."journals" to "authenticated";

grant select on table "public"."journals" to "authenticated";

grant update on table "public"."journals" to "authenticated";

grant delete on table "public"."journals" to "service_role";

grant insert on table "public"."journals" to "service_role";

grant select on table "public"."journals" to "service_role";

grant update on table "public"."journals" to "service_role";

grant delete on table "public"."legal_pages" to "anon";

grant insert on table "public"."legal_pages" to "anon";

grant select on table "public"."legal_pages" to "anon";

grant update on table "public"."legal_pages" to "anon";

grant delete on table "public"."legal_pages" to "authenticated";

grant insert on table "public"."legal_pages" to "authenticated";

grant select on table "public"."legal_pages" to "authenticated";

grant update on table "public"."legal_pages" to "authenticated";

grant delete on table "public"."legal_pages" to "service_role";

grant insert on table "public"."legal_pages" to "service_role";

grant select on table "public"."legal_pages" to "service_role";

grant update on table "public"."legal_pages" to "service_role";

grant delete on table "public"."monthly_update_items" to "anon";

grant insert on table "public"."monthly_update_items" to "anon";

grant select on table "public"."monthly_update_items" to "anon";

grant update on table "public"."monthly_update_items" to "anon";

grant delete on table "public"."monthly_update_items" to "authenticated";

grant insert on table "public"."monthly_update_items" to "authenticated";

grant select on table "public"."monthly_update_items" to "authenticated";

grant update on table "public"."monthly_update_items" to "authenticated";

grant delete on table "public"."monthly_update_items" to "service_role";

grant insert on table "public"."monthly_update_items" to "service_role";

grant select on table "public"."monthly_update_items" to "service_role";

grant update on table "public"."monthly_update_items" to "service_role";

grant delete on table "public"."monthly_update_media" to "anon";

grant insert on table "public"."monthly_update_media" to "anon";

grant select on table "public"."monthly_update_media" to "anon";

grant update on table "public"."monthly_update_media" to "anon";

grant delete on table "public"."monthly_update_media" to "authenticated";

grant insert on table "public"."monthly_update_media" to "authenticated";

grant select on table "public"."monthly_update_media" to "authenticated";

grant update on table "public"."monthly_update_media" to "authenticated";

grant delete on table "public"."monthly_update_media" to "service_role";

grant insert on table "public"."monthly_update_media" to "service_role";

grant select on table "public"."monthly_update_media" to "service_role";

grant update on table "public"."monthly_update_media" to "service_role";

grant delete on table "public"."monthly_update_tokens" to "anon";

grant insert on table "public"."monthly_update_tokens" to "anon";

grant select on table "public"."monthly_update_tokens" to "anon";

grant update on table "public"."monthly_update_tokens" to "anon";

grant delete on table "public"."monthly_update_tokens" to "authenticated";

grant insert on table "public"."monthly_update_tokens" to "authenticated";

grant select on table "public"."monthly_update_tokens" to "authenticated";

grant update on table "public"."monthly_update_tokens" to "authenticated";

grant delete on table "public"."monthly_update_tokens" to "service_role";

grant insert on table "public"."monthly_update_tokens" to "service_role";

grant select on table "public"."monthly_update_tokens" to "service_role";

grant update on table "public"."monthly_update_tokens" to "service_role";

grant delete on table "public"."monthly_updates" to "anon";

grant insert on table "public"."monthly_updates" to "anon";

grant select on table "public"."monthly_updates" to "anon";

grant update on table "public"."monthly_updates" to "anon";

grant delete on table "public"."monthly_updates" to "authenticated";

grant insert on table "public"."monthly_updates" to "authenticated";

grant select on table "public"."monthly_updates" to "authenticated";

grant update on table "public"."monthly_updates" to "authenticated";

grant delete on table "public"."monthly_updates" to "service_role";

grant insert on table "public"."monthly_updates" to "service_role";

grant select on table "public"."monthly_updates" to "service_role";

grant update on table "public"."monthly_updates" to "service_role";

grant delete on table "public"."notifications" to "anon";

grant insert on table "public"."notifications" to "anon";

grant select on table "public"."notifications" to "anon";

grant update on table "public"."notifications" to "anon";

grant delete on table "public"."notifications" to "authenticated";

grant insert on table "public"."notifications" to "authenticated";

grant select on table "public"."notifications" to "authenticated";

grant update on table "public"."notifications" to "authenticated";

grant delete on table "public"."notifications" to "service_role";

grant insert on table "public"."notifications" to "service_role";

grant select on table "public"."notifications" to "service_role";

grant update on table "public"."notifications" to "service_role";

grant delete on table "public"."photo_prompt_fragments" to "anon";

grant insert on table "public"."photo_prompt_fragments" to "anon";

grant references on table "public"."photo_prompt_fragments" to "anon";

grant select on table "public"."photo_prompt_fragments" to "anon";

grant trigger on table "public"."photo_prompt_fragments" to "anon";

grant truncate on table "public"."photo_prompt_fragments" to "anon";

grant update on table "public"."photo_prompt_fragments" to "anon";

grant delete on table "public"."photo_prompt_fragments" to "authenticated";

grant insert on table "public"."photo_prompt_fragments" to "authenticated";

grant references on table "public"."photo_prompt_fragments" to "authenticated";

grant select on table "public"."photo_prompt_fragments" to "authenticated";

grant trigger on table "public"."photo_prompt_fragments" to "authenticated";

grant truncate on table "public"."photo_prompt_fragments" to "authenticated";

grant update on table "public"."photo_prompt_fragments" to "authenticated";

grant delete on table "public"."photo_prompt_fragments" to "service_role";

grant insert on table "public"."photo_prompt_fragments" to "service_role";

grant references on table "public"."photo_prompt_fragments" to "service_role";

grant select on table "public"."photo_prompt_fragments" to "service_role";

grant trigger on table "public"."photo_prompt_fragments" to "service_role";

grant truncate on table "public"."photo_prompt_fragments" to "service_role";

grant update on table "public"."photo_prompt_fragments" to "service_role";

grant delete on table "public"."podcast_guests" to "anon";

grant insert on table "public"."podcast_guests" to "anon";

grant select on table "public"."podcast_guests" to "anon";

grant update on table "public"."podcast_guests" to "anon";

grant delete on table "public"."podcast_guests" to "authenticated";

grant insert on table "public"."podcast_guests" to "authenticated";

grant select on table "public"."podcast_guests" to "authenticated";

grant update on table "public"."podcast_guests" to "authenticated";

grant delete on table "public"."podcast_guests" to "service_role";

grant insert on table "public"."podcast_guests" to "service_role";

grant select on table "public"."podcast_guests" to "service_role";

grant update on table "public"."podcast_guests" to "service_role";

grant delete on table "public"."podcasts" to "anon";

grant insert on table "public"."podcasts" to "anon";

grant select on table "public"."podcasts" to "anon";

grant update on table "public"."podcasts" to "anon";

grant delete on table "public"."podcasts" to "authenticated";

grant insert on table "public"."podcasts" to "authenticated";

grant select on table "public"."podcasts" to "authenticated";

grant update on table "public"."podcasts" to "authenticated";

grant delete on table "public"."podcasts" to "service_role";

grant insert on table "public"."podcasts" to "service_role";

grant select on table "public"."podcasts" to "service_role";

grant update on table "public"."podcasts" to "service_role";

grant delete on table "public"."profile_views" to "anon";

grant insert on table "public"."profile_views" to "anon";

grant select on table "public"."profile_views" to "anon";

grant update on table "public"."profile_views" to "anon";

grant delete on table "public"."profile_views" to "authenticated";

grant insert on table "public"."profile_views" to "authenticated";

grant select on table "public"."profile_views" to "authenticated";

grant update on table "public"."profile_views" to "authenticated";

grant delete on table "public"."profile_views" to "service_role";

grant insert on table "public"."profile_views" to "service_role";

grant select on table "public"."profile_views" to "service_role";

grant update on table "public"."profile_views" to "service_role";

grant delete on table "public"."profiles" to "anon";

grant insert on table "public"."profiles" to "anon";

grant select on table "public"."profiles" to "anon";

grant update on table "public"."profiles" to "anon";

grant delete on table "public"."profiles" to "authenticated";

grant insert on table "public"."profiles" to "authenticated";

grant select on table "public"."profiles" to "authenticated";

grant update on table "public"."profiles" to "authenticated";

grant delete on table "public"."profiles" to "service_role";

grant insert on table "public"."profiles" to "service_role";

grant select on table "public"."profiles" to "service_role";

grant update on table "public"."profiles" to "service_role";

grant delete on table "public"."quotes" to "anon";

grant insert on table "public"."quotes" to "anon";

grant select on table "public"."quotes" to "anon";

grant update on table "public"."quotes" to "anon";

grant delete on table "public"."quotes" to "authenticated";

grant insert on table "public"."quotes" to "authenticated";

grant select on table "public"."quotes" to "authenticated";

grant update on table "public"."quotes" to "authenticated";

grant delete on table "public"."quotes" to "service_role";

grant insert on table "public"."quotes" to "service_role";

grant select on table "public"."quotes" to "service_role";

grant update on table "public"."quotes" to "service_role";

grant delete on table "public"."ranking_adjustments" to "anon";

grant insert on table "public"."ranking_adjustments" to "anon";

grant select on table "public"."ranking_adjustments" to "anon";

grant update on table "public"."ranking_adjustments" to "anon";

grant delete on table "public"."ranking_adjustments" to "authenticated";

grant insert on table "public"."ranking_adjustments" to "authenticated";

grant select on table "public"."ranking_adjustments" to "authenticated";

grant update on table "public"."ranking_adjustments" to "authenticated";

grant delete on table "public"."ranking_adjustments" to "service_role";

grant insert on table "public"."ranking_adjustments" to "service_role";

grant select on table "public"."ranking_adjustments" to "service_role";

grant update on table "public"."ranking_adjustments" to "service_role";

grant delete on table "public"."ranking_categories" to "anon";

grant insert on table "public"."ranking_categories" to "anon";

grant select on table "public"."ranking_categories" to "anon";

grant update on table "public"."ranking_categories" to "anon";

grant delete on table "public"."ranking_categories" to "authenticated";

grant insert on table "public"."ranking_categories" to "authenticated";

grant select on table "public"."ranking_categories" to "authenticated";

grant update on table "public"."ranking_categories" to "authenticated";

grant delete on table "public"."ranking_categories" to "service_role";

grant insert on table "public"."ranking_categories" to "service_role";

grant select on table "public"."ranking_categories" to "service_role";

grant update on table "public"."ranking_categories" to "service_role";

grant delete on table "public"."ranking_events" to "anon";

grant insert on table "public"."ranking_events" to "anon";

grant select on table "public"."ranking_events" to "anon";

grant update on table "public"."ranking_events" to "anon";

grant delete on table "public"."ranking_events" to "authenticated";

grant insert on table "public"."ranking_events" to "authenticated";

grant select on table "public"."ranking_events" to "authenticated";

grant update on table "public"."ranking_events" to "authenticated";

grant delete on table "public"."ranking_events" to "service_role";

grant insert on table "public"."ranking_events" to "service_role";

grant select on table "public"."ranking_events" to "service_role";

grant update on table "public"."ranking_events" to "service_role";

grant delete on table "public"."ranking_periods" to "anon";

grant insert on table "public"."ranking_periods" to "anon";

grant select on table "public"."ranking_periods" to "anon";

grant update on table "public"."ranking_periods" to "anon";

grant delete on table "public"."ranking_periods" to "authenticated";

grant insert on table "public"."ranking_periods" to "authenticated";

grant select on table "public"."ranking_periods" to "authenticated";

grant update on table "public"."ranking_periods" to "authenticated";

grant delete on table "public"."ranking_periods" to "service_role";

grant insert on table "public"."ranking_periods" to "service_role";

grant select on table "public"."ranking_periods" to "service_role";

grant update on table "public"."ranking_periods" to "service_role";

grant delete on table "public"."ranking_scores" to "anon";

grant insert on table "public"."ranking_scores" to "anon";

grant select on table "public"."ranking_scores" to "anon";

grant update on table "public"."ranking_scores" to "anon";

grant delete on table "public"."ranking_scores" to "authenticated";

grant insert on table "public"."ranking_scores" to "authenticated";

grant select on table "public"."ranking_scores" to "authenticated";

grant update on table "public"."ranking_scores" to "authenticated";

grant delete on table "public"."ranking_scores" to "service_role";

grant insert on table "public"."ranking_scores" to "service_role";

grant select on table "public"."ranking_scores" to "service_role";

grant update on table "public"."ranking_scores" to "service_role";

grant delete on table "public"."ranking_weights" to "anon";

grant insert on table "public"."ranking_weights" to "anon";

grant select on table "public"."ranking_weights" to "anon";

grant update on table "public"."ranking_weights" to "anon";

grant delete on table "public"."ranking_weights" to "authenticated";

grant insert on table "public"."ranking_weights" to "authenticated";

grant select on table "public"."ranking_weights" to "authenticated";

grant update on table "public"."ranking_weights" to "authenticated";

grant delete on table "public"."ranking_weights" to "service_role";

grant insert on table "public"."ranking_weights" to "service_role";

grant select on table "public"."ranking_weights" to "service_role";

grant update on table "public"."ranking_weights" to "service_role";

grant delete on table "public"."regions" to "anon";

grant insert on table "public"."regions" to "anon";

grant select on table "public"."regions" to "anon";

grant update on table "public"."regions" to "anon";

grant delete on table "public"."regions" to "authenticated";

grant insert on table "public"."regions" to "authenticated";

grant select on table "public"."regions" to "authenticated";

grant update on table "public"."regions" to "authenticated";

grant delete on table "public"."regions" to "service_role";

grant insert on table "public"."regions" to "service_role";

grant select on table "public"."regions" to "service_role";

grant update on table "public"."regions" to "service_role";

grant delete on table "public"."role_permissions" to "anon";

grant insert on table "public"."role_permissions" to "anon";

grant select on table "public"."role_permissions" to "anon";

grant update on table "public"."role_permissions" to "anon";

grant delete on table "public"."role_permissions" to "authenticated";

grant insert on table "public"."role_permissions" to "authenticated";

grant select on table "public"."role_permissions" to "authenticated";

grant update on table "public"."role_permissions" to "authenticated";

grant delete on table "public"."role_permissions" to "service_role";

grant insert on table "public"."role_permissions" to "service_role";

grant select on table "public"."role_permissions" to "service_role";

grant update on table "public"."role_permissions" to "service_role";

grant delete on table "public"."roles" to "anon";

grant insert on table "public"."roles" to "anon";

grant select on table "public"."roles" to "anon";

grant update on table "public"."roles" to "anon";

grant delete on table "public"."roles" to "authenticated";

grant insert on table "public"."roles" to "authenticated";

grant select on table "public"."roles" to "authenticated";

grant update on table "public"."roles" to "authenticated";

grant delete on table "public"."roles" to "service_role";

grant insert on table "public"."roles" to "service_role";

grant select on table "public"."roles" to "service_role";

grant update on table "public"."roles" to "service_role";

grant delete on table "public"."site_settings" to "anon";

grant insert on table "public"."site_settings" to "anon";

grant select on table "public"."site_settings" to "anon";

grant update on table "public"."site_settings" to "anon";

grant delete on table "public"."site_settings" to "authenticated";

grant insert on table "public"."site_settings" to "authenticated";

grant select on table "public"."site_settings" to "authenticated";

grant update on table "public"."site_settings" to "authenticated";

grant delete on table "public"."site_settings" to "service_role";

grant insert on table "public"."site_settings" to "service_role";

grant select on table "public"."site_settings" to "service_role";

grant update on table "public"."site_settings" to "service_role";

grant delete on table "public"."social_links" to "anon";

grant insert on table "public"."social_links" to "anon";

grant select on table "public"."social_links" to "anon";

grant update on table "public"."social_links" to "anon";

grant delete on table "public"."social_links" to "authenticated";

grant insert on table "public"."social_links" to "authenticated";

grant select on table "public"."social_links" to "authenticated";

grant update on table "public"."social_links" to "authenticated";

grant delete on table "public"."social_links" to "service_role";

grant insert on table "public"."social_links" to "service_role";

grant select on table "public"."social_links" to "service_role";

grant update on table "public"."social_links" to "service_role";

grant delete on table "public"."user_roles" to "anon";

grant insert on table "public"."user_roles" to "anon";

grant select on table "public"."user_roles" to "anon";

grant update on table "public"."user_roles" to "anon";

grant delete on table "public"."user_roles" to "authenticated";

grant insert on table "public"."user_roles" to "authenticated";

grant select on table "public"."user_roles" to "authenticated";

grant update on table "public"."user_roles" to "authenticated";

grant delete on table "public"."user_roles" to "service_role";

grant insert on table "public"."user_roles" to "service_role";

grant select on table "public"."user_roles" to "service_role";

grant update on table "public"."user_roles" to "service_role";

grant delete on table "public"."work_experiences" to "anon";

grant insert on table "public"."work_experiences" to "anon";

grant select on table "public"."work_experiences" to "anon";

grant update on table "public"."work_experiences" to "anon";

grant delete on table "public"."work_experiences" to "authenticated";

grant insert on table "public"."work_experiences" to "authenticated";

grant select on table "public"."work_experiences" to "authenticated";

grant update on table "public"."work_experiences" to "authenticated";

grant delete on table "public"."work_experiences" to "service_role";

grant insert on table "public"."work_experiences" to "service_role";

grant select on table "public"."work_experiences" to "service_role";

grant update on table "public"."work_experiences" to "service_role";


  create policy "candidate intake access logs view"
  on "public"."candidate_intake_access_logs"
  as permissive
  for select
  to authenticated
using ((public.has_permission('audit.view'::text) OR public.has_permission('candidate_intakes.links'::text)));



  create policy "intake ai feedback read"
  on "public"."candidate_intake_ai_feedback"
  as permissive
  for select
  to authenticated
using (public.has_permission('intakes.view'::text));



  create policy "intake ai feedback write"
  on "public"."candidate_intake_ai_feedback"
  as permissive
  for all
  to authenticated
using ((public.has_permission('intakes.edit'::text) OR public.has_permission('intakes.review'::text)))
with check ((public.has_permission('intakes.edit'::text) OR public.has_permission('intakes.review'::text)));



  create policy "ai prompts read"
  on "public"."photo_prompt_fragments"
  as permissive
  for select
  to authenticated
using (public.has_permission('ai_prompts.view'::text));



  create policy "ai prompts write"
  on "public"."photo_prompt_fragments"
  as permissive
  for all
  to authenticated
using (public.has_permission('ai_prompts.edit'::text))
with check (public.has_permission('ai_prompts.edit'::text));



  create policy "admins read all"
  on "public"."achievements"
  as permissive
  for select
  to authenticated
using (public.is_admin());



  create policy "public candidate sections"
  on "public"."achievements"
  as permissive
  for select
  to public
using ((EXISTS ( SELECT 1
   FROM public.candidates c
  WHERE ((c.id = achievements.candidate_id) AND (c.status = 'published'::text) AND (c.deleted_at IS NULL)))));



  create policy "own ai chat messages"
  on "public"."ai_chat_messages"
  as permissive
  for all
  to authenticated
using ((EXISTS ( SELECT 1
   FROM public.ai_chat_sessions s
  WHERE ((s.id = ai_chat_messages.session_id) AND (s.created_by = auth.uid())))))
with check ((EXISTS ( SELECT 1
   FROM public.ai_chat_sessions s
  WHERE ((s.id = ai_chat_messages.session_id) AND (s.created_by = auth.uid())))));



  create policy "ai job viewers"
  on "public"."ai_jobs"
  as permissive
  for select
  to authenticated
using (public.has_permission('ai.use'::text));



  create policy "admins read all"
  on "public"."application_files"
  as permissive
  for select
  to authenticated
using (public.is_admin());



  create policy "admins read all"
  on "public"."application_notes"
  as permissive
  for select
  to authenticated
using (public.is_admin());



  create policy "admins read all"
  on "public"."applications"
  as permissive
  for select
  to authenticated
using (public.is_admin());



  create policy "admins read all"
  on "public"."article_revisions"
  as permissive
  for select
  to authenticated
using (public.is_admin());



  create policy "admins read all"
  on "public"."articles"
  as permissive
  for select
  to authenticated
using (public.is_admin());



  create policy "article writers"
  on "public"."articles"
  as permissive
  for all
  to authenticated
using (public.has_permission('articles.edit'::text))
with check (public.has_permission('articles.edit'::text));



  create policy "audit viewers"
  on "public"."audit_logs"
  as permissive
  for select
  to authenticated
using (public.has_permission('audit.view'::text));



  create policy "admins read all"
  on "public"."books_read"
  as permissive
  for select
  to authenticated
using (public.is_admin());



  create policy "public candidate sections"
  on "public"."books_read"
  as permissive
  for select
  to public
using ((EXISTS ( SELECT 1
   FROM public.candidates c
  WHERE ((c.id = books_read.candidate_id) AND (c.status = 'published'::text) AND (c.deleted_at IS NULL)))));



  create policy "intake admins read"
  on "public"."candidate_intake_ai_runs"
  as permissive
  for select
  to authenticated
using (public.has_permission('intakes.view'::text));



  create policy "intake admins read"
  on "public"."candidate_intake_answer_revisions"
  as permissive
  for select
  to authenticated
using (public.has_permission('intakes.view'::text));



  create policy "intake writers"
  on "public"."candidate_intake_answer_revisions"
  as permissive
  for all
  to authenticated
using (public.has_permission('intakes.edit'::text))
with check (public.has_permission('intakes.edit'::text));



  create policy "intake admins read"
  on "public"."candidate_intake_answer_tables"
  as permissive
  for select
  to authenticated
using (public.has_permission('intakes.view'::text));



  create policy "intake writers"
  on "public"."candidate_intake_answer_tables"
  as permissive
  for all
  to authenticated
using (public.has_permission('intakes.edit'::text))
with check (public.has_permission('intakes.edit'::text));



  create policy "intake admins read"
  on "public"."candidate_intake_answers"
  as permissive
  for select
  to authenticated
using (public.has_permission('intakes.view'::text));



  create policy "intake writers"
  on "public"."candidate_intake_answers"
  as permissive
  for all
  to authenticated
using (public.has_permission('intakes.edit'::text))
with check (public.has_permission('intakes.edit'::text));



  create policy "intake admins read"
  on "public"."candidate_intake_attachments"
  as permissive
  for select
  to authenticated
using (public.has_permission('intakes.view'::text));



  create policy "intake writers"
  on "public"."candidate_intake_attachments"
  as permissive
  for all
  to authenticated
using (public.has_permission('intakes.edit'::text))
with check (public.has_permission('intakes.edit'::text));



  create policy "intake admins read"
  on "public"."candidate_intake_links"
  as permissive
  for select
  to authenticated
using (public.has_permission('intakes.view'::text));



  create policy "intake link managers"
  on "public"."candidate_intake_links"
  as permissive
  for all
  to authenticated
using (public.has_permission('intakes.link'::text))
with check (public.has_permission('intakes.link'::text));



  create policy "intake admins read"
  on "public"."candidate_intake_photo_edits"
  as permissive
  for select
  to authenticated
using (public.has_permission('intakes.view'::text));



  create policy "intake writers"
  on "public"."candidate_intake_photo_edits"
  as permissive
  for all
  to authenticated
using (public.has_permission('intakes.edit'::text))
with check (public.has_permission('intakes.edit'::text));



  create policy "intake admins read"
  on "public"."candidate_intake_questions"
  as permissive
  for select
  to authenticated
using (public.has_permission('intakes.view'::text));



  create policy "intake question managers"
  on "public"."candidate_intake_questions"
  as permissive
  for all
  to authenticated
using (public.has_permission('intakes.edit'::text))
with check (public.has_permission('intakes.edit'::text));



  create policy "intake admins read"
  on "public"."candidate_intake_review_comments"
  as permissive
  for select
  to authenticated
using (public.has_permission('intakes.view'::text));



  create policy "intake writers"
  on "public"."candidate_intake_review_comments"
  as permissive
  for all
  to authenticated
using (public.has_permission('intakes.edit'::text))
with check (public.has_permission('intakes.edit'::text));



  create policy "intake admins read"
  on "public"."candidate_intake_templates"
  as permissive
  for select
  to authenticated
using (public.has_permission('intakes.view'::text));



  create policy "intake template managers"
  on "public"."candidate_intake_templates"
  as permissive
  for all
  to authenticated
using (public.has_permission('intakes.edit'::text))
with check (public.has_permission('intakes.edit'::text));



  create policy "intake admins read"
  on "public"."candidate_intakes"
  as permissive
  for select
  to authenticated
using (public.has_permission('intakes.view'::text));



  create policy "intake writers"
  on "public"."candidate_intakes"
  as permissive
  for all
  to authenticated
using (public.has_permission('intakes.edit'::text))
with check (public.has_permission('intakes.edit'::text));



  create policy "admins read all"
  on "public"."candidate_media"
  as permissive
  for select
  to authenticated
using (public.is_admin());



  create policy "admins read all"
  on "public"."candidates"
  as permissive
  for select
  to authenticated
using (public.is_admin());



  create policy "candidate writers"
  on "public"."candidates"
  as permissive
  for all
  to authenticated
using (public.has_permission('candidates.edit'::text))
with check (public.has_permission('candidates.edit'::text));



  create policy "taxonomy managers write categories"
  on "public"."categories"
  as permissive
  for all
  to authenticated
using (public.has_permission('taxonomy.manage'::text))
with check (public.has_permission('taxonomy.manage'::text));



  create policy "admins read all"
  on "public"."education"
  as permissive
  for select
  to authenticated
using (public.is_admin());



  create policy "public candidate sections"
  on "public"."education"
  as permissive
  for select
  to public
using ((EXISTS ( SELECT 1
   FROM public.candidates c
  WHERE ((c.id = education.candidate_id) AND (c.status = 'published'::text) AND (c.deleted_at IS NULL)))));



  create policy "admins read all"
  on "public"."events"
  as permissive
  for select
  to authenticated
using (public.is_admin());



  create policy "public candidate sections"
  on "public"."events"
  as permissive
  for select
  to public
using ((EXISTS ( SELECT 1
   FROM public.candidates c
  WHERE ((c.id = events.candidate_id) AND (c.status = 'published'::text) AND (c.deleted_at IS NULL)))));



  create policy "admins read all"
  on "public"."journal_articles"
  as permissive
  for select
  to authenticated
using (public.is_admin());



  create policy "journal articles of published journals"
  on "public"."journal_articles"
  as permissive
  for select
  to public
using ((EXISTS ( SELECT 1
   FROM public.journals j
  WHERE ((j.id = journal_articles.journal_id) AND (j.status = 'published'::text)))));



  create policy "admins read all"
  on "public"."journals"
  as permissive
  for select
  to authenticated
using (public.is_admin());



  create policy "content managers write journals"
  on "public"."journals"
  as permissive
  for all
  to authenticated
using (public.has_permission('journals.manage'::text))
with check (public.has_permission('journals.manage'::text));



  create policy "update item viewers"
  on "public"."monthly_update_items"
  as permissive
  for select
  to authenticated
using (public.has_permission('updates.view'::text));



  create policy "update media viewers"
  on "public"."monthly_update_media"
  as permissive
  for select
  to authenticated
using (public.has_permission('updates.view'::text));



  create policy "token viewers"
  on "public"."monthly_update_tokens"
  as permissive
  for select
  to authenticated
using (public.has_permission('tokens.view'::text));



  create policy "update viewers"
  on "public"."monthly_updates"
  as permissive
  for select
  to authenticated
using (public.has_permission('updates.view'::text));



  create policy "mark own notifications read"
  on "public"."notifications"
  as permissive
  for update
  to authenticated
using (((recipient_id = auth.uid()) OR ((recipient_id IS NULL) AND public.is_admin())))
with check (((recipient_id = auth.uid()) OR ((recipient_id IS NULL) AND public.is_admin())));



  create policy "own notifications"
  on "public"."notifications"
  as permissive
  for select
  to authenticated
using (((recipient_id = auth.uid()) OR ((recipient_id IS NULL) AND public.is_admin())));



  create policy "admins read all"
  on "public"."podcast_guests"
  as permissive
  for select
  to authenticated
using (public.is_admin());



  create policy "admins read all"
  on "public"."podcasts"
  as permissive
  for select
  to authenticated
using (public.is_admin());



  create policy "content managers write podcasts"
  on "public"."podcasts"
  as permissive
  for all
  to authenticated
using (public.has_permission('podcasts.manage'::text))
with check (public.has_permission('podcasts.manage'::text));



  create policy "admins read all"
  on "public"."profile_views"
  as permissive
  for select
  to authenticated
using (public.is_admin());



  create policy "admins read profiles"
  on "public"."profiles"
  as permissive
  for select
  to authenticated
using (public.is_admin());



  create policy "admins read all"
  on "public"."quotes"
  as permissive
  for select
  to authenticated
using (public.is_admin());



  create policy "content managers write quotes"
  on "public"."quotes"
  as permissive
  for all
  to authenticated
using (public.has_permission('quotes.manage'::text))
with check (public.has_permission('quotes.manage'::text));



  create policy "admins read all"
  on "public"."ranking_adjustments"
  as permissive
  for select
  to authenticated
using (public.is_admin());



  create policy "admins read all"
  on "public"."ranking_events"
  as permissive
  for select
  to authenticated
using (public.is_admin());



  create policy "admins read all"
  on "public"."ranking_periods"
  as permissive
  for select
  to authenticated
using (public.is_admin());



  create policy "admins read all"
  on "public"."ranking_scores"
  as permissive
  for select
  to authenticated
using (public.is_admin());



  create policy "published rankings are public"
  on "public"."ranking_scores"
  as permissive
  for select
  to public
using (((is_current = true) AND (EXISTS ( SELECT 1
   FROM public.ranking_periods p
  WHERE ((p.id = ranking_scores.period_id) AND (p.published_at IS NOT NULL))))));



  create policy "admins read all"
  on "public"."ranking_weights"
  as permissive
  for select
  to authenticated
using (public.is_admin());



  create policy "taxonomy managers write regions"
  on "public"."regions"
  as permissive
  for all
  to authenticated
using (public.has_permission('taxonomy.manage'::text))
with check (public.has_permission('taxonomy.manage'::text));



  create policy "admins read role_permissions"
  on "public"."role_permissions"
  as permissive
  for select
  to authenticated
using (public.is_admin());



  create policy "admins read roles"
  on "public"."roles"
  as permissive
  for select
  to authenticated
using (public.is_admin());



  create policy "admins read all"
  on "public"."social_links"
  as permissive
  for select
  to authenticated
using (public.is_admin());



  create policy "public candidate sections"
  on "public"."social_links"
  as permissive
  for select
  to public
using ((EXISTS ( SELECT 1
   FROM public.candidates c
  WHERE ((c.id = social_links.candidate_id) AND (c.status = 'published'::text) AND (c.deleted_at IS NULL)))));



  create policy "admins read user_roles"
  on "public"."user_roles"
  as permissive
  for select
  to authenticated
using (public.is_admin());



  create policy "admins read all"
  on "public"."work_experiences"
  as permissive
  for select
  to authenticated
using (public.is_admin());



  create policy "public candidate sections"
  on "public"."work_experiences"
  as permissive
  for select
  to public
using ((EXISTS ( SELECT 1
   FROM public.candidates c
  WHERE ((c.id = work_experiences.candidate_id) AND (c.status = 'published'::text) AND (c.deleted_at IS NULL)))));


CREATE TRIGGER trg_photo_prompt_fragments_updated BEFORE UPDATE ON public.photo_prompt_fragments FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_applications_updated BEFORE UPDATE ON public.applications FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_articles_updated BEFORE UPDATE ON public.articles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_intake_answers_updated BEFORE UPDATE ON public.candidate_intake_answers FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_intake_templates_updated BEFORE UPDATE ON public.candidate_intake_templates FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_intakes_updated BEFORE UPDATE ON public.candidate_intakes FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_candidates_updated BEFORE UPDATE ON public.candidates FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_monthly_update_merged AFTER UPDATE ON public.monthly_updates FOR EACH ROW EXECUTE FUNCTION public.on_monthly_update_merged();

CREATE TRIGGER trg_monthly_updates_updated BEFORE UPDATE ON public.monthly_updates FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_podcasts_updated BEFORE UPDATE ON public.podcasts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_profiles_updated BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_ranking_scores_updated BEFORE UPDATE ON public.ranking_scores FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_ranking_weights_updated BEFORE UPDATE ON public.ranking_weights FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

drop trigger if exists "on_auth_user_created" on "auth"."users";

CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

drop policy "admins delete media" on "storage"."objects";

drop policy "admins read all buckets" on "storage"."objects";

drop policy "admins upload media" on "storage"."objects";

drop policy "intake files admin read" on "storage"."objects";


  create policy "candidate intake admins delete storage"
  on "storage"."objects"
  as permissive
  for delete
  to authenticated
using (((bucket_id = 'candidate-intake-files'::text) AND (public.has_permission('candidate_intakes.edit'::text) OR public.has_permission('candidate_intakes.photos'::text))));



  create policy "candidate intake admins read storage"
  on "storage"."objects"
  as permissive
  for select
  to authenticated
using (((bucket_id = 'candidate-intake-files'::text) AND (public.has_permission('candidate_intakes.view'::text) OR public.has_permission('candidate_intakes.review'::text) OR public.has_permission('candidate_intakes.photos'::text))));



  create policy "candidate intake admins update storage"
  on "storage"."objects"
  as permissive
  for update
  to authenticated
using (((bucket_id = 'candidate-intake-files'::text) AND (public.has_permission('candidate_intakes.edit'::text) OR public.has_permission('candidate_intakes.photos'::text))))
with check (((bucket_id = 'candidate-intake-files'::text) AND (public.has_permission('candidate_intakes.edit'::text) OR public.has_permission('candidate_intakes.photos'::text))));



  create policy "candidate intake admins upload storage"
  on "storage"."objects"
  as permissive
  for insert
  to authenticated
with check (((bucket_id = 'candidate-intake-files'::text) AND (public.has_permission('candidate_intakes.edit'::text) OR public.has_permission('candidate_intakes.photos'::text))));



  create policy "admins delete media"
  on "storage"."objects"
  as permissive
  for delete
  to authenticated
using (public.has_permission('media.delete'::text));



  create policy "admins read all buckets"
  on "storage"."objects"
  as permissive
  for select
  to authenticated
using (public.has_permission('media.view'::text));



  create policy "admins upload media"
  on "storage"."objects"
  as permissive
  for insert
  to authenticated
with check (public.has_permission('media.upload'::text));



  create policy "intake files admin read"
  on "storage"."objects"
  as permissive
  for select
  to authenticated
using (((bucket_id = 'candidate-intake-files'::text) AND public.has_permission('intakes.view'::text)));



