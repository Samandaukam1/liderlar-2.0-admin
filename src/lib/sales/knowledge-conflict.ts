/**
 * BILIM ZIDDIYATLARINI ANIQLASH — SOF MODUL.
 *
 * AUDIT TOPILMASI: bir mavzuda ikki qarama-qarshi tasdiqlangan
 * javob bor edi. Masalan bo'lib to'lash: tasdiqlangan bilimda
 * "chegirmasiz narxda mumkin", yaqindagi chatda esa oddiy "yo'q".
 * Retrieval token mosligi bo'yicha ishlaydi va ikkalasining ham
 * ballari yaqin — ya'ni javob AMALDA TASODIFIY tanlanardi.
 *
 * Mijoz uchun bu eng yomon holat: bugun "mumkin" eshitadi,
 * ertaga "mumkin emas". Shuning uchun ziddiyat topilsa IKKALASI
 * ham avtonom javobdan chiqariladi va odam hal qiladi.
 *
 * USUL: mavzu kaliti + POZITSIYA. Ikkalasi bir mavzuda, lekin
 * pozitsiyasi qarama-qarshi bo'lsa — ziddiyat.
 */

import { normalizeForMatch } from "./text-normalize.ts";

/** Pozitsiya: gap tasdiqlaydimi, inkor qiladimi. */
export type Stance = "affirm" | "deny" | "neutral";

export interface ConflictCandidate {
  id: string;
  question: string | null;
  answer: string;
  status: string;
}

export interface TopicMember {
  id: string;
  stance: Stance;
  excerpt: string;
}

export interface DetectedConflict {
  topicKey: string;
  topicLabel: string;
  members: TopicMember[];
  reason: string;
}

/**
 * MAVZULAR — ziddiyat faqat AYNAN BIR MAVZU ichida qidiriladi.
 *
 * Nega ro'yxat, umumiy o'xshashlik emas: "bo'lib to'lash mumkin
 * emas" va "chegirma tugadi" ikkalasi ham inkor, lekin ular
 * ziddiyat emas — ular boshqa-boshqa gap. Semantik yaqinlik bu
 * farqni ishonchli ushlay olmaydi, aniq mavzu kaliti ushlaydi.
 */
interface TopicRule {
  key: string;
  label: string;
  /** Mavzuga tegishlilik: shu naqshlarning BIRORTASI matnda bo'lsa. */
  match: readonly RegExp[];
}

const TOPICS: readonly TopicRule[] = [
  {
    key: "installment",
    label: "Bo‘lib to‘lash",
    match: [/\bbo['’ʻ]?lib\s+to['’ʻ]?la/i, /\bqismlarga\s+bo['’ʻ]?l/i, /\brassrochka\b/i],
  },
  {
    key: "refund",
    label: "Pulni qaytarish",
    match: [/\bpulni\s+qaytar/i, /\bqaytarib\s+ber/i, /\brefund\b/i],
  },
  {
    key: "free_of_charge",
    label: "Bepulmi",
    match: [/\bbepul\b/i, /\btekin\b/i],
  },
  {
    key: "discount_active",
    label: "Chegirma amaldami",
    match: [/\bchegirma\b/i, /\baksiya\b/i],
  },
  {
    key: "certificate_availability",
    label: "Sertifikat beriladimi",
    match: [/\bsertifikat\b/i, /\bguvohnoma\b/i],
  },
  {
    key: "article_authorship",
    label: "Maqolani kim yozadi",
    match: [/\bmaqolani\s+kim\s+yoz/i, /\bmaqola\s+yoz(asiz|amiz|ib beras)/i],
  },
  {
    key: "grant_guarantee",
    label: "Grant/stipendiya kafolati",
    match: [/\bgrant\b/i, /\bstipendiya\b/i, /\bkontraktdan\b/i],
  },
  {
    key: "photo_required",
    label: "Rasm majburiymi",
    match: [/\brasm(ingiz)?\s+(kerak|majburiy|shart)/i, /\bsurat\s+(kerak|majburiy)/i],
  },
];

/* ------------------------------ pozitsiya ------------------------------- */

/** Inkorni bildiruvchi shakllar — o'zbekchada qo'shimcha bilan keladi. */
const DENY_PATTERNS: readonly RegExp[] = [
  /\bmumkin\s+emas\b/i,
  /\byo['’ʻ]?q\b/i,
  /\bbo['’ʻ]?lmaydi\b/i,
  /\bberilmaydi\b/i,
  /\bqaytarilmaydi\b/i,
  /\bkafolatla(y|n)maydi\b/i,
  /\bimkoni\s+yo['’ʻ]?q\b/i,
  /\bemas\b/i,
];

const AFFIRM_PATTERNS: readonly RegExp[] = [
  /\bmumkin\b/i,
  /\bha[,.\s]/i,
  /\bbor\b/i,
  /\bberiladi\b/i,
  /\btaqdim\s+etiladi\b/i,
  /\bmavjud\b/i,
];

/**
 * Gapning pozitsiyasi.
 *
 * INKOR USTUN: "bo'lib to'lash mumkin emas" ichida "mumkin" ham
 * bor. Avval inkor tekshirilmasa, bu gap "ha, mumkin" deb
 * o'qilardi — ya'ni ziddiyat aniqlanish o'rniga yaratilardi.
 */
export function detectStance(text: string): Stance {
  const normalized = normalizeForMatch(text);
  if (DENY_PATTERNS.some((pattern) => pattern.test(normalized))) return "deny";
  if (AFFIRM_PATTERNS.some((pattern) => pattern.test(normalized))) return "affirm";
  return "neutral";
}

/** Yozuv qaysi mavzularga tegishli (bir nechta bo'lishi mumkin). */
export function topicsFor(candidate: ConflictCandidate): string[] {
  const haystack = normalizeForMatch(`${candidate.question ?? ""} ${candidate.answer}`);
  return TOPICS.filter((topic) => topic.match.some((pattern) => pattern.test(haystack))).map(
    (topic) => topic.key,
  );
}

/**
 * Tasdiqlangan bilimlar ichidan ziddiyatlarni topadi.
 *
 * FAQAT `approved` tekshiriladi: qoralama hali javobda
 * ishlatilmaydi, shuning uchun u ziddiyat yaratmaydi.
 */
export function detectConflicts(
  candidates: readonly ConflictCandidate[],
): DetectedConflict[] {
  const byTopic = new Map<string, TopicMember[]>();

  for (const candidate of candidates) {
    if (candidate.status !== "approved") continue;
    const stance = detectStance(candidate.answer);
    if (stance === "neutral") continue;

    for (const topicKey of topicsFor(candidate)) {
      const list = byTopic.get(topicKey) ?? [];
      list.push({
        id: candidate.id,
        stance,
        excerpt: candidate.answer.slice(0, 200),
      });
      byTopic.set(topicKey, list);
    }
  }

  const conflicts: DetectedConflict[] = [];
  for (const [topicKey, members] of byTopic) {
    const affirm = members.filter((member) => member.stance === "affirm");
    const deny = members.filter((member) => member.stance === "deny");
    // Ikkala pozitsiya ham bo'lsagina ziddiyat. Bitta tomon
    // takrorlangani ziddiyat emas.
    if (affirm.length === 0 || deny.length === 0) continue;

    const topic = TOPICS.find((entry) => entry.key === topicKey);
    conflicts.push({
      topicKey,
      topicLabel: topic?.label ?? topicKey,
      members,
      reason:
        `"${topic?.label ?? topicKey}" mavzusida ${affirm.length} ta tasdiq va ` +
        `${deny.length} ta inkor javob tasdiqlangan.`,
    });
  }

  return conflicts.sort((a, b) => b.members.length - a.members.length);
}

/** Ziddiyatga tushgan barcha bilim identifikatorlari. */
export function conflictedKnowledgeIds(conflicts: readonly DetectedConflict[]): Set<string> {
  const ids = new Set<string>();
  for (const conflict of conflicts) {
    for (const member of conflict.members) ids.add(member.id);
  }
  return ids;
}
