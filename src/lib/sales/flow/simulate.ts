/**
 * SOTUV OQIMI SIMULYATORI.
 *
 * Real Telegram'ga yuborishdan oldin ssenariyni tekshirish uchun.
 *
 * ATAYLAB SOF: bu modulda na Telegram, na baza, na AI bor. Shuning
 * uchun "simulyatsiya rejimida Telegram'ga xabar ketmaydi" degan
 * kafolat kod tuzilishining o'zidan kelib chiqadi — uni tekshirish
 * uchun bayroqqa ishonish shart emas, modulda yuborish yo'li YO'Q.
 *
 * Xuddi shu sababdan u testda ham to'liq ishlatiladi: butun ssenariy
 * boshidan oxirigacha, bazasiz o'ynab ko'riladi.
 */

import { classifyReply } from "./classify.ts";
import { validateFullName } from "./full-name.ts";
import { FOLLOWUP_TEMPLATES, getTemplate } from "./templates.ts";
import {
  isForwardTransition,
  resolveTransition,
  TERMINAL_STAGES,
  type ReplyIntent,
  type SalesStage,
} from "./stages.ts";

export interface SimulatedMessage {
  templateKey: string | null;
  body: string;
}

export interface SimulationStep {
  /** Mijoz nima yozgani. */
  input: string;
  messageType: string;
  intent: ReplyIntent;
  stageBefore: SalesStage;
  stageAfter: SalesStage;
  sent: SimulatedMessage[];
  scheduledFollowups: string[];
  cancelledFollowups: string[];
  notes: string[];
}

export interface SimulationState {
  stage: SalesStage;
  fullName: string | null;
  pendingFollowups: string[];
}

export const INITIAL_SIMULATION_STATE: SimulationState = {
  stage: "new",
  fullName: null,
  pendingFollowups: [],
};

/** Anketa havolasi o'rniga ko'rsatiladigan namuna. */
const SIMULATED_INTAKE_LINK = "https://liderlar.uz/anketa/<vaqtinchalik-havola>";

export interface SimulationInput {
  text: string;
  /** "photo" / "document" — chek yuborilganini taqlid qiladi. */
  messageType?: string;
}

export function simulateStep(
  state: SimulationState,
  input: SimulationInput,
): { state: SimulationState; step: SimulationStep } {
  const messageType = input.messageType ?? "text";
  const notes: string[] = [];

  // Mijoz javob berdi — kutilayotgan follow-up bekor bo'ladi.
  const cancelledFollowups = [...state.pendingFollowups];
  let pendingFollowups: string[] = [];

  /* --------------------------- niyat aniqlash --------------------------- */
  let intent: ReplyIntent;
  if (messageType === "photo" || messageType === "document") {
    intent = "payment_evidence";
  } else if (state.stage === "need_full_name") {
    intent = validateFullName(input.text).ok ? "full_name" : "other";
  } else {
    intent = classifyReply(input.text).intent;
  }

  const step: SimulationStep = {
    input: input.text,
    messageType,
    intent,
    stageBefore: state.stage,
    stageAfter: state.stage,
    sent: [],
    scheduledFollowups: [],
    cancelledFollowups,
    notes,
  };

  const transition = resolveTransition(state.stage, intent);

  if (!transition) {
    if (intent === "question" || intent === "need_info") {
      // Real oqimda bu yerda tasdiqlangan bilim ishlatiladi. Simulyator
      // AI'ni chaqirmaydi — u ssenariy qadamlarini tekshirish uchun.
      notes.push("bilim bazasidan javob (simulyatsiyada matn yaratilmaydi)");
    } else if (TERMINAL_STAGES.includes(state.stage)) {
      notes.push("ssenariy tugagan bosqich — javob berilmadi");
    } else {
      notes.push(`${state.stage} bosqichida "${intent}" uchun qadam yo‘q`);
    }
    return { state: { ...state, pendingFollowups }, step };
  }

  // O'Z-O'ZIGA QAYTISH — bu bosqich sakrashi emas, QAYTA SO'RASH
  // ("To'liq F.I.Sh.ingizni yozib yuboring"). Uni "allaqachon o'tilgan"
  // deb bloklash mijozni javobsiz qoldirardi.
  const isRePrompt = transition.to === state.stage;
  if (!isRePrompt && !isForwardTransition(state.stage, transition.to)) {
    notes.push("bosqich allaqachon o‘tilgan — takroriy o‘tish qilinmadi");
    return { state: { ...state, pendingFollowups }, step };
  }

  let fullName = state.fullName;
  if (transition.action === "request_intake_link") {
    const name = validateFullName(input.text);
    if (!name.ok) {
      notes.push("F.I.Sh. yetarli emas — havola yaratilmadi");
      return { state: { ...state, pendingFollowups }, step };
    }
    fullName = name.fullName;
    notes.push(
      `anketa yaratiladi: ${name.fullName}` +
        (name.gender ? ` (jins: ${name.gender})` : " (jins aniqlanmadi — admin to‘ldiradi)"),
    );
    step.sent.push({ templateKey: null, body: SIMULATED_INTAKE_LINK });
  }

  for (const key of transition.templates) {
    const template = getTemplate(key);
    if (!template) {
      notes.push(`shablon topilmadi: ${key}`);
      continue;
    }
    step.sent.push({ templateKey: key, body: template.body });
  }

  if (transition.followup) {
    const templateKey = FOLLOWUP_TEMPLATES[transition.followup.type];
    if (templateKey) {
      pendingFollowups = [transition.followup.type];
      step.scheduledFollowups.push(
        `${transition.followup.type} (${transition.followup.delayMinutes} daqiqa)`,
      );
    }
  }

  step.stageAfter = transition.to;
  return {
    state: { stage: transition.to, fullName, pendingFollowups },
    step,
  };
}

export interface SimulationRun {
  steps: SimulationStep[];
  finalStage: SalesStage;
  fullName: string | null;
}

/** Butun ssenariyni ketma-ket o'ynab chiqadi. */
export function simulateConversation(
  inputs: readonly SimulationInput[],
  initial: SimulationState = INITIAL_SIMULATION_STATE,
): SimulationRun {
  let state = initial;
  const steps: SimulationStep[] = [];

  for (const input of inputs) {
    const result = simulateStep(state, input);
    state = result.state;
    steps.push(result.step);
  }

  return { steps, finalStage: state.stage, fullName: state.fullName };
}
