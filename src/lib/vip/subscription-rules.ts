/**
 * VIP OBUNA — HOLAT MASHINASI. SOF MODUL.
 *
 * Bu faylda BAZAGA MUROJAAT YO'Q va hech narsa import qilinmaydi:
 * testlar `@/` taxallusini yecha olmaydi, bitta shunday import butun
 * test faylini ishga tushmas qilardi.
 *
 * NEGA ALOHIDA MODUL: obuna muddati pul bilan bog'liq. "Uzaytirish
 * qaysi sanadan hisoblanadi" degan savolning xato javobi odamga
 * to'lagan kunini bermaydi yoki tekin kun beradi. Bunday mantiq
 * testdan o'tishi kerak, server amali ichida ko'milib qolmasligi.
 *
 * I/O qismi — `subscription-service.ts`.
 */

/* ========================================================================= *
 * HOLATLAR
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
 * TUGALLANGAN holatlar — bu yerdan o'z-o'zidan chiqib ketilmaydi.
 *
 * `expired` va `cancelled` dan chiqish faqat `restore` bilan, ya'ni
 * ongli admin amali orqali. Shu sababli bitta profilda bunday obuna
 * necha bo'lsa ham bo'ladi (bazadagi `uq_vip_subscription_open` ularni
 * hisobga olmaydi).
 */
const TERMINAL: ReadonlySet<SubscriptionState> = new Set(["expired", "cancelled"]);

export function isTerminal(state: SubscriptionState): boolean {
  return TERMINAL.has(state);
}

/* ========================================================================= *
 * HODISALAR
 * ========================================================================= */

export const SUBSCRIPTION_EVENTS = [
  "created",
  "activated",
  "extended",
  "grace_started",
  "expired",
  "cancelled",
  "suspended",
  "restored",
  "plan_changed",
] as const;

export type SubscriptionEvent = (typeof SUBSCRIPTION_EVENTS)[number];

/** Admin bajaradigan amallar (fon vazifasi emas). */
export type AdminAction = "activate" | "extend" | "suspend" | "cancel" | "restore";

/**
 * Qaysi amal qaysi holatdan mumkin.
 *
 * Ro'yxat ATAYLAB tor. Masalan `activate` faqat `pending` va
 * `suspended` dan: allaqachon `active` obunani qayta faollashtirish
 * muddatni jimgina qayta hisoblab, odamga to'lagan kunini
 * yo'qotishi mumkin edi — buning uchun `extend` bor.
 */
const ALLOWED_FROM: Readonly<Record<AdminAction, readonly SubscriptionState[]>> = {
  activate: ["pending", "suspended"],
  extend: ["active", "grace_period"],
  suspend: ["active", "grace_period", "pending"],
  cancel: ["pending", "active", "grace_period", "suspended"],
  restore: ["suspended", "cancelled", "expired"],
};

export function canApply(action: AdminAction, from: SubscriptionState): boolean {
  return ALLOWED_FROM[action].includes(from);
}

/* ========================================================================= *
 * OBUNA SURATI
 * ========================================================================= */

export interface SubscriptionTimes {
  startedAt: Date | null;
  /** `null` — muddatsiz. */
  currentPeriodEnd: Date | null;
  graceUntil: Date | null;
}

export interface PlanTerms {
  /** `null` — muddatsiz tarif. */
  durationDays: number | null;
  graceDays: number;
}

export interface TransitionResult {
  state: SubscriptionState;
  event: SubscriptionEvent;
  times: SubscriptionTimes;
}

export type TransitionOutcome =
  | { ok: true; result: TransitionResult }
  | { ok: false; error: string };

const DAY_MS = 86_400_000;

function addDays(from: Date, days: number): Date {
  return new Date(from.getTime() + days * DAY_MS);
}

/**
 * Imtiyoz tugash sanasi.
 *
 * `graceDays === 0` bo'lsa `null` qaytaradi — "imtiyoz davr tugashi
 * bilan bir xil" degan qiymat yozish uni bor ko'rsatib qo'yardi va
 * bazadagi `vip_grace_after_period` sharti ham chalkashardi.
 */
function graceEnd(periodEnd: Date | null, graceDays: number): Date | null {
  if (periodEnd === null || graceDays <= 0) return null;
  return addDays(periodEnd, graceDays);
}

/* ========================================================================= *
 * AMALLAR
 * ========================================================================= */

/**
 * FAOLLASHTIRISH.
 *
 * Muddat `now` dan boshlanadi, obuna yaratilgan sanadan emas: odam
 * to'lovni kech qilgan bo'lsa, kutgan kunlari uning hisobidan
 * ketmasligi kerak.
 */
export function activate(
  from: SubscriptionState,
  plan: PlanTerms,
  now: Date,
): TransitionOutcome {
  if (!canApply("activate", from)) {
    return { ok: false, error: `'${from}' holatidan faollashtirib bo'lmaydi.` };
  }

  const periodEnd = plan.durationDays === null ? null : addDays(now, plan.durationDays);

  return {
    ok: true,
    result: {
      state: "active",
      event: "activated",
      times: {
        startedAt: now,
        currentPeriodEnd: periodEnd,
        graceUntil: graceEnd(periodEnd, plan.graceDays),
      },
    },
  };
}

/**
 * UZAYTIRISH.
 *
 * ENG NOZIK QOIDA: yangi muddat qaysi sanadan hisoblanadi.
 *
 *   - Joriy muddat HALI TUGAMAGAN bo'lsa — uning oxiridan.
 *     Aks holda odam qolgan kunlarini yo'qotardi.
 *   - Allaqachon O'TGAN bo'lsa (imtiyoz ichida) — `now` dan.
 *     Aks holda o'tmishdagi sanaga kun qo'shilib, uzaytirish
 *     qisqa yoki butunlay foydasiz chiqardi.
 */
export function extend(
  from: SubscriptionState,
  times: SubscriptionTimes,
  days: number,
  now: Date,
  graceDays: number,
): TransitionOutcome {
  if (!canApply("extend", from)) {
    return { ok: false, error: `'${from}' holatidagi obunani uzaytirib bo'lmaydi.` };
  }
  if (!Number.isInteger(days) || days <= 0) {
    return { ok: false, error: "Uzaytirish kunlari musbat butun son bo'lsin." };
  }

  /*
   * MUDDATSIZ OBUNANI UZAYTIRISH — XATO, JIMGINA O'TKAZISH EMAS.
   *
   * `null` ga kun qo'shish uni muddatli qilib qo'yardi, ya'ni
   * uzaytirish obunani QISQARTIRARDI.
   */
  if (times.currentPeriodEnd === null) {
    return { ok: false, error: "Muddatsiz obunani uzaytirish kerak emas." };
  }

  const base =
    times.currentPeriodEnd.getTime() > now.getTime() ? times.currentPeriodEnd : now;
  const periodEnd = addDays(base, days);

  return {
    ok: true,
    result: {
      state: "active",
      event: "extended",
      times: {
        // Boshlanish sanasi O'ZGARMAYDI: u obuna tarixi.
        startedAt: times.startedAt,
        currentPeriodEnd: periodEnd,
        graceUntil: graceEnd(periodEnd, graceDays),
      },
    },
  };
}

/**
 * ANIQ SANAGACHA UZAYTIRISH (admin taqvimdan sana tanlaydi).
 *
 * Faqat UZAYTIRADI: yangi sana joriy tugashdan keyin bo'lishi shart.
 * Qisqartirish "uzaytirish" tugmasi ortida yashirinmasin — u VIPni
 * o'chirib, qayta berish bilan ochiq qilinadi va jurnalda shunday
 * ko'rinadi.
 */
export function extendTo(
  from: SubscriptionState,
  times: SubscriptionTimes,
  newEnd: Date,
  now: Date,
): TransitionOutcome {
  if (!canApply("extend", from)) {
    return { ok: false, error: `'${from}' holatidagi obunani uzaytirib bo'lmaydi.` };
  }
  if (!Number.isFinite(newEnd.getTime())) {
    return { ok: false, error: "Tugash sanasi noto'g'ri." };
  }
  if (times.currentPeriodEnd === null) {
    return { ok: false, error: "Muddatsiz obunani uzaytirish kerak emas." };
  }
  if (newEnd.getTime() <= now.getTime()) {
    return { ok: false, error: "Yangi tugash sanasi kelajakda bo'lishi kerak." };
  }
  if (newEnd.getTime() <= times.currentPeriodEnd.getTime()) {
    return { ok: false, error: "Yangi sana joriy tugash sanasidan keyin bo'lishi kerak." };
  }

  return {
    ok: true,
    result: {
      state: "active",
      event: "extended",
      // Imtiyoz yo'q: kirish aynan tugash sanasida yopiladi.
      times: { startedAt: times.startedAt, currentPeriodEnd: newEnd, graceUntil: null },
    },
  };
}

/* ========================================================================= *
 * ADMIN KO'RADIGAN HOLAT
 * ========================================================================= */

/**
 * Admin panelidagi uch holat (+ ikki yordamchi).
 *
 *   active   — FAOL: huquq beryapti;
 *   expired  — TUGAGAN: muddat o'tgan (fon vazifasi holatni hali
 *              yangilamagan bo'lsa ham — sana hal qiladi);
 *   disabled — O'CHIRILGAN: admin bekor qilgan yoki to'xtatgan;
 *   pending  — yaratilgan, hali yoqilmagan;
 *   none     — hech qachon VIP bo'lmagan.
 */
export type VipDisplayStatus = "active" | "expired" | "disabled" | "pending" | "none";

export interface VipDisplay {
  status: VipDisplayStatus;
  /** Faqat `active` uchun; `null` — muddatsiz. */
  daysLeft: number | null;
}

/**
 * HUQUQ TEKSHIRUVI BILAN BIR XIL QOIDA: holat VA sana
 * (`entitlements.ts` dagi `isSubscriptionGranting`). Ekran "FAOL"
 * desa-yu, sayt eshikni yopsa, admin noto'g'ri ma'lumot bilan
 * ishlardi.
 */
export function vipDisplay(
  subscription: { state: SubscriptionState; times: SubscriptionTimes } | null,
  now: Date,
): VipDisplay {
  if (!subscription) return { status: "none", daysLeft: null };

  const { state, times } = subscription;
  if (state === "cancelled" || state === "suspended") return { status: "disabled", daysLeft: null };
  if (state === "pending") return { status: "pending", daysLeft: null };
  if (state === "expired") return { status: "expired", daysLeft: null };

  if (times.currentPeriodEnd === null) return { status: "active", daysLeft: null };

  const until = times.graceUntil ?? times.currentPeriodEnd;
  if (now.getTime() > until.getTime()) return { status: "expired", daysLeft: null };

  return {
    status: "active",
    // Yuqoriga yaxlitlanadi: oxirgi kunning yarmi ham "1 kun qoldi".
    daysLeft: Math.max(0, Math.ceil((until.getTime() - now.getTime()) / DAY_MS)),
  };
}

/**
 * TO'XTATIB QO'YISH.
 *
 * Sanalar SAQLANADI. To'xtatish — jazo choralari emas, tekshiruv
 * holati; qayta tiklanganda odam qolgan kunlarini olishi kerak.
 */
export function suspend(
  from: SubscriptionState,
  times: SubscriptionTimes,
): TransitionOutcome {
  if (!canApply("suspend", from)) {
    return { ok: false, error: `'${from}' holatidagi obunani to'xtatib bo'lmaydi.` };
  }
  return {
    ok: true,
    result: { state: "suspended", event: "suspended", times },
  };
}

/**
 * BEKOR QILISH.
 *
 * Sanalar ham saqlanadi: "qachongacha to'lagan edi" degan savol
 * bekor qilingandan keyin ham javobsiz qolmasligi kerak.
 */
export function cancel(
  from: SubscriptionState,
  times: SubscriptionTimes,
): TransitionOutcome {
  if (!canApply("cancel", from)) {
    return { ok: false, error: `'${from}' holatidagi obunani bekor qilib bo'lmaydi.` };
  }
  return {
    ok: true,
    result: { state: "cancelled", event: "cancelled", times },
  };
}

/**
 * QAYTA TIKLASH.
 *
 * Tiklangan obuna MUDDATIGA qarab holat oladi:
 *   - muddati hali bor         -> active
 *   - imtiyoz ichida           -> grace_period
 *   - butunlay o'tgan          -> xato (uzaytirish kerak)
 *
 * Shuning uchun tiklash muddatni O'ZIDAN uzaytirmaydi: tekin kun
 * berish tijoriy qaror va u admin tomonidan ongli `extend` bilan
 * qilinishi kerak.
 */
export function restore(
  from: SubscriptionState,
  times: SubscriptionTimes,
  now: Date,
): TransitionOutcome {
  if (!canApply("restore", from)) {
    return { ok: false, error: `'${from}' holatidagi obunani tiklab bo'lmaydi.` };
  }

  if (times.currentPeriodEnd === null) {
    return {
      ok: true,
      result: { state: "active", event: "restored", times },
    };
  }

  if (now.getTime() <= times.currentPeriodEnd.getTime()) {
    return {
      ok: true,
      result: { state: "active", event: "restored", times },
    };
  }

  if (times.graceUntil && now.getTime() <= times.graceUntil.getTime()) {
    return {
      ok: true,
      result: { state: "grace_period", event: "restored", times },
    };
  }

  return {
    ok: false,
    error: "Obuna muddati butunlay tugagan. Avval uzaytirish kerak.",
  };
}

/* ========================================================================= *
 * FON VAZIFASI — MUDDATNI YOPISH
 * ========================================================================= */

/**
 * Muddati kelgan obunaning keyingi holati.
 *
 * `null` — o'zgarish kerak emas. Bu IDEMPOTENT (§73): bir xil `now`
 * bilan ikki marta chaqirilsa, ikkinchisi `null` qaytaradi va
 * qo'shimcha yozuv tushmaydi.
 *
 * `suspended` BU YERDA TEGILMAYDI: uni admin qo'ygan va fon vazifasi
 * admin qarorini bosib ketmasligi kerak.
 */
export function dueTransition(
  state: SubscriptionState,
  times: SubscriptionTimes,
  now: Date,
): TransitionResult | null {
  if (state !== "active" && state !== "grace_period") return null;
  if (times.currentPeriodEnd === null) return null;

  const periodOver = now.getTime() > times.currentPeriodEnd.getTime();
  if (!periodOver) return null;

  const graceOver =
    times.graceUntil === null || now.getTime() > times.graceUntil.getTime();

  if (!graceOver) {
    // Imtiyoz hali bor — faqat `active` dan o'tish mantiqli.
    if (state === "grace_period") return null;
    return { state: "grace_period", event: "grace_started", times };
  }

  return { state: "expired", event: "expired", times };
}

/* ========================================================================= *
 * SABAB
 * ========================================================================= */

/**
 * Admin amallari uchun sabab MAJBURIY (§37).
 *
 * Bazada majburiy qilinmagan, chunki fon vazifasi yozadigan
 * 'expired' uchun sabab ma'nosiz. Shu sababli qoida shu yerda:
 * ODAM qilgan amal sababsiz qolmaydi.
 */
export function checkReason(reason: string | null | undefined): string | null {
  const value = (reason ?? "").trim();
  if (value.length < 3) return "Sababni yozing (kamida 3 belgi).";
  if (value.length > 500) return "Sabab 500 belgidan oshmasin.";
  return null;
}
