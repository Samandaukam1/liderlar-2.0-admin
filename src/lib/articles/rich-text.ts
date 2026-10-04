/**
 * MAQOLA MATNI — YENGIL BELGILASH. SOF MODUL.
 *
 * IKKALA REPODA AYNAN BIR XIL FAYL: `liderlar-web` matnni sahifada
 * chizadi, `liderlar-admin` esa uni AdabiyotX'ga bloklar sifatida
 * uzatadi. Ikki xil tahlilchi bo'lsa, bitta maqola ikki joyda turlicha
 * ko'rinardi. Test (`rich-text.test.ts`) ikki nusxani bayt-baytigacha
 * solishtiradi.
 *
 * NEGA HTML EMAS: maqolani a'zo yozadi va u ommaviy sahifada chiqadi.
 * Xom HTML saqlash va ko'rsatish saqlangan XSS bo'lardi (§58), uni
 * tozalash esa qo'shimcha kutubxona va doimiy xavf. Bu yerda matn
 * MATN bo'lib qoladi; chizuvchi undan React elementlarini o'zi yasaydi
 * va `dangerouslySetInnerHTML` hech qayerda yo'q.
 *
 * Qo'llab-quvvatlanadigan belgilar (muharrir tugmalari aynan shularni
 * qo'yadi):
 *
 *   **qalin**            — qalin
 *   *kursiv*             — kursiv
 *   [matn](https://…)    — havola (FAQAT https)
 *   > iqtibos            — iqtibos bloki (ketma-ket qatorlar bitta)
 *   ## Sarlavha          — kichik sarlavha (### — undan kichigi)
 *   - band               — ro'yxat (ketma-ket qatorlar bitta)
 *   \*                   — belgining o'zi (qochirish)
 *
 * ESKI MATN O'ZGARMAYDI: belgisiz matnda har qator alohida abzats —
 * bu `ArticleBody` ning oldingi xatti-harakati bilan bir xil.
 *
 * Hech narsa import qilinmaydi: testlar `@/` taxallusini yecha olmaydi.
 */

/* ========================================================================= *
 * TURLAR
 * ========================================================================= */

export interface RichInline {
  text: string;
  bold?: true;
  italic?: true;
  /** Faqat tekshirilgan `https://` manzil. */
  href?: string;
}

export type RichBlock =
  | { type: "paragraph"; children: RichInline[] }
  | { type: "heading"; level: 2 | 3; children: RichInline[] }
  | { type: "quote"; children: RichInline[] }
  | { type: "list"; items: RichInline[][] };

/* ========================================================================= *
 * HAVOLA XAVFSIZLIGI
 * ========================================================================= */

/**
 * Havola qabul qilinadimi.
 *
 * FAQAT `https://`. `javascript:` va `data:` saqlangan XSS bo'lardi;
 * `http://` esa ommaviy sahifada brauzer ogohlantirishiga olib keladi —
 * profil yozuvlaridagi qoida bilan bir xil (`field-policy.ts`).
 */
export function isSafeLink(value: string): boolean {
  if (value.length > 2000) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname.includes(".");
  } catch {
    return false;
  }
}

/* ========================================================================= *
 * QATOR ICHIDAGI BELGILAR
 * ========================================================================= */

const ESCAPABLE = new Set(["*", "[", "]", "(", ")", "\\", ">", "-", "#"]);

/** Qochirilgan belgi bo'lmagan `marker` ning keyingi o'rni. */
function findClosing(source: string, marker: string, from: number): number {
  let index = from;
  while (index < source.length) {
    if (source[index] === "\\") {
      index += 2;
      continue;
    }
    if (source.startsWith(marker, index)) {
      // `*` izlaganda `**` ning yarmini olmaymiz.
      if (marker === "*" && source[index + 1] === "*") {
        index += 2;
        continue;
      }
      return index;
    }
    index += 1;
  }
  return -1;
}

interface Marks {
  bold?: true;
  italic?: true;
  href?: string;
}

function pushText(out: RichInline[], text: string, marks: Marks): void {
  if (text === "") return;
  const last = out[out.length - 1];
  /*
   * BIR XIL BELGILI QO'SHNI BO'LAKLAR BIRLASHADI.
   *
   * Aks holda "a\*b" uch bo'lak bo'lib qolardi va AdabiyotX'ga
   * keraksiz ko'p bo'lak ketardi.
   */
  if (
    last &&
    last.bold === marks.bold &&
    last.italic === marks.italic &&
    last.href === marks.href
  ) {
    last.text += text;
    return;
  }
  const node: RichInline = { text };
  if (marks.bold) node.bold = true;
  if (marks.italic) node.italic = true;
  if (marks.href) node.href = marks.href;
  out.push(node);
}

/**
 * Qator ichidagi belgilarni tahlil qiladi.
 *
 * YOPILMAGAN BELGI MATN BO'LIB QOLADI: "5 * 3" yoki yopilmagan "**"
 * hech narsani buzmaydi va yo'qolmaydi. Noto'g'ri havola ham shunday —
 * muallif ko'rib chiqishda xatosini ko'radi.
 */
function parseInlineInto(source: string, marks: Marks, out: RichInline[], depth: number): void {
  let buffer = "";
  let index = 0;

  const flush = () => {
    pushText(out, buffer, marks);
    buffer = "";
  };

  while (index < source.length) {
    const char = source[index]!;

    // Qochirish: `\*` -> `*`.
    if (char === "\\" && index + 1 < source.length && ESCAPABLE.has(source[index + 1]!)) {
      buffer += source[index + 1];
      index += 2;
      continue;
    }

    // Chuqurlik cheklovi — o'ta ichma-ich kiritma tahlilchini sekinlashtirmasin.
    if (depth < 4) {
      // [matn](https://…)
      if (char === "[" && !marks.href) {
        const closeText = findClosing(source, "]", index + 1);
        if (closeText > index + 1 && source[closeText + 1] === "(") {
          const closeUrl = source.indexOf(")", closeText + 2);
          if (closeUrl > closeText + 2) {
            const url = source.slice(closeText + 2, closeUrl).trim();
            if (isSafeLink(url)) {
              flush();
              parseInlineInto(source.slice(index + 1, closeText), { ...marks, href: url }, out, depth + 1);
              index = closeUrl + 1;
              continue;
            }
          }
        }
      }

      // **qalin**
      if (char === "*" && source[index + 1] === "*" && !marks.bold) {
        let close = findClosing(source, "**", index + 2);
        /*
         * `***matn***` — QALIN VA KURSIV.
         *
         * Ochuvchi uchta yulduz bo'lsa va yopuvchi ham uchta bo'lsa,
         * qalinning yopilishi oxirgi ikkitasi: ichida `*matn*` qoladi
         * va u kursiv bo'ladi. Busiz qalin ichida "*matn" va tashqarida
         * yolg'iz "*" qolardi — muharrirdagi kursiv tugmasi qalin
         * matnga aynan shunday belgi qo'yadi.
         */
        if (close !== -1 && source[index + 2] === "*" && source[close + 2] === "*") close += 1;
        if (close > index + 2) {
          flush();
          parseInlineInto(source.slice(index + 2, close), { ...marks, bold: true }, out, depth + 1);
          index = close + 2;
          continue;
        }
      }

      // *kursiv* — ichi bo'sh joy bilan boshlanmasin/tugamasin ("5 * 3 * 2").
      if (char === "*" && source[index + 1] !== "*" && !marks.italic) {
        const close = findClosing(source, "*", index + 1);
        const inner = close > index + 1 ? source.slice(index + 1, close) : "";
        if (inner !== "" && inner.trim() === inner) {
          flush();
          parseInlineInto(inner, { ...marks, italic: true }, out, depth + 1);
          index = close + 1;
          continue;
        }
      }
    }

    buffer += char;
    index += 1;
  }

  flush();
}

export function parseInline(source: string): RichInline[] {
  const out: RichInline[] = [];
  parseInlineInto(source, {}, out, 0);
  return out;
}

/* ========================================================================= *
 * BLOKLAR
 * ========================================================================= */

const HEADING = /^(#{1,3})\s+(.+)$/;
const QUOTE = /^>\s?(.*)$/;
const LIST = /^[-•]\s+(.+)$/;

/**
 * Matnni bloklarga ajratadi.
 *
 * Har oddiy qator — alohida abzats (eski matn shunday ko'rinardi).
 * Ketma-ket `>` qatorlar bitta iqtibos, ketma-ket `-` qatorlar bitta
 * ro'yxat bo'ladi.
 */
export function parseRichText(source: string | null | undefined): RichBlock[] {
  if (!source) return [];

  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: RichBlock[] = [];
  let quote: string[] | null = null;
  let list: RichInline[][] | null = null;

  const flushQuote = () => {
    if (quote && quote.some((line) => line.trim() !== "")) {
      blocks.push({ type: "quote", children: parseInline(quote.join("\n").trim()) });
    }
    quote = null;
  };
  const flushList = () => {
    if (list && list.length > 0) blocks.push({ type: "list", items: list });
    list = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (line === "") {
      flushQuote();
      flushList();
      continue;
    }

    // Qochirilgan blok belgisi: "\# emas" -> oddiy abzats.
    const escaped = line.startsWith("\\") && ESCAPABLE.has(line[1] ?? "");

    const quoteMatch = escaped ? null : QUOTE.exec(line);
    if (quoteMatch) {
      flushList();
      (quote ??= []).push(quoteMatch[1] ?? "");
      continue;
    }
    flushQuote();

    const listMatch = escaped ? null : LIST.exec(line);
    if (listMatch) {
      (list ??= []).push(parseInline(listMatch[1]!.trim()));
      continue;
    }
    flushList();

    const headingMatch = escaped ? null : HEADING.exec(line);
    if (headingMatch) {
      blocks.push({
        type: "heading",
        // `#` ham 2-daraja: sahifada 1-daraja — maqola sarlavhasining o'zi.
        level: headingMatch[1]!.length === 3 ? 3 : 2,
        children: parseInline(headingMatch[2]!.trim()),
      });
      continue;
    }

    blocks.push({ type: "paragraph", children: parseInline(line) });
  }

  flushQuote();
  flushList();

  return blocks.filter((block) =>
    block.type === "list" ? block.items.length > 0 : block.children.length > 0,
  );
}

/* ========================================================================= *
 * ODDIY MATN
 * ========================================================================= */

export function inlineToPlain(children: readonly RichInline[]): string {
  return children.map((child) => child.text).join("");
}

/**
 * Belgilarsiz matn — o'qish vaqti, qidiruv va qisqa tavsif uchun.
 *
 * Xom matndan sanasak, "**" va havola manzillari so'z bo'lib
 * hisoblanardi.
 */
export function richTextToPlain(source: string | null | undefined): string {
  return parseRichText(source)
    .map((block) =>
      block.type === "list"
        ? block.items.map((item) => inlineToPlain(item)).join("\n")
        : inlineToPlain(block.children),
    )
    .join("\n\n");
}
