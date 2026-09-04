/**
 * Botdagi jamoviy chop etish xabarlari — sof modul.
 *
 * Panel bilan AYNAN bir xil batch ustida ishlaydi: bot tugmasi yangi oqim
 * yaratmaydi, saytdagi navbatni boshlaydi va o'sha navbatning holatini
 * ko'rsatadi. Shuning uchun bu yerda faqat matn — hisob-kitob ham, holat ham
 * publish-batch.ts dan keladi.
 */

/** Blocks in the text progress bar. Ten reads cleanly on a phone. */
const BAR_WIDTH = 10;

export function progressBar(percent: number): string {
  const clamped = Math.max(0, Math.min(100, Math.round(percent)));
  const filled = Math.round((clamped / 100) * BAR_WIDTH);
  return `${"█".repeat(filled)}${"░".repeat(BAR_WIDTH - filled)} ${clamped}%`;
}

/** mm:ss, or "1 s 20 d" once it passes an hour. */
export function formatDurationUz(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  if (minutes >= 60) return `${Math.floor(minutes / 60)} s ${minutes % 60} d`;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function buildBatchStartedText(total: number): string {
  return [
    "🚀 JAMOVIY CHOP ETISH BOSHLANDI",
    "",
    `📋 Jami: ${total} ta nomzod`,
    "🔢 Tartib: anketa yuborilgan vaqti bo‘yicha",
    "⚙️ Har biri navbat bilan qayta ishlanadi",
    "",
    "Holatni ko‘rish uchun shu tugmani yana bosing.",
  ].join("\n");
}

export function buildNothingToPublishText(): string {
  return [
    "ℹ️ CHOP ETISHGA TAYYOR NOMZOD YO‘Q",
    "",
    "To‘lovi tasdiqlangan va hali chop etilmagan nomzod topilmadi.",
    "",
    "Sabablari: to‘lov hali so‘ralmagan, javob berilmagan,",
    "yoki bugungilar allaqachon chop etilgan.",
  ].join("\n");
}

export interface BatchProgressText {
  status: string;
  total: number;
  completed: number;
  failed: number;
  remaining: number;
  percent: number;
  currentName: string | null;
  currentStage: string | null;
  elapsedMs: number;
  etaMs: number | null;
}

const STATUS_LABELS: Record<string, string> = {
  queued: "⏸ Navbatda",
  running: "⚙️ Ishlamoqda",
  paused: "⏸ To‘xtatilgan",
  completed: "✅ Yakunlandi",
  completed_with_errors: "⚠️ Xatolar bilan yakunlandi",
  failed: "❌ Muvaffaqiyatsiz",
  cancelled: "🚫 Bekor qilingan",
};

export function buildBatchProgressText(p: BatchProgressText): string {
  const lines = [
    "🚀 JAMOVIY CHOP ETISH",
    STATUS_LABELS[p.status] ?? p.status,
    "",
    progressBar(p.percent),
    "",
    `✅ Qilindi: ${p.completed}`,
  ];

  if (p.currentName) {
    lines.push(`⚙️ Qilinyapti: ${p.currentName}`);
    if (p.currentStage) lines.push(`   └ ${p.currentStage}`);
  }

  lines.push(`📋 Qoldi: ${p.remaining}`);
  if (p.failed > 0) lines.push(`❌ Xato: ${p.failed}`);

  lines.push("", `⏱ O‘tgan vaqt: ${formatDurationUz(p.elapsedMs)}`);
  // Never a fabricated countdown: with nothing finished there is nothing to
  // average, and the message says so instead of inventing a number.
  lines.push(
    p.etaMs != null
      ? `⏳ Taxminiy qolgan: ~ ${formatDurationUz(p.etaMs)}`
      : "⏳ Taxminiy qolgan: hisoblanmoqda…",
  );

  return lines.join("\n");
}
