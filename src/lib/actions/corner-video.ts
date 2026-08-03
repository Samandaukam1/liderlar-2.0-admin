"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import type { SystemActionResult } from "@/lib/actions/system";

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const CORNERS = ["bottom-left", "bottom-right", "top-left", "top-right"];
const ASPECT_RATIOS = ["9:16", "4:5", "1:1", "16:9"];
const BUTTON_ANIMATIONS = ["pulse", "bounce", "glow", "shine", "none"];

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

/**
 * Accepts an absolute http(s) URL or a site-relative path ("/liderlar").
 * Anything else (javascript:, mailto:, bare words) is rejected — the value
 * ends up in an href on every public page, so it has to be safe by construction.
 */
function normalizeLink(raw: string): string | null | false {
  const value = raw.trim();
  if (!value) return null;
  if (value.startsWith("/")) return value;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    return url.toString();
  } catch {
    return false;
  }
}

export async function saveCornerVideoSettingsAction(
  formData: FormData,
): Promise<SystemActionResult> {
  const ctx = await requirePermission("corner_video.manage");

  const enabled = formData.get("enabled") === "on";
  const videoUrl = String(formData.get("video_url") ?? "").trim() || null;
  const posterUrl = String(formData.get("poster_url") ?? "").trim() || null;

  if (enabled && !videoUrl) {
    return { ok: false, error: "Widgetni yoqish uchun avval video yuklang" };
  }

  const corner = String(formData.get("corner") ?? "bottom-left");
  if (!CORNERS.includes(corner)) {
    return { ok: false, error: "Noto'g'ri burchak tanlandi" };
  }
  const aspectRatio = String(formData.get("aspect_ratio") ?? "9:16");
  if (!ASPECT_RATIOS.includes(aspectRatio)) {
    return { ok: false, error: "Noto'g'ri video nisbati tanlandi" };
  }

  const buttonEnabled = formData.get("button_enabled") === "on";
  const buttonLabel = String(formData.get("button_label") ?? "").trim() || "Batafsil";
  if (buttonLabel.length > 40) {
    return { ok: false, error: "Tugma matni juda uzun (maksimum 40 belgi)" };
  }
  const buttonUrl = normalizeLink(String(formData.get("button_url") ?? ""));
  if (buttonUrl === false) {
    return {
      ok: false,
      error: "Tugma havolasi http(s):// bilan boshlanishi yoki / bilan boshlanuvchi ichki manzil bo'lishi kerak",
    };
  }
  if (buttonEnabled && !buttonUrl) {
    return { ok: false, error: "Tugma yoqilgan — unga havola kiriting" };
  }

  const buttonAnimation = String(formData.get("button_animation") ?? "pulse");
  if (!BUTTON_ANIMATIONS.includes(buttonAnimation)) {
    return { ok: false, error: "Noto'g'ri tugma animatsiyasi" };
  }

  const buttonColor = String(formData.get("button_color") ?? "#13BCE4").trim();
  const buttonTextColor = String(formData.get("button_text_color") ?? "#FFFFFF").trim();
  if (!HEX_COLOR.test(buttonColor) || !HEX_COLOR.test(buttonTextColor)) {
    return { ok: false, error: "Rang qiymati #rrggbb formatida bo'lishi kerak" };
  }

  const widthPx = clamp(Number(formData.get("width_px")) || 150, 90, 420);
  const offsetXPx = clamp(Number(formData.get("offset_x_px")) || 0, 0, 200);
  const offsetYPx = clamp(Number(formData.get("offset_y_px")) || 0, 0, 200);
  const roundedPx = clamp(Number(formData.get("rounded_px")) || 0, 0, 40);

  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("corner_video_settings").upsert(
    {
      id: true,
      enabled,
      video_url: videoUrl,
      poster_url: posterUrl,
      corner,
      aspect_ratio: aspectRatio,
      width_px: widthPx,
      offset_x_px: offsetXPx,
      offset_y_px: offsetYPx,
      rounded_px: roundedPx,
      loop_enabled: formData.get("loop_enabled") === "on",
      show_close_button: formData.get("show_close_button") === "on",
      button_enabled: buttonEnabled,
      button_label: buttonLabel,
      button_url: buttonUrl,
      button_animation: buttonAnimation,
      button_color: buttonColor,
      button_text_color: buttonTextColor,
      updated_by: ctx.userId,
    },
    { onConflict: "id" },
  );
  if (error) return { ok: false, error: error.message };

  await logAudit({
    actorId: ctx.userId,
    action: "corner_video_settings.update",
    entityType: "corner_video_settings",
    newValue: { enabled, corner, button_label: buttonLabel, button_url: buttonUrl },
    severity: "warning",
  });
  revalidatePath("/corner-video");
  return { ok: true };
}
