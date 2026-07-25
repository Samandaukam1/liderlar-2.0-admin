/** Shared status → label/accent map. Accents are @theme color token names. */

export type Accent =
  | "mint"
  | "green"
  | "peach"
  | "amber"
  | "coral"
  | "rose"
  | "lavender"
  | "sky"
  | "lime"
  | "cyan"
  | "brand"
  | "neutral";

export interface StatusMeta {
  label: string;
  accent: Accent;
}

export const STATUS_META: Record<string, StatusMeta> = {
  // content lifecycle
  draft: { label: "Qoralama", accent: "lavender" },
  review: { label: "Ko‘rib chiqilmoqda", accent: "sky" },
  scheduled: { label: "Rejalashtirilgan", accent: "cyan" },
  published: { label: "Nashr etilgan", accent: "mint" },
  archived: { label: "Arxivlangan", accent: "neutral" },
  // candidate intake (V2)
  ai_reviewing: { label: "AI ko‘rmoqda", accent: "cyan" },
  needs_clarification: { label: "Aniqlashtirish kerak", accent: "peach" },
  promoted: { label: "Nomzodga aylantirilgan", accent: "green" },
  // monthly updates
  submitted: { label: "Yuborilgan", accent: "sky" },
  under_review: { label: "Tekshirilmoqda", accent: "sky" },
  needs_changes: { label: "Tuzatish kerak", accent: "peach" },
  approved: { label: "Tasdiqlangan", accent: "green" },
  merged: { label: "Biografiyaga qo‘shilgan", accent: "mint" },
  rejected: { label: "Rad etilgan", accent: "coral" },
  // tokens
  active: { label: "Faol", accent: "cyan" },
  used: { label: "Foydalanilgan", accent: "mint" },
  expired: { label: "Muddati tugagan", accent: "peach" },
  revoked: { label: "Bekor qilingan", accent: "coral" },
  due_soon: { label: "Muddat yaqin", accent: "lavender" },
  overdue: { label: "Muddati o‘tgan", accent: "coral" },
  // applications
  new: { label: "Yangi", accent: "cyan" },
  in_review: { label: "Ko‘rilmoqda", accent: "sky" },
  needs_info: { label: "Ma’lumot kerak", accent: "peach" },
  accepted: { label: "Qabul qilingan", accent: "green" },
  converted: { label: "Nomzodga aylantirilgan", accent: "mint" },
  // podcasts
  planned: { label: "Rejada", accent: "lavender" },
  announced: { label: "E’lon qilingan", accent: "cyan" },
  live: { label: "Jonli", accent: "coral" },
  recorded: { label: "Yozib olingan", accent: "sky" },
  cancelled: { label: "Bekor qilingan", accent: "coral" },
  // ai jobs
  pending: { label: "Navbatda", accent: "lavender" },
  running: { label: "AI ishlamoqda", accent: "cyan" },
  succeeded: { label: "Bajarildi", accent: "mint" },
  failed: { label: "Xatolik", accent: "coral" },
  // audit severity
  info: { label: "Ma’lumot", accent: "sky" },
  warning: { label: "Ogohlantirish", accent: "amber" },
  critical: { label: "Muhim", accent: "coral" },
};

export function statusMeta(status: string | null | undefined): StatusMeta {
  if (!status) return { label: "—", accent: "neutral" };
  return STATUS_META[status] ?? { label: status, accent: "neutral" };
}
