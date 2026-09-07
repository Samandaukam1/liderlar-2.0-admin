/**
 * Test chat uchun promt yig'ish.
 *
 * SOF MODUL — modelga ketadigan matnning har bir bo'lagi shu yerda
 * yig'iladi va testda tekshiriladi. Eng muhim ikki qoida promtning
 * o'zida qattiq yozilgan:
 *
 *   1. FAKT faqat berilgan bilimdan olinadi. Bilim bo'lmasa, javob
 *      "aniqlab, xabar beraman" shaklida bo'ladi — son yoki muddat
 *      o'ylab topilmaydi.
 *   2. Oldingi javob NUSXALANMAYDI. Shablonlar faqat ohang namunasi;
 *      mazmun saqlanadi, matn qaytadan yoziladi.
 */

import type { StyleProfile } from "./style.ts";
import type { RetrievablePattern, ScoredKnowledge } from "./retrieval.ts";

export interface TestChatTurn {
  role: "customer" | "assistant";
  text: string;
}

/**
 * Uslub profilidan o'qiladigan ko'rsatmalar.
 *
 * Profil raqamlardan iborat; model raqamni tushunmaydi, ko'rsatmani
 * tushunadi. Shuning uchun har o'lchov jumlaga aylantiriladi. Namuna
 * yetarli bo'lmagan o'lchov (masalan `reciprocity.samples === 0`)
 * ko'rsatmaga UMUMAN qo'shilmaydi — yo'q ma'lumotdan qoida yasamaymiz.
 */
export function buildStyleInstructions(profile: StyleProfile | null): string[] {
  if (!profile) return [];
  const lines: string[] = [];

  if (profile.address.form === "siz") lines.push("Mijozga DOIM “siz” deb murojaat qil.");
  else if (profile.address.form === "sen") lines.push("Mijozga “sen” deb murojaat qil.");

  if (profile.greeting.usageRate >= 0.4 && profile.greeting.top.length > 0) {
    lines.push(`Salomlashish bilan boshla, masalan: “${profile.greeting.top[0].phrase}”.`);
  } else if (profile.greeting.usageRate < 0.15) {
    lines.push("Ortiqcha salomlashmasdan, to‘g‘ridan-to‘g‘ri mavzuga o‘t.");
  }

  lines.push(
    `Ohang: ${profile.tone.label}. Xabar o‘rtacha ${Math.max(1, Math.round(profile.sentence.averageWords))} ` +
      "so‘zli gaplardan iborat bo‘lsin.",
  );

  if (profile.length.shortShare >= 0.6) lines.push("Javob QISQA bo‘lsin — bir-ikki gap.");
  else if (profile.length.detailedShare >= 0.6) lines.push("Javob batafsil bo‘lsin, lekin cho‘zilmasin.");

  if (profile.emoji.usageRate >= 0.4) {
    const sample = profile.emoji.top.slice(0, 3).map((e) => e.phrase).join(" ");
    lines.push(`Emoji ishlatish odatiy${sample ? ` (masalan: ${sample})` : ""}, lekin me’yorida.`);
  } else if (profile.emoji.usageRate < 0.1) {
    lines.push("Emoji ishlatma.");
  }

  if (profile.script.dominant === "lotin") lines.push("Lotin yozuvida yoz.");
  else if (profile.script.dominant === "kirill") lines.push("Kirill yozuvida yoz.");

  if (profile.price.templates.length > 0) {
    // Shablonlarda son {SON} bilan maskalangan — bu ataylab: uslub
    // profilida haqiqiy narx saqlanmaydi, u faqat SHAKLNI ko'rsatadi.
    lines.push(
      `Narxni shu shaklda ayt: ${profile.price.templates.slice(0, 2).join(" / ")}. ` +
        "{SON} o‘rniga faqat bilimdan olingan haqiqiy qiymatni qo‘y.",
    );
  }

  if (profile.objection.responseRate >= 0.3 && profile.objection.openers.length > 0) {
    const openers = profile.objection.openers.slice(0, 3).map((o) => o.phrase).join(", ");
    lines.push(`E’tirozga javob berishda yumshatuvchi ochqich ishlat: ${openers}.`);
  }

  if (profile.cta.usageRate >= 0.3 && profile.cta.top.length > 0) {
    lines.push(`Javob oxirida harakatga chorla, masalan: “${profile.cta.top[0].phrase}”.`);
  }

  if (profile.structure.multiQuestionSamples > 0 && profile.structure.multiQuestionListShare >= 0.5) {
    lines.push("Mijoz bir nechta savol bersa, javobni ro‘yxat qilib yoz.");
  }

  if (profile.reciprocity.samples > 0 && profile.reciprocity.shortInShortOutRate >= 0.6) {
    lines.push("Mijoz qisqa yozsa, sen ham qisqa javob ber.");
  }

  return lines;
}

export interface SystemPromptInput {
  knowledge: readonly ScoredKnowledge[];
  patterns: readonly RetrievablePattern[];
  style: StyleProfile | null;
  missingKnowledge: boolean;
}

export const TEST_CHAT_ROLE =
  "Sen Liderlar.uz sotuv bo‘limining menejerisan va Telegram’da mijoz bilan yozishyapsan.";

export function buildTestChatSystemPrompt(input: SystemPromptInput): string {
  const sections: string[] = [TEST_CHAT_ROLE];

  /* ------------------------------ FAKTLAR ------------------------------ */
  sections.push(
    [
      "TASDIQLANGAN BILIM (faqat shu faktlardan foydalanishing mumkin):",
      input.knowledge.length === 0
        ? "— (bu savol bo‘yicha tasdiqlangan bilim YO‘Q)"
        : input.knowledge
            .map((entry, i) => {
              const question = entry.item.question ? `S: ${entry.item.question}\n   ` : "";
              return `${i + 1}. [${entry.item.category}] ${question}J: ${entry.item.answer}`;
            })
            .join("\n"),
    ].join("\n"),
  );

  /* ----------------------------- SHABLONLAR ---------------------------- */
  if (input.patterns.length > 0) {
    sections.push(
      [
        "AVVAL SHU SAVOLGA QANDAY JAVOB BERGANMIZ (faqat OHANG namunasi):",
        input.patterns
          .map((pattern, i) => {
            const outcome =
              pattern.successRate == null
                ? "natijasi noma’lum"
                : `${pattern.successRate}% muvaffaqiyat`;
            return `${i + 1}. (${pattern.frequency} marta, ${outcome})\n   Mijoz: ${pattern.customerExample}\n   Biz: ${pattern.responseExample}`;
          })
          .join("\n"),
        "Bu javoblarni KO‘CHIRMA. Ular faqat uslub va yondashuv namunasi.",
      ].join("\n"),
    );
  }

  /* ------------------------------- USLUB ------------------------------- */
  const styleLines = buildStyleInstructions(input.style);
  if (styleLines.length > 0) {
    sections.push(["YOZISH USLUBI:", ...styleLines.map((line) => `- ${line}`)].join("\n"));
  }

  /* ------------------------------ QOIDALAR ----------------------------- */
  const rules = [
    "Yuqoridagi bilimda BO‘LMAGAN faktni aytma: narx, muddat, sana, foiz, " +
      "shart yoki kafolatni O‘YLAB TOPMA.",
    "Oldingi javoblarni so‘zma-so‘z ko‘chirma — mazmunni saqlab, tabiiy qayta yoz.",
    "Faqat mijozga yoziladigan matnni qaytar: izoh, sarlavha yoki tushuntirish qo‘shma.",
    "O‘zbek tilida yoz.",
  ];

  if (input.missingKnowledge) {
    // Bilim yo'q — bu holatda fakt aytishga URINISH ham xato bo'ladi.
    rules.unshift(
      "MUHIM: bu savol bo‘yicha tasdiqlangan bilim yo‘q. HECH QANDAY aniq " +
        "fakt aytma. Buning o‘rniga savolni aniqlashtir yoki “aniqlab, " +
        "xabar beraman” deb javob ber.",
    );
  }

  sections.push(["QAT’IY QOIDALAR:", ...rules.map((rule, i) => `${i + 1}. ${rule}`)].join("\n"));

  return sections.join("\n\n");
}

/** Suhbat konteksti — model oldingi gaplarni unutmasligi uchun. */
export function buildTestChatMessages(
  history: readonly TestChatTurn[],
  message: string,
): Array<{ role: "user" | "assistant"; content: string }> {
  const turns = history.map((turn) => ({
    role: turn.role === "customer" ? ("user" as const) : ("assistant" as const),
    content: turn.text,
  }));
  return [...turns, { role: "user" as const, content: message }];
}

/**
 * Retrieval uchun so'rov matni.
 *
 * Faqat oxirgi xabar olinsa, "Qimmat ekan" kabi e'tiroz hech qanday
 * bilimga ulanmasdi — unda mavzu so'zlari umuman yo'q. Shuning uchun
 * mijozning oldingi xabarlari ham qo'shiladi, lekin OXIRGISI ustun
 * turadi (u ikki marta hisobga olinadi).
 */
export function buildRetrievalQuery(
  history: readonly TestChatTurn[],
  message: string,
  maxPreviousTurns = 3,
): string {
  const previous = history
    .filter((turn) => turn.role === "customer")
    .slice(-maxPreviousTurns)
    .map((turn) => turn.text);
  return [...previous, message, message].join("\n");
}
