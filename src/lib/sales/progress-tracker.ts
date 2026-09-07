/**
 * O'rganish progressi — HAQIQIY sanoq asosida.
 *
 * "Fake progress bo'lmasin" talabi shu modulda majburlanadi: foiz faqat
 * `processedConversations / targetConversations` dan chiqadi, taymerdan
 * emas. ETA ham shunday — o'lchangan tezlikdan hisoblanadi, va tezlik hali
 * o'lchanmagan bo'lsa `null` qaytadi ("3m 12s" deb o'ylab topilmaydi).
 */

export const LEARNING_STAGES = [
  { key: "queued", label: "Navbatda", startPercent: 0, endPercent: 1 },
  { key: "loading", label: "Suhbatlar yuklanmoqda", startPercent: 1, endPercent: 10 },
  { key: "indexing", label: "Xabarlar indekslanmoqda", startPercent: 10, endPercent: 25 },
  { key: "clustering", label: "Savollar clustering", startPercent: 25, endPercent: 45 },
  { key: "patterns", label: "Response patterns", startPercent: 45, endPercent: 65 },
  { key: "outcomes", label: "Sales outcome analysis", startPercent: 65, endPercent: 80 },
  { key: "style", label: "Style profile", startPercent: 80, endPercent: 95 },
  { key: "aggregation", label: "Knowledge aggregation", startPercent: 95, endPercent: 100 },
  { key: "done", label: "Tayyor", startPercent: 100, endPercent: 100 },
] as const;

export type LearningStage = (typeof LEARNING_STAGES)[number]["key"];

const STAGE_BY_KEY = new Map(LEARNING_STAGES.map((s) => [s.key, s]));

export function stageLabel(stage: string): string {
  return STAGE_BY_KEY.get(stage as LearningStage)?.label ?? stage;
}

/**
 * Bosqichlar KETMA-KET emas, PARALLEL kechadi: bitta batch ichida
 * clustering ham, pattern ham, outcome ham bajariladi. Shuning uchun
 * foiz batch'ning o'zidan hisoblanadi va bosqich nomi shunchaki "hozir
 * nima ustida ishlanyapti" degan yorliq bo'lib qoladi — u foizni
 * oldinga surib yubormaydi.
 *
 * `clustering` dan `outcomes` gacha bo'lgan oraliq (25–80%) batch
 * ishlashiga tegishli; undan oldingi va keyingi bosqichlar o'z
 * oralig'ini to'liq egallaydi.
 */
const BATCH_STAGE_START = 25;
const BATCH_STAGE_END = 80;

export interface ProgressInput {
  stage: LearningStage;
  processedConversations: number;
  targetConversations: number;
  processedMessages: number;
  totalMessages: number;
  startedAt: string | Date | null;
  now?: string | Date;
}

export interface RunProgress {
  percent: number;
  stage: LearningStage;
  stageLabel: string;
  /** "327 / 500" */
  conversationLabel: string;
  /** "5 840 / 8 421" */
  messageLabel: string;
  /** Sekundlarda. O'lchash uchun ma'lumot yetmasa null. */
  etaSeconds: number | null;
  /** Suhbat/sekund. Hali o'lchanmagan bo'lsa null. */
  throughput: number | null;
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const groupDigits = (n: number) => n.toLocaleString("uz-UZ").replace(/,/g, " ");

export function computeRunProgress(input: ProgressInput): RunProgress {
  const stage = STAGE_BY_KEY.get(input.stage) ? input.stage : "queued";
  const meta = STAGE_BY_KEY.get(stage)!;

  const target = Math.max(0, input.targetConversations);
  const processed = clamp(input.processedConversations, 0, target || input.processedConversations);

  let percent: number;
  if (stage === "done") {
    percent = 100;
  } else if (meta.startPercent >= BATCH_STAGE_START && meta.startPercent < BATCH_STAGE_END) {
    // Batch bosqichlari — foiz REAL ishlangan suhbatlardan.
    const fraction = target > 0 ? processed / target : 0;
    percent = BATCH_STAGE_START + (BATCH_STAGE_END - BATCH_STAGE_START) * fraction;
  } else {
    percent = meta.startPercent;
  }

  // Tezlik va ETA faqat o'lchangan ish asosida.
  let throughput: number | null = null;
  let etaSeconds: number | null = null;
  if (input.startedAt && processed > 0 && stage !== "done") {
    const started = new Date(input.startedAt).getTime();
    const now = input.now ? new Date(input.now).getTime() : Date.now();
    const elapsedSeconds = (now - started) / 1000;
    if (elapsedSeconds > 0) {
      throughput = processed / elapsedSeconds;
      const remaining = Math.max(0, target - processed);
      etaSeconds = throughput > 0 ? Math.round(remaining / throughput) : null;
    }
  }

  return {
    percent: Math.round(clamp(percent, 0, 100) * 10) / 10,
    stage,
    stageLabel: meta.label,
    conversationLabel: `${groupDigits(processed)} / ${groupDigits(target)}`,
    messageLabel: `${groupDigits(Math.max(0, input.processedMessages))} / ${groupDigits(Math.max(0, input.totalMessages))}`,
    etaSeconds,
    throughput: throughput != null ? Math.round(throughput * 1000) / 1000 : null,
  };
}

/** "3m 12s". Noma'lum bo'lsa "—" — o'ylab topilgan raqam emas. */
export function formatEta(seconds: number | null): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return "—";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  if (minutes < 60) return `${minutes}m ${rest}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}
