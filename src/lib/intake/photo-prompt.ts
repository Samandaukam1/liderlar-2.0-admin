import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { GENDERS, MANUAL_PHOTO_PROMPTS } from "./constants";
import type { Gender, ClothingType, PhotoColor } from "./constants";

export interface PromptFragment {
  id: string;
  fragment_type: "base_scene" | "clothing" | "color";
  gender: Gender | null;
  clothing_type: string | null;
  color: string | null;
  label: string | null;
  prompt_text: string;
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
    prompt_text: (row.prompt_text as string | null) ?? "",
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

  const parts = [base?.prompt_text, clothing?.prompt_text, color?.prompt_text]
    .map((p) => p?.trim())
    .filter(Boolean);

  // Graceful fallback so a missing/renamed fragment never yields an empty prompt.
  if (parts.length === 0) {
    return "Ushbu rasmni professional biografik portretga aylantiring: yuz identifikatsiyasi va yoshini aynan saqlang, neytral premium studiya foni, kameraga to‘g‘ri qaragan, rasmiy kiyim, tabiiy teri teksturasi.";
  }
  return parts.join("\n\n");
}

/**
 * The prompt the candidate copies into their own AI image tool, per gender.
 *
 * Assembled from the SAME `photo_prompt_fragments` the admin edits under
 * "Nomzod link rasm yaratish promtlari". It used to be a constant compiled into
 * the form, so anything set in that panel changed the in-app generation while
 * the text every candidate actually copied stayed frozen at whatever had been
 * hardcoded — two prompts drifting apart with nothing saying so.
 *
 * `suit` is the clothing fragment used here: the copy-paste card offers no
 * clothing choice, and a formal portrait is what the poster needs. Colour is
 * skipped for the same reason — it only qualifies a garment the candidate has
 * not chosen.
 *
 * Falls back to the compiled-in text per gender, so clearing a fragment in the
 * panel leaves the candidate with a working prompt rather than an empty box.
 */
export async function buildManualPhotoPrompts(): Promise<Record<Gender, string>> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("photo_prompt_fragments")
    .select("*")
    .eq("is_active", true);

  if (error) {
    console.error("[photo-prompt] fragment load failed", error.message);
    return { ...MANUAL_PHOTO_PROMPTS };
  }

  const fragments = (data ?? []).map((r) => normalize(r as Record<string, unknown>));
  const prompts = {} as Record<Gender, string>;

  for (const gender of GENDERS) {
    const base = fragments.find((f) => f.fragment_type === "base_scene" && f.gender === gender);
    const clothing = fragments.find(
      (f) => f.fragment_type === "clothing" && f.gender === gender && f.clothing_type === "suit",
    );
    const assembled = [base?.prompt_text, clothing?.prompt_text]
      .map((p) => p?.trim())
      .filter(Boolean)
      .join("\n\n");
    prompts[gender] = assembled || MANUAL_PHOTO_PROMPTS[gender];
  }

  return prompts;
}
