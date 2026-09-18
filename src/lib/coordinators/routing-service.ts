import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { getCoordinatorSettings } from "./settings.ts";
import {
  businessDayRange,
  businessDate,
  claimDeadline,
  pickOverflowCoordinator,
  pickRegionalCoordinator,
  type EligibleCoordinator,
} from "./routing-rules.ts";

/**
 * LID MARSHRUTLASH — server tomoni.
 *
 * QARORLAR SOF MODULDA (`routing-rules.ts`); bu yerda faqat baza,
 * bildirishnoma va audit.
 *
 * MANBA — CRM, TELEGRAM EMAS. Bot faqat ko'rsatadi va tugmani
 * uzatadi; kim nimani oldi degan haqiqat bazada.
 */

/* --------------------------- nomzodlar ro'yxati -------------------------- */

/**
 * Bugungi yuk bilan birga koordinatorlar.
 *
 * Yuk HOZIRGI kun bo'yicha (Toshkent), chunki adolat kunlik
 * o'lchanadi: kecha ko'p ishlagan odam bugun ham navbatdan
 * chetlatilmasligi kerak.
 */
export async function loadEligibleCoordinators(
  now: Date = new Date(),
): Promise<EligibleCoordinator[]> {
  const db = createSupabaseAdminClient();
  const day = businessDayRange(businessDate(now));

  const { data: coordinators } = await db
    .from("coordinators")
    .select("id, region_id, status, is_active, backup_priority, daily_lead_limit")
    .eq("is_active", true);

  if (!coordinators || coordinators.length === 0) return [];

  const ids = coordinators.map((c) => c.id as string);

  // Bugungi takliflar — marshrutlash tarixidan.
  const { data: offers } = await db
    .from("lead_routing_events")
    .select("coordinator_id")
    .eq("event", "offered")
    .in("coordinator_id", ids)
    .gte("created_at", day.startIso)
    .lt("created_at", day.endIso);

  // Ochiq lidlar — yopilmagan holatlar.
  const { data: open } = await db
    .from("coordinator_leads")
    .select("assigned_coordinator_id")
    .in("assigned_coordinator_id", ids)
    .not("state", "in", "(won,lost,cancelled,payment_confirmed)");

  const { data: sales } = await db
    .from("coordinator_commissions")
    .select("coordinator_id")
    .in("coordinator_id", ids)
    .eq("business_date", businessDate(now))
    .neq("status", "reversed");

  const tally = (rows: { [k: string]: unknown }[] | null, key: string) => {
    const counts = new Map<string, number>();
    for (const row of rows ?? []) {
      const id = row[key] as string | null;
      if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return counts;
  };

  const offeredToday = tally(offers, "coordinator_id");
  const openLeads = tally(open, "assigned_coordinator_id");
  const confirmedToday = tally(sales, "coordinator_id");

  return coordinators.map((c) => ({
    id: c.id as string,
    regionId: (c.region_id as string | null) ?? null,
    status: (c.status as string) ?? "active",
    isActive: c.is_active === true,
    backupPriority: (c.backup_priority as number) ?? 100,
    offeredToday: offeredToday.get(c.id as string) ?? 0,
    openLeads: openLeads.get(c.id as string) ?? 0,
    confirmedToday: confirmedToday.get(c.id as string) ?? 0,
    dailyLeadLimit: (c.daily_lead_limit as number | null) ?? null,
  }));
}

/* ------------------------------ taklif qilish ---------------------------- */

export interface OfferResult {
  ok: boolean;
  coordinatorId: string | null;
  reason: "offered" | "routing_disabled" | "no_coordinator" | "already_assigned" | "error";
}

/**
 * Lidni navbatdagi koordinatorga taklif qiladi.
 *
 * `round === 0` — hududning O'Z koordinatori.
 * `round > 0`  — overflow: eng kam yuklangan mos koordinator.
 *
 * MOS KOORDINATOR BO'LMASA LID YO'QOLMAYDI: u `new` holatida
 * qoladi va keyingi yugurishda qayta uriniladi. Hodisa yozib
 * qo'yiladi, ya'ni "hech kim yo'q" holati ko'rinib turadi.
 */
export async function offerLead(
  leadId: string,
  options: { now?: Date } = {},
): Promise<OfferResult> {
  const now = options.now ?? new Date();
  const settings = await getCoordinatorSettings();
  if (!settings.routingEnabled) {
    return { ok: false, coordinatorId: null, reason: "routing_disabled" };
  }

  const db = createSupabaseAdminClient();
  const { data: lead } = await db
    .from("coordinator_leads")
    .select("id, lead_region_id, state, offer_round, assigned_coordinator_id")
    .eq("id", leadId)
    .maybeSingle();

  if (!lead) return { ok: false, coordinatorId: null, reason: "error" };
  if (lead.assigned_coordinator_id) {
    return { ok: false, coordinatorId: null, reason: "already_assigned" };
  }

  const round = (lead.offer_round as number) ?? 0;
  const pool = await loadEligibleCoordinators(now);

  // Allaqachon taklif qilinganlarga qayta yuborilmaydi.
  const { data: previous } = await db
    .from("lead_routing_events")
    .select("coordinator_id")
    .eq("lead_id", leadId)
    .eq("event", "offered");
  const alreadyOffered = (previous ?? [])
    .map((row) => row.coordinator_id as string | null)
    .filter((id): id is string => id != null);

  const chosen =
    round === 0
      ? pickRegionalCoordinator(pool, (lead.lead_region_id as string | null) ?? null)
      : pickOverflowCoordinator(pool, { excludeIds: alreadyOffered });

  // Hududda koordinator bo'lmasa DARHOL overflow'ga o'tamiz:
  // 10 daqiqa kutish ma'nosiz, kutadigan odam yo'q.
  const fallback =
    chosen ?? pickOverflowCoordinator(pool, { excludeIds: alreadyOffered });

  if (!fallback) {
    await db.from("lead_routing_events").insert({
      lead_id: leadId,
      event: "no_coordinator",
      metadata: { round },
    });
    return { ok: false, coordinatorId: null, reason: "no_coordinator" };
  }

  const deadline = claimDeadline(now, settings.claimWindowMinutes);

  await db
    .from("coordinator_leads")
    .update({
      state: "offered",
      offered_at: now.toISOString(),
      claim_deadline: deadline.toISOString(),
      offer_round: round + 1,
    })
    .eq("id", leadId);

  await db.from("lead_routing_events").insert({
    lead_id: leadId,
    event: round === 0 ? "offered" : "overflow",
    coordinator_id: fallback.id,
    to_state: "offered",
    metadata: {
      round: round + 1,
      deadline: deadline.toISOString(),
      // Overflow ekanini KO'RSATAMIZ: keyin "nega boshqa hudud
      // koordinatori oldi?" degan savol tug'ilmasin.
      overflow: round > 0 || fallback.regionId !== lead.lead_region_id,
    },
  });

  // `overflow` hodisasi ham `offered` sifatida hisoblanishi kerak —
  // yuk hisobida ikkalasi bir xil ma'noga ega.
  if (round > 0) {
    await db.from("lead_routing_events").insert({
      lead_id: leadId,
      event: "offered",
      coordinator_id: fallback.id,
      to_state: "offered",
      metadata: { round: round + 1 },
    });
  }

  return { ok: true, coordinatorId: fallback.id, reason: "offered" };
}

/* ------------------------- muddati o'tganlarni qayta ---------------------- */

export interface ExpirySweepResult {
  expired: number;
  reoffered: number;
  stranded: number;
}

/**
 * Muddati tugagan takliflarni qaytadan yo'naltiradi.
 *
 * LID HECH QACHON YO'QOLMAYDI: koordinator javob bermasa, u
 * boshqasiga o'tadi; hech kim bo'lmasa `new` holatida qolib,
 * keyingi yugurishni kutadi.
 */
export async function runExpirySweep(now: Date = new Date()): Promise<ExpirySweepResult> {
  const settings = await getCoordinatorSettings();
  const result: ExpirySweepResult = { expired: 0, reoffered: 0, stranded: 0 };
  if (!settings.routingEnabled) return result;

  const db = createSupabaseAdminClient();
  const { data: expired } = await db
    .from("coordinator_leads")
    .select("id")
    .eq("state", "offered")
    .is("assigned_coordinator_id", null)
    .lte("claim_deadline", now.toISOString())
    .limit(50);

  for (const row of expired ?? []) {
    const leadId = row.id as string;

    /*
     * MUDDAT TUGADI DEB BELGILASH SHARTLI.
     *
     * Shu daqiqada kimdir band qilib ulgurgan bo'lishi mumkin.
     * Shart UPDATE ning o'zida: band qilingan lid bu yerdan
     * o'tmaydi va ikki jarayon bir lidni ikki marta qaytarmaydi.
     */
    const { data: claimedRows } = await db
      .from("coordinator_leads")
      .update({ state: "new", offered_at: null, claim_deadline: null })
      .eq("id", leadId)
      .eq("state", "offered")
      .is("assigned_coordinator_id", null)
      .select("id");

    if ((claimedRows?.length ?? 0) === 0) continue;

    result.expired += 1;
    await db.from("lead_routing_events").insert({
      lead_id: leadId,
      event: "expired",
      from_state: "offered",
      to_state: "new",
    });

    const offered = await offerLead(leadId, { now });
    if (offered.ok) result.reoffered += 1;
    else result.stranded += 1;
  }

  return result;
}

/* ---------------------------- band qilish -------------------------------- */

export interface ClaimOutcome {
  claimed: boolean;
  reason: string | null;
}

/**
 * Atomik band qilish — baza funksiyasi orqali.
 *
 * Mantiq SQL da, chunki shart UPDATE ning o'zida bo'lishi kerak:
 * ikki koordinator bir vaqtda bosganda faqat bittasi yutadi.
 */
export async function claimLead(
  leadId: string,
  coordinatorId: string,
): Promise<ClaimOutcome> {
  const db = createSupabaseAdminClient();
  const { data, error } = await db.rpc("claim_coordinator_lead", {
    p_lead_id: leadId,
    p_coordinator_id: coordinatorId,
  });

  if (error) {
    console.error("[coordinator] claim xatosi", error.message);
    return { claimed: false, reason: "error" };
  }

  const row = Array.isArray(data) ? data[0] : data;
  const claimed = row?.claimed === true;

  if (claimed) {
    await logAudit({
      actorId: null,
      action: "coordinator.lead_claimed",
      entityType: "coordinator_lead",
      entityId: leadId,
      metadata: { coordinatorId },
    });
  }

  return { claimed, reason: (row?.reason as string | null) ?? null };
}
