import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { getMehrFlags } from "@/lib/mehr/flags";
import {
  issueActivationToken,
  hashActivationToken,
  clampTtl,
  DEFAULT_TTL_HOURS,
} from "./activation-token.ts";

/**
 * Nomzod hisobini faollashtirish.
 *
 * NIMA QILMAYDI:
 *   - parol yaratmaydi;
 *   - parolni ko'rsatmaydi;
 *   - nomzod nomiga hisob ochib qo'ymaydi.
 *
 * NIMA QILADI: nomzodga BIR MARTALIK, MUDDATLI havola beradi.
 * Hisobni nomzodning o'zi ochadi va parolini o'zi qo'yadi —
 * uni hech kim, jumladan admin ham ko'rmaydi.
 */

async function activationTtlHours(): Promise<number> {
  const db = createSupabaseAdminClient();
  const { data } = await db
    .from("site_settings")
    .select("value")
    .eq("key", "member.activation_ttl_hours")
    .maybeSingle();

  return clampTtl(Number(data?.value ?? DEFAULT_TTL_HOURS));
}

/**
 * Faollashtirish yoqilganmi.
 *
 * Bayroq MEHR bayroqlari bilan BITTA joydan o'qiladi
 * (`getMehrFlags`). Bu yerda alohida `site_settings` so'rovi
 * yozish oson edi, lekin shunda ikkita o'qish mantig'i paydo
 * bo'lardi va ular bir kun kelib boshqacha xulq ko'rsatardi —
 * masalan "True" va "true" ni turlicha tushunardi.
 */
export async function isActivationEnabled(): Promise<boolean> {
  const flags = await getMehrFlags();
  return flags.accountActivationEnabled;
}

export interface CreateActivationResult {
  ok: boolean;
  /** Faqat shu javobda qaytadi va hech qayerda saqlanmaydi. */
  token: string | null;
  expiresAt: string | null;
  reason:
    | "created"
    | "disabled"
    | "candidate_not_found"
    | "already_linked"
    | "error";
}

/**
 * Taklifnoma yaratadi.
 *
 * ESKISI BEKOR QILINADI. Bir vaqtda bir nechtasi amal qilsa,
 * eskisi xabarda yoki ekran suratida qolib, keyin kimdir undan
 * foydalanishi mumkin edi. Bazadagi qisman unikal indeks ham
 * shuni qo'riqlaydi — ya'ni poyga holatida ikkinchisi yiqiladi.
 */
export async function createActivation(
  candidateId: string,
  options: { actorId?: string | null; now?: Date } = {},
): Promise<CreateActivationResult> {
  if (!(await isActivationEnabled())) {
    return { ok: false, token: null, expiresAt: null, reason: "disabled" };
  }

  const db = createSupabaseAdminClient();
  const now = options.now ?? new Date();

  const { data: candidate } = await db
    .from("candidates")
    .select("id, user_id, full_name")
    .eq("id", candidateId)
    .is("deleted_at", null)
    .maybeSingle();

  if (!candidate) {
    return { ok: false, token: null, expiresAt: null, reason: "candidate_not_found" };
  }

  /*
   * Allaqachon bog'langan nomzodga taklifnoma berilmaydi.
   *
   * Aks holda havolani qo'lga kiritgan odam boshqa birovning
   * hisobini "qayta faollashtirib" egallab olardi.
   */
  if (candidate.user_id) {
    return { ok: false, token: null, expiresAt: null, reason: "already_linked" };
  }

  await db
    .from("candidate_activations")
    .update({
      revoked_at: now.toISOString(),
      revoked_by: options.actorId ?? null,
      revoke_reason: "Yangi havola yaratildi",
    })
    .eq("candidate_id", candidateId)
    .is("consumed_at", null)
    .is("revoked_at", null);

  const issued = issueActivationToken(now, await activationTtlHours());

  const { error } = await db.from("candidate_activations").insert({
    candidate_id: candidateId,
    token_hash: issued.tokenHash,
    created_by: options.actorId ?? null,
    expires_at: issued.expiresAt,
  });

  if (error) {
    console.error("ACTIVATION_CREATE_FAILED", { code: error.code, message: error.message });
    return { ok: false, token: null, expiresAt: null, reason: "error" };
  }

  await db.from("member_security_events").insert({
    candidate_id: candidateId,
    event_type: "activation_created",
    actor: "admin",
    actor_user_id: options.actorId ?? null,
    // Token ham, hash ham metama'lumotga TUSHMAYDI.
    metadata: { expires_at: issued.expiresAt },
  });

  await logAudit({
    actorId: options.actorId ?? null,
    action: "account.activation.created",
    entityType: "candidate",
    entityId: candidateId,
    severity: "warning",
    newValue: { expires_at: issued.expiresAt },
  });

  return { ok: true, token: issued.token, expiresAt: issued.expiresAt, reason: "created" };
}

export interface RevokeResult {
  ok: boolean;
  reason: "revoked" | "not_found" | "already_final" | "error";
}

export async function revokeActivation(
  activationId: string,
  reason: string,
  options: { actorId?: string | null } = {},
): Promise<RevokeResult> {
  const trimmed = reason.trim();
  if (!trimmed) return { ok: false, reason: "error" };

  const db = createSupabaseAdminClient();

  /*
   * Shartli UPDATE: ishlatilgan yoki allaqachon bekor qilingan
   * taklifnomaga tegmaydi. Avval o'qib keyin yozsak, ikki admin
   * bir vaqtda bosganda ikkalasiga ham "mumkin" ko'rinardi.
   */
  const { data, error } = await db
    .from("candidate_activations")
    .update({
      revoked_at: new Date().toISOString(),
      revoked_by: options.actorId ?? null,
      revoke_reason: trimmed,
    })
    .eq("id", activationId)
    .is("consumed_at", null)
    .is("revoked_at", null)
    .select("id, candidate_id")
    .maybeSingle();

  if (error) {
    console.error("ACTIVATION_REVOKE_FAILED", { code: error.code, message: error.message });
    return { ok: false, reason: "error" };
  }

  if (!data) {
    const { data: exists } = await db
      .from("candidate_activations")
      .select("id")
      .eq("id", activationId)
      .maybeSingle();
    return { ok: false, reason: exists ? "already_final" : "not_found" };
  }

  await db.from("member_security_events").insert({
    candidate_id: data.candidate_id as string,
    event_type: "activation_revoked",
    actor: "admin",
    actor_user_id: options.actorId ?? null,
    metadata: { reason: trimmed },
  });

  await logAudit({
    actorId: options.actorId ?? null,
    action: "account.activation.revoked",
    entityType: "candidate",
    entityId: data.candidate_id as string,
    reason: trimmed,
    severity: "warning",
  });

  return { ok: true, reason: "revoked" };
}

/* ------------------------------------------------------------------
 * TAKLIFNOMANI TEKSHIRISH VA ISHLATISH
 * ------------------------------------------------------------------ */

export interface ActivationTarget {
  activationId: string;
  candidateId: string;
  fullName: string;
  slug: string | null;
  avatarUrl: string | null;
  regionName: string | null;
  isPublished: boolean;
}

export type InspectResult =
  | { ok: true; target: ActivationTarget }
  | { ok: false; reason: "not_found" | "consumed" | "revoked" | "expired" | "already_linked" };

/**
 * Havolani ochgan odamga nima ko'rsatishni aniqlaydi.
 *
 * YAROQSIZ TOKEN HECH QANDAY MA'LUMOT BERMAYDI. Nomzodning
 * ismi ham, rasmi ham faqat token haqiqiy bo'lsa ko'rsatiladi —
 * aks holda havolalarni taxmin qilib, kim kim ekanini bilib
 * olish mumkin bo'lardi.
 */
export async function inspectActivation(
  rawToken: string,
  now: Date = new Date(),
): Promise<InspectResult> {
  const db = createSupabaseAdminClient();

  const { data: row } = await db
    .from("candidate_activations")
    .select(
      "id, candidate_id, expires_at, consumed_at, revoked_at, " +
        "candidates(id, full_name, slug, avatar_url, status, user_id, regions(name))",
    )
    .eq("token_hash", hashActivationToken(rawToken))
    .maybeSingle();

  if (!row) return { ok: false, reason: "not_found" };

  /*
   * PostgREST ichma-ich bog'lanish uchun union tip qaytaradi.
   * Shakl bizga ma'lum — ustunlar ro'yxati shu yerda yozilgan.
   */
  const data = row as unknown as {
    id: string;
    candidate_id: string;
    expires_at: string;
    consumed_at: string | null;
    revoked_at: string | null;
    candidates: {
      id: string;
      full_name: string;
      slug: string | null;
      avatar_url: string | null;
      status: string;
      user_id: string | null;
      regions: { name?: string } | null;
    } | null;
  };

  if (data.revoked_at) return { ok: false, reason: "revoked" };
  if (data.consumed_at) return { ok: false, reason: "consumed" };

  const expires = new Date(data.expires_at);
  if (!Number.isFinite(expires.getTime()) || expires <= now) {
    return { ok: false, reason: "expired" };
  }

  const candidate = data.candidates;
  if (!candidate) return { ok: false, reason: "not_found" };

  // Havola amal qilsa ham, nomzod shu orada bog'langan bo'lishi mumkin.
  if (candidate.user_id) return { ok: false, reason: "already_linked" };

  return {
    ok: true,
    target: {
      activationId: data.id,
      candidateId: candidate.id,
      fullName: candidate.full_name,
      slug: candidate.slug,
      avatarUrl: candidate.avatar_url,
      regionName: candidate.regions?.name ?? null,
      isPublished: candidate.status === "published",
    },
  };
}

export type ConsumeReason =
  | "linked"
  | "not_found"
  | "consumed"
  | "revoked"
  | "expired"
  | "already_linked"
  | "user_already_linked"
  | "needs_reconcile"
  | "error";

export interface ConsumeResult {
  ok: boolean;
  reason: ConsumeReason;
  candidateSlug?: string | null;
}

/**
 * Taklifnomani ishlatib, hisobni nomzodga bog'laydi.
 *
 * ATOMIKLIK CHEGARASI — OCHIQ AYTILGAN MUAMMO.
 *
 * Supabase Auth va Postgres alohida tizimlar; ular orasida
 * bitta tranzaksiya yo'q. Shuning uchun tartib shunday:
 *
 *   1. Taklifnoma SHARTLI UPDATE bilan "ishlatilgan" deb
 *      belgilanadi — bu MUTEX. Ikki so'rov bir vaqtda kelsa,
 *      faqat bittasi 1 qator o'zgartiradi.
 *   2. Keyin nomzod bog'lanadi (shartli: user_id is null).
 *
 * Agar 2-qadam yiqilsa, taklifnoma ishlatilgan-u nomzod
 * bog'lanmagan bo'lib qoladi. Bu holat YASHIRILMAYDI:
 * `consumed_by_user_id` to'ldirilgani bilan nomzodning
 * `user_id` si bo'sh qolishi admin panelda "e'tibor kerak"
 * deb ko'rinadi va admin uni qo'lda bog'lay oladi.
 */
export async function consumeActivation(
  rawToken: string,
  authUserId: string,
  mode: "new_account" | "existing_account",
  options: { now?: Date } = {},
): Promise<ConsumeResult> {
  const db = createSupabaseAdminClient();
  const now = options.now ?? new Date();
  const nowIso = now.toISOString();

  /*
   * Bu hisob allaqachon boshqa nomzodga bog'langanmi?
   *
   * Bog'langan bo'lsa, ikkinchisini biriktirish odamning
   * ikkita ensiklopediya profilini egallashiga olib borardi.
   */
  const { data: existingLink } = await db
    .from("candidates")
    .select("id")
    .eq("user_id", authUserId)
    .is("deleted_at", null)
    .maybeSingle();

  if (existingLink) {
    await db.from("member_security_events").insert({
      profile_id: authUserId,
      event_type: "account_link_conflict",
      actor: "member",
      metadata: { reason: "auth_user_already_linked" },
    });
    return { ok: false, reason: "user_already_linked" };
  }

  // 1. MUTEX — taklifnomani egallash.
  const { data: claimed, error: claimError } = await db
    .from("candidate_activations")
    .update({ consumed_at: nowIso, consumed_by_user_id: authUserId, consumed_mode: mode })
    .eq("token_hash", hashActivationToken(rawToken))
    .is("consumed_at", null)
    .is("revoked_at", null)
    .gt("expires_at", nowIso)
    .select("id, candidate_id")
    .maybeSingle();

  if (claimError) {
    console.error("ACTIVATION_CLAIM_FAILED", { code: claimError.code, message: claimError.message });
    return { ok: false, reason: "error" };
  }

  if (!claimed) {
    // Nega bo'lmadi — foydalanuvchiga aniq javob berish uchun.
    const inspected = await inspectActivation(rawToken, now);
    return {
      ok: false,
      reason: inspected.ok ? "error" : inspected.reason,
    };
  }

  const candidateId = claimed.candidate_id as string;

  // 2. Nomzodni bog'lash — shartli, ya'ni bo'sh bo'lsagina.
  const { data: linked, error: linkError } = await db
    .from("candidates")
    .update({ user_id: authUserId })
    .eq("id", candidateId)
    .is("user_id", null)
    .is("deleted_at", null)
    .select("id, slug")
    .maybeSingle();

  if (linkError || !linked) {
    console.error("ACTIVATION_LINK_FAILED", {
      code: linkError?.code,
      message: linkError?.message,
      candidateId,
    });

    await db.from("member_security_events").insert({
      candidate_id: candidateId,
      profile_id: authUserId,
      event_type: "activation_failed",
      actor: "system",
      metadata: { stage: "link", reason: linkError?.code ?? "already_linked" },
    });

    return { ok: false, reason: "needs_reconcile" };
  }

  await db.from("member_security_events").insert({
    candidate_id: candidateId,
    profile_id: authUserId,
    event_type: "activation_consumed",
    actor: "member",
    metadata: { mode },
  });

  await db.from("member_security_events").insert({
    candidate_id: candidateId,
    profile_id: authUserId,
    event_type: "account_linked",
    actor: "member",
    metadata: { mode },
  });

  await logAudit({
    actorId: authUserId,
    action: "account.activated",
    entityType: "candidate",
    entityId: candidateId,
    severity: "warning",
    newValue: { mode },
  });

  return { ok: true, reason: "linked", candidateSlug: linked.slug as string | null };
}
