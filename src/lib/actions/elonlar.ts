"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import type { SystemActionResult } from "@/lib/actions/system";
import { refreshProfileHighlight } from "@/lib/profile-highlight-refresh";
import { getAd, listAdsInPlacement } from "@/lib/elonlar/service";
import {
  buildAdRecord,
  buildSettingsRecord,
  describeDbError,
  isMoveDirection,
  nextSortOrder,
  reorderIds,
  sortOrderUpdates,
  type AdFormInput,
} from "@/lib/elonlar/rules";
import { ACTIVE_LIMIT_MESSAGE, canActivate, type AdPlacement } from "@/lib/elonlar/types";

/**
 * REKLAMALARNI BOSHQARISH — server action'lar.
 *
 * Har biri: ruxsat → tekshiruv (sof `rules.ts`) → service_role yozuvi →
 * audit → admin sahifasini yangilash → bar o'zgarsa saytni yangilash.
 * "Ko'pi bilan 3 ta" qoidasi ikki joyda: bu yerda (tushunarli xabar uchun)
 * va bazadagi triggerda (ikki admin bir vaqtda yoqsa ham buzilmasin).
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "");
}

function readAdForm(formData: FormData): AdFormInput {
  return {
    placement: str(formData, "placement"),
    title: str(formData, "title"),
    text: str(formData, "text"),
    url: str(formData, "url"),
    kind: str(formData, "kind"),
    buttonLabel: str(formData, "button_label"),
    logoUrl: str(formData, "logo_url"),
    imageUrl: str(formData, "image_url"),
    imageWidth: str(formData, "image_width"),
    imageHeight: str(formData, "image_height"),
    style: {
      theme: str(formData, "style_theme"),
      entrance: str(formData, "style_entrance"),
      attention: str(formData, "style_attention"),
      logoPosition: str(formData, "style_logo_position"),
      bg: str(formData, "style_bg"),
      fg: str(formData, "style_fg"),
      accent: str(formData, "style_accent"),
    },
    closeOpensLink: formData.get("close_opens_link") === "on",
    startsAt: str(formData, "starts_at"),
    endsAt: str(formData, "ends_at"),
    isActive: formData.get("is_active") === "on",
  };
}

function afterChange(placement: AdPlacement): void {
  revalidatePath("/elonlar");
  if (placement === "profile_bar") refreshProfileHighlight();
}

export async function createAdAction(formData: FormData): Promise<SystemActionResult> {
  const ctx = await requirePermission("ads.manage");
  const built = buildAdRecord(readAdForm(formData));
  if (!built.ok) return { ok: false, error: built.error };
  const record = built.record;

  const existing = await listAdsInPlacement(record.placement);
  if (!existing.ok) return { ok: false, error: existing.error };
  if (record.is_active && !canActivate(existing.ads, record.placement, null)) {
    return { ok: false, error: ACTIVE_LIMIT_MESSAGE };
  }

  const db = createSupabaseAdminClient();
  const { data, error } = await db
    .from("ads")
    .insert({
      ...record,
      sort_order: nextSortOrder(existing.ads),
      created_by: ctx.userId,
      updated_by: ctx.userId,
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: describeDbError(error) };

  await logAudit({
    actorId: ctx.userId,
    action: "ad.created",
    entityType: "ads",
    entityId: data.id as string,
    newValue: { placement: record.placement, title: record.title, url: record.url, is_active: record.is_active },
    severity: record.is_active ? "warning" : "info",
  });
  afterChange(record.placement);
  return { ok: true };
}

export async function updateAdAction(formData: FormData): Promise<SystemActionResult> {
  const ctx = await requirePermission("ads.manage");
  const id = str(formData, "id");
  if (!UUID.test(id)) return { ok: false, error: "Noto‘g‘ri identifikator" };

  const current = await getAd(id);
  if (!current) return { ok: false, error: "Reklama topilmadi" };

  const built = buildAdRecord(readAdForm(formData));
  if (!built.ok) return { ok: false, error: built.error };
  // Joylashuv yaratilgandan keyin o'zgarmaydi: bot qatori va bar boshqa-boshqa narsa.
  const record = { ...built.record, placement: current.placement };

  if (record.is_active && !current.isActive) {
    const existing = await listAdsInPlacement(current.placement);
    if (!existing.ok) return { ok: false, error: existing.error };
    if (!canActivate(existing.ads, current.placement, id)) return { ok: false, error: ACTIVE_LIMIT_MESSAGE };
  }

  const db = createSupabaseAdminClient();
  const { error } = await db
    .from("ads")
    .update({ ...record, updated_by: ctx.userId })
    .eq("id", id);
  if (error) return { ok: false, error: describeDbError(error) };

  await logAudit({
    actorId: ctx.userId,
    action: "ad.updated",
    entityType: "ads",
    entityId: id,
    oldValue: { title: current.title, url: current.url, is_active: current.isActive },
    newValue: { title: record.title, url: record.url, is_active: record.is_active },
    severity: record.is_active !== current.isActive ? "warning" : "info",
  });
  afterChange(current.placement);
  return { ok: true };
}

export async function setAdActiveAction(id: string, active: boolean): Promise<SystemActionResult> {
  const ctx = await requirePermission("ads.manage");
  if (!UUID.test(id)) return { ok: false, error: "Noto‘g‘ri identifikator" };
  const current = await getAd(id);
  if (!current) return { ok: false, error: "Reklama topilmadi" };

  if (active && !current.isActive) {
    const existing = await listAdsInPlacement(current.placement);
    if (!existing.ok) return { ok: false, error: existing.error };
    if (!canActivate(existing.ads, current.placement, id)) return { ok: false, error: ACTIVE_LIMIT_MESSAGE };
  }

  const db = createSupabaseAdminClient();
  const { error } = await db.from("ads").update({ is_active: active, updated_by: ctx.userId }).eq("id", id);
  if (error) return { ok: false, error: describeDbError(error) };

  await logAudit({
    actorId: ctx.userId,
    action: "ad.toggled",
    entityType: "ads",
    entityId: id,
    newValue: { is_active: active, placement: current.placement, title: current.title },
    severity: "warning",
  });
  afterChange(current.placement);
  return { ok: true };
}

export async function deleteAdAction(id: string): Promise<SystemActionResult> {
  const ctx = await requirePermission("ads.manage");
  if (!UUID.test(id)) return { ok: false, error: "Noto‘g‘ri identifikator" };
  const current = await getAd(id);
  if (!current) return { ok: false, error: "Reklama topilmadi" };

  // Postlardagi `telegram_ad_id` bazada `on delete set null` — yuborilgan
  // postlar tarixi buzilmaydi, keyingi yuborishda yangi reklama olinadi.
  const db = createSupabaseAdminClient();
  const { error } = await db.from("ads").delete().eq("id", id);
  if (error) return { ok: false, error: describeDbError(error) };

  await logAudit({
    actorId: ctx.userId,
    action: "ad.deleted",
    entityType: "ads",
    entityId: id,
    oldValue: { placement: current.placement, title: current.title, url: current.url },
    severity: "warning",
  });
  afterChange(current.placement);
  return { ok: true };
}

export async function moveAdAction(id: string, direction: string): Promise<SystemActionResult> {
  const ctx = await requirePermission("ads.manage");
  if (!UUID.test(id) || !isMoveDirection(direction)) return { ok: false, error: "Noto‘g‘ri so‘rov" };
  const current = await getAd(id);
  if (!current) return { ok: false, error: "Reklama topilmadi" };

  const list = await listAdsInPlacement(current.placement);
  if (!list.ok) return { ok: false, error: list.error };
  const ordered = reorderIds(
    list.ads.map((ad) => ad.id),
    id,
    direction,
  );
  if (!ordered) return { ok: true };

  const db = createSupabaseAdminClient();
  for (const update of sortOrderUpdates(list.ads, ordered)) {
    const { error } = await db.from("ads").update({ sort_order: update.sort_order }).eq("id", update.id);
    if (error) return { ok: false, error: describeDbError(error) };
  }

  await logAudit({
    actorId: ctx.userId,
    action: "ad.reordered",
    entityType: "ads",
    entityId: id,
    metadata: { direction },
  });
  afterChange(current.placement);
  return { ok: true };
}

export async function saveAdsSettingsAction(formData: FormData): Promise<SystemActionResult> {
  const ctx = await requirePermission("ads.manage");
  const built = buildSettingsRecord({
    rotation: str(formData, "profile_bar_rotation"),
    appearDelayMs: str(formData, "profile_bar_appear_delay_ms"),
    cycleSeconds: str(formData, "profile_bar_cycle_seconds"),
    dismissHours: str(formData, "profile_bar_dismiss_hours"),
    hideOnScroll: formData.get("profile_bar_hide_on_scroll") === "on",
    botPostPosition: str(formData, "bot_post_position"),
  });
  if (!built.ok) return { ok: false, error: built.error };

  const db = createSupabaseAdminClient();
  const { error } = await db
    .from("ads_settings")
    .upsert({ id: true, ...built.record, updated_by: ctx.userId }, { onConflict: "id" });
  if (error) return { ok: false, error: describeDbError(error) };

  await logAudit({
    actorId: ctx.userId,
    action: "ads_settings.updated",
    entityType: "ads_settings",
    newValue: built.record,
    severity: "warning",
  });
  revalidatePath("/elonlar");
  refreshProfileHighlight();
  return { ok: true };
}
