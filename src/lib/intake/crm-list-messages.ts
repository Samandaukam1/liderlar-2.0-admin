/**
 * Bot CRM ro'yxatlari — sof modul (matn, tugmalar, callback_data).
 *
 * I/O yo'q, shuning uchun sahifalash arifmetikasi, callback formati va
 * "telefon raqam KO'RSATILMAYDI" qoidasi haqiqiy unit testlar bilan qoplanadi.
 * Xabarlar ATAYLAB oddiy matn: MarkdownV2 bo'lganda ismdagi bitta nuqta yoki
 * username ichidagi pastki chiziq butun yuborishni 400 bilan yiqitadi.
 */

// Nisbiy yo'l: bu modulni node:test to'g'ridan-to'g'ri yuklaydi va u
// tsconfig alias'larini bilmaydi.
import {
  shiftCalendarDate,
  tashkentDayRange,
  tashkentDayRangeForDate,
} from "../tashkent-day.ts";
import {
  pipelineStageLabel,
  splitPipelineError,
} from "../post-studio/pipeline-stages.ts";
import { PIPELINE_STALE_AFTER_MS } from "../post-studio/pipeline-recovery.ts";

/** The three CRM buttons added to the editorial /start keyboard. */
export const PUBLISHED_BUTTON_LABEL = "📚 Hozirgacha chop etilganlar";
export const WAITING_BUTTON_LABEL = "⏳ Kutayotganlar";
export const FILLING_BUTTON_LABEL = "✍️ To‘ldirayotganlar";

export type CrmListKind = "published" | "waiting" | "filling";

/**
 * Ro'yxat qaysi kun bo'yicha ko'rsatiladi.
 *
 * Standart — BUGUN. Ilgari har bosishda butun ro'yxat kelardi va ikki
 * mingta yozuv ichidan bugungisini topish uchun sahifalarni varaqlash
 * kerak bo'lardi. Muharrirga eng ko'p kerak bo'ladigan kesim — bugun.
 *
 * To'rt davr butun to'plamni QOLDIRIQSIZ bo'ladi: bugun + kecha +
 * undan avval = hammasi. Sanasi yo'q yozuvlar "undan avval" ga
 * qo'shiladi, aks holda ular hech qaysi kesimda ko'rinmay, jimgina
 * yo'qolib qolardi.
 */
export const CRM_PERIODS = ["today", "yesterday", "earlier", "all"] as const;
export type CrmPeriod = (typeof CRM_PERIODS)[number];

export const CRM_PERIOD_LABELS: Record<CrmPeriod, string> = {
  today: "Bugun",
  yesterday: "Kecha",
  earlier: "Undan avval",
  all: "Hammasi",
};

export function isCrmPeriod(value: unknown): value is CrmPeriod {
  return typeof value === "string" && (CRM_PERIODS as readonly string[]).includes(value);
}

/**
 * Davr chegaralari — Toshkent kunlari bo'yicha.
 *
 * `endIso` DOIM eksklyuziv (`.gte(start).lt(end)`), shuning uchun
 * yarim tunda muhrlangan yozuv faqat bitta kunga tegishli bo'ladi.
 * `earlier` uchun faqat yuqori chegara bor.
 */
export interface CrmPeriodRange {
  startIso: string | null;
  endIso: string | null;
  /** Sanasi yo'q yozuvlar ham shu kesimga kiradimi. */
  includeNull: boolean;
}

export function crmPeriodRange(period: CrmPeriod, now: Date = new Date()): CrmPeriodRange {
  if (period === "all") return { startIso: null, endIso: null, includeNull: true };

  const today = tashkentDayRange(now);
  const yesterday = tashkentDayRangeForDate(shiftCalendarDate(today.date, -1));

  if (period === "today") {
    return { startIso: today.startIso, endIso: today.endIso, includeNull: false };
  }
  if (period === "yesterday") {
    return { startIso: yesterday.startIso, endIso: yesterday.endIso, includeNull: false };
  }
  // "Undan avval" — kechadan oldingi hammasi, sanasizlar bilan birga.
  return { startIso: null, endIso: yesterday.startIso, includeNull: true };
}

/**
 * EXACT intake statuses behind each list, from 0010_candidate_intake_v2.sql:
 *
 *   status in ('draft','submitted','ai_reviewing','needs_clarification',
 *              'approved','promoted','published','archived')
 *
 * MUHIM O'ZGARISH: "chop etilgan" va "kutayotgan" endi anketa holatiga
 * EMAS, saytning o'ziga qaraydi (`candidate_intake_crm.article_live`).
 * Anketa holati hujjatning holati — u saytdan ajralib qolishi mumkin
 * va ajralganda bot allaqachon chiqib bo'lgan odamni "kutayapti" deb
 * ko'rsatardi. `CRM_LIST_STATUSES.waiting` esa hamon kerak: u
 * "yuborilgan, lekin tashlab yuborilmagan" doirasini belgilaydi.
 *
 *   • published — endi `article_live`, ya'ni saytda turgan nomzod.
 *     `CRM_LIST_STATUSES.published` faqat tarixiy ma'lumot uchun
 *     qoldirilgan va so'rovda ISHLATILMAYDI.
 *   • waiting   — every status between draft and published: the candidate
 *     submitted and is not live yet. 'ai_reviewing' and 'needs_clarification'
 *     are in, because from the editorial side those people are still waiting;
 *     'archived' is out, because that intake was abandoned, not queued.
 *   • filling   — 'draft'. The form exists and submit_candidate_intake(...)
 *     has not run. The same set the /hisobot report counts as
 *     "✍️ To'ldirmoqda", so a button and the report can never disagree.
 *
 * Kept here, in the pure module, so the semantics are asserted by a real test
 * rather than living only inside a query builder.
 */
export const CRM_LIST_STATUSES: Record<CrmListKind, readonly string[]> = {
  published: ["published"],
  waiting: ["submitted", "ai_reviewing", "needs_clarification", "approved", "promoted"],
  filling: ["draft"],
};

/**
 * How many rows one message carries.
 *
 * Telegram caps a message at 4096 characters and there are thousands of
 * intakes: one un-paged list would either be rejected outright or arrive as an
 * unreadable wall. Twenty name+handle pairs sit comfortably under the cap.
 */
export const CRM_LIST_PAGE_SIZE = 20;

export const CRM_LIST_TITLES: Record<CrmListKind, string> = {
  published: "📚 HOZIRGACHA CHOP ETILGANLAR",
  waiting: "⏳ KUTAYOTGANLAR",
  filling: "✍️ TO‘LDIRAYOTGANLAR",
};

/** One line under each title, so the reader knows what the list actually is. */
export const CRM_LIST_SUBTITLES: Record<CrmListKind, string> = {
  published: "Saytda maqolasi chop etilgan nomzodlar.",
  waiting: "Anketani yuborgan, maqolasi hali saytda yo‘q nomzodlar.",
  filling: "Anketani boshlagan, hali yubormagan nomzodlar.",
};

/** A pressed reply-keyboard button arrives as an ordinary message with its label. */
export const CRM_LIST_BY_BUTTON: Record<string, CrmListKind> = {
  [PUBLISHED_BUTTON_LABEL]: "published",
  [WAITING_BUTTON_LABEL]: "waiting",
  [FILLING_BUTTON_LABEL]: "filling",
};

/** Every list is also reachable as a typed command, like the other actions. */
export const CRM_LIST_BY_COMMAND: Record<string, CrmListKind> = {
  "/chopetilganlar": "published",
  "/kutayotganlar": "waiting",
  "/toldirayotganlar": "filling",
};

/**
 * Callback payload.
 *
 * Telegram caps callback_data at 64 BYTES. "crm:p:12" is eight, which leaves
 * the format room to grow without ever approaching the limit.
 */
const CALLBACK_PREFIX = "crm:";

const KIND_CODE: Record<CrmListKind, string> = {
  published: "p",
  waiting: "w",
  filling: "f",
};

const CODE_KIND: Record<string, CrmListKind> = {
  p: "published",
  w: "waiting",
  f: "filling",
};

const PERIOD_CODE: Record<CrmPeriod, string> = {
  today: "t",
  yesterday: "y",
  earlier: "e",
  all: "a",
};

const CODE_PERIOD: Record<string, CrmPeriod> = {
  t: "today",
  y: "yesterday",
  e: "earlier",
  a: "all",
};

export function crmListCallbackData(
  kind: CrmListKind,
  period: CrmPeriod,
  page: number,
): string {
  return `${CALLBACK_PREFIX}${KIND_CODE[kind]}:${PERIOD_CODE[period]}:${Math.max(1, Math.floor(page))}`;
}

export interface ParsedCrmListCallback {
  kind: CrmListKind;
  period: CrmPeriod;
  page: number;
}

/**
 * Reads a tapped pagination button back into a list and a page.
 *
 * Anything that is not ours — another feature's button, a truncated payload, a
 * page that is not a positive integer — returns null so the caller ignores it
 * instead of querying for page NaN.
 */
export function parseCrmListCallback(
  data: string | undefined | null,
): ParsedCrmListCallback | null {
  if (!data || !data.startsWith(CALLBACK_PREFIX)) return null;
  const parts = data.split(":");

  // Eski uch bo'lakli shakl ("crm:p:2") hali chatlarda osilib turgan
  // xabarlarda uchraydi. O'shanda davr tushunchasi yo'q edi va tugma
  // BUTUN ro'yxatni bildirardi — shuning uchun u "hammasi" deb
  // o'qiladi, "bugun" deb emas: aks holda eski tugma bosilganda
  // ro'yxat jimgina qisqarib qolardi.
  const [, code, third, fourth] = parts;
  const kind = CODE_KIND[code ?? ""];
  if (!kind) return null;

  const hasPeriod = parts.length >= 4;
  const period = hasPeriod ? CODE_PERIOD[third ?? ""] : "all";
  if (!period) return null;

  const rawPage = hasPeriod ? fourth : third;
  if (!/^\d+$/.test(rawPage ?? "")) return null;
  const page = Number(rawPage);
  if (!Number.isSafeInteger(page) || page < 1) return null;
  return { kind, period, page };
}

/** Total pages for a row count, never less than one (an empty list has page 1). */
export function crmPageCount(total: number, pageSize = CRM_LIST_PAGE_SIZE): number {
  return Math.max(1, Math.ceil(Math.max(0, total) / pageSize));
}

/** Clamps a requested page into the list's real range. */
export function clampCrmPage(page: number, pageCount: number): number {
  if (!Number.isSafeInteger(page)) return 1;
  return Math.min(Math.max(1, page), Math.max(1, pageCount));
}

/** Zero-based index of the first row on a page — the query's offset. */
export function crmPageOffset(page: number, pageSize = CRM_LIST_PAGE_SIZE): number {
  return (Math.max(1, page) - 1) * pageSize;
}

export interface CrmListRow {
  fullName: string;
  /** Stored canonically as "@name"; null when the candidate never gave one. */
  telegramUsername: string | null;
  /** Faqat "kutayotganlar" ro'yxatida to'ldiriladi. */
  waiting?: WaitingContext;
}

/* ------------------------- nega kutayapti ------------------------------- */

/**
 * Bitta odam nega hali chiqmaganini aytish uchun kerak bo'lgan hamma narsa.
 *
 * Ro'yxat ilgari faqat ism ko'rsatardi va muharrir har biri uchun panelga
 * kirib sabab qidirishga majbur edi. Hamma qiymat `candidate_intakes` dan
 * keladi, ya'ni bu yerda taxmin qilinadigan narsa yo'q.
 */
export interface WaitingContext {
  status: string;
  /** 'paid' | 'unpaid' | 'unknown' — anketa to'lov holati. */
  paymentStatus: string | null;
  /** 'pending' | 'running' | 'completed' | 'failed' | 'needs_review' | 'skipped'. */
  pipelineStatus: string | null;
  /** `fail()` yozgan "<bosqich>: <matn>" shakli. */
  pipelineError: string | null;
  /** Quvur qachon boshlangan — "qotib qolgan"ni ajratish uchun. */
  pipelineStartedAt: string | null;
  /** Quvur qachon boshlanishi kerak edi (yuborilgandan +2 soat). */
  processAfter: string | null;
}

export interface WaitingReason {
  /** Bir qatorli asosiy sabab. */
  label: string;
  /** Texnik tafsilot — faqat xato bo'lganda. */
  detail?: string;
  icon: string;
}

/**
 * "Qotib qolgan" chegarasi TIKLOVCHIDAN olinadi, bu yerda qayta
 * yozilmaydi.
 *
 * `recoverStalePipelines()` aynan shu yoshdagi yugurishni o'lgan deb
 * hisoblab qaytadan navbatga qo'yadi. Agar ro'yxat o'z sonini tutsa,
 * ikkisi bir kun ajralib ketardi va ro'yxat "hammasi joyida" deyayotganda
 * tiklovchi allaqachon uni o'lgan deb bilardi.
 */
const STUCK_RUN_MS = PIPELINE_STALE_AFTER_MS;

/** Navbat vaqti o'tib ketgan, lekin boshlanmagan — cron ishlamayotgan belgisi. */
const LATE_QUEUE_MS = 30 * 60 * 1000;

const STATUS_REASONS: Record<string, string> = {
  submitted: "Anketa to‘ldirilgan, navbatda",
  ai_reviewing: "AI ko‘rib chiqmoqda",
  needs_clarification: "Aniqlashtirish so‘ralgan — nomzod javobi kutilmoqda",
  approved: "Tasdiqlangan, nashr navbatida",
  promoted: "Nomzod yaratilgan, nashr kutilmoqda",
};

/**
 * Nega bu odam hali saytda yo'q.
 *
 * TARTIB — "buni hal qilmaguncha keyingisi ahamiyatsiz" tamoyili bilan:
 *
 *   1. TO'LOV. Nashr to'lovga bog'langan; to'lov tasdiqlanmaguncha quvur bu
 *      odamni umuman olmaydi. Shuning uchun u birinchi bo'lib aytiladi,
 *      hatto eski xato yozuvi turgan bo'lsa ham — aks holda muharrir
 *      hech qachon boshlanmagan ishning xatosini tuzatishga urinadi.
 *   2. TEXNIK XATO — bosqich nomi bilan, chunki "nimadir bo'ldi" degan
 *      xabar bilan hech narsa qilib bo'lmaydi.
 *   3. QOTIB QOLGAN YUGURISH. "Ishlanmoqda" bilan "ikki soatdan beri
 *      ishlanmoqda" bir xil narsa emas; ikkinchisi aralashuv talab qiladi.
 *   4. HOLAT — qolgan, oddiy kutish hollari.
 */
export function describeWaitingReason(
  context: WaitingContext | undefined,
  now: Date = new Date(),
): WaitingReason {
  if (!context) return { icon: "❔", label: "Sabab aniqlanmadi" };

  if (context.paymentStatus !== "paid") {
    return {
      icon: "💳",
      label:
        context.paymentStatus === "unpaid"
          ? "Anketa to‘ldirilgan, hali to‘lov qilmagan"
          : "Anketa to‘ldirilgan, to‘lov tasdiqlanmagan",
    };
  }

  const pipeline = context.pipelineStatus;

  if (pipeline === "failed" || pipeline === "needs_review") {
    const { stage, message } = splitPipelineError(context.pipelineError);
    return {
      icon: "⚠️",
      label: stage
        ? `Texnik xato: ${pipelineStageLabel(stage)}`
        : "Texnik xato — qo‘lda tekshirish kerak",
      detail: message || undefined,
    };
  }

  if (pipeline === "running") {
    const age = elapsedMs(context.pipelineStartedAt, now);
    if (age !== null && age > STUCK_RUN_MS) {
      return {
        icon: "⚠️",
        label: `Qotib qolgan: ${formatAge(age)}dan beri "ishlanmoqda"`,
        detail: "Avtomatik tiklash keyingi cron'da uriniladi.",
      };
    }
    return { icon: "⏳", label: "Hozir ishlanmoqda" };
  }

  if (pipeline === "pending") {
    const late = elapsedMs(context.processAfter, now);
    if (late !== null && late > LATE_QUEUE_MS) {
      return {
        icon: "⚠️",
        label: `Navbatda turibdi, lekin boshlanmagan (${formatAge(late)} kechikdi)`,
      };
    }
    if (late !== null && late < 0) {
      return { icon: "⏳", label: `Navbatda — ${formatAge(-late)}dan keyin boshlanadi` };
    }
    return { icon: "⏳", label: "Navbatda" };
  }

  // Quvur tugagan, lekin odam saytda yo'q. Bu yerga tushish o'zi
  // nomuvofiqlik: aytiladi, yashirilmaydi.
  if (pipeline === "completed") {
    return { icon: "⚠️", label: "Post tayyor, lekin saytda chiqmagan" };
  }
  if (pipeline === "skipped") {
    return { icon: "⏭", label: "Post quvuri o‘tkazib yuborilgan" };
  }

  const known = STATUS_REASONS[context.status];
  if (known) return { icon: "⏳", label: known };

  return { icon: "❔", label: `Holat: ${context.status}` };
}

/** Musbat = o'tgan vaqt, manfiy = hali kelmagan. Sana yaroqsiz bo'lsa null. */
function elapsedMs(iso: string | null, now: Date): number | null {
  if (!iso) return null;
  const at = Date.parse(iso);
  return Number.isFinite(at) ? now.getTime() - at : null;
}

/** "12 daqiqa" / "3 soat" / "2 kun" — chatda o'qish uchun, aniqlik uchun emas. */
function formatAge(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes} daqiqa`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} soat`;
  return `${Math.round(hours / 24)} kun`;
}

export interface CrmListPageInput {
  kind: CrmListKind;
  period: CrmPeriod;
  rows: CrmListRow[];
  page: number;
  total: number;
  pageSize?: number;
}

/**
 * One page of a list.
 *
 * Deliberately carries F.I.Sh. and the Telegram handle ONLY. Phone numbers are
 * never rendered here: the lists go to a chat, chats get forwarded, and a phone
 * number is the one field in this table that cannot be un-leaked.
 */
export function buildCrmListText(input: CrmListPageInput): string {
  const pageSize = input.pageSize ?? CRM_LIST_PAGE_SIZE;
  const pageCount = crmPageCount(input.total, pageSize);
  const page = clampCrmPage(input.page, pageCount);
  const offset = crmPageOffset(page, pageSize);

  const header = [
    `${CRM_LIST_TITLES[input.kind]} — ${input.total} ta`,
    CRM_LIST_SUBTITLES[input.kind],
    // Qaysi kesim ko'rsatilayotgani DOIM yoziladi: "12 ta" degan son
    // qaysi kunga tegishli ekani aytilmasa, chalg'itadi.
    `🗓 ${CRM_PERIOD_LABELS[input.period]}`,
  ];

  if (input.total === 0 || input.rows.length === 0) {
    return [...header, "", "Bu kesimda hech kim yo‘q."].join("\n");
  }

  // Har qator O'Z guruhi bo'lib yasaladi: chegaraga yetganda BUTUN
  // yozuv tashlanadi, yarmi emas. Yarim qolgan yozuv "bu kim?" degan
  // savol tug'diradi va uni hech qayerdan tekshirib bo'lmaydi.
  const groups = input.rows.map((row, index) => {
    const name = row.fullName.trim() || "(ismi yo‘q)";
    const handle = normalizeHandleForDisplay(row.telegramUsername);
    const lines = [`${offset + index + 1}. ${name}`, `   ${handle}`];

    // Sabab FAQAT "kutayotganlar" ro'yxatida: chop etilganlar uchun
    // "nega kutayapti" degan savolning ma'nosi yo'q.
    if (input.kind === "waiting") {
      const reason = describeWaitingReason(row.waiting);
      lines.push(`   ${reason.icon} ${reason.label}`);
      if (reason.detail) lines.push(`      ${truncateDetail(reason.detail)}`);
    }
    return lines;
  });

  const prefix = [...header, `Sahifa ${page}/${pageCount}`, ""];
  return joinWithinTelegramLimit(prefix, groups);
}

/**
 * Telegram bitta xabarni 4096 BELGIDA kesadi — aniqrog'i, kesmaydi:
 * butun yuborishni 400 bilan rad etadi va muharrir hech narsa ko'rmaydi.
 *
 * Sahifa hajmi (20) ism va username uchun tanlangan edi. "Kutayotganlar"
 * ro'yxati endi har yozuvga sabab va texnik tafsilot qo'shadi, ya'ni
 * qator ikki barobar uzun bo'lishi mumkin, ismlar esa erkin matn —
 * ularning uzunligiga hech qanday kafolat yo'q.
 *
 * Shuning uchun chegara SO'NGGI nuqtada, tayyor matn ustida qo'llanadi:
 * nechta yozuv sig'sa shuncha yuboriladi va nechtasi qolgani AYTILADI.
 * Qolganlar keyingi sahifada — ular yo'qolmaydi.
 */
const TELEGRAM_TEXT_LIMIT = 4096;

function joinWithinTelegramLimit(prefix: string[], groups: string[][]): string {
  const kept: string[] = [];
  let length = prefix.join("\n").length;
  let shown = 0;

  for (const group of groups) {
    const cost = group.join("\n").length + 1;
    // Zaxira — pastdagi "yana N ta" eslatmasining o'zi uchun.
    if (length + cost > TELEGRAM_TEXT_LIMIT - 80) break;
    kept.push(...group);
    length += cost;
    shown += 1;
  }

  const lines = [...prefix, ...kept];
  const dropped = groups.length - shown;
  if (dropped > 0) {
    lines.push("", `… yana ${dropped} ta shu sahifada sig‘madi — keyingi sahifaga qarang.`);
  }
  return lines.join("\n");
}

/**
 * Xato matni uzun bo'lishi mumkin (`fail()` 900 belgigacha yozadi), ro'yxat
 * qatori esa bir nechta odam bilan bitta xabarga sig'ishi kerak.
 */
function truncateDetail(text: string, max = 90): string {
  const value = text.replace(/\s+/g, " ").trim();
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

/** "@name" whether it was stored with the "@" or without; "—" when absent. */
function normalizeHandleForDisplay(raw: string | null): string {
  const value = (raw ?? "").trim().replace(/^@+/, "");
  return value ? `@${value}` : "—";
}

/** Structural shape of telegram-api's InlineButton, without importing it. */
export interface CrmInlineButton {
  text: string;
  callback_data: string;
}

/**
 * Prev/next row, or nothing at all on a single-page list.
 *
 * The page number lives in the text rather than in a third button: every inline
 * button needs its own callback_data, and a button that answers nothing is a
 * button people tap expecting something to happen.
 */
export function buildCrmListKeyboard(
  kind: CrmListKind,
  period: CrmPeriod,
  page: number,
  pageCount: number,
): CrmInlineButton[][] {
  const rows: CrmInlineButton[][] = [];

  // Davr tugmalari DOIM ko'rinadi — bitta sahifali ro'yxatda ham,
  // chunki ular sahifalash emas, kesim tanlash. Aktiv kesim belgi
  // bilan ajratiladi, aks holda qaysi ro'yxat ochiqligi bilinmaydi.
  const periodButton = (value: CrmPeriod): CrmInlineButton => ({
    text: value === period ? `▪️ ${CRM_PERIOD_LABELS[value]}` : CRM_PERIOD_LABELS[value],
    // Kesim almashganda sahifa 1 dan boshlanadi: 5-sahifada turib
    // "Bugun" bosilsa, u yerda 5-sahifa bo'lmasligi mumkin.
    callback_data: crmListCallbackData(kind, value, 1),
  });

  rows.push([periodButton("today"), periodButton("yesterday")]);
  rows.push([periodButton("earlier"), periodButton("all")]);

  if (pageCount > 1) {
    const row: CrmInlineButton[] = [];
    if (page > 1) {
      row.push({
        text: "◀️ Oldingi",
        callback_data: crmListCallbackData(kind, period, page - 1),
      });
    }
    if (page < pageCount) {
      row.push({
        text: "Keyingi ▶️",
        callback_data: crmListCallbackData(kind, period, page + 1),
      });
    }
    if (row.length > 0) rows.push(row);
  }

  return rows;
}
