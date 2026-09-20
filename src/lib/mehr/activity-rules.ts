/**
 * Ezgulik ishining hayot yo'li — SOF MODUL.
 *
 * Holat o'zgarishi bu yerda qat'iy: tasdiqlangan tadbirni
 * "qayta tahrirlab" ball va sertifikatni ostidan siljitib
 * bo'lmaydi.
 */

export type ActivityStatus =
  | "draft"
  | "submitted"
  | "changes_requested"
  | "approved"
  | "rejected";

export type ReviewAction = "submit" | "approve" | "reject" | "request_changes";

const TRANSITIONS: Readonly<Record<ActivityStatus, readonly ReviewAction[]>> = {
  draft: ["submit"],
  // Tuzatish so'ralgan tadbir qayta yuboriladi — bu odatiy yo'l.
  changes_requested: ["submit"],
  submitted: ["approve", "reject", "request_changes"],
  /*
   * TASDIQLANGANDAN KEYIN — HECH NIMA.
   *
   * Ball daftarga tushgan, sertifikat berilgan, ommaviy sahifa
   * chiqqan. Holatni qaytarish bu uchalasini jimgina yolg'onga
   * aylantirardi. Tuzatish kerak bo'lsa — teskari ball yozuvi va
   * sertifikatni bekor qilish, ya'ni ko'rinadigan amal.
   */
  approved: [],
  /*
   * Rad etilgan tadbir qayta yuborilmaydi: tashkilotchi yangisini
   * yaratadi. Aks holda rad etish tarixi bitta yozuv ustida
   * qayta-qayta yozilib, dalil yo'qolardi.
   */
  rejected: [],
};

export function canTransition(from: ActivityStatus, action: ReviewAction): boolean {
  return TRANSITIONS[from].includes(action);
}

export function nextStatus(action: ReviewAction): ActivityStatus {
  switch (action) {
    case "submit":
      return "submitted";
    case "approve":
      return "approved";
    case "reject":
      return "rejected";
    case "request_changes":
      return "changes_requested";
  }
}

export interface SubmissionDraft {
  title: string;
  description: string | null;
  purpose: string | null;
  coverImageUrl: string | null;
  beneficiaryCount: number | null;
  mediaCount: number;
  participantCount: number;
  startsAt: string | null;
}

export interface SubmissionCheck {
  ok: boolean;
  /** Foydalanuvchiga ko'rsatiladigan, aniq nima yetishmayotgani. */
  missing: string[];
}

/**
 * Tekshiruvga yuborishdan oldingi to'liqlik nazorati.
 *
 * Maqsad — adminning vaqtini tejash emas, DALILSIZ tadbir
 * tasdiqqa kirmasligi. Ro'yxat aniq: "to'ldiring" degan umumiy
 * xabar odamni nima qilishini bilmay qoldiradi.
 */
export function checkSubmission(draft: SubmissionDraft): SubmissionCheck {
  const missing: string[] = [];

  if (!draft.title.trim() || draft.title.trim().length < 3) missing.push("Tadbir nomi");
  if (!draft.description?.trim()) missing.push("Tavsif — nima qilindi");
  if (!draft.purpose?.trim()) missing.push("Maqsad");
  if (!draft.coverImageUrl?.trim()) missing.push("Muqova rasmi");
  if (draft.mediaCount < 1) missing.push("Kamida bitta dalil rasmi");
  if (draft.beneficiaryCount === null || draft.beneficiaryCount < 0) {
    missing.push("Nafi tekkanlar soni");
  }
  if (!draft.startsAt) missing.push("Tadbir sanasi");

  /*
   * ISHTIROKCHI SONI TEKSHIRILMAYDI.
   *
   * Yolg'iz qilingan ezgulik ham ezgulik. Tashkilotchining o'zi
   * yagona ishtirokchi bo'lishi mumkin va bu rad etish sababi emas.
   */

  return { ok: missing.length === 0, missing };
}
