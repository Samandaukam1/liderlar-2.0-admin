/**
 * AUDIT HODISALARI KATALOGI (§37, §56).
 *
 * IKKALA REPODA AYNAN BIR XIL FAYL: `liderlar-admin` va `liderlar-web`
 * ikkalasi ham `audit_logs` ga yozadi, admin panel esa ikkalasining
 * yozuvini bitta ro'yxatda ko'rsatadi. Hodisa nomi yoki uning ma'nosi
 * ikki joyda farq qilsa, panel bir repodagi yozuvni noto'g'ri
 * tushuntirardi. Test (`vip-audit.test.ts`) ikki nusxani bayt-baytigacha
 * solishtiradi.
 *
 * HECH NARSA IMPORT QILMAYDI — ataylab: fayl ikki repoga ko'chiriladi
 * va testlar uni `node --test` bilan to'g'ridan-to'g'ri o'qiydi. Birorta
 * `@/` import uni repoga bog'lab qo'yardi.
 *
 * QOIDA: kodda audit hodisasi FAQAT shu katalogdagi kalit bilan
 * yoziladi (`recordAudit("vip.subscription.extended", …)`). Nomni
 * qatorni yig'ib yasash (`"vip." + event`) taqiqlangan: test koddagi
 * har bir nomni katalogdan qidiradi va yig'ilgan nomni ko'ra olmaydi.
 */

export type AuditSeverity = "info" | "warning" | "critical";

/**
 * Kim qiladigan amal.
 *
 *   admin  — admin panelidagi xodim;
 *   member — a'zoning o'zi (sayt kabineti yoki Telegram bot);
 *   system — fon vazifasi yoki tizim oqimi, odam emas.
 *
 * Bu faqat ko'rsatish uchun ishora. Haqiqiy shaxs `actor_id` da.
 */
export type AuditActorKind = "admin" | "member" | "system";

/**
 * `audit_logs.entity_type` qiymatlari.
 *
 * Profilga tegishli barcha hodisa `candidate` ga yoziladi (entity_id —
 * nomzod id si): shunda admin nomzod sahifasidagi "Tarix" bo'limida
 * shu nomzodning BARCHA o'zgarishlarini bitta so'rov bilan ko'radi.
 * Yozuv, sertifikat yoki rasm id si `metadata` da turadi.
 */
export type AuditEntity =
  | "candidate"
  | "vip_subscription"
  | "feature_flag"
  | "member_article"
  | "referral_attribution"
  | "profile"
  | "system";

export interface AuditEventSpec {
  readonly entity: AuditEntity;
  readonly severity: AuditSeverity;
  readonly actor: AuditActorKind;
  /** Admin panelda ko'rinadigan matn. Texnik kalit EMAS. */
  readonly label: string;
}

export const AUDIT_EVENTS = {
  /* ------------------------------------------------------------ *
   * VIP OBUNA — pul bilan bog'liq, shuning uchun hammasi jurnalda.
   * ------------------------------------------------------------ */
  "vip.subscription.created": {
    entity: "vip_subscription", severity: "info", actor: "admin",
    label: "VIP obuna yaratildi",
  },
  "vip.subscription.activated": {
    entity: "vip_subscription", severity: "info", actor: "admin",
    label: "VIP obuna faollashtirildi",
  },
  "vip.subscription.extended": {
    entity: "vip_subscription", severity: "info", actor: "admin",
    label: "VIP obuna uzaytirildi",
  },
  "vip.subscription.suspended": {
    entity: "vip_subscription", severity: "warning", actor: "admin",
    label: "VIP obuna to‘xtatildi",
  },
  "vip.subscription.cancelled": {
    entity: "vip_subscription", severity: "warning", actor: "admin",
    label: "VIP obuna bekor qilindi",
  },
  "vip.subscription.restored": {
    entity: "vip_subscription", severity: "info", actor: "admin",
    label: "VIP obuna tiklandi",
  },
  "vip.subscription.grace_started": {
    entity: "vip_subscription", severity: "info", actor: "system",
    label: "VIP obuna imtiyoz muddatiga o‘tdi",
  },
  "vip.subscription.expired": {
    entity: "vip_subscription", severity: "info", actor: "system",
    label: "VIP obuna muddati tugadi",
  },

  /* ------------------------------------------------------------ *
   * FUNKSIYA BAYROQLARI — butun tizimning chiqarish holati.
   * ------------------------------------------------------------ */
  "feature_flag.updated": {
    entity: "feature_flag", severity: "critical", actor: "admin",
    label: "Funksiya bayrog‘i o‘zgartirildi",
  },

  /* ------------------------------------------------------------ *
   * PROFIL — A'ZONING O'ZI (sayt kabineti).
   * ------------------------------------------------------------ */
  "profile.fields.updated": {
    entity: "candidate", severity: "info", actor: "member",
    label: "Profil maydonlari o‘zgartirildi",
  },
  "profile.edit.submitted": {
    entity: "candidate", severity: "info", actor: "member",
    label: "Profil o‘zgarishi tekshiruvga yuborildi",
  },
  "profile.entry.created": {
    entity: "candidate", severity: "info", actor: "member",
    label: "Profilga yozuv qo‘shildi",
  },
  "profile.entry.updated": {
    entity: "candidate", severity: "info", actor: "member",
    label: "Profil yozuvi o‘zgartirildi",
  },
  "profile.entry.deleted": {
    entity: "candidate", severity: "warning", actor: "member",
    label: "Profil yozuvi o‘chirildi",
  },
  "profile.certificate.created": {
    entity: "candidate", severity: "info", actor: "member",
    label: "Sertifikat qo‘shildi",
  },
  "profile.certificate.updated": {
    entity: "candidate", severity: "info", actor: "member",
    label: "Sertifikat o‘zgartirildi",
  },
  "profile.certificate.deleted": {
    entity: "candidate", severity: "warning", actor: "member",
    label: "Sertifikat o‘chirildi",
  },
  "profile.certificate.evidence_attached": {
    entity: "candidate", severity: "info", actor: "member",
    label: "Sertifikat dalili yuklandi",
  },
  "profile.certificate.evidence_removed": {
    entity: "candidate", severity: "info", actor: "member",
    label: "Sertifikat dalili o‘chirildi",
  },
  "profile.media.uploaded": {
    entity: "candidate", severity: "info", actor: "member",
    label: "Profilga rasm yuklandi",
  },
  "profile.media.removed": {
    entity: "candidate", severity: "info", actor: "member",
    label: "Profildan rasm olib tashlandi",
  },
  "profile.media.alt_updated": {
    entity: "candidate", severity: "info", actor: "member",
    label: "Rasm tavsifi o‘zgartirildi",
  },
  "profile.theme.published": {
    entity: "candidate", severity: "info", actor: "member",
    label: "Profil dizayni nashr qilindi",
  },
  "profile.theme.reset": {
    entity: "candidate", severity: "info", actor: "member",
    label: "Profil dizayni standartga qaytarildi",
  },

  /* ------------------------------------------------------------ *
   * PROFIL — TAHRIRIYAT QARORLARI (admin panel).
   * ------------------------------------------------------------ */
  "profile.edit.approved": {
    entity: "candidate", severity: "info", actor: "admin",
    label: "Profil o‘zgarishi tasdiqlandi",
  },
  "profile.edit.rejected": {
    entity: "candidate", severity: "info", actor: "admin",
    label: "Profil o‘zgarishi qaytarildi",
  },
  "profile.entry.approved": {
    entity: "candidate", severity: "info", actor: "admin",
    label: "Profil yozuvi tasdiqlandi",
  },
  "profile.entry.rejected": {
    entity: "candidate", severity: "info", actor: "admin",
    label: "Profil yozuvi qaytarildi",
  },
  "profile.certificate.trust_set": {
    entity: "candidate", severity: "info", actor: "admin",
    label: "Sertifikatga ishonch darajasi berildi",
  },
  /*
   * DALILNI OCHISH HAM YOZILADI.
   *
   * Dalil faylida shaxsiy ma'lumot bo'lishi mumkin (diplom, pasport
   * nusxasi). Kim qachon ochganini bilish — maxfiylik kafolatining
   * bir qismi.
   */
  "profile.certificate.evidence_viewed": {
    entity: "candidate", severity: "info", actor: "admin",
    label: "Sertifikat dalili ochildi",
  },

  /* ------------------------------------------------------------ *
   * TELEGRAM BOT ORQALI PROFIL (§19–§22).
   * ------------------------------------------------------------ */
  "telegram.profile.bio_updated": {
    entity: "candidate", severity: "info", actor: "member",
    label: "Qisqa ma’lumot Telegram orqali o‘zgartirildi",
  },
  "telegram.profile.entry_submitted": {
    entity: "candidate", severity: "info", actor: "member",
    label: "Yozuv Telegram orqali yuborildi",
  },
  "telegram.profile.photo_uploaded": {
    entity: "candidate", severity: "info", actor: "member",
    label: "Rasm Telegram orqali yuklandi",
  },

  /* ------------------------------------------------------------ *
   * AKKAUNT
   * ------------------------------------------------------------ */
  "account.username.set": {
    entity: "profile", severity: "info", actor: "member",
    label: "Login o‘rnatildi",
  },
  /*
   * PAROLNI TIKLASH. Ikkalasi `warning`: hisobga kirish yo'li
   * o'zgaryapti va "kim, qachon havola bergan" savoli xavfsizlik
   * tekshiruvida birinchi so'raladi.
   */
  "account.recovery.created": {
    entity: "profile", severity: "warning", actor: "admin",
    label: "Parolni tiklash havolasi yaratildi",
  },
  "account.recovery.completed": {
    entity: "profile", severity: "warning", actor: "member",
    label: "Parol tiklash havolasi orqali yangilandi",
  },

  /* ------------------------------------------------------------ *
   * A'ZO MAQOLALARI (Liderlar Online)
   * ------------------------------------------------------------ */
  "article.submitted": {
    entity: "member_article", severity: "info", actor: "member",
    label: "Maqola tekshiruvga yuborildi",
  },
  "article.review_started": {
    entity: "member_article", severity: "info", actor: "admin",
    label: "Maqola ko‘rib chiqila boshlandi",
  },
  "article.changes_requested": {
    entity: "member_article", severity: "info", actor: "admin",
    label: "Maqolaga tuzatish so‘raldi",
  },
  "article.approved": {
    entity: "member_article", severity: "info", actor: "admin",
    label: "Maqola tasdiqlandi",
  },
  "article.published": {
    entity: "member_article", severity: "info", actor: "admin",
    label: "Maqola nashr qilindi",
  },
  "article.rejected": {
    entity: "member_article", severity: "info", actor: "admin",
    label: "Maqola rad etildi",
  },
  "article.archived": {
    entity: "member_article", severity: "info", actor: "admin",
    label: "Maqola arxivlandi",
  },
  "article.unpublished": {
    entity: "member_article", severity: "warning", actor: "admin",
    label: "Maqola nashrdan olindi",
  },
  "article.adabiyotx_synced": {
    entity: "member_article", severity: "info", actor: "system",
    label: "Maqola AdabiyotX’ga uzatildi",
  },
  "article.adabiyotx_failed": {
    entity: "member_article", severity: "warning", actor: "system",
    label: "Maqolani AdabiyotX’ga uzatib bo‘lmadi",
  },

  /* ------------------------------------------------------------ *
   * TAVSIYA (REFERRAL) VA BALL
   * ------------------------------------------------------------ */
  "referral.code.issued": {
    entity: "profile", severity: "info", actor: "member",
    label: "Shaxsiy tavsiya kodi berildi",
  },
  /*
   * FON VAZIFASI BITTA YIG'MA YOZUV QOLDIRADI, har kod uchun emas.
   *
   * Vazifa bir yurishda 200 tagacha kod beradi. Har biriga alohida
   * jurnal yozuvi cron vaqtini ikki baravar oshirar va jurnalni
   * ma'nosiz qatorlar bilan to'ldirardi. Yig'ma yozuvda sonlar bor.
   */
  "referral.codes.swept": {
    entity: "system", severity: "info", actor: "system",
    label: "Tavsiya kodlari tarqatildi",
  },
  "referral.attribution.created": {
    entity: "referral_attribution", severity: "info", actor: "system",
    label: "Arizaga tavsiya biriktirildi",
  },
  "referral.attribution.advanced": {
    entity: "referral_attribution", severity: "info", actor: "system",
    label: "Tavsiya bosqichi oldinga siljidi",
  },
  "referral.points.awarded": {
    entity: "referral_attribution", severity: "info", actor: "system",
    label: "Tavsiya uchun ball berildi",
  },
  "referral.milestone.awarded": {
    entity: "profile", severity: "info", actor: "system",
    label: "Tavsiya bosqichi mukofoti berildi",
  },
  "referral.points.reversed": {
    entity: "referral_attribution", severity: "warning", actor: "admin",
    label: "Tavsiya balli bekor qilindi",
  },
} as const satisfies Readonly<Record<string, AuditEventSpec>>;

export type AuditEventKey = keyof typeof AUDIT_EVENTS;

export const AUDIT_EVENT_KEYS = Object.keys(AUDIT_EVENTS) as AuditEventKey[];

export function isAuditEventKey(value: unknown): value is AuditEventKey {
  return typeof value === "string" && Object.hasOwn(AUDIT_EVENTS, value);
}

/**
 * Hodisa ta'rifi yoki `null`.
 *
 * `audit_logs` da katalogdan TASHQARI eski yozuvlar ham bor
 * (`candidate.update` va boshqalar). Ular uchun `null` qaytadi va
 * panel texnik nomni ko'rsatadi — yozuv yashirilmaydi.
 */
export function auditEventSpec(action: string): AuditEventSpec | null {
  return isAuditEventKey(action) ? AUDIT_EVENTS[action] : null;
}

/** Panel uchun odam tilidagi nom; katalogda bo'lmasa — texnik nom. */
export function auditEventLabel(action: string): string {
  return auditEventSpec(action)?.label ?? action;
}

/** Filtr ro'yxati uchun obyekt turlarining nomlari. */
export const AUDIT_ENTITY_LABEL: Readonly<Record<AuditEntity, string>> = {
  candidate: "Nomzod profili",
  vip_subscription: "VIP obuna",
  feature_flag: "Funksiya bayrog‘i",
  member_article: "A’zo maqolasi",
  referral_attribution: "Tavsiya",
  profile: "Akkaunt",
  system: "Fon vazifasi",
};
