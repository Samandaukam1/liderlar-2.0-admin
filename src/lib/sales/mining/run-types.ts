/**
 * QAZISH YUGURISHI TURLARI — SOF MODUL.
 *
 * NEGA ALOHIDA FAYL: `learning-run.ts` `server-only` va Supabase
 * admin klientini import qiladi. Admin sahifasidagi klient
 * komponent esa yugurish holatining NOMINI ko'rsatishi kerak.
 *
 * Yorliqni server modulidan olish butun server zanjirini brauzer
 * bandliga tortadi va build yiqiladi — aynan shunday bo'lgan edi.
 * Nomlar va turlar shu yerda, I/O esa `learning-run.ts` da qoladi.
 */

export type RunKind = "incremental" | "full_rebuild";
export type RunStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export const RUN_STATUS_LABELS: Record<RunStatus, string> = {
  queued: "Navbatda",
  running: "Ishlamoqda",
  completed: "Tugadi",
  failed: "Xato",
  cancelled: "Bekor qilingan",
};

export const RUN_KIND_LABELS: Record<RunKind, string> = {
  incremental: "Yangilash",
  full_rebuild: "To‘liq qayta qurish",
};
