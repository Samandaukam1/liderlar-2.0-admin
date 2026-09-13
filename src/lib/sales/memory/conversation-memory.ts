/**
 * TUZILMALI SUHBAT XOTIRASI — SOF MODUL.
 *
 * MUAMMO (24–26-band): bot oxirgi 10 ta xom xabarga tayanardi.
 * Suhbat 30 xabarga yetganda birinchi 20 tasi kontekstdan
 * CHIQIB KETARDI va u bilan birga:
 *
 *   · mijoz allaqachon to'laganini,
 *   · qanday savolga javob berilmaganini,
 *   · qanday va'da berilganini,
 *   · mijoz "boshqa yozmang" deganini
 *
 * bot UNUTARDI. Natijada to'lagan odamdan yana to'lov so'ralardi.
 *
 * YECHIM: holat xabar oynasidan ALOHIDA saqlanadi. Oyna siljiydi,
 * xotira qoladi.
 *
 * SOF MODUL: bazaga bormaydi. Saqlash `memory-store.ts` da.
 */

import type { LeadTemperature } from "../flow/lead-score.ts";
import type { SalesStage } from "../flow/stages.ts";

export interface PendingQuestion {
  /** REDAKSIYADAN O'TGAN savol matni. */
  text: string;
  askedAt: string;
  /** Klaster kaliti (ma'lum bo'lsa). */
  intentKey: string | null;
}

export interface SellerPromise {
  text: string;
  promisedAt: string;
  /** Bajarildimi. Bajarilmagan va'da har javobda ko'rinadi. */
  fulfilled: boolean;
  dueAt: string | null;
}

export interface CustomerCommitment {
  text: string;
  statedAt: string;
  /** Mijoz aytgan vaqt ("ishdan keyin", "ertaga") — o'z so'zi bilan. */
  timeHint: string | null;
}

export const PAYMENT_STATES = [
  "none",
  "requested",
  "customer_claimed",
  "evidence_received",
  "under_review",
  "confirmed",
  "rejected",
] as const;
export type PaymentState = (typeof PAYMENT_STATES)[number];

export const PAYMENT_STATE_LABELS: Record<PaymentState, string> = {
  none: "so‘ralmagan",
  requested: "so‘ralgan",
  customer_claimed: "mijoz “to‘ladim” dedi",
  evidence_received: "chek keldi",
  under_review: "tekshiruvda",
  confirmed: "TASDIQLANGAN",
  rejected: "rad etilgan",
};

/**
 * FAQAT `confirmed` — pul kelgani.
 *
 * "To'ladim" matni ham, chek skrinshoti ham moliyaviy tasdiq
 * EMAS (30-band). Ular alohida holat sifatida saqlanadi, chunki
 * ular ham foydali signal — lekin sotuv emas.
 */
export function isPaymentConfirmed(state: PaymentState): boolean {
  return state === "confirmed";
}

export const INTAKE_STATES = ["none", "link_sent", "started", "submitted"] as const;
export type IntakeState = (typeof INTAKE_STATES)[number];

export const PHOTO_STATES = ["none", "requested", "received", "rework", "approved"] as const;
export type PhotoState = (typeof PHOTO_STATES)[number];

export const PUBLICATION_STATES = ["none", "queued", "on_hold", "published"] as const;
export type PublicationState = (typeof PUBLICATION_STATES)[number];

export const CERTIFICATE_STATES = ["none", "promised", "issued"] as const;
export type CertificateState = (typeof CERTIFICATE_STATES)[number];

export interface ConversationMemory {
  /** Mijozning O'Z so'zi bilan maqsadi. Biz taxmin qilmaymiz. */
  customerGoal: string | null;
  currentStage: SalesStage | null;
  /** AI allaqachon tushuntirgan mavzular — qayta tushuntirmaydi. */
  answeredTopics: string[];
  pendingQuestions: PendingQuestion[];
  unresolvedObjections: string[];
  lastCta: string | null;
  customerCommitments: CustomerCommitment[];
  sellerPromises: SellerPromise[];
  /** Mijoz qachon yozishni so'ragani. */
  followupPreference: string | null;

  intakeStatus: IntakeState;
  paymentStatus: PaymentState;
  photoStatus: PhotoState;
  publicationStatus: PublicationState;
  certificateStatus: CertificateState;
  supportStatus: "none" | "open" | "resolved";

  humanTakeover: boolean;
  optOut: boolean;

  leadTemperature: LeadTemperature;
  leadScoreReasons: string[];

  /** Mijoz bergan va qayta so'ralmasligi kerak bo'lgan ma'lumot. */
  knownFacts: {
    fullName: string | null;
    articleInterest: boolean | null;
    region: string | null;
  };

  updatedAt: string | null;
}

export const EMPTY_MEMORY: ConversationMemory = {
  customerGoal: null,
  currentStage: null,
  answeredTopics: [],
  pendingQuestions: [],
  unresolvedObjections: [],
  lastCta: null,
  customerCommitments: [],
  sellerPromises: [],
  followupPreference: null,
  intakeStatus: "none",
  paymentStatus: "none",
  photoStatus: "none",
  publicationStatus: "none",
  certificateStatus: "none",
  supportStatus: "none",
  humanTakeover: false,
  optOut: false,
  leadTemperature: "cold",
  leadScoreReasons: [],
  knownFacts: { fullName: null, articleInterest: null, region: null },
  updatedAt: null,
};

/* ------------------------------ o'qish ---------------------------------- */

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function strArray(value: unknown, limit = 40): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string").slice(0, limit);
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

/**
 * Bazadagi jsonb'dan xotirani o'qiydi.
 *
 * NOSOZ QIYMAT XATO EMAS: xotira yo'qolgandan ko'ra bo'sh
 * bo'lgani yaxshi — bot holatni qayta aniqlaydi. Lekin nosoz
 * qiymat sabab javob umuman ketmasligi mumkin emas.
 */
export function parseMemory(value: unknown): ConversationMemory {
  if (!value || typeof value !== "object") return { ...EMPTY_MEMORY };
  const raw = value as Record<string, unknown>;

  const pending: PendingQuestion[] = Array.isArray(raw.pendingQuestions)
    ? raw.pendingQuestions
        .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
        .map((item) => ({
          text: str(item.text) ?? "",
          askedAt: str(item.askedAt) ?? "",
          intentKey: str(item.intentKey),
        }))
        .filter((item) => item.text !== "")
        .slice(0, 10)
    : [];

  const promises: SellerPromise[] = Array.isArray(raw.sellerPromises)
    ? raw.sellerPromises
        .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
        .map((item) => ({
          text: str(item.text) ?? "",
          promisedAt: str(item.promisedAt) ?? "",
          fulfilled: item.fulfilled === true,
          dueAt: str(item.dueAt),
        }))
        .filter((item) => item.text !== "")
        .slice(0, 10)
    : [];

  const commitments: CustomerCommitment[] = Array.isArray(raw.customerCommitments)
    ? raw.customerCommitments
        .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
        .map((item) => ({
          text: str(item.text) ?? "",
          statedAt: str(item.statedAt) ?? "",
          timeHint: str(item.timeHint),
        }))
        .filter((item) => item.text !== "")
        .slice(0, 10)
    : [];

  const knownFacts = (raw.knownFacts ?? {}) as Record<string, unknown>;

  return {
    customerGoal: str(raw.customerGoal),
    currentStage: (str(raw.currentStage) as SalesStage | null) ?? null,
    answeredTopics: strArray(raw.answeredTopics),
    pendingQuestions: pending,
    unresolvedObjections: strArray(raw.unresolvedObjections),
    lastCta: str(raw.lastCta),
    customerCommitments: commitments,
    sellerPromises: promises,
    followupPreference: str(raw.followupPreference),
    intakeStatus: oneOf(raw.intakeStatus, INTAKE_STATES, "none"),
    paymentStatus: oneOf(raw.paymentStatus, PAYMENT_STATES, "none"),
    photoStatus: oneOf(raw.photoStatus, PHOTO_STATES, "none"),
    publicationStatus: oneOf(raw.publicationStatus, PUBLICATION_STATES, "none"),
    certificateStatus: oneOf(raw.certificateStatus, CERTIFICATE_STATES, "none"),
    supportStatus: oneOf(raw.supportStatus, ["none", "open", "resolved"] as const, "none"),
    humanTakeover: raw.humanTakeover === true,
    optOut: raw.optOut === true,
    leadTemperature: oneOf(
      raw.leadTemperature,
      ["cold", "warm", "hot", "payment_ready"] as const,
      "cold",
    ),
    leadScoreReasons: strArray(raw.leadScoreReasons, 20),
    knownFacts: {
      fullName: str(knownFacts.fullName),
      articleInterest:
        typeof knownFacts.articleInterest === "boolean" ? knownFacts.articleInterest : null,
      region: str(knownFacts.region),
    },
    updatedAt: str(raw.updatedAt),
  };
}

/* ------------------------------ yangilash ------------------------------- */

/**
 * TO'LOV HOLATI FAQAT OLDINGA SILJIYDI.
 *
 * Bu eng muhim qoida: tasdiqlangan to'lov hech qachon "so'ralgan"
 * holatiga qaytmasligi kerak. Aks holda bot to'lagan mijozdan
 * yana pul so'rardi — auditda aynan shundan qo'rqilgan.
 *
 * Yagona istisno — `rejected`: uni faqat vakolatli admin qo'yadi
 * va u ataylab orqaga qaytarish.
 */
const PAYMENT_ORDER: Record<PaymentState, number> = {
  none: 0,
  requested: 1,
  customer_claimed: 2,
  evidence_received: 3,
  under_review: 4,
  confirmed: 5,
  rejected: 5,
};

export function advancePaymentState(
  current: PaymentState,
  next: PaymentState,
  options: { authorized?: boolean } = {},
): PaymentState {
  // Tasdiqlash va rad etish FAQAT vakolat bilan.
  if ((next === "confirmed" || next === "rejected") && options.authorized !== true) {
    return current;
  }
  if (options.authorized === true) return next;
  return PAYMENT_ORDER[next] > PAYMENT_ORDER[current] ? next : current;
}

export interface MemoryUpdate {
  answeredTopic?: string;
  pendingQuestion?: PendingQuestion;
  resolvedQuestionIntent?: string | null;
  objections?: readonly string[];
  lastCta?: string | null;
  promise?: SellerPromise;
  commitment?: CustomerCommitment;
  followupPreference?: string | null;
  customerGoal?: string | null;
  stage?: SalesStage;
  intakeStatus?: IntakeState;
  paymentStatus?: PaymentState;
  paymentAuthorized?: boolean;
  photoStatus?: PhotoState;
  publicationStatus?: PublicationState;
  certificateStatus?: CertificateState;
  supportStatus?: "none" | "open" | "resolved";
  humanTakeover?: boolean;
  optOut?: boolean;
  leadTemperature?: LeadTemperature;
  leadScoreReasons?: readonly string[];
  fullName?: string | null;
  articleInterest?: boolean | null;
  region?: string | null;
  now?: Date;
}

const MAX_TOPICS = 40;
const MAX_PENDING = 10;

/**
 * Xotirani yangilaydi. HECH NARSA O'CHIRILMAYDI, faqat qo'shiladi
 * yoki holat oldinga siljiydi — bundan tashqari javob berilgan
 * savol `pendingQuestions` dan olib tashlanadi.
 */
export function applyMemoryUpdate(
  memory: ConversationMemory,
  update: MemoryUpdate,
): ConversationMemory {
  const now = update.now ?? new Date();
  const next: ConversationMemory = {
    ...memory,
    answeredTopics: [...memory.answeredTopics],
    pendingQuestions: [...memory.pendingQuestions],
    unresolvedObjections: [...memory.unresolvedObjections],
    customerCommitments: [...memory.customerCommitments],
    sellerPromises: [...memory.sellerPromises],
    leadScoreReasons: [...memory.leadScoreReasons],
    knownFacts: { ...memory.knownFacts },
  };

  if (update.answeredTopic && !next.answeredTopics.includes(update.answeredTopic)) {
    next.answeredTopics.push(update.answeredTopic);
    if (next.answeredTopics.length > MAX_TOPICS) next.answeredTopics.shift();
  }

  if (update.pendingQuestion) {
    const incoming = update.pendingQuestion;
    // Bir savol ikki marta yozilmaydi.
    const duplicate = next.pendingQuestions.some(
      (question) =>
        (incoming.intentKey && question.intentKey === incoming.intentKey) ||
        question.text === incoming.text,
    );
    if (!duplicate) {
      next.pendingQuestions.push(incoming);
      if (next.pendingQuestions.length > MAX_PENDING) next.pendingQuestions.shift();
    }
  }

  if (update.resolvedQuestionIntent !== undefined && update.resolvedQuestionIntent !== null) {
    next.pendingQuestions = next.pendingQuestions.filter(
      (question) => question.intentKey !== update.resolvedQuestionIntent,
    );
  }

  if (update.objections) {
    for (const objection of update.objections) {
      if (!next.unresolvedObjections.includes(objection)) next.unresolvedObjections.push(objection);
    }
  }

  if (update.lastCta !== undefined) next.lastCta = update.lastCta;
  if (update.customerGoal !== undefined && update.customerGoal !== null) {
    next.customerGoal = update.customerGoal;
  }
  if (update.stage) next.currentStage = update.stage;

  if (update.promise) {
    const exists = next.sellerPromises.some((promise) => promise.text === update.promise!.text);
    if (!exists) next.sellerPromises.push(update.promise);
  }
  if (update.commitment) {
    const exists = next.customerCommitments.some(
      (commitment) => commitment.text === update.commitment!.text,
    );
    if (!exists) next.customerCommitments.push(update.commitment);
  }
  if (update.followupPreference !== undefined) next.followupPreference = update.followupPreference;

  if (update.intakeStatus) {
    const order: IntakeState[] = ["none", "link_sent", "started", "submitted"];
    if (order.indexOf(update.intakeStatus) > order.indexOf(next.intakeStatus)) {
      next.intakeStatus = update.intakeStatus;
    }
  }

  if (update.paymentStatus) {
    next.paymentStatus = advancePaymentState(next.paymentStatus, update.paymentStatus, {
      authorized: update.paymentAuthorized,
    });
  }

  if (update.photoStatus) next.photoStatus = update.photoStatus;
  if (update.publicationStatus) next.publicationStatus = update.publicationStatus;
  if (update.certificateStatus) next.certificateStatus = update.certificateStatus;
  if (update.supportStatus) next.supportStatus = update.supportStatus;

  // Opt-out va takeover FAQAT yoqiladi, o'chirilmaydi: ularni
  // orqaga qaytarish odamning ataylab qilgan ishi bo'lishi kerak.
  if (update.humanTakeover === true) next.humanTakeover = true;
  if (update.optOut === true) next.optOut = true;

  if (update.leadTemperature) next.leadTemperature = update.leadTemperature;
  if (update.leadScoreReasons) next.leadScoreReasons = [...update.leadScoreReasons];

  if (update.fullName !== undefined && update.fullName !== null) {
    next.knownFacts.fullName = update.fullName;
  }
  if (update.articleInterest !== undefined && update.articleInterest !== null) {
    next.knownFacts.articleInterest = update.articleInterest;
  }
  if (update.region !== undefined && update.region !== null) next.knownFacts.region = update.region;

  next.updatedAt = now.toISOString();
  return next;
}

/* -------------------------- qayta so'ramaslik --------------------------- */

/** Qayta so'rash MUMKIN EMAS bo'lgan narsalar. */
export const GUARDED_ASKS = [
  "full_name",
  "article_interest",
  "payment",
  "intake",
  "photo",
] as const;
export type GuardedAsk = (typeof GUARDED_ASKS)[number];

export interface AskVerdict {
  allowed: boolean;
  reason: string;
}

/**
 * Bu narsani MIJOZDAN SO'RASH mumkinmi.
 *
 * Bu eng ko'p ishonch yo'qotadigan xato: to'lagan odamdan yana
 * to'lov so'rash, anketa to'ldirgandan yana anketa so'rash,
 * ismini aytganidan yana ism so'rash.
 */
export function canAsk(memory: ConversationMemory, ask: GuardedAsk): AskVerdict {
  switch (ask) {
    case "full_name":
      return memory.knownFacts.fullName
        ? { allowed: false, reason: "ism allaqachon ma’lum" }
        : { allowed: true, reason: "" };
    case "article_interest":
      return memory.knownFacts.articleInterest !== null
        ? { allowed: false, reason: "maqolaga qiziqish allaqachon aniqlangan" }
        : { allowed: true, reason: "" };
    case "payment":
      if (memory.paymentStatus === "confirmed") {
        return { allowed: false, reason: "TO‘LOV TASDIQLANGAN — qayta so‘ralmaydi" };
      }
      if (memory.paymentStatus === "evidence_received" || memory.paymentStatus === "under_review") {
        return { allowed: false, reason: "chek kelgan, tekshiruvda — qayta so‘ralmaydi" };
      }
      return { allowed: true, reason: "" };
    case "intake":
      return memory.intakeStatus === "submitted"
        ? { allowed: false, reason: "anketa topshirilgan" }
        : { allowed: true, reason: "" };
    case "photo":
      return memory.photoStatus === "received" || memory.photoStatus === "approved"
        ? { allowed: false, reason: "rasm allaqachon kelgan" }
        : { allowed: true, reason: "" };
  }
}

/** Bu mavzu allaqachon tushuntirilganmi. */
export function alreadyExplained(memory: ConversationMemory, topic: string): boolean {
  return memory.answeredTopics.includes(topic);
}
