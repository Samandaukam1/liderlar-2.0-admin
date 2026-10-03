import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { randomUUID } from "node:crypto";
import { recordAudit } from "./audit-log";
import { grantVipDays } from "./grant-service";
import type { AuditEventKey } from "./audit-events";
import {
  activate,
  cancel,
  checkReason,
  dueTransition,
  extend,
  extendTo,
  restore,
  suspend,
  vipDisplay,
  type AdminAction,
  type PlanTerms,
  type SubscriptionEvent,
  type SubscriptionState,
  type SubscriptionTimes,
  type TransitionOutcome,
} from "./subscription-rules";

/**
 * VIP OBUNA — ADMIN AMALLARI.
 *
 * Qoidalar `subscription-rules.ts` da va ular testlangan. Bu yerda
 * faqat: holatni o'qish, qoidani chaqirish, natijani RPC orqali
 * saqlash.
 *
 * SAQLASH RPC ORQALI: holat o'zgarishi va audit yozuvi bitta
 * tranzaksiyada tushishi kerak (§37). Ikki alohida `update`/`insert`
 * bo'lsa, ikkinchisi yiqilganda imtiyozli o'zgarish auditsiz qolardi.
 */

export interface SubscriptionRow {
  id: string;
  profileId: string;
  planCode: string;
  state: SubscriptionState;
  times: SubscriptionTimes;
  /**
   * Qator versiyasi — bazadagi `updated_at` ning XOM matni.
   *
   * `Date` ga aylantirilmaydi: Postgres mikrosekund saqlaydi, JS esa
   * millisekundgacha qirqadi va qirqilgan qiymat `vip_apply_transition`
   * dagi tenglik tekshiruvidan hech qachon o'tmasdi.
   */
  version: string;
}

/**
 * Obuna hodisasi -> audit hodisasi.
 *
 * NOMLAR QO'LDA YOZILGAN, `"vip.subscription." + event` bilan
 * yasalmagan: test koddagi har bir audit nomini katalogdan qidiradi
 * va yig'ilgan qatorni ko'ra olmaydi. `plan_changed` hozircha hech
 * qayerda sodir bo'lmaydi — u paydo bo'lsa, shu yerga qo'shiladi.
 */
const SUBSCRIPTION_AUDIT: Readonly<Partial<Record<SubscriptionEvent, AuditEventKey>>> = {
  created: "vip.subscription.created",
  activated: "vip.subscription.activated",
  extended: "vip.subscription.extended",
  suspended: "vip.subscription.suspended",
  cancelled: "vip.subscription.cancelled",
  restored: "vip.subscription.restored",
  grace_started: "vip.subscription.grace_started",
  expired: "vip.subscription.expired",
};

/**
 * Bazaning "holat o'zgargan" javobi.
 *
 * `PT409` — `vip_apply_transition` dagi optimistik tekshiruv (HTTP 409).
 * `40001` eski funksiya uchun qoldirilgan: migratsiya kod deploy'idan
 * keyin qo'llansa ham xabar to'g'ri chiqsin.
 */
export function isTransitionConflict(error: { code?: string; message?: string }): boolean {
  return (
    error.code === "PT409" ||
    error.code === "40001" ||
    /holati o'zgargan/.test(error.message ?? "")
  );
}

export type ActionResult =
  | { ok: true; state: SubscriptionState }
  | { ok: false; error: string };

function toDate(value: unknown): Date | null {
  return value ? new Date(value as string) : null;
}

/* ========================================================================= *
 * O'QISH
 * ========================================================================= */

async function loadOpenSubscription(
  profileId: string,
): Promise<{ ok: true; row: SubscriptionRow | null } | { ok: false }> {
  const admin = createSupabaseAdminClient();

  const { data, error } = await admin
    .from("vip_subscriptions")
    .select("id, profile_id, plan_code, state, started_at, current_period_end, grace_until, updated_at")
    /*
     * Faqat tugallanmagan obuna. Bazada bunday obuna bittadan ko'p
     * bo'lishi mumkin emas (`uq_vip_subscription_open`), ya'ni
     * "qaysi birini olish" muammosi yo'q.
     */
    .in("state", ["pending", "active", "grace_period", "suspended"])
    .eq("profile_id", profileId)
    .maybeSingle();

  if (error) {
    /*
     * O'QISH XATOSI "OBUNA YO'Q" EMAS.
     *
     * Avval ikkalasi ham `null` qaytarardi va admin baza uzilganda
     * "Bu foydalanuvchida faol obuna yo'q" degan yolg'on xabarni
     * ko'rardi — keyin yangi obuna yaratishga urinardi.
     */
    console.error("[vip] obuna o'qilmadi:", error.message);
    return { ok: false };
  }
  if (!data) return { ok: true, row: null };

  return {
    ok: true,
    row: {
      id: data.id as string,
      profileId: data.profile_id as string,
      planCode: data.plan_code as string,
      state: data.state as SubscriptionState,
      times: {
        startedAt: toDate(data.started_at),
        currentPeriodEnd: toDate(data.current_period_end),
        graceUntil: toDate(data.grace_until),
      },
      version: data.updated_at as string,
    },
  };
}

async function loadPlanTerms(planCode: string): Promise<PlanTerms | null> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("vip_plans")
    .select("duration_days, grace_days")
    .eq("code", planCode)
    .maybeSingle();

  if (error || !data) {
    console.error("[vip] tarif o'qilmadi:", error?.message);
    return null;
  }
  return {
    durationDays: (data.duration_days as number | null) ?? null,
    graceDays: (data.grace_days as number) ?? 0,
  };
}

/* ========================================================================= *
 * SAQLASH
 * ========================================================================= */

async function persist(
  subscription: SubscriptionRow,
  outcome: TransitionOutcome,
  reason: string,
  actorId: string,
  extra: { days?: number } = {},
): Promise<ActionResult> {
  if (!outcome.ok) return { ok: false, error: outcome.error };

  const { state, event, times } = outcome.result;
  const admin = createSupabaseAdminClient();

  const { error } = await admin.rpc("vip_apply_transition", {
    p_subscription_id: subscription.id,
    // Poyga tekshiruvi: boshqa admin holatni o'zgartirgan bo'lsa, rad etiladi.
    p_expected_state: subscription.state,
    p_new_state: state,
    p_event: event,
    p_started_at: times.startedAt?.toISOString() ?? null,
    p_current_period_end: times.currentPeriodEnd?.toISOString() ?? null,
    p_grace_until: times.graceUntil?.toISOString() ?? null,
    p_reason: reason,
    p_actor_id: actorId,
    /*
     * VERSIYA SHARTI: holat bir xil qolib, sanalar o'zgargan bo'lishi
     * mumkin (boshqa admin uzaytirgan). Unda bu amal eski sanalardan
     * hisoblangan va yozilsa, o'sha uzaytirishni o'chirib yuborardi.
     */
    p_expected_updated_at: subscription.version,
  });

  if (error) {
    /*
     * POYGA XATOSINI AJRATIB AYTAMIZ.
     *
     * "Qayta urinib ko'ring" degan xabar bu holatda to'g'ri va
     * foydali: admin ekranni yangilasa, boshqa adminning qarorini
     * ko'radi. Qolgan xatolar uchun texnik tafsilot logda qoladi
     * (§55).
     */
    if (isTransitionConflict(error)) {
      return {
        ok: false,
        error: "Obuna holati boshqa joyda o'zgargan. Sahifani yangilab, qaytadan ko'ring.",
      };
    }
    console.error("[vip] o'tish saqlanmadi:", error.message);
    return { ok: false, error: "O'zgarishni saqlab bo'lmadi." };
  }

  const auditEvent = SUBSCRIPTION_AUDIT[event];
  if (auditEvent) {
    await recordAudit(auditEvent, {
      actorId,
      entityId: subscription.id,
      reason,
      before: {
        state: subscription.state,
        current_period_end: subscription.times.currentPeriodEnd?.toISOString() ?? null,
        grace_until: subscription.times.graceUntil?.toISOString() ?? null,
      },
      after: {
        state,
        current_period_end: times.currentPeriodEnd?.toISOString() ?? null,
        grace_until: times.graceUntil?.toISOString() ?? null,
      },
      metadata: {
        profile_id: subscription.profileId,
        plan: subscription.planCode,
        ...(extra.days !== undefined ? { days: extra.days } : {}),
      },
    });
  }

  return { ok: true, state };
}

/* ========================================================================= *
 * AMALLAR
 * ========================================================================= */

export interface AdminActionInput {
  profileId: string;
  actorId: string;
  reason: string;
  /** Faqat `extend` uchun. */
  days?: number;
}

/**
 * Obuna yaratadi (hali faollashtirmaydi).
 *
 * `pending` holatda yaratish ataylab: to'lov tasdiqlanmaguncha huquq
 * berilmaydi, lekin obuna allaqachon ko'rinib turadi va admin uni
 * kuzatishi mumkin.
 */
export async function createSubscription(
  profileId: string,
  planCode: string,
  actorId: string,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const admin = createSupabaseAdminClient();

  /*
   * OBUNA VA UNING `created` YOZUVI — BITTA TRANZAKSIYADA.
   *
   * Avval ikki alohida so'rov edi va ikkinchisining xatosi
   * tekshirilmasdi: tarix yozuvi tushmasa, obuna "qachon va kim
   * yaratgan" degan savolga javobsiz qolardi (§37).
   */
  const { data, error } = await admin
    .rpc("vip_create_subscription", {
      p_profile_id: profileId,
      p_plan_code: planCode,
      p_actor_id: actorId,
    })
    .single();

  if (error || !data) {
    /*
     * 23505 — `uq_vip_subscription_open` buzilgani, ya'ni bu odamda
     * allaqachon tugallanmagan obuna bor. Bu xato emas, holat.
     */
    if (error?.code === "23505") {
      return { ok: false, error: "Bu foydalanuvchida allaqachon faol obuna bor." };
    }
    console.error("[vip] obuna yaratilmadi:", error?.message);
    return { ok: false, error: "Obunani yaratib bo'lmadi." };
  }

  const id = (data as { id: string }).id;

  await recordAudit("vip.subscription.created", {
    actorId,
    entityId: id,
    after: { state: "pending" },
    metadata: { profile_id: profileId, plan: planCode },
  });

  return { ok: true, id };
}

/**
 * Admin amalini bajaradi.
 *
 * Bitta kirish nuqtasi: har amal uchun alohida funksiya bo'lsa,
 * sabab tekshiruvi yoki audit biror joyda esdan chiqib ketardi.
 */
export async function applyAdminAction(
  action: AdminAction,
  input: AdminActionInput,
): Promise<ActionResult> {
  /*
   * SABAB — ENG AVVAL.
   *
   * Bazaga tegishdan oldin tekshiriladi: sababsiz amal hech qanday
   * o'zgarish qoldirmasligi kerak.
   */
  const reasonProblem = checkReason(input.reason);
  if (reasonProblem) return { ok: false, error: reasonProblem };

  const loaded = await loadOpenSubscription(input.profileId);
  if (!loaded.ok) {
    return { ok: false, error: "Obunani o'qib bo'lmadi. Birozdan keyin qaytadan urinib ko'ring." };
  }
  const subscription = loaded.row;
  if (!subscription) {
    return { ok: false, error: "Bu foydalanuvchida faol obuna yo'q." };
  }

  const plan = await loadPlanTerms(subscription.planCode);
  if (!plan) return { ok: false, error: "Tarif ma'lumotini o'qib bo'lmadi." };

  const now = new Date();
  let outcome: TransitionOutcome;

  switch (action) {
    case "activate":
      outcome = activate(subscription.state, plan, now);
      break;
    case "extend": {
      if (input.days === undefined) {
        return { ok: false, error: "Uzaytirish kunlarini kiriting." };
      }
      // Qoida (holat, kun soni) shu yerda tekshiriladi, YOZISH esa yagona xizmatda.
      const check = extend(subscription.state, subscription.times, input.days, now, plan.graceDays);
      if (!check.ok) return { ok: false, error: check.error };

      /*
       * YAGONA VIP XIZMATI (`vip_grant_days`): admin uzaytirishi ham
       * challenge va referal mukofotlari bilan bir xil yo'ldan o'tadi —
       * ular bir-birining muddatini bosib ketmaydi va "VIP tarixi"da
       * manbasi bilan ko'rinadi.
       */
      const granted = await grantVipDays({
        profileId: input.profileId,
        days: input.days,
        source: "admin",
        sourceId: subscription.id,
        idempotencyKey: `admin-extend:${randomUUID()}`,
        actorId: input.actorId,
        reason: input.reason,
      });
      return granted.ok
        ? { ok: true, state: "active" }
        : { ok: false, error: "Uzaytirishni saqlab bo'lmadi." };
    }
    case "suspend":
      outcome = suspend(subscription.state, subscription.times);
      break;
    case "cancel":
      outcome = cancel(subscription.state, subscription.times);
      break;
    case "restore":
      outcome = restore(subscription.state, subscription.times, now);
      break;
  }

  return persist(subscription, outcome, input.reason, input.actorId, { days: input.days });
}

/* ========================================================================= *
 * ADMIN QO'LDA BOSHQARADI — "Foydalanuvchi akkauntlari" bo'limi
 * ========================================================================= */

/** Yagona tarif. `vip_plans` da boshqasi paydo bo'lsa, formaga tanlov qo'shiladi. */
export const DEFAULT_VIP_PLAN = "LIDERLAR_VIP";

/**
 * VIP beradi: admin bergan boshlanish va tugash sanasi bilan, darhol FAOL.
 *
 * MAVJUD OBUNA HOLATIGA QARAB:
 *   · yo'q yoki tugallangan  -> yangi obuna (`vip_admin_grant`, bitta tranzaksiya);
 *   · kutilmoqda/to'xtatilgan -> o'sha obuna yangi sanalar bilan yoqiladi;
 *   · faol                    -> rad etiladi: buning uchun "Uzaytirish" bor,
 *                                aks holda qolgan kunlar jimgina qayta yozilardi;
 *   · faol, lekin muddati o'tgan (fon vazifasi hali yopmagan) -> avval
 *     `expired` qilinadi, keyin yangisi beriladi — tarix to'g'ri qoladi.
 */
export async function grantVip(input: {
  profileId: string;
  startedAt: Date;
  periodEnd: Date;
  days: number;
  reason: string;
  actorId: string;
}): Promise<ActionResult> {
  const reasonProblem = checkReason(input.reason);
  if (reasonProblem) return { ok: false, error: reasonProblem };

  const loaded = await loadOpenSubscription(input.profileId);
  if (!loaded.ok) {
    return { ok: false, error: "Obunani o'qib bo'lmadi. Birozdan keyin qaytadan urinib ko'ring." };
  }

  const now = new Date();
  const open = loaded.row;
  const granted = { startedAt: input.startedAt, currentPeriodEnd: input.periodEnd, graceUntil: null };

  if (open) {
    const display = vipDisplay(open, now);

    if (display.status === "active") {
      return { ok: false, error: "VIP allaqachon faol. Muddatini «Uzaytirish» orqali o'zgartiring." };
    }

    if (open.state === "pending" || open.state === "suspended") {
      return persist(
        open,
        { ok: true, result: { state: "active", event: "activated", times: granted } },
        input.reason,
        input.actorId,
        { days: input.days },
      );
    }

    // Faol holatda qolgan, lekin muddati o'tgan obuna — avval yopiladi.
    const due = dueTransition(open.state, open.times, now);
    if (due) {
      const closed = await persist(open, { ok: true, result: due }, "Muddat tugagan — qayta berishdan oldin yopildi.", input.actorId);
      if (!closed.ok) return closed;
    }
  }

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .rpc("vip_admin_grant", {
      p_profile_id: input.profileId,
      p_plan_code: DEFAULT_VIP_PLAN,
      p_started_at: input.startedAt.toISOString(),
      p_period_end: input.periodEnd.toISOString(),
      p_reason: input.reason,
      p_actor_id: input.actorId,
    })
    .single();

  if (error || !data) {
    if (error?.code === "23505") {
      return { ok: false, error: "Bu foydalanuvchida allaqachon ochiq obuna bor. Sahifani yangilang." };
    }
    if (error?.code === "22023") {
      return { ok: false, error: error.message };
    }
    console.error("[vip] VIP berilmadi:", error?.message);
    return { ok: false, error: "VIP berib bo'lmadi." };
  }

  /*
   * KIM, QACHON, QANCHA MUDDATGA — bitta yozuvda.
   */
  await recordAudit("vip.subscription.activated", {
    actorId: input.actorId,
    entityId: (data as { id: string }).id,
    reason: input.reason,
    before: { state: open?.state ?? null },
    after: {
      state: "active",
      started_at: input.startedAt.toISOString(),
      current_period_end: input.periodEnd.toISOString(),
    },
    metadata: { profile_id: input.profileId, plan: DEFAULT_VIP_PLAN, days: input.days },
  });

  return { ok: true, state: "active" };
}

/**
 * Aniq sanagacha uzaytiradi (taqvimdan tanlangan kun oxirigacha).
 *
 * N kunga uzaytirish — `applyAdminAction("extend")` (mavjud qoida).
 */
export async function extendVipTo(input: {
  profileId: string;
  newEnd: Date;
  reason: string;
  actorId: string;
}): Promise<ActionResult> {
  const reasonProblem = checkReason(input.reason);
  if (reasonProblem) return { ok: false, error: reasonProblem };

  const loaded = await loadOpenSubscription(input.profileId);
  if (!loaded.ok) {
    return { ok: false, error: "Obunani o'qib bo'lmadi. Birozdan keyin qaytadan urinib ko'ring." };
  }
  if (!loaded.row) return { ok: false, error: "Bu foydalanuvchida faol VIP yo'q." };

  const now = new Date();
  const outcome = extendTo(loaded.row.state, loaded.row.times, input.newEnd, now);
  const days =
    loaded.row.times.currentPeriodEnd === null
      ? undefined
      : Math.ceil((input.newEnd.getTime() - Math.max(loaded.row.times.currentPeriodEnd.getTime(), now.getTime())) / 86_400_000);

  return persist(loaded.row, outcome, input.reason, input.actorId, { days });
}

/* ========================================================================= *
 * FON VAZIFASI — MUDDATNI YOPISH
 * ========================================================================= */

export interface ExpirySweepResult {
  checked: number;
  graceStarted: number;
  expired: number;
  /**
   * O'qish va yozish orasida admin o'zgartirgan obunalar.
   *
   * Bu XATO EMAS: vazifa adminning qarorini bosib ketmadi. Obuna
   * hamon muddati o'tgan bo'lsa, keyingi yurishda qayta ko'riladi.
   */
  skipped: number;
  failed: number;
}

/**
 * Muddati kelgan obunalarni yopadi (§73).
 *
 * IDEMPOTENT: qoida bir xil `now` uchun ikkinchi marta `null`
 * qaytaradi, ya'ni vazifa qayta ishga tushsa qo'shimcha yozuv
 * tushmaydi.
 *
 * `actorId` YO'Q — bu odam amali emas. Audit yozuvida `actor_id`
 * `null` bo'ladi va bu "fon vazifasi" degani.
 */
export async function sweepExpiredSubscriptions(limit = 200): Promise<ExpirySweepResult> {
  const admin = createSupabaseAdminClient();
  const now = new Date();

  const { data, error } = await admin
    .from("vip_subscriptions")
    .select("id, profile_id, plan_code, state, started_at, current_period_end, grace_until, updated_at")
    .in("state", ["active", "grace_period"])
    // Faqat muddati o'tganlar — indeks aynan shu so'rov uchun.
    .lt("current_period_end", now.toISOString())
    .order("current_period_end", { ascending: true })
    .limit(limit);

  if (error) {
    console.error("[vip] muddat yig'uvi o'qilmadi:", error.message);
    return { checked: 0, graceStarted: 0, expired: 0, skipped: 0, failed: 0 };
  }

  const result: ExpirySweepResult = {
    checked: (data ?? []).length,
    graceStarted: 0,
    expired: 0,
    skipped: 0,
    failed: 0,
  };

  for (const row of data ?? []) {
    const times: SubscriptionTimes = {
      startedAt: toDate(row.started_at),
      currentPeriodEnd: toDate(row.current_period_end),
      graceUntil: toDate(row.grace_until),
    };
    const state = row.state as SubscriptionState;

    const next = dueTransition(state, times, now);
    if (!next) continue;

    const { error: rpcError } = await admin.rpc("vip_apply_transition", {
      p_subscription_id: row.id,
      p_expected_state: state,
      p_new_state: next.state,
      p_event: next.event,
      p_started_at: times.startedAt?.toISOString() ?? null,
      p_current_period_end: times.currentPeriodEnd?.toISOString() ?? null,
      p_grace_until: times.graceUntil?.toISOString() ?? null,
      p_reason: null,
      p_actor_id: null,
      /*
       * VERSIYA SHARTI — fon vazifasining asosiy poyga himoyasi.
       *
       * Vazifa qatorni o'qigach, admin obunani uzaytirishi mumkin
       * (holat `active` qoladi). Shartsiz yozuv ESKI sanalarni qaytarib,
       * uzaytirishni jimgina yo'q qilardi.
       */
      p_expected_updated_at: row.updated_at as string,
    });

    if (rpcError && isTransitionConflict(rpcError)) {
      result.skipped += 1;
      continue;
    }

    if (rpcError) {
      /*
       * Bitta obuna yiqilsa, QOLGANLARI DAVOM ETADI.
       *
       * Aks holda bitta nosoz qator butun yig'uvni to'xtatib, barcha
       * muddati o'tgan obunalar ochiq qolardi.
       */
      console.error("[vip] obuna yopilmadi:", { id: row.id, message: rpcError.message });
      result.failed += 1;
      continue;
    }

    if (next.state === "grace_period") result.graceStarted += 1;
    else result.expired += 1;

    /*
     * FON VAZIFASI HAM JURNALGA YOZADI: "obuna qachon va nega
     * yopildi" degan savolga javob shu yerda. `actorId: null` —
     * odam emas.
     */
    const auditEvent = SUBSCRIPTION_AUDIT[next.event];
    if (auditEvent) {
      await recordAudit(auditEvent, {
        actorId: null,
        entityId: row.id as string,
        reason: "Muddat tugadi (fon vazifasi).",
        before: { state },
        after: { state: next.state },
        metadata: { profile_id: row.profile_id as string, plan: row.plan_code as string },
      });
    }
  }

  return result;
}
