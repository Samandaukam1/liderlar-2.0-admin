/**
 * FAQ KLASTERLASH — SOF MODUL.
 *
 * IKKI QAT'IY QOIDA (13 va 15-band):
 *
 * 1. ORTIQCHA BIRLASHTIRMA. Ma'nosi yaqin, lekin JAVOBI boshqa
 *    savollar alohida qoladi. "Sertifikat berasizmi" (xizmat
 *    tarkibi) va "sertifikat qachon keladi" (yetkazib berish
 *    holati) bitta klaster bo'lsa, bot yarim mijozga noto'g'ri
 *    javob berardi.
 *
 * 2. XABAR SONI ≠ SUHBAT SONI. Bitta mijoz bir savolni o'n marta
 *    yozsa, u o'n mijozdek ko'rinmasligi kerak. Ikkala son ham
 *    saqlanadi va adminda IKKALASI ko'rsatiladi.
 */

import type { MinedQuestion, QuestionKind } from "./question-mining.ts";

export interface QuestionOccurrence {
  mined: MinedQuestion;
  conversationId: string;
  messageId: string | null;
  /** REDAKSIYADAN O'TGAN asl matn. Xom matn bu yerga kelmaydi. */
  redactedText: string;
  askedAt: string | null;
}

export interface FaqCluster {
  /** Lug'atdagi niyat kaliti, yoki noma'lum savol uchun sintetik kalit. */
  clusterKey: string;
  intentKey: string | null;
  canonicalQuestion: string;
  kind: QuestionKind;
  category: string;
  /** Necha marta yozilgan. */
  messageCount: number;
  /** Nechta BOSHQA suhbatda. Yagona halol "talab" o'lchovi. */
  conversationCount: number;
  /** Mijozlar aynan qanday yozgani (redaksiyalangan, takrorsiz). */
  variants: string[];
  examples: Array<{ text: string; conversationId: string; askedAt: string | null }>;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
}

/** Bitta klasterda saqlanadigan eng ko'p variant/namuna. */
const MAX_VARIANTS = 12;
const MAX_EXAMPLES = 5;

/**
 * Noma'lum savol uchun klaster kaliti.
 *
 * Me'yorlashtirilgan matnning ilk to'rt so'zi olinadi: "hujjat
 * kerakmi menga" va "menga hujjat kerakmi" bitta klasterga
 * tushmaydi, lekin bir xil yozilgan savollar birlashadi.
 * Bu ATAYLAB EHTIYOTKOR — ortiqcha birlashtirishdan ko'ra
 * ortiqcha bo'linish xavfsizroq: admin ikkitasini qo'lda
 * birlashtira oladi, noto'g'ri birlashtirilganini esa
 * ajratib bo'lmaydi.
 */
export function unknownClusterKey(normalized: string): string {
  const words = normalized.split(/\s+/).filter(Boolean).slice(0, 4);
  return `unknown:${words.join("_") || "empty"}`;
}

export function clusterQuestions(
  occurrences: readonly QuestionOccurrence[],
): FaqCluster[] {
  const groups = new Map<
    string,
    {
      cluster: FaqCluster;
      conversations: Set<string>;
      variantSet: Set<string>;
    }
  >();

  for (const occurrence of occurrences) {
    const { mined } = occurrence;
    const clusterKey = mined.intentKey ?? unknownClusterKey(mined.normalized);

    let group = groups.get(clusterKey);
    if (!group) {
      group = {
        cluster: {
          clusterKey,
          intentKey: mined.intentKey,
          // Lug'atdagi nom bo'lsa o'sha; bo'lmasa mijozning
          // O'Z SO'ZI kanonik savol bo'ladi — biz savolni
          // o'ylab topmaymiz.
          canonicalQuestion: mined.intentLabel ?? occurrence.redactedText.trim(),
          kind: mined.kind,
          category: mined.category,
          messageCount: 0,
          conversationCount: 0,
          variants: [],
          examples: [],
          firstSeenAt: occurrence.askedAt,
          lastSeenAt: occurrence.askedAt,
        },
        conversations: new Set(),
        variantSet: new Set(),
      };
      groups.set(clusterKey, group);
    }

    group.cluster.messageCount += 1;
    group.conversations.add(occurrence.conversationId);

    const variant = occurrence.redactedText.trim();
    if (variant !== "" && !group.variantSet.has(variant) && group.variantSet.size < MAX_VARIANTS) {
      group.variantSet.add(variant);
      group.cluster.variants.push(variant);
    }

    if (group.cluster.examples.length < MAX_EXAMPLES) {
      group.cluster.examples.push({
        text: variant,
        conversationId: occurrence.conversationId,
        askedAt: occurrence.askedAt,
      });
    }

    if (occurrence.askedAt) {
      if (!group.cluster.firstSeenAt || occurrence.askedAt < group.cluster.firstSeenAt) {
        group.cluster.firstSeenAt = occurrence.askedAt;
      }
      if (!group.cluster.lastSeenAt || occurrence.askedAt > group.cluster.lastSeenAt) {
        group.cluster.lastSeenAt = occurrence.askedAt;
      }
    }
  }

  const clusters: FaqCluster[] = [];
  for (const group of groups.values()) {
    group.cluster.conversationCount = group.conversations.size;
    clusters.push(group.cluster);
  }

  // TARTIB SUHBAT SONI BO'YICHA, xabar soni bo'yicha emas:
  // bitta mijozning o'n takrori ro'yxat boshiga chiqmasligi kerak.
  return clusters.sort(
    (a, b) => b.conversationCount - a.conversationCount || b.messageCount - a.messageCount,
  );
}

/* ------------------------------ TOP ro'yxatlar --------------------------- */

export interface TopQuestionRow {
  clusterKey: string;
  question: string;
  category: string;
  kind: QuestionKind;
  messageCount: number;
  conversationCount: number;
  answered: boolean;
}

/**
 * TOP savollar.
 *
 * `limit` — KO'RSATISH chegarasi, qamrov chegarasi EMAS. Ro'yxat
 * qisqartirilgani "boshqa savol yo'q" degani emas va admin
 * sahifasida jami klaster soni ham ko'rsatiladi.
 */
export function topQuestions(
  clusters: readonly FaqCluster[],
  answeredKeys: ReadonlySet<string>,
  limit = 20,
): TopQuestionRow[] {
  return clusters.slice(0, limit).map((cluster) => ({
    clusterKey: cluster.clusterKey,
    question: cluster.canonicalQuestion,
    category: cluster.category,
    kind: cluster.kind,
    messageCount: cluster.messageCount,
    conversationCount: cluster.conversationCount,
    answered: answeredKeys.has(cluster.clusterKey),
  }));
}

/** Javobi yo'q savollar — bilim bo'shlig'ining eng aniq ko'rsatkichi. */
export function topUnanswered(
  clusters: readonly FaqCluster[],
  answeredKeys: ReadonlySet<string>,
  limit = 20,
): TopQuestionRow[] {
  return topQuestions(
    clusters.filter((cluster) => !answeredKeys.has(cluster.clusterKey)),
    answeredKeys,
    limit,
  );
}

/**
 * YANGI savollar — oldingi yugurishda umuman bo'lmagan klasterlar.
 */
export function newClusters(
  current: readonly FaqCluster[],
  previousKeys: ReadonlySet<string>,
): FaqCluster[] {
  return current.filter((cluster) => !previousKeys.has(cluster.clusterKey));
}

/**
 * O'SAYOTGAN savollar.
 *
 * Faqat NAMUNA YETARLI bo'lganda: 1 dan 2 ga o'sish "100% o'sish"
 * emas, shovqin. Shuning uchun eski qiymat kamida `minBase`
 * bo'lishi shart.
 */
export function growingClusters(
  current: readonly FaqCluster[],
  previousCounts: ReadonlyMap<string, number>,
  options: { minBase?: number; minGrowth?: number } = {},
): Array<{ cluster: FaqCluster; previous: number; growth: number }> {
  const minBase = options.minBase ?? 3;
  const minGrowth = options.minGrowth ?? 1.5;

  const rows: Array<{ cluster: FaqCluster; previous: number; growth: number }> = [];
  for (const cluster of current) {
    const previous = previousCounts.get(cluster.clusterKey) ?? 0;
    if (previous < minBase) continue;
    const growth = cluster.conversationCount / previous;
    if (growth < minGrowth) continue;
    rows.push({ cluster, previous, growth: Math.round(growth * 100) / 100 });
  }
  return rows.sort((a, b) => b.growth - a.growth);
}
