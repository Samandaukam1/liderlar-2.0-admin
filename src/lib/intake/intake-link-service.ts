import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { getActiveTemplate, getIntakeSettings } from "@/lib/intake/data";
import {
  buildIntakeLink,
  generateRawIntakeToken,
  hashIntakeToken,
  tokenPrefix,
} from "@/lib/intake/tokens";

/**
 * Anketa + vaqtinchalik havola yaratishning YAGONA backend xizmati.
 *
 * NEGA AJRATILDI: bu mantiq ilgari `actions/intakes.ts` ichida, server
 * action ichiga kirib qolgan edi. Server action `requirePermission` ga
 * tayanadi va admin sessiyasini talab qiladi — sotuv boti esa webhook
 * yoki cron ichida, sessiyasiz ishlaydi va uni chaqira olmaydi.
 *
 * Ikkinchi generator yozish eng yomon yo'l bo'lardi: ikkita joyda
 * ikkita token muddati, ikkita havola shakli va bir kun kelib ikkita
 * turli xatolik. Shuning uchun mantiq shu yerga ko'chirildi va
 * server action ham, sotuv boti ham AYNAN shu funksiyani chaqiradi.
 * Ruxsat tekshiruvi chaqiruvchida qoladi — bu xizmat uni bilmaydi.
 */

export interface CreateIntakeInput {
  fullName: string;
  /**
   * Aniqlanmagan bo'lsa `null`. TAXMIN QILINMAYDI: noto'g'ri jins
   * rasm promti va anketa mavzusini buzadi, admin esa uni anketada
   * bir bosishda to'g'irlay oladi.
   */
  gender: "male" | "female" | null;
  /** Kim yaratgani. Bot uchun null — sessiya yo'q. */
  actorId: string | null;
  /** Havola qancha kun yashaydi. Berilmasa sozlamadagi qiymat. */
  ttlDays?: number;
  /** Havola bazasi. Berilmasa INTAKE_BASE_URL / standart qiymat. */
  baseUrl?: string;
  /** Audit uchun: anketa qayerdan kelgani. */
  origin?: string;
}

export interface CreateIntakeResult {
  ok: boolean;
  error?: string;
  intakeId?: string;
  /** Xom havola — FAQAT bir marta qaytadi va hech qayerda saqlanmaydi. */
  link?: string;
  prefix?: string;
  expiresAt?: string;
}

/** Anketa yozuvini yaratadi (havolasiz). */
export async function createIntakeRecord(input: {
  fullName: string;
  gender: "male" | "female" | null;
  method: "manual" | "secure_link";
  actorId: string | null;
  origin?: string;
}): Promise<{ ok: boolean; error?: string; intakeId?: string }> {
  const fullName = input.fullName.trim();
  if (fullName.length < 3) return { ok: false, error: "Ism familiya kiritilishi shart (kamida 3 belgi)" };

  const template = await getActiveTemplate();
  if (!template) return { ok: false, error: "Faol anketa shabloni topilmadi (migration/seed?)" };

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("candidate_intakes")
    .insert({
      template_id: template.id,
      intake_method: input.method,
      status: "draft",
      full_name: fullName.slice(0, 200),
      gender: input.gender,
      created_by: input.actorId,
      assigned_admin: input.actorId,
    })
    .select("id")
    .single();

  if (error || !data) return { ok: false, error: error?.message ?? "Yaratib bo‘lmadi" };

  await logAudit({
    actorId: input.actorId,
    action: `intake.create.${input.method}`,
    entityType: "candidate_intake",
    entityId: data.id as string,
    newValue: { full_name: fullName, gender: input.gender, method: input.method },
    metadata: input.origin ? { origin: input.origin } : undefined,
  });

  return { ok: true, intakeId: data.id as string };
}

/**
 * Mavjud anketaga yangi havola beradi.
 * Eski faol havola avval bekor qilinadi — bir vaqtda bitta amal qiladi.
 */
export async function createIntakeLink(
  intakeId: string,
  actorId: string | null,
  options: { ttlDays?: number; baseUrl?: string } = {},
): Promise<{ ok: boolean; error?: string; link?: string; prefix?: string; expiresAt?: string }> {
  const settings = await getIntakeSettings();
  const ttlDays = options.ttlDays ?? settings.linkTtlDays;

  const admin = createSupabaseAdminClient();
  await admin
    .from("candidate_intake_links")
    .update({ status: "revoked", revoked_at: new Date().toISOString() })
    .eq("intake_id", intakeId)
    .eq("status", "active");

  const raw = generateRawIntakeToken();
  const expiresAt = new Date(Date.now() + ttlDays * 86400000).toISOString();

  const { error } = await admin.from("candidate_intake_links").insert({
    intake_id: intakeId,
    // Xom token BAZAGA YOZILMAYDI — faqat xesh va prefiks.
    token_hash: hashIntakeToken(raw),
    token_prefix: tokenPrefix(raw),
    status: "active",
    expires_at: expiresAt,
    created_by: actorId,
  });
  if (error) return { ok: false, error: error.message };

  return {
    ok: true,
    link: buildIntakeLink(raw, options.baseUrl),
    prefix: tokenPrefix(raw),
    expiresAt,
  };
}

/** Anketa + havola bitta qadamda. Sotuv boti aynan shuni chaqiradi. */
export async function createIntakeWithLink(
  input: CreateIntakeInput,
): Promise<CreateIntakeResult> {
  const created = await createIntakeRecord({
    fullName: input.fullName,
    gender: input.gender,
    method: "secure_link",
    actorId: input.actorId,
    origin: input.origin,
  });
  if (!created.ok || !created.intakeId) return { ok: false, error: created.error };

  const link = await createIntakeLink(created.intakeId, input.actorId, {
    ttlDays: input.ttlDays,
    baseUrl: input.baseUrl,
  });
  if (!link.ok) return { ok: false, error: link.error };

  await logAudit({
    actorId: input.actorId,
    action: "intake.link.create",
    entityType: "candidate_intake",
    entityId: created.intakeId,
    // Xom token hech qachon log'ga tushmaydi.
    metadata: { prefix: link.prefix, expiresAt: link.expiresAt, origin: input.origin ?? null },
  });

  return {
    ok: true,
    intakeId: created.intakeId,
    link: link.link,
    prefix: link.prefix,
    expiresAt: link.expiresAt,
  };
}
