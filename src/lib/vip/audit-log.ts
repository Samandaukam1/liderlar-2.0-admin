import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { AUDIT_EVENTS, type AuditEventKey } from "./audit-events";
import { cleanAuditFields, cleanAuditReason, type AuditFields } from "./audit-fields";

export type { AuditFields, AuditScalar, AuditValue } from "./audit-fields";

/**
 * AUDIT JURNALIGA YOZISH — VIP VA PROFIL AMALLARI (§37, §56).
 *
 * Mavjud `logAudit` (src/lib/audit.ts) dan farqi:
 *
 *   1. HODISA NOMI KATALOGDAN (`audit-events.ts`). Erkin matn emas:
 *      panel har bir yozuvni odam tilida tushuntira olishi uchun.
 *   2. QIYMATLAR TEKIS. `before`/`after`/`metadata` ga faqat oddiy
 *      qiymat (matn, son, mantiqiy, ro'yxat) beriladi — butun obyekt
 *      (bazadan kelgan qator, `input`) EMAS. Butun obyekt kelajakda
 *      unga qo'shiladigan maydonni ham (parol xeshi, token) o'zi bilan
 *      jurnalga olib kirardi. Tip buni kompilyatsiya vaqtida to'sadi,
 *      `vip-audit.test.ts` esa chaqiruv joylarini tekshiradi.
 *   3. NATIJA QAYTARADI. Chaqiruvchi uni `await` qiladi: serverless
 *      muhitda javob qaytgandan keyin tugallanmagan so'rov uzilib
 *      qolishi mumkin va yozuv yo'qolardi.
 *
 * XATO AMALNI YIQITMAYDI. Jurnal amaldan KEYIN yoziladi: amal bazaga
 * tushgan, foydalanuvchiga "xato" deyish yolg'on bo'lardi. Xato logga
 * aniq hodisa nomi bilan chiqadi — kuzatuvda ko'rinadi.
 *
 * Tozalash qoidalari (sir kalitlari, uzun matn) sof `audit-fields.ts`
 * da — testda shu fayl yuklanadi.
 */

export interface AuditInput {
  /** Kim. `null` — fon vazifasi yoki tizim (odam emas). */
  actorId: string | null;
  /** Qaysi obyekt. Tur katalogdagi `entity` dan olinadi. */
  entityId: string | null;
  reason?: string | null;
  before?: AuditFields | null;
  after?: AuditFields | null;
  metadata?: AuditFields;
}

export async function recordAudit(event: AuditEventKey, input: AuditInput): Promise<boolean> {
  const spec = AUDIT_EVENTS[event];

  try {
    const { error } = await createSupabaseAdminClient().from("audit_logs").insert({
      actor_id: input.actorId,
      action: event,
      entity_type: spec.entity,
      entity_id: input.entityId,
      old_value: cleanAuditFields(input.before),
      new_value: cleanAuditFields(input.after),
      reason: cleanAuditReason(input.reason),
      severity: spec.severity,
      metadata: cleanAuditFields(input.metadata) ?? {},
    });

    if (error) {
      console.error("[audit] yozilmadi:", { event, entityId: input.entityId, message: error.message });
      return false;
    }
    return true;
  } catch (err) {
    console.error("[audit] yozilmadi:", {
      event,
      entityId: input.entityId,
      message: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}
