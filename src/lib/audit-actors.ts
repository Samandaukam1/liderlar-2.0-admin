import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  auditActorIds,
  chunkIds,
  resolveAuditActor,
  type AuditActor,
  type AuditActorProfile,
} from "@/lib/audit-view";

/**
 * AUDIT YOZUVLARINING MUALLIFLARI.
 *
 * `audit_logs.actor_id` auth.users ga bog'langan, `profiles` ga emas —
 * PostgREST `profiles(full_name)` ni shu jadvalga qo'sha olmaydi va
 * butun so'rov xato bilan qaytadi (oldin jurnal sahifasi shu sababli
 * bo'sh "Jadval topilmadi" ko'rsatardi). Shuning uchun ismlar alohida,
 * bo'laklab o'qiladi.
 *
 * ISMLARNI O'QIB BO'LMASA, JURNAL YASHIRILMAYDI. Yozuvlarning o'zi
 * o'qilgan; faqat ismlar "noma'lum" bo'lib ko'rinadi va sahifa buni
 * ochiq aytadi (`failed`). Butun sahifani yiqitish admin uchun undan
 * yomonroq edi.
 */

export interface AuditActorLookup {
  actorOf(actorId: string | null): AuditActor;
  /** Kamida bitta bo'lak o'qilmadi — ismlar to'liq emas. */
  failed: boolean;
}

export async function loadAuditActors(
  rows: ReadonlyArray<{ actor_id: string | null }>,
): Promise<AuditActorLookup> {
  const profiles = new Map<string, AuditActorProfile>();
  let failed = false;

  const ids = auditActorIds(rows);
  if (ids.length > 0) {
    const admin = createSupabaseAdminClient();
    for (const chunk of chunkIds(ids)) {
      const { data, error } = await admin
        .from("profiles")
        .select("id, full_name, avatar_url")
        .in("id", chunk);

      if (error) {
        console.error("[audit] mualliflar o'qilmadi:", error.message);
        failed = true;
        break;
      }
      for (const row of data ?? []) {
        profiles.set(row.id as string, {
          full_name: (row.full_name as string | null) ?? null,
          avatar_url: (row.avatar_url as string | null) ?? null,
        });
      }
    }
  }

  return {
    failed,
    actorOf: (actorId) => resolveAuditActor(actorId, profiles, failed),
  };
}
