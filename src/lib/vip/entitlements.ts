/**
 * VIP HUQUQLARI — SOF MODUL.
 *
 * Bu faylda BAZAGA MUROJAAT YO'Q. Sabab ikki xil:
 *
 *   1. Huquq qoidalari eng muhim xavfsizlik mantig'i va u testdan
 *      o'tishi kerak. Testlar `@/` taxallusini yecha olmaydi, shuning
 *      uchun bu modul faqat nisbiy importlar bilan ishlaydi va hech
 *      narsa import qilmaydi.
 *   2. "Bu odam nimaga haqli" degan savolning javobi bitta joyda
 *      bo'lsin. Har ekranda o'z tekshiruvi paydo bo'lsa, ular
 *      bir-biriga qarama-qarshi tushadi.
 *
 * I/O qismi — `entitlement-service.ts`.
 */

/* ========================================================================= *
 * HUQUQ KALITLARI
 * ========================================================================= */

/**
 * Tizimdagi BARCHA huquq kalitlari.
 *
 * Migratsiyadagi `vip_plan_entitlements` seed'i bilan bir xil bo'lishi
 * SHART. Nomuvofiqlik bo'lsa, `can()` noma'lum kalit uchun xato
 * qaytaradi — ya'ni xato jimgina "ruxsat yo'q" ga aylanmaydi va
 * e'tiborsiz qolmaydi.
 */
export const ENTITLEMENTS = [
  "profile.self_edit",
  "profile.media_upload",
  "profile.certificate_manage",
  "profile.premium_themes",
  "referral.analytics",
  "telegram.profile_edit",
  "articles.create",
  "articles.submit",
  "magazine.subscription",
] as const;

export type Entitlement = (typeof ENTITLEMENTS)[number];

const ENTITLEMENT_SET: ReadonlySet<string> = new Set(ENTITLEMENTS);

export function isKnownEntitlement(value: string): value is Entitlement {
  return ENTITLEMENT_SET.has(value);
}

/* ========================================================================= *
 * FEATURE FLAGLAR
 * ========================================================================= */

export const FEATURE_FLAGS = [
  "vip.enabled",
  "vip.profile_editor_enabled",
  "vip.themes_enabled",
  "vip.referrals_enabled",
  "vip.telegram_edit_enabled",
  "vip.articles_enabled",
  "vip.adabiyotx_sync_enabled",
  "liderlar_online.enabled",
  "vip.magazine_enabled",
] as const;

export type FeatureFlag = (typeof FEATURE_FLAGS)[number];

/**
 * Har bir huquq qaysi flagga bog'liq.
 *
 * `vip.enabled` BARCHASIGA qo'shimcha shart sifatida qo'llanadi —
 * quyidagi jadvalda takrorlanmaydi, chunki uni bir joyda tekshirish
 * "bittasini yozishni esdan chiqarish" xatosini imkonsiz qiladi.
 */
const ENTITLEMENT_FLAG: Readonly<Record<Entitlement, FeatureFlag>> = {
  "profile.self_edit": "vip.profile_editor_enabled",
  "profile.media_upload": "vip.profile_editor_enabled",
  "profile.certificate_manage": "vip.profile_editor_enabled",
  "profile.premium_themes": "vip.themes_enabled",
  "referral.analytics": "vip.referrals_enabled",
  "telegram.profile_edit": "vip.telegram_edit_enabled",
  "articles.create": "vip.articles_enabled",
  "articles.submit": "vip.articles_enabled",
  "magazine.subscription": "vip.magazine_enabled",
};

/* ========================================================================= *
 * OBUNA HOLATI
 * ========================================================================= */

export const SUBSCRIPTION_STATES = [
  "pending",
  "active",
  "grace_period",
  "expired",
  "cancelled",
  "suspended",
] as const;

export type SubscriptionState = (typeof SUBSCRIPTION_STATES)[number];

/**
 * Huquq BERADIGAN holatlar.
 *
 * `pending` bermaydi: u "to'lov kutilyapti" degani va oldindan huquq
 * berish to'lovsiz foydalanishga yo'l ochardi.
 *
 * `grace_period` BERADI: muddat tugagan, lekin imtiyoz ataylab
 * saqlanyapti — aks holda to'lov bir kun kechikkan odam profilidan
 * mahrum bo'lardi.
 */
const GRANTING_STATES: ReadonlySet<SubscriptionState> = new Set([
  "active",
  "grace_period",
]);

export interface SubscriptionSnapshot {
  state: SubscriptionState;
  /** `null` — muddatsiz obuna. */
  currentPeriodEnd: Date | null;
  graceUntil: Date | null;
  /** Shu obuna tarifi beradigan huquqlar. */
  entitlements: readonly string[];
}

/**
 * Obuna hozir huquq beradimi.
 *
 * HOLAT VA SANA — IKKOVI tekshiriladi. Faqat holatga qarash muddatni
 * yopadigan fon vazifasiga ishonish bo'lardi: u kechiksa, tugagan
 * obuna huquq berib turardi.
 */
export function isSubscriptionGranting(
  subscription: SubscriptionSnapshot | null,
  now: Date,
): boolean {
  if (!subscription) return false;
  if (!GRANTING_STATES.has(subscription.state)) return false;

  // Muddatsiz obuna — sana sharti yo'q.
  if (subscription.currentPeriodEnd === null) return true;

  const until = subscription.graceUntil ?? subscription.currentPeriodEnd;
  return now.getTime() <= until.getTime();
}

/* ========================================================================= *
 * QAROR
 * ========================================================================= */

export type DenialReason =
  | "vip_disabled"
  | "feature_disabled"
  | "no_subscription"
  | "subscription_inactive"
  | "not_in_plan";

export type EntitlementDecision =
  | { allowed: true }
  | { allowed: false; reason: DenialReason };

export interface EntitlementContext {
  subscription: SubscriptionSnapshot | null;
  /** Flag qiymatlari. Yetishmayotgan flag O'CHIQ deb qaraladi. */
  flags: Readonly<Partial<Record<FeatureFlag, boolean>>>;
  now: Date;
}

/**
 * Bitta huquq savoliga javob.
 *
 * NOMA'LUM KALIT UCHUN XATO TASHLAYDI, `false` qaytarmaydi.
 *
 * Sabab: `can(user, "profile.premum_themes")` (xato yozilgan) jimgina
 * "ruxsat yo'q" qaytarsa, imkoniyat hech kimga ishlamay qolardi va
 * buni hech kim sezmasdi. Xato esa darhol ko'rinadi. Bu chaqiruv
 * foydalanuvchi kiritmasi bilan emas, DASTURCHI yozgan satr bilan
 * ishlaydi — ya'ni xato tashlash tashqi xatti-harakatga bog'liq emas.
 */
export function decide(
  entitlement: Entitlement,
  context: EntitlementContext,
): EntitlementDecision {
  if (!isKnownEntitlement(entitlement)) {
    throw new Error(`Noma'lum huquq kaliti: ${entitlement}`);
  }

  /*
   * ENG AVVAL BOSH FLAG.
   *
   * `vip.enabled` o'chirilsa, butun tizim o'chadi. Bu ishlab
   * chiqarishda xavfsiz orqaga qaytish yo'li: nosozlik chiqsa,
   * bitta flag bilan hammasi to'xtatiladi.
   */
  if (context.flags["vip.enabled"] !== true) {
    return { allowed: false, reason: "vip_disabled" };
  }

  const required = ENTITLEMENT_FLAG[entitlement];
  if (context.flags[required] !== true) {
    return { allowed: false, reason: "feature_disabled" };
  }

  if (!context.subscription) {
    return { allowed: false, reason: "no_subscription" };
  }
  if (!isSubscriptionGranting(context.subscription, context.now)) {
    return { allowed: false, reason: "subscription_inactive" };
  }
  if (!context.subscription.entitlements.includes(entitlement)) {
    return { allowed: false, reason: "not_in_plan" };
  }

  return { allowed: true };
}

/* ========================================================================= *
 * VIP BELGISI
 * ========================================================================= */

/**
 * VIP badge ko'rsatilsinmi (§34).
 *
 * Badge FAOL OBUNAGA bog'langan, alohida bayroqqa emas: aks holda
 * obuna tugaganda badge qolib ketardi va yolg'on holat ko'rsatardi.
 *
 * Badge biror huquqqa ham bog'lanmagan — tarif huquqlari o'zgarsa,
 * badge yo'qolib qolmasligi kerak.
 */
export function showsVipBadge(context: EntitlementContext): boolean {
  if (context.flags["vip.enabled"] !== true) return false;
  return isSubscriptionGranting(context.subscription, context.now);
}

/**
 * Foydalanuvchiga ko'rsatiladigan rad etish matni.
 *
 * Flag o'chiqligi va obuna yo'qligi BIR XIL matn beradi: "hali
 * yoqilmagan" degan xabar foydalanuvchi uchun ma'nosiz va ichki
 * chiqarish holatini oshkor qiladi.
 */
export function denialText(reason: DenialReason): string {
  switch (reason) {
    case "vip_disabled":
    case "feature_disabled":
      return "Bu imkoniyat hozir mavjud emas.";
    case "no_subscription":
    case "not_in_plan":
      return "Bu imkoniyat Liderlar VIP obunasi bilan ochiladi.";
    case "subscription_inactive":
      return "VIP obunangiz muddati tugagan. Yangilash orqali davom eting.";
  }
}
