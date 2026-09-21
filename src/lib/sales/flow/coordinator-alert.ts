import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isCoordinatorBotConfigured, sendCoordinatorMessage } from "@/lib/coordinators/bot-api";

/**
 * TO'LOV KELGANDA KOORDINATORGA XABAR.
 *
 * Chek kelgani ODAM ARALASHUVI kerak bo'lgan lahza: uni
 * tekshirish, tasdiqlash va nomzod bilan ishni davom
 * ettirish kerak. Bot buni o'zi qila olmaydi.
 *
 * XABAR — TO'LOV TASDIG'I EMAS. Chek kelgani pul kelganini
 * bildirmaydi; u faqat "qarab chiqing" degan signal. Shuning
 * uchun matn ham shunday yozilgan: "tekshirish kerak", "to'lov
 * qabul qilindi" emas.
 */

export interface AlertResult {
  ok: boolean;
  notified: number;
  reason: "sent" | "no_coordinators" | "not_configured" | "error";
}

/**
 * Chek kelganini koordinatorlarga bildiradi.
 *
 * XATO BO'LSA HAM SOTUV OQIMI TO'XTAMAYDI. Xabar yetmagani
 * yomon, lekin chek yozuvi bazada qoladi va admin uni panelda
 * ko'radi. Chaqiruvchi bu funksiyaning natijasini kutmasligi
 * ham mumkin.
 */
export async function alertCoordinatorsOnPayment(input: {
  conversationId: string;
  customerName: string | null;
}): Promise<AlertResult> {
  if (!isCoordinatorBotConfigured()) {
    return { ok: false, notified: 0, reason: "not_configured" };
  }

  const db = createSupabaseAdminClient();

  /*
   * Kimga: faol va Telegram'ga ulangan koordinatorlar.
   *
   * Raqamli id bo'yicha — username o'zgaradi va uni boshqa
   * odam egallashi mumkin.
   */
  const { data, error } = await db
    .from("coordinators")
    .select("id, full_name, telegram_user_id")
    .eq("is_active", true)
    .eq("status", "active")
    .not("telegram_user_id", "is", null);

  if (error) {
    console.error("COORDINATOR_ALERT_LOOKUP_FAILED", { code: error.code });
    return { ok: false, notified: 0, reason: "error" };
  }

  const coordinators = (data ?? []) as {
    id: string;
    full_name: string;
    telegram_user_id: number;
  }[];

  if (coordinators.length === 0) {
    return { ok: false, notified: 0, reason: "no_coordinators" };
  }

  const name = input.customerName?.trim() || "Ism ko'rsatilmagan";

  const text = [
    "💳 <b>Chek keldi — tekshirish kerak</b>",
    "",
    `Mijoz: <b>${escapeHtml(name)}</b>`,
    "",
    "Chek AI sotuv botida qabul qilindi. To'lov hali TASDIQLANMAGAN —",
    "admin panelda ko'rib chiqing va tasdiqlang.",
  ].join("\n");

  let notified = 0;
  for (const coordinator of coordinators) {
    const result = await sendCoordinatorMessage(coordinator.telegram_user_id, text);
    if (result.ok) notified += 1;
    else {
      console.warn("COORDINATOR_ALERT_FAILED", {
        coordinatorId: coordinator.id,
        // Xato matni transport tomonidan tozalangan — token tushmaydi.
        error: result.error,
      });
    }
  }

  return {
    ok: notified > 0,
    notified,
    reason: notified > 0 ? "sent" : "error",
  };
}

/** Telegram HTML rejimida ism buzmasligi uchun. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
