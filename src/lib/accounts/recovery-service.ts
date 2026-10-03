import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { recordAudit } from "@/lib/vip/audit-log";
import { issueRecoveryToken } from "./recovery-token.ts";

/**
 * PAROLNI TIKLASH HAVOLASI — ADMIN TOMONI.
 *
 * NIMA QILMAYDI:
 *   - parol yaratmaydi va ko'rsatmaydi;
 *   - email yubormaydi (a'zolarning auth email'i ichki manzil);
 *   - yangi hisob, profil yoki nomzod yaratmaydi.
 *
 * NIMA QILADI: mavjud hisobga BIR MARTALIK, MUDDATLI havola beradi.
 * Admin uni nusxalab Telegram orqali yuboradi, a'zo esa parolni
 * o'zi qo'yadi. Ishlatish — sayt tomonida (`liderlar-web`).
 */

export type CreateRecoveryReason =
  | "created"
  | "not_member"
  | "staff_account"
  | "blocked"
  | "error";

export interface CreateRecoveryResult {
  ok: boolean;
  /** Faqat shu javobda qaytadi va hech qayerda saqlanmaydi. */
  token: string | null;
  expiresAt: string | null;
  reason: CreateRecoveryReason;
}

/**
 * Tiklash havolasini yaratadi. Eski amaldagi havola bekor qilinadi.
 */
export async function createRecovery(
  profileId: string,
  options: { actorId: string; now?: Date },
): Promise<CreateRecoveryResult> {
  const db = createSupabaseAdminClient();
  const now = options.now ?? new Date();
  const fail = (reason: CreateRecoveryReason): CreateRecoveryResult => ({
    ok: false,
    token: null,
    expiresAt: null,
    reason,
  });

  const [candidateRes, rolesRes, accountRes] = await Promise.all([
    db.from("candidates").select("id").eq("user_id", profileId).is("deleted_at", null).maybeSingle(),
    db.from("user_roles").select("role_id", { count: "exact", head: true }).eq("user_id", profileId),
    db.from("member_accounts").select("status").eq("profile_id", profileId).maybeSingle(),
  ]);

  if (candidateRes.error || rolesRes.error || accountRes.error) {
    console.error("RECOVERY_PRECHECK_FAILED", {
      message: candidateRes.error?.message ?? rolesRes.error?.message ?? accountRes.error?.message,
    });
    return fail("error");
  }

  /*
   * FAQAT NOMZOD HISOBI.
   *
   * Bu bo'lim nomzodlar hisoblari uchun. Nomzodga bog'lanmagan hisobga
   * havola berish — bo'lim maqsadidan tashqari va tekshirilmagan yo'l.
   */
  if (!candidateRes.data) return fail("not_member");

  /*
   * XODIM HISOBIGA HAVOLA BERILMAYDI — imtiyozni oshirishning oldi.
   *
   * `members.manage` ruxsati bor xodim super_admin hisobiga tiklash
   * havolasi yaratib, uni o'zi ochsa — o'sha hisobni egallab olardi.
   * Xodimlar paroli faqat "Adminlar" bo'limi orqali boshqariladi.
   */
  if ((rolesRes.count ?? 0) > 0) return fail("staff_account");

  /*
   * BLOKLANGAN HISOB — avval tiklanadi.
   *
   * Aks holda yangi parol bloklashni "chetlab o'tish" yo'li kabi
   * ko'rinardi: bloklash qarori bilan parol qarori aralashmasin.
   */
  if (accountRes.data?.status === "disabled") return fail("blocked");

  /*
   * ESKI HAVOLA BEKOR QILINADI. Bir vaqtda bittasi amal qiladi —
   * bazadagi qisman unikal indeks poyga holatida ikkinchisini to'sadi.
   */
  const { error: revokeError } = await db
    .from("account_recoveries")
    .update({
      revoked_at: now.toISOString(),
      revoked_by: options.actorId,
      revoke_reason: "Yangi havola yaratildi",
    })
    .eq("profile_id", profileId)
    .is("consumed_at", null)
    .is("revoked_at", null);

  if (revokeError) {
    console.error("RECOVERY_REVOKE_FAILED", { code: revokeError.code, message: revokeError.message });
    return fail("error");
  }

  const issued = issueRecoveryToken(now);

  const { error } = await db.from("account_recoveries").insert({
    profile_id: profileId,
    token_hash: issued.tokenHash,
    created_by: options.actorId,
    created_at: now.toISOString(),
    expires_at: issued.expiresAt,
  });

  if (error) {
    console.error("RECOVERY_CREATE_FAILED", { code: error.code, message: error.message });
    return fail("error");
  }

  // Token ham, hash ham metama'lumotga va jurnalga TUSHMAYDI.
  await db.from("member_security_events").insert({
    profile_id: profileId,
    candidate_id: candidateRes.data.id as string,
    event_type: "recovery_link_created",
    actor: "admin",
    actor_user_id: options.actorId,
    metadata: { expires_at: issued.expiresAt },
  });

  await recordAudit("account.recovery.created", {
    actorId: options.actorId,
    entityId: profileId,
    after: { expires_at: issued.expiresAt },
    metadata: { candidate_id: candidateRes.data.id as string },
  });

  return { ok: true, token: issued.token, expiresAt: issued.expiresAt, reason: "created" };
}
