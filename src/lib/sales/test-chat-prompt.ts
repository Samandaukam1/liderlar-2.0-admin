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
import { isUzbekGreeting, UZBEK_ONLY_RULE } from "./flow/language-guard.ts";

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

  /*
   * SALOMLASHUV NAMUNASI FILTRLANADI.
   *
   * Bu yer "Hi" muammosining eng kutilmagan manbai edi: uslub profili
   * real yozishmalardan salomlashuv namunalarini oladi va admin bir
   * marta "Hi" deb yozgan bo'lsa, u namuna bo'lib tushardi. Keyin
   * promt modelga AYNAN inglizcha salomlashishni BUYURARDI — ya'ni
   * o'rganish tizimining o'zi muammoni kuchaytirardi.
   */
  const uzbekGreeting = profile.greeting.top.find((entry) => isUzbekGreeting(entry.phrase));
  if (profile.greeting.usageRate >= 0.4 && uzbekGreeting) {
    lines.push(`Salomlashish bilan boshla, masalan: “${uzbekGreeting.phrase}”.`);
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
  /** Suhbatga xos kontekst: tijoriy faktlar, allaqachon aytilganlar. */
  extraContext?: string | null;
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

  /* --------------------------- SUHBAT KONTEKSTI ------------------------ */
  /*
   * Bu blok QOIDALARDAN OLDIN turadi — u faktlar qatoriga kiradi,
   * ko'rsatma emas. Tijoriy ma'lumot (narx, muddat) aynan shu yerdan
   * keladi va u bilim bazasidagi eski yozuvdan USTUN: narx bitta
   * joydan o'qilishi kerak (20-band).
   */
  const extra = (input.extraContext ?? "").trim();
  if (extra !== "") sections.push(extra);

  /* ------------------------------ QOIDALAR ----------------------------- */
  /*
   * QOIDALAR TARTIBI MUHIM.
   *
   * "O'zbek tilida yoz" ilgari ro'yxatning OXIRGI bandi edi — eng kam
   * e'tibor beriladigan joy. Model esa oxirgi navbat tilini aks
   * ettirishga juda kuchli moyil: mijoz "hi" deb yozsa, "Hi" qaytardi.
   * Bitta kuchsiz jumla bu moyillikni yenga olmasdi.
   *
   * Endi til qoidasi BIRINCHI va u aynan shu holatni — mijoz boshqa
   * tilda yozgan holatni — nomma-nom aytadi.
   */
  const rules = [
    UZBEK_ONLY_RULE,
    /*
     * KONTEKST BIRINCHI (3-band).
     *
     * Model qisqa xabarni YAKKA holda talqin qilib, suhbatni
     * noldan boshlab yuborardi: mijoz anketani yuborgandan
     * keyin "Assalomu alaykum, sizga qanday yordam beray?"
     * javobi kelardi. Bu mijozning qadamini o'chirib tashlaydi.
     */
    "Javob yozishdan OLDIN suhbat tarixini o‘qi va mijozning hozirgi " +
      "xabari NIMAGA ishora qilayotganini aniqla. “Mana”, “Yubordim”, " +
      "“Qildim”, “Bo‘ldimi?”, “Qancha?” — bular oldingi gapga bog‘liq; " +
      "ularni yakka holda talqin qilma.",
    "Suhbatni davom ettir, qaytadan boshlama. Salomlashish allaqachon " +
      "bo‘lgan bo‘lsa, qayta salomlashma va “sizga qanday yordam beray?” " +
      "deb so‘rama — mijoz nima kutayotgani tarixdan ko‘rinib turibdi.",
    /*
     * VA'DA — HAQIQIY TOPSHIRIQQA BOG'LANGAN (12-band).
     *
     * Kod "yo'naltirdim" degan matnni topshiriq yaratilgandan
     * KEYIN o'zi qo'yadi. Model bunday va'dani o'zi
     * to'qimasligi kerak.
     */
    "“Aniqlab xabar beraman”, “tekshirib yozaman”, “sizga xabar beramiz” " +
      "kabi kelajakdagi va’dani O‘ZING berma. Bilmasang, bilmasligingni ayt.",
    "Bajarilganini tizim tasdiqlamagan ishni bajarilgan deb aytma: " +
      "to‘lov tasdiqlangani, maqola chiqqani, ariza qabul bo‘lgani — " +
      "bularni faqat tasdiqlangan ma’lumot asosida ayt.",
    "Yuqoridagi bilimda BO‘LMAGAN faktni aytma: narx, muddat, sana, foiz, " +
      "shart yoki kafolatni O‘YLAB TOPMA.",
    "Oldingi javoblarni so‘zma-so‘z ko‘chirma — mazmunni saqlab, tabiiy qayta yoz.",
    "Bir xil gapni ikki marta aytma. Mijoz allaqachon eshitgan narsani " +
      "qayta tushuntirsang, “yuqorida aytganimdek” deb qisqa ayt.",
    "Faqat mijozga yoziladigan matnni qaytar: izoh, sarlavha yoki tushuntirish qo‘shma.",
    "Har javobni “Albatta”, “Ajoyib” yoki “Tushunarli” bilan boshlash ODAT QILMA.",
    "Rasmiy-kitobiy uslubdan qoch. Tirik sotuvchi kabi tabiiy yoz.",
  ];

  if (input.missingKnowledge) {
    // Bilim yo'q — bu holatda fakt aytishga URINISH ham xato bo'ladi.
    /*
     * ILGARI SHU YERDA "aniqlab, xabar beraman" DEB YOZISH
     * BUYURILARDI — ya'ni yolg'on va'da modelga O'ZIMIZ
     * aytardik. Orqada esa hech qanday topshiriq
     * yaratilmasdi (12-band).
     */
    rules.unshift(
      "MUHIM: bu savol bo‘yicha tasdiqlangan bilim yo‘q. HECH QANDAY aniq " +
        "fakt aytma va kelajakda xabar berishni VA’DA QILMA. Buning " +
        "o‘rniga savolni aniqlashtir yoki bu ma’lumot sende yo‘qligini " +
        "ochiq ayt.",
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
