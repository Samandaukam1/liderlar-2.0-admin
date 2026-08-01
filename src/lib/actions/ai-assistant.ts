"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import type { SystemActionResult } from "@/lib/actions/system";

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export async function saveAiAssistantSettingsAction(
  formData: FormData,
): Promise<SystemActionResult> {
  const ctx = await requirePermission("ai_assistant.manage");

  const assistantName = String(formData.get("assistant_name") ?? "").trim();
  if (assistantName.length < 1 || assistantName.length > 60) {
    return { ok: false, error: "Yordamchi nomi 1-60 belgi bo'lishi kerak" };
  }
  const greeting = String(formData.get("greeting") ?? "").trim();
  if (greeting.length > 500) {
    return { ok: false, error: "Salomlashuv matni juda uzun (maksimum 500 belgi)" };
  }
  const quickQuestions = String(formData.get("quick_questions") ?? "")
    .split("\n")
    .map((q) => q.trim())
    .filter(Boolean)
    .slice(0, 8);

  const avatarKind = formData.get("avatar_kind") === "image" ? "image" : "video";
  const avatarImageUrl = String(formData.get("avatar_image_url") ?? "").trim() || null;
  const avatarVideoUrl = String(formData.get("avatar_video_url") ?? "").trim() || null;

  const glowColor = String(formData.get("glow_color") ?? "#13BCE4").trim();
  const borderColor = String(formData.get("border_color") ?? "#13BCE4").trim();
  const backgroundColorRaw = String(formData.get("background_color") ?? "").trim();
  if (!HEX_COLOR.test(glowColor) || !HEX_COLOR.test(borderColor)) {
    return { ok: false, error: "Rang qiymati #rrggbb formatida bo'lishi kerak" };
  }
  if (backgroundColorRaw && !HEX_COLOR.test(backgroundColorRaw)) {
    return { ok: false, error: "Fon rangi #rrggbb formatida bo'lishi kerak" };
  }

  const openingAnimation = String(formData.get("opening_animation") ?? "portal");
  const closingAnimation = String(formData.get("closing_animation") ?? "teleport");
  if (!["portal", "fade", "scale"].includes(openingAnimation)) {
    return { ok: false, error: "Noto'g'ri ochilish animatsiyasi" };
  }
  if (!["teleport", "fade", "scale"].includes(closingAnimation)) {
    return { ok: false, error: "Noto'g'ri yopilish animatsiyasi" };
  }

  const sizePx = clamp(Number(formData.get("size_px")) || 56, 32, 160);
  const floatingHeightPx = clamp(Number(formData.get("floating_height_px")) || 24, 0, 200);
  const particleCount = clamp(Number(formData.get("particle_count")) || 18, 0, 80);
  const animationSpeed = clamp(Number(formData.get("animation_speed")) || 1, 0.25, 3);

  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("ai_assistant_settings").upsert(
    {
      id: true,
      assistant_name: assistantName,
      greeting,
      quick_questions: quickQuestions,
      avatar_kind: avatarKind,
      avatar_image_url: avatarImageUrl,
      avatar_video_url: avatarVideoUrl,
      size_px: sizePx,
      floating_height_px: floatingHeightPx,
      particle_count: particleCount,
      animation_speed: animationSpeed,
      glow_enabled: formData.get("glow_enabled") === "on",
      particle_enabled: formData.get("particle_enabled") === "on",
      pulse_enabled: formData.get("pulse_enabled") === "on",
      bloom_enabled: formData.get("bloom_enabled") === "on",
      blur_shadow_enabled: formData.get("blur_shadow_enabled") === "on",
      halo_enabled: formData.get("halo_enabled") === "on",
      voice_enabled: formData.get("voice_enabled") === "on",
      glow_color: glowColor,
      border_color: borderColor,
      background_color: backgroundColorRaw || null,
      opening_animation: openingAnimation,
      closing_animation: closingAnimation,
      updated_by: ctx.userId,
    },
    { onConflict: "id" },
  );
  if (error) return { ok: false, error: error.message };

  await logAudit({
    actorId: ctx.userId,
    action: "ai_assistant_settings.update",
    entityType: "ai_assistant_settings",
    newValue: { assistant_name: assistantName, avatar_kind: avatarKind },
    severity: "warning",
  });
  revalidatePath("/ai-assistant");
  return { ok: true };
}
