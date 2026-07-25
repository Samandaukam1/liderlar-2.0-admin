"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { validateWeights, type RankingWeights } from "@/lib/ranking";

export interface RankingActionResult {
  ok: boolean;
  error?: string;
}

export async function createPeriodAction(formData: FormData): Promise<RankingActionResult> {
  const ctx = await requirePermission("rankings.manage");
  const name = String(formData.get("name") ?? "").trim();
  const startsOn = String(formData.get("starts_on") ?? "");
  const endsOn = String(formData.get("ends_on") ?? "");
  if (name.length < 3) return { ok: false, error: "Davr nomi juda qisqa" };
  if (!startsOn) return { ok: false, error: "Boshlanish sanasi kerak" };

  const admin = createSupabaseAdminClient();
  // Close the current open period first
  await admin.from("ranking_periods").update({ is_current: false }).eq("is_current", true);

  const { data: period, error } = await admin
    .from("ranking_periods")
    .insert({
      name,
      starts_on: startsOn,
      ends_on: endsOn || null,
      status: "open",
      is_current: true,
      created_by: ctx.userId,
    })
    .select("id")
    .single();
  if (error || !period) return { ok: false, error: error?.message ?? "Yaratib bo‘lmadi" };

  // Copy the latest weights forward (or defaults)
  const { data: lastWeights } = await admin
    .from("ranking_weights")
    .select("achievements, monthly_activity, active_leadership")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  await admin.from("ranking_weights").insert({
    period_id: period.id,
    achievements: lastWeights?.achievements ?? 40,
    monthly_activity: lastWeights?.monthly_activity ?? 25,
    active_leadership: lastWeights?.active_leadership ?? 35,
    updated_by: ctx.userId,
  });

  await logAudit({
    actorId: ctx.userId,
    action: "ranking.period.create",
    entityType: "ranking_period",
    entityId: period.id,
    newValue: { name, starts_on: startsOn },
  });
  revalidatePath("/ranking-settings");
  revalidatePath("/rankings");
  return { ok: true };
}

export async function closePeriodAction(periodId: string): Promise<RankingActionResult> {
  const ctx = await requirePermission("rankings.manage");
  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("ranking_periods")
    .update({ status: "closed", closed_at: new Date().toISOString() })
    .eq("id", periodId);
  if (error) return { ok: false, error: error.message };
  await logAudit({
    actorId: ctx.userId,
    action: "ranking.period.close",
    entityType: "ranking_period",
    entityId: periodId,
    severity: "warning",
  });
  revalidatePath("/ranking-settings");
  revalidatePath("/rankings");
  return { ok: true };
}

const weightsSchema = z.object({
  achievements: z.coerce.number(),
  monthly_activity: z.coerce.number(),
  active_leadership: z.coerce.number(),
});

/** Weight changes are super-admin only (rankings.weights permission). */
export async function updateWeightsAction(
  periodId: string,
  formData: FormData,
): Promise<RankingActionResult> {
  const ctx = await requirePermission("rankings.weights");
  const parsed = weightsSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { ok: false, error: "Qiymatlar noto‘g‘ri" };
  const weights = parsed.data as RankingWeights;
  const validation = validateWeights(weights);
  if (validation) return { ok: false, error: validation };

  const admin = createSupabaseAdminClient();
  const { data: before } = await admin
    .from("ranking_weights")
    .select("achievements, monthly_activity, active_leadership")
    .eq("period_id", periodId)
    .maybeSingle();
  const { error } = await admin
    .from("ranking_weights")
    .upsert(
      { period_id: periodId, ...weights, updated_by: ctx.userId },
      { onConflict: "period_id" },
    );
  if (error) return { ok: false, error: error.message };
  await logAudit({
    actorId: ctx.userId,
    action: "ranking.weights.update",
    entityType: "ranking_period",
    entityId: periodId,
    oldValue: before,
    newValue: weights,
    severity: "warning",
  });
  revalidatePath("/ranking-settings");
  return { ok: true };
}

/** Runs the SQL recalculation function for the current period. */
export async function recalculateRankingsAction(): Promise<
  RankingActionResult & { updated?: number }
> {
  const ctx = await requirePermission("rankings.manage");
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc("recalculate_rankings");
  if (error) return { ok: false, error: error.message };
  await logAudit({
    actorId: ctx.userId,
    action: "ranking.recalculate",
    entityType: "ranking",
    metadata: { updated: data ?? 0 },
  });
  revalidatePath("/rankings");
  return { ok: true, updated: typeof data === "number" ? data : undefined };
}

const adjustSchema = z.object({
  candidate_id: z.string().uuid(),
  category: z.enum(["overall", "achievements", "monthly_activity", "active_leadership"]),
  delta: z.coerce.number().min(-100).max(100),
  reason: z.string().min(5, "Sabab kamida 5 belgidan iborat bo‘lsin").max(500),
});

/** Manual score adjustment — always requires a written reason; audited. */
export async function adjustScoreAction(formData: FormData): Promise<RankingActionResult> {
  const ctx = await requirePermission("rankings.adjust");
  const parsed = adjustSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Forma xatosi" };
  }
  const v = parsed.data;
  const admin = createSupabaseAdminClient();
  const { data: period } = await admin
    .from("ranking_periods")
    .select("id")
    .eq("is_current", true)
    .maybeSingle();
  if (!period) return { ok: false, error: "Faol reyting davri yo‘q" };

  const { error } = await admin.from("ranking_adjustments").insert({
    period_id: period.id,
    candidate_id: v.candidate_id,
    category: v.category,
    delta: v.delta,
    reason: v.reason.trim(),
    created_by: ctx.userId,
  });
  if (error) return { ok: false, error: error.message };
  await logAudit({
    actorId: ctx.userId,
    action: "ranking.adjust",
    entityType: "candidate",
    entityId: v.candidate_id,
    newValue: { category: v.category, delta: v.delta },
    reason: v.reason.trim(),
    severity: "warning",
  });
  // Re-run the calculation so the adjustment is reflected immediately.
  await admin.rpc("recalculate_rankings");
  revalidatePath("/rankings");
  return { ok: true };
}

export async function publishRankingAction(periodId: string): Promise<RankingActionResult> {
  const ctx = await requirePermission("rankings.manage");
  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("ranking_periods")
    .update({ published_at: new Date().toISOString() })
    .eq("id", periodId);
  if (error) return { ok: false, error: error.message };
  await logAudit({
    actorId: ctx.userId,
    action: "ranking.publish",
    entityType: "ranking_period",
    entityId: periodId,
  });
  revalidatePath("/rankings");
  return { ok: true };
}
