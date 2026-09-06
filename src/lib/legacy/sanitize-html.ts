/**
 * Tilda HTML'ini xavfsiz, 2.0 dizayniga mos HTML'ga aylantiradi — sof modul.
 *
 * Manba — begona sayt konstruktori chiqargan HTML: 167k `<div>`, 104k `class`,
 * inline `style`, `contenteditable`, va 4 ta `<iframe>` bilan 2 ta `<video>`.
 * Uni o'z holicha render qilish ikki xato bo'lardi: eski saytning ko'rinishi
 * qolib ketardi, va begona `<iframe>`/`<script>` bizning domenimizda ishga
 * tushardi. Shuning uchun bu yerda QAT'IY OQ RO'YXAT ishlaydi — nimaiki
 * ro'yxatda bo'lmasa, o'tmaydi.
 *
 * Chiqish: teglari sanoqli, class va style'siz HTML. Uslubni liderlar-web'ning
 * o'z tipografiyasi beradi.
 */

/** Teg va uning ichidagi hamma narsa tashlanadi. */
const DROP_WITH_CONTENT = new Set([
  "script", "style", "iframe", "video", "audio", "source", "track",
  "object", "embed", "applet", "form", "input", "button", "select",
  "textarea", "noscript", "svg", "math", "template",
]);

/**
 * Saqlanadigan teglar. `h1` ataylab yo'q — sahifadagi h1 sarlavhaning o'zi.
 *
 * Ro'yxatda ham, DROP_WITH_CONTENT da ham bo'lmagan har qanday teg "unwrap"
 * qilinadi: tegning o'zi tashlanadi, ichidagi matn qoladi. Tilda'ning 167 ming
 * o'rov `<div>`i, `<span>`, `<figure>`, jadval teglari va kelajakda chiqishi
 * mumkin bo'lgan noma'lum teglar — hammasi shu yo'l bilan yo'qoladi. Yopiq
 * ro'yxat tuzish o'rniga shunday qilingani muhim: noma'lum teg xavfsiz tomonga
 * tushadi, matn esa yo'qolmaydi.
 */
const ALLOWED = new Set([
  "h2", "h3", "h4", "p", "strong", "b", "em", "i", "u",
  "ul", "ol", "li", "br", "hr", "blockquote", "a", "img",
]);

/** Yopilmaydigan teglar. */
const VOID_TAGS = new Set(["br", "hr", "img"]);

/**
 * Tilda abzatsni `<div class="t-redactor__text">` bilan yozadi (83k marta).
 * Uni `<p>` ga aylantirish — matn ma'nosini tiklash, chunki `div` unwrap
 * qilinsa butun maqola bitta uzun abzatsga aylanib qolardi.
 */
const PARAGRAPH_CLASS = /(^|\s)t-redactor__(text|preface)(\s|$)/;
const QUOTE_CLASS = /(^|\s)t-redactor__quote(\s|$)/;

const TOKEN = /<!--[\s\S]*?-->|<\/?([a-zA-Z][a-zA-Z0-9]*)((?:"[^"]*"|'[^']*'|[^>])*)>/g;
const ATTR = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;

function escapeText(value: string): string {
  return value
    .replace(/&(?![a-zA-Z#][a-zA-Z0-9]{1,8};)/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

/**
 * Atribut qiymatidagi HTML entity'larni bir marta ochadi.
 *
 * Manbadagi havola `?utm_source=x&amp;utm_content=y` ko'rinishida keladi.
 * Uni ochmasdan qayta ekranlash `&amp;amp;` beradi va brauzer `amp;utm_content`
 * degan parametr ko'radi — havola buziladi. Haqiqiy import ma'lumotida shu
 * aynan sodir bo'lgan edi.
 *
 * Bir marta ochish xavfsiz: ikki qavat kodlangan `&amp;#106;avascript:` bir
 * pasda `&#106;avascript:` bo'ladi va safeUrl uni sxema deb tanimaydi, bir
 * qavat kodlangan `&#106;avascript:` esa `javascript:` bo'ladi va oq
 * ro'yxatdan o'tmaydi. Ikkala yo'l ham havolani tashlaydi.
 */
function decodeEntitiesOnce(value: string): string {
  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body.startsWith("#")) {
      const code = body[1] === "x" || body[1] === "X"
        ? Number.parseInt(body.slice(2), 16)
        : Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : whole;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

function readAttributes(raw: string): Map<string, string> {
  const out = new Map<string, string>();
  ATTR.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ATTR.exec(raw)) !== null) {
    out.set(m[1].toLowerCase(), decodeEntitiesOnce(m[2] ?? m[3] ?? m[4] ?? ""));
  }
  return out;
}

/**
 * Faqat http(s) va mailto o'tadi.
 *
 * `javascript:` va `data:` — bu yerdagi asosiy xavf: sanitizerdan o'tgan
 * `<a href="javascript:...">` bosilganda bizning originimizda ishlaydi.
 * Bo'shliq va boshqaruv belgilari avval olib tashlanadi, chunki brauzer
 * "java\tscript:" ni ham bajaradi.
 */
function safeUrl(raw: string, protocols: string[]): string | null {
  const value = (raw ?? "").replace(/[\u0000-\u0020\u007f-\u00a0]/g, "").trim();
  if (!value) return null;
  if (value.startsWith("//")) return `https:${value}`;
  const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(value);
  if (!scheme) return null;
  return protocols.includes(scheme[1].toLowerCase()) ? value : null;
}

function openTagFor(name: string, attrs: Map<string, string>): string | null {
  if (name === "a") {
    const href = safeUrl(attrs.get("href") ?? "", ["http", "https", "mailto"]);
    if (!href) return null; // havolasiz `a` — teg tashlanadi, matn qoladi
    return `<a href="${escapeAttr(href)}" target="_blank" rel="noopener noreferrer nofollow">`;
  }
  if (name === "img") {
    const src = safeUrl(attrs.get("src") ?? attrs.get("data-src") ?? "", ["https"]);
    if (!src) return null;
    const alt = escapeAttr(attrs.get("alt") ?? "");
    return `<img src="${escapeAttr(src)}" alt="${alt}" loading="lazy" />`;
  }
  return `<${name}>`;
}

export interface SanitizedLegacyContent {
  /** Oq ro'yxatdan o'tgan HTML. */
  html: string;
  /** Teglarsiz matn — qidiruv va o'qish vaqti uchun. */
  text: string;
}

/**
 * Bitta legacy maqolani tozalaydi.
 *
 * Tokenlarga ajratib yuriladi: tanilmagan `<` oddiy matn sifatida ekranlanadi,
 * shuning uchun sanitizerdan o'tolmagan hech qanday belgi teg bo'lib qayta
 * tirilmaydi.
 */
export function sanitizeLegacyHtml(input: string | null | undefined): SanitizedLegacyContent {
  const source = input ?? "";
  const parts: string[] = [];
  const textParts: string[] = [];
  const open: string[] = [];
  /** >0 bo'lsa, biz tashlab yuboriladigan elementning ichidamiz. */
  let dropDepth = 0;
  let dropTag = "";
  let cursor = 0;

  const pushText = (raw: string) => {
    if (!raw || dropDepth > 0) return;
    parts.push(escapeText(raw));
    textParts.push(raw);
  };

  TOKEN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TOKEN.exec(source)) !== null) {
    pushText(source.slice(cursor, match.index));
    cursor = match.index + match[0].length;

    const name = (match[1] ?? "").toLowerCase();
    if (!name) continue; // izoh (comment) — butunlay tashlanadi
    const closing = match[0].startsWith("</");
    const selfClosing = match[0].endsWith("/>");

    if (dropDepth > 0) {
      // Tashlanayotgan elementning ichida faqat o'sha tegning ochilish/yopilishi
      // hisoblanadi; ichidagi hamma narsa (matn ham) yo'qoladi.
      if (name === dropTag) dropDepth += closing ? -1 : 1;
      continue;
    }

    if (DROP_WITH_CONTENT.has(name)) {
      if (!closing && !selfClosing) {
        dropDepth = 1;
        dropTag = name;
      }
      continue;
    }

    const attrs = closing ? new Map<string, string>() : readAttributes(match[2] ?? "");

    // Tilda abzats/iqtibosini haqiqiy teg bilan almashtirish.
    let effective = name;
    if (!closing && (name === "div" || name === "blockquote")) {
      const cls = attrs.get("class") ?? "";
      if (QUOTE_CLASS.test(cls)) effective = "blockquote";
      else if (name === "div" && PARAGRAPH_CLASS.test(cls)) effective = "p";
    }

    if (closing) {
      // Yopuvchi tegning turi ochilishdagi qaror bo'yicha topiladi: Tilda'ning
      // `<div class="t-redactor__text">` uchun bu `</p>` bo'lishi kerak.
      const top = open.length > 0 ? open[open.length - 1] : null;
      if (top && (top === name || (name === "div" && (top === "p" || top === "blockquote")))) {
        open.pop();
        parts.push(`</${top}>`);
        textParts.push(" ");
        continue;
      }
      if (!ALLOWED.has(name)) continue; // unwrap qilingan yoki noma'lum teg
      const at = open.lastIndexOf(name);
      if (at === -1) continue; // juftsiz yopuvchi teg
      while (open.length > at) parts.push(`</${open.pop()}>`);
      textParts.push(" ");
      continue;
    }

    if (!ALLOWED.has(effective)) continue; // unwrap: teg tashlanadi, matn qoladi

    const rendered = openTagFor(effective, attrs);
    if (!rendered) continue;
    parts.push(rendered);
    if (!VOID_TAGS.has(effective) && !selfClosing) open.push(effective);
    if (effective === "br" || effective === "li" || effective === "p") textParts.push(" ");
  }

  pushText(source.slice(cursor));
  while (open.length > 0) parts.push(`</${open.pop()}>`);

  const html = parts.join("").replace(/<p>\s*<\/p>/g, "").trim();
  const text = textParts.join("").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
  return { html, text };
}
