import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { getCoordinatorSettings } from "./settings.ts";
import { buildCommission } from "./targets.ts";
import { businessDate } from "./routing-rules.ts";

/**
 * TO'LOV TASDIQI -> SOTUV -> KOMISSIYA.
 *
 * KOMISSIYA FAQAT VAKOLATLI TASDIQDAN KEYIN. Chek kelgani,
 * mijozning "to'ladim" degani yoki to'lov so'ralgani — hech biri
 * pul kelganini bildirmaydi. Ular bilan komissiya yozilsa, tizim
 * bo'lmagan daromadni hisoblab, koordinatorga qarz bo'lib qolardi.
 */

export interface ConfirmSaleResult {
  ok: boolean;
  /** Komissiya AYNAN shu chaqiruvda yaratildimi. */
  commissionCreated: boolean;
  reason: "confirmed" | "already_confirmed" | "no_coordinator" | "not_found" | "error";
}

/**
 * Lidni tasdiqlangan sotuv deb belgilaydi.
 *
 * IDEMPOTENT: ikki marta chaqirilsa ikkinchi komissiya
 * YARATILMAYDI — `uq_commission_per_lead` unikal indeksi bunga
 * yo'l qo'ymaydi. Tekshirib-keyin-yozish ikki parallel jarayonda
 * ikkalasiga ham "yo'q ekan" deb ko'rinardi.
 */
export async function confirmCoordinatorSale(
  leadId: string,
  options: { actorId?: string | null; now?: Date } = {},
): Promise<ConfirmSaleResult> {
  const db = createSupabaseAdminClient();
  const now = options.now ?? new Date();

  const { data: lead } = await db
    .from("coordinator_leads")
    .select("id, state, assigned_coordinator_id, payment_confirmed_at")
    .eq("id", leadId)
    .maybeSingle();

  if (!lead) return { ok: false, commissionCreated: false, reason: "not_found" };

  if (!lead.assigned_coordinator_id) {
    /*
     * KOORDINATORSIZ SOTUV KOMISSIYA YARATMAYDI.
     *
     * Bu haqiqiy holat: AI sotuv boti mijozni o'zi yopgan bo'lishi
     * mumkin. U holda sotuv bor, lekin uni hech kim "qilmagan" —
     * komissiya ham yo'q. Holat baribir yangilanadi.
     */
    await db
      .from("coordinator_leads")
      .update({
        state: "payment_confirmed",
        payment_confirmed_at: now.toISOString(),
        closed_at: now.toISOString(),
      })
      .eq("id", leadId)
      .neq("state", "payment_confirmed");
    return { ok: true, commissionCreated: false, reason: "no_coordinator" };
  }

  /*
   * HOLATNI SHARTLI YANGILAYMIZ.
   *
   * `neq("state", "payment_confirmed")` — allaqachon tasdiqlangan
   * lid ikkinchi marta o'tmaydi va `payment_confirmed_at` qayta
   * yozilmaydi. O'sha vaqt kunlik hisobga kiradi; uni surish
   * kechagi sotuvni bugunga ko'chirardi.
   */
  const { data: updated } = await db
    .from("coordinator_leads")
    .update({
      state: "payment_confirmed",
      payment_confirmed_at: now.toISOString(),
      closed_at: now.toISOString(),
    })
    .eq("id", leadId)
    .neq("state", "payment_confirmed")
    .select("id");

  const firstTime = (updated?.length ?? 0) > 0;

  const settings = await getCoordinatorSettings();
  const draft = buildCommission({
    leadState: "payment_confirmed",
    coordinatorId: lead.assigned_coordinator_id as string,
    amountUzs: settings.commissionUzs,
    at: now,
  });
  if (!draft) return { ok: true, commissionCreated: false, reason: "no_coordinator" };

  const { error } = await db.from("coordinator_commissions").insert({
    coordinator_id: draft.coordinatorId,
    lead_id: leadId,
    amount_uzs: draft.amountUzs,
    status: draft.status,
    business_date: draft.businessDate,
    earned_at: now.toISOString(),
  });

  // Unikal indeks buzilishi — komissiya allaqachon bor. Xato emas.
  const duplicate = Boolean(error) && error?.code === "23505";
  if (error && !duplicate) {
    console.error("[coordinator] komissiya yozilmadi", error.message);
    return { ok: false, commissionCreated: false, reason: "error" };
  }

  if (!duplicate) {
    await db.from("lead_routing_events").insert({
      lead_id: leadId,
      event: "payment_confirmed",
      coordinator_id: draft.coordinatorId,
      to_state: "payment_confirmed",
      metadata: { amountUzs: draft.amountUzs, businessDate: draft.businessDate },
    });

    await logAudit({
      actorId: options.actorId ?? null,
      action: "coordinator.commission_earned",
      entityType: "coordinator_lead",
      entityId: leadId,
      metadata: { coordinatorId: draft.coordinatorId, amountUzs: draft.amountUzs },
    });
  }

  return {
    ok: true,
    commissionCreated: !duplicate,
    reason: firstTime && !duplicate ? "confirmed" : "already_confirmed",
  };
}

/**
 * Komissiyani bekor qilish.
 *
 * O'CHIRILMAYDI — `reversed` deb belgilanadi. Daftar o'zgarmas
 * bo'lishi kerak: "bu pul qayerga ketdi?" degan savolga javob
 * faqat to'liq tarixdan chiqadi.
 */
export async function reverseCommission(
  commissionId: string,
  reason: string,
  actorId: string | null,
): Promise<{ ok: boolean; error?: string }> {
  if (reason.trim().length < 3) return { ok: false, error: "Sabab yozilishi shart" };

  const db = createSupabaseAdminClient();
  const { error } = await db
    .from("coordinator_commissions")
    .update({
      status: "reversed",
      reversed_at: new Date().toISOString(),
      reversal_reason: reason.trim().slice(0, 500),
    })
    .eq("id", commissionId)
    .neq("status", "reversed");

  if (error) return { ok: false, error: error.message };

  await logAudit({
    actorId,
    action: "coordinator.commission_reversed",
    entityType: "coordinator_commissions",
    entityId: commissionId,
    metadata: { reason },
    severity: "warning",
  });
  return { ok: true };
}

/** Bugungi kun — hisobotlar shu bo'yicha yig'iladi. */
export { businessDate };
