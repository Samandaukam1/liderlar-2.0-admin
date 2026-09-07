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

/** Chuqur o'rganish (oxirgi N suhbatning barcha xabarlari) parametrlari. */
export interface SalesDeepLearningSettings {
  /** Nechta eng so'nggi suhbat olinadi. */
  targetConversations: number;
  /** Bitta AI chaqiruviga nechta suhbat kiradi. */
  batchSize: number;
  /** Bitta suhbatdan olinadigan eng ko'p xabar (kontekst chegarasi). */
  maxMessagesPerConversation: number;
}

/** 0.2 sotuv oqimi sozlamalari. */
export interface SalesFlowSettings {
  /**
   * Mijozga avtomatik javob yozish. STANDART QIYMAT — O'CHIQ.
   *
   * 0.1 dagi kafolat "bot hech kimga yozmaydi" edi. Migratsiya bu
   * kalitni `false` bilan qo'shadi, ya'ni kod deploy bo'lgani bilan
   * bot jim qoladi; yoqishni admin ataylab qiladi.
   */
  autoReplyEnabled: boolean;
  followupOfferReviewMinutes: number;
  followupArticleDecisionMinutes: number;
  followupLaterMinutes: number;
}

export interface SalesSettings {
  recencyBuckets: readonly RecencyBucket[];
  learning: SalesLearningSettings;
  deepLearning: SalesDeepLearningSettings;
  flow: SalesFlowSettings;
}

export const DEFAULT_LEARNING_SETTINGS: SalesLearningSettings = {
  batchSize: 25,
  minMessagesPerConversation: 4,
};

export const DEFAULT_FLOW_SETTINGS: SalesFlowSettings = {
  autoReplyEnabled: false,
  followupOfferReviewMinutes: 7,
  followupArticleDecisionMinutes: 5,
  followupLaterMinutes: 60,
};

function parseFlow(value: unknown): SalesFlowSettings {
  if (!value || typeof value !== "object") return DEFAULT_FLOW_SETTINGS;
  const raw = value as Record<string, unknown>;
  const minutes = (input: unknown, fallback: number) => {
    const n = typeof input === "number" ? Math.round(input) : Number.NaN;
    return Number.isFinite(n) && n >= 1 && n <= 10_080 ? n : fallback;
  };
  return {
    // Faqat ANIQ `true` yoqadi: nosoz qiymat botni jim qoldiradi.
    autoReplyEnabled: raw.autoReplyEnabled === true,
    followupOfferReviewMinutes: minutes(
      raw.followupOfferReviewMinutes,
      DEFAULT_FLOW_SETTINGS.followupOfferReviewMinutes,
    ),
    followupArticleDecisionMinutes: minutes(
      raw.followupArticleDecisionMinutes,
      DEFAULT_FLOW_SETTINGS.followupArticleDecisionMinutes,
    ),
    followupLaterMinutes: minutes(
      raw.followupLaterMinutes,
      DEFAULT_FLOW_SETTINGS.followupLaterMinutes,
    ),
  };
}

export const DEFAULT_DEEP_LEARNING_SETTINGS: SalesDeepLearningSettings = {
  targetConversations: 500,
  // 10–25 oralig'i: kattaroq batch kontekstni to'ldirib, sifatni
  // tushiradi; kichigi esa chaqiruvlar sonini oshiradi.
  batchSize: 15,
  maxMessagesPerConversation: 400,
};

function parseDeepLearning(value: unknown): SalesDeepLearningSettings {
  if (!value || typeof value !== "object") return DEFAULT_DEEP_LEARNING_SETTINGS;
  const raw = value as Record<string, unknown>;
  const int = (input: unknown, fallback: number, min: number, max: number) => {
    const n = typeof input === "number" ? Math.round(input) : Number.NaN;
    return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
  };
  return {
    targetConversations: int(
      raw.targetConversations,
      DEFAULT_DEEP_LEARNING_SETTINGS.targetConversations,
      1,
      2000,
    ),
    batchSize: int(raw.batchSize, DEFAULT_DEEP_LEARNING_SETTINGS.batchSize, 1, 25),
    maxMessagesPerConversation: int(
      raw.maxMessagesPerConversation,
      DEFAULT_DEEP_LEARNING_SETTINGS.maxMessagesPerConversation,
      10,
      2000,
    ),
  };
}

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
      .in("key", ["recency_buckets", "learning", "deep_learning", "flow"]);

    const map = new Map((data ?? []).map((row) => [row.key as string, row.value]));
    return {
      recencyBuckets: parseRecencyBuckets(map.get("recency_buckets")),
      learning: parseLearning(map.get("learning")),
      deepLearning: parseDeepLearning(map.get("deep_learning")),
      flow: parseFlow(map.get("flow")),
    };
  } catch {
    return {
      recencyBuckets: DEFAULT_RECENCY_BUCKETS,
      learning: DEFAULT_LEARNING_SETTINGS,
      deepLearning: DEFAULT_DEEP_LEARNING_SETTINGS,
      // Baza yetib bo'lmasa avto-javob O'CHIQ qoladi — jim qolish
      // noto'g'ri javob yuborishdan xavfsizroq.
      flow: DEFAULT_FLOW_SETTINGS,
    };
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
