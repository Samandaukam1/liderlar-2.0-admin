import { emptyCandidateData, type CandidateStructuredData } from "./schema.ts";
import { splitPipeValues } from "./parser.ts";

type CandidateKey =
  | "fullName"
  | "descriptionItems"
  | "birthYear"
  | "birthPlace"
  | "currentLocation"
  | "education"
  | "activityField"
  | "languages"
  | "profilePhoto";

const FIELD_ALIASES: Record<CandidateKey, string[]> = {
  fullName: ["full_name", "fullname", "fish", "fio", "candidate_name", "nomzod_ismi", "ism_familiya", "ism"],
  descriptionItems: ["description_items", "short_bio", "description", "qisqa_tavsif", "tavsif"],
  birthYear: ["birth_year", "birth_date", "date_of_birth", "tugilgan_yili", "tugilgan_sana"],
  birthPlace: ["birth_place", "place_of_birth", "tugilgan_joyi"],
  currentLocation: ["current_location", "residence", "living_region", "yashash_hududi", "hozirda_yashash"],
  education: ["education", "talim", "malumoti", "oqish_joyi"],
  activityField: ["activity_field", "occupation", "profession", "faoliyat_sohasi", "kasbi"],
  languages: ["languages", "spoken_languages", "tillar", "qaysi_tillar"],
  profilePhoto: ["profile_photo", "photo", "avatar_url", "rasm", "surat"],
};

function normalizeKey(key: string): string {
  return key
    .toLocaleLowerCase("uz")
    .replace(/[‘’ʻ`']/g, "")
    .replace(/[^a-z0-9а-яё]+/gi, "_")
    .replace(/^_+|_+$/g, "");
}

function targetForKey(rawKey: string): CandidateKey | null {
  const key = normalizeKey(rawKey);
  for (const [target, aliases] of Object.entries(FIELD_ALIASES) as Array<[CandidateKey, string[]]>) {
    if (aliases.includes(key)) return target;
    if (aliases.some((alias) => alias.length >= 5 && key.includes(alias))) return target;
  }
  return null;
}

function valueAsText(value: unknown): string {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value).trim();
  if (Array.isArray(value)) return value.map(valueAsText).filter(Boolean).join(" | ");
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).map(valueAsText).filter(Boolean).join(" | ");
  }
  return "";
}

export interface NormalizedCandidateIntake {
  data: CandidateStructuredData;
  unmapped: Record<string, unknown>;
  rawContent: string;
}

export function normalizeCandidateIntake(raw: Record<string, unknown>): NormalizedCandidateIntake {
  const data = emptyCandidateData();
  const unmapped: Record<string, unknown> = {};
  const assigned = new Set<CandidateKey>();

  for (const [key, rawValue] of Object.entries(raw)) {
    const target = targetForKey(key);
    const text = valueAsText(rawValue);
    if (!target || !text || assigned.has(target)) {
      unmapped[key] = rawValue;
      continue;
    }
    assigned.add(target);
    if (target === "descriptionItems" || target === "languages") data[target] = splitPipeValues(text);
    else data[target] = text;
  }

  const rawContent = JSON.stringify(raw, null, 2);
  data.rawContent = rawContent;
  return { data, unmapped, rawContent };
}
