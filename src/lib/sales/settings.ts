import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  DEFAULT_RECENCY_BUCKETS,
  parseRecencyBuckets,
  type RecencyBucket,
} from "./recency.ts";

/**
 * AI Sotuv sozlamalari — `sales_settings` (key -> jsonb).
 *
 * Recency og'irliklari kodda qotib qolmasligi kerak (talab 6), shuning
 * uchun ular shu yerdan o'qiladi. Baza yetib bo'lmasa yoki qiymat nosoz
 * bo'lsa standart jadval ishlatiladi — o'rganish sozlama xatosi tufayli
 * to'xtab qolmaydi.
 */

export interface SalesLearningSettings {
  /** Bitta yugurishda nechta suhbat o'rganiladi. */
  batchSize: number;
  /** Shundan kam xabarli suhbat 'skipped' bo'ladi. */
  minMessagesPerConversation: number;
}

export interface SalesSettings {
  recencyBuckets: readonly RecencyBucket[];
  learning: SalesLearningSettings;
}

export const DEFAULT_LEARNING_SETTINGS: SalesLearningSettings = {
  batchSize: 25,
  minMessagesPerConversation: 4,
};

function parseLearning(value: unknown): SalesLearningSettings {
  if (!value || typeof value !== "object") return DEFAULT_LEARNING_SETTINGS;
  const raw = value as Record<string, unknown>;
  const int = (input: unknown, fallback: number, min: number, max: number) => {
    const n = typeof input === "number" ? Math.round(input) : Number.NaN;
    return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
  };
  return {
    batchSize: int(raw.batchSize, DEFAULT_LEARNING_SETTINGS.batchSize, 1, 200),
    minMessagesPerConversation: int(
      raw.minMessagesPerConversation,
      DEFAULT_LEARNING_SETTINGS.minMessagesPerConversation,
      1,
      100,
    ),
  };
}

export async function getSalesSettings(): Promise<SalesSettings> {
  try {
    const admin = createSupabaseAdminClient();
    const { data } = await admin
      .from("sales_settings")
      .select("key, value")
      .in("key", ["recency_buckets", "learning"]);

    const map = new Map((data ?? []).map((row) => [row.key as string, row.value]));
    return {
      recencyBuckets: parseRecencyBuckets(map.get("recency_buckets")),
      learning: parseLearning(map.get("learning")),
    };
  } catch {
    return { recencyBuckets: DEFAULT_RECENCY_BUCKETS, learning: DEFAULT_LEARNING_SETTINGS };
  }
}

export async function saveSalesSetting(
  key: string,
  value: unknown,
  updatedBy: string | null,
): Promise<void> {
  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("sales_settings")
    .upsert(
      { key, value, updated_by: updatedBy, updated_at: new Date().toISOString() },
      { onConflict: "key" },
    );
  if (error) throw new Error(error.message);
}
