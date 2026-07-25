import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { Gender, ClothingType, PhotoColor } from "./constants";

/**
 * Column that holds the actual prompt text in public.photo_prompt_fragments.
 *
 * ⚠️ ASSUMPTION: the 0011 migration was applied outside this repo, so the exact
 * name of the text column could not be introspected. It is centralized here —
 * if your migration named it differently (e.g. `prompt_text`, `body`, `text`),
 * change this ONE constant and everything (admin editor + prompt builder) follows.
 */
export const FRAGMENT_TEXT_COLUMN = "content";

export interface PromptFragment {
  id: string;
  fragment_type: "base_scene" | "clothing" | "color";
  gender: Gender | null;
  clothing_type: string | null;
  color: string | null;
  label: string | null;
  text: string;
  is_active: boolean;
}

function normalize(row: Record<string, unknown>): PromptFragment {
  return {
    id: row.id as string,
    fragment_type: row.fragment_type as PromptFragment["fragment_type"],
    gender: (row.gender as Gender | null) ?? null,
    clothing_type: (row.clothing_type as string | null) ?? null,
    color: (row.color as string | null) ?? null,
    label: (row.label as string | null) ?? null,
    text: (row[FRAGMENT_TEXT_COLUMN] as string | null) ?? "",
    is_active: (row.is_active as boolean) ?? false,
  };
}

/** All fragments (active + inactive) for the admin editor. */
export async function listPhotoPromptFragments(): Promise<PromptFragment[]> {
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("photo_prompt_fragments")
    .select("*")
    .order("fragment_type")
    .order("gender", { nullsFirst: true })
    .order("clothing_type", { nullsFirst: true })
    .order("color", { nullsFirst: true });
  return (data ?? []).map((r) => normalize(r as Record<string, unknown>));
}

/**
 * Assembles the final image-generation prompt from active fragments. Shared by
 * both the candidate route (/api/intake/photo-edit) and the admin route so the
 * prompt is never hardcoded in two places.
 *
 *   base_scene(gender) + clothing(gender, clothingType)
 *   + color(color)   ← skipped when clothingType === 'own_clothes'
 */
export async function buildPhotoPrompt(params: {
  gender: Gender;
  clothingType: ClothingType;
  color?: PhotoColor | null;
}): Promise<string> {
  const admin = createSupabaseAdminClient();
  const { data } = await admin.from("photo_prompt_fragments").select("*").eq("is_active", true);
  const fragments = (data ?? []).map((r) => normalize(r as Record<string, unknown>));

  const base = fragments.find((f) => f.fragment_type === "base_scene" && f.gender === params.gender);
  const clothing = fragments.find(
    (f) => f.fragment_type === "clothing" && f.gender === params.gender && f.clothing_type === params.clothingType,
  );
  const color =
    params.clothingType !== "own_clothes" && params.color
      ? fragments.find((f) => f.fragment_type === "color" && f.color === params.color)
      : undefined;

  const parts = [base?.text, clothing?.text, color?.text].map((p) => p?.trim()).filter(Boolean);

  // Graceful fallback so a missing/renamed fragment never yields an empty prompt.
  if (parts.length === 0) {
    return "Ushbu rasmni professional biografik portretga aylantiring: yuz identifikatsiyasi va yoshini aynan saqlang, neytral premium studiya foni, kameraga to‘g‘ri qaragan, rasmiy kiyim, tabiiy teri teksturasi.";
  }
  return parts.join("\n\n");
}
