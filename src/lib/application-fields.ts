/** Sayt ariza formasidagi maydonlar uchun ko'rinadigan matnlar va havolalar. */

export const APPLICATION_AGE_RANGES = ["14-18", "19-24", "25-28", "29-35", "35+"] as const;

export const APPLICATION_GENDER_LABELS: Record<string, string> = {
  male: "Erkak",
  female: "Ayol",
};

export function genderLabel(gender: string | null | undefined): string {
  if (!gender) return "—";
  return APPLICATION_GENDER_LABELS[gender] ?? gender;
}

/** @username → t.me havolasi; telefon raqamga havola berilmaydi. */
export function telegramHref(telegram: string | null | undefined): string | null {
  if (!telegram?.startsWith("@")) return null;
  return `https://t.me/${telegram.slice(1)}`;
}
