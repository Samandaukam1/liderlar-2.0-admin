import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { splitPipeValues, stripCandidateMarkers } from "./parser.ts";
import { DEFAULT_CANDIDATE_AI_PROMPT, CANDIDATE_AI_PROMPT_KEY } from "./prompt.ts";
import { emptyCandidateData, type CandidateEditorPayload, type CandidateStructuredData } from "./schema.ts";

const EDITOR_SELECT = [
  "id",
  "slug",
  "full_name",
  "short_bio",
  "avatar_url",
  "birth_date",
  "birth_year",
  "birth_place",
  "current_location",
  "education_summary",
  "activity_field",
  "description_items",
  "languages",
  "raw_content",
  "formatted_content",
  "unparsed_content",
  "status",
  "deleted_at",
  "regions(name)",
  "categories(name)",
].join(",");

type CandidateEditorRow = {
  id: string;
  slug: string;
  full_name: string;
  short_bio: string | null;
  avatar_url: string | null;
  birth_date: string | null;
  birth_year: string | null;
  birth_place: string | null;
  current_location: string | null;
  education_summary: string | null;
  activity_field: string | null;
  description_items: string[] | null;
  languages: string[] | null;
  raw_content: string | null;
  formatted_content: string | null;
  unparsed_content: string | null;
  status: string;
  deleted_at: string | null;
  regions: { name: string } | { name: string }[] | null;
  categories: { name: string } | { name: string }[] | null;
};

function relatedName(value: { name: string } | { name: string }[] | null): string {
  if (Array.isArray(value)) return value[0]?.name ?? "";
  return value?.name ?? "";
}

export interface CandidateEditorRecord {
  id: string;
  status: string;
  data: CandidateStructuredData;
}

export async function getCandidateEditorRecord(candidateId: string): Promise<CandidateEditorRecord | null> {
  const admin = createSupabaseAdminClient();
  const { data: candidate, error } = await admin
    .from("candidates")
    .select(EDITOR_SELECT)
    .eq("id", candidateId)
    .maybeSingle();
  if (error) throw error;
  if (!candidate) return null;
  const row = candidate as unknown as CandidateEditorRow;

  const [{ data: sectionRows, error: sectionError }, { data: legacyArticle }] = await Promise.all([
    admin
      .from("candidate_sections")
      .select("id,title,content,sort_order")
      .eq("candidate_id", candidateId)
      .order("sort_order")
      .order("created_at"),
    admin
      .from("articles")
      .select("id,title,content")
      .eq("candidate_id", candidateId)
      .is("deleted_at", null)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (sectionError) throw sectionError;

  const sections = (sectionRows ?? []).map((section, order) => ({
    id: section.id as string,
    title: stripCandidateMarkers(section.title as string),
    content: stripCandidateMarkers(section.content as string),
    order,
  }));
  if (sections.length === 0 && legacyArticle?.content) {
    sections.push({
      id: crypto.randomUUID(),
      title: stripCandidateMarkers((legacyArticle.title as string) || "Biografiya"),
      content: stripCandidateMarkers(legacyArticle.content as string),
      order: 0,
    });
  }

  const fallbackBirthYear = row.birth_date ?? "";
  const data: CandidateStructuredData = {
    ...emptyCandidateData(),
    fullName: stripCandidateMarkers(row.full_name),
    descriptionItems: splitPipeValues(row.description_items?.length ? row.description_items : row.short_bio),
    birthYear: stripCandidateMarkers(row.birth_year ?? fallbackBirthYear),
    birthPlace: stripCandidateMarkers(row.birth_place),
    currentLocation: stripCandidateMarkers(row.current_location ?? relatedName(row.regions)),
    education: stripCandidateMarkers(row.education_summary),
    activityField: stripCandidateMarkers(row.activity_field ?? relatedName(row.categories)),
    languages: splitPipeValues(row.languages),
    sections,
    profilePhoto: row.avatar_url ?? "",
    slug: row.slug,
    rawContent: row.raw_content ?? row.formatted_content ?? "",
    formattedContent: row.formatted_content ?? "",
    unparsedContent: row.unparsed_content ?? "",
  };
  return { id: row.id, status: row.status, data };
}

export async function saveCandidateProfile(
  payload: CandidateEditorPayload,
  actorId: string,
): Promise<{ candidateId: string; slug: string }> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc("save_candidate_profile_v2", {
    p_candidate: payload.candidateId,
    p_payload: {
      fullName: payload.fullName,
      slug: payload.slug,
      descriptionItems: payload.descriptionItems,
      birthYear: payload.birthYear,
      birthPlace: payload.birthPlace,
      currentLocation: payload.currentLocation,
      education: payload.education,
      activityField: payload.activityField,
      languages: payload.languages,
      profilePhoto: payload.profilePhoto,
      rawContent: payload.rawContent,
      formattedContent: payload.formattedContent,
      unparsedContent: payload.unparsedContent,
    },
    p_sections: payload.sections,
    p_actor: actorId,
  });
  if (error) throw error;
  const result = data as { candidate_id?: string; slug?: string } | null;
  if (!result?.candidate_id || !result.slug) throw new Error("Nomzod saqlanganini tasdiqlab bo‘lmadi");
  return { candidateId: result.candidate_id, slug: result.slug };
}

export async function getCandidatePrompt(): Promise<string> {
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("site_settings")
    .select("value")
    .eq("key", CANDIDATE_AI_PROMPT_KEY)
    .maybeSingle();
  return typeof data?.value === "string" && data.value.trim() ? data.value : DEFAULT_CANDIDATE_AI_PROMPT;
}

export async function saveCandidatePrompt(value: string, actorId: string): Promise<void> {
  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("site_settings").upsert({
    key: CANDIDATE_AI_PROMPT_KEY,
    value,
    updated_by: actorId,
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;
}

export async function updateCandidateAiMetadata(
  candidateId: string,
  patch: {
    status: "processing" | "succeeded" | "failed";
    model?: string;
    rawResponse?: unknown;
  },
): Promise<void> {
  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("candidates")
    .update({
      ai_status: patch.status,
      ai_model: patch.model ?? null,
      ai_generated_at: patch.status === "succeeded" ? new Date().toISOString() : undefined,
      ai_raw_response: patch.rawResponse ?? undefined,
      manually_reviewed: false,
    })
    .eq("id", candidateId);
  if (error) throw error;
}

