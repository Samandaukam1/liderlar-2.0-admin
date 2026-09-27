import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { formatTashkent } from "@/lib/tashkent-day";
import type { PromoApplicant, PromoGroup } from "./promo-similarity.ts";

/**
 * PROMO KODLAR HISOBOTI — PDF.
 *
 * SHRIFT: Tinos. Bu Times New Roman bilan O'LCHOVDOSH (metric-
 * compatible) ochiq shrift. Times New Roman'ning o'zi Microsoft
 * mulki va uni serverga qo'yib bo'lmaydi; pdf-lib'ning ichki
 * "Times-Roman" shrifti esa WinAnsi kodlashda ishlaydi, ya'ni
 * o'zbekcha "Oʻ", "gʻ" va kirill harflarni UMUMAN chiza olmaydi
 * — ismlar buziladi yoki hujjat yaratilmaydi.
 *
 * Tinos ikkalasini ham qamraydi va ko'rinishi Times New Roman
 * bilan bir xil.
 */

const FONT_DIR = "public/assets/reports/fonts";

/* Sayt palitrasi (globals.css dagi qiymatlar). */
const NAVY = rgb(0x10 / 255, 0x20 / 255, 0x33 / 255);
const NAVY_DEEP = rgb(0x07 / 255, 0x1a / 255, 0x33 / 255);
const BRAND = rgb(0x08 / 255, 0x7e / 255, 0xa4 / 255);
const CYAN = rgb(0x00 / 255, 0xc7 / 255, 0xe8 / 255);
const INK_SOFT = rgb(0x52 / 255, 0x65 / 255, 0x79 / 255);
const SURFACE = rgb(0xf4 / 255, 0xf8 / 255, 0xfc / 255);
const LINE = rgb(0xd8 / 255, 0xe6 / 255, 0xef / 255);
const WHITE = rgb(1, 1, 1);

const PAGE_WIDTH = 595.28; // A4
const PAGE_HEIGHT = 841.89;
const MARGIN = 48;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

export interface PromoReportInput {
  groups: readonly PromoGroup[];
  /** Admin kiritgan harflar. Bo'sh — hammasi. */
  query: string | null;
  /** Hisobot olingan payt. */
  generatedAt: Date;
  /** Jami ariza soni (filtrsiz) — kontekst uchun. */
  totalApplications: number;
}

interface Fonts {
  regular: PDFFont;
  bold: PDFFont;
}

async function loadFonts(pdf: PDFDocument): Promise<Fonts> {
  const [regular, bold] = await Promise.all([
    fs.readFile(path.join(process.cwd(), FONT_DIR, "tinos-regular.ttf")),
    fs.readFile(path.join(process.cwd(), FONT_DIR, "tinos-bold.ttf")),
  ]);
  /*
   * SUBSET ATAYLAB O'CHIQ.
   *
   * `subset: true` bilan birinchi urinishda hujjatdagi harflarning
   * bir qismi JIMGINA yo'qoldi — "O'ZBEKISTON" o'rniga "O BE STON"
   * chiqdi va hech qanday xato berilmadi. @pdf-lib/fontkit ning TTF
   * subsetteri ba'zi shriftlarda glyphlarni tashlab ketadi; repodagi
   * sertifikat kodida ham aynan shu yozilgan (certificates/fonts.ts).
   *
   * To'liq joylash PDF ni ~1 MB qiladi — hisobot uchun bu arzon narx.
   */
  return {
    regular: await pdf.embedFont(regular, { subset: false }),
    bold: await pdf.embedFont(bold, { subset: false }),
  };
}

/**
 * Shrift chiza olmaydigan belgini olib tashlaydi.
 *
 * Tinos keng qamrovli, lekin ma'lumot xom: ismda kutilmagan
 * belgi (emoji, kamdan-kam uchraydigan yozuv) bo'lishi mumkin.
 * Bitta belgi butun hisobotni yiqitmasligi kerak.
 */
function drawable(font: PDFFont, text: string): string {
  let out = "";
  for (const char of text) {
    try {
      font.widthOfTextAtSize(char, 10);
      out += char;
    } catch {
      out += "·";
    }
  }
  return out;
}

/** Matnni ustun kengligiga sig'diradi. */
function fit(font: PDFFont, text: string, size: number, maxWidth: number): string {
  const safe = drawable(font, text);
  if (font.widthOfTextAtSize(safe, size) <= maxWidth) return safe;
  let cut = safe;
  while (cut.length > 1 && font.widthOfTextAtSize(`${cut}…`, size) > maxWidth) {
    cut = cut.slice(0, -1);
  }
  return `${cut}…`;
}

interface Cursor {
  page: PDFPage;
  y: number;
  pageNumber: number;
}

export async function buildPromoReportPdf(input: PromoReportInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const fonts = await loadFonts(pdf);

  pdf.setTitle("Promo kodlar bo‘yicha arizalar");
  pdf.setCreator("Liderlar.uz admin panel");
  pdf.setProducer("Liderlar.uz");

  const cursor: Cursor = { page: addPage(pdf), y: 0, pageNumber: 1 };
  cursor.y = drawHeader(cursor.page, fonts, input);

  if (input.groups.length === 0) {
    cursor.page.drawText(
      drawable(fonts.regular, "Bu harflarga mos promo kod topilmadi."),
      { x: MARGIN, y: cursor.y - 24, size: 11, font: fonts.regular, color: INK_SOFT },
    );
  }

  for (const group of input.groups) {
    ensureSpace(pdf, cursor, 90);
    cursor.y = drawGroup(pdf, cursor, fonts, group);
    cursor.y -= 14;
  }

  drawFooters(pdf, fonts, input);
  return pdf.save();
}

function addPage(pdf: PDFDocument): PDFPage {
  const page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  page.drawRectangle({ x: 0, y: 0, width: PAGE_WIDTH, height: PAGE_HEIGHT, color: WHITE });
  return page;
}

/**
 * Sarlavha — saytdagi kabi: ochiq fon, tepada ingichka moviy
 * chiziq, quyuq navy sarlavha va ostida yumshoq izoh.
 */
function drawHeader(page: PDFPage, fonts: Fonts, input: PromoReportInput): number {
  // Tepa lenta.
  page.drawRectangle({ x: 0, y: PAGE_HEIGHT - 6, width: PAGE_WIDTH, height: 6, color: BRAND });
  page.drawRectangle({ x: 0, y: PAGE_HEIGHT - 9, width: PAGE_WIDTH * 0.42, height: 3, color: CYAN });

  let y = PAGE_HEIGHT - 58;

  page.drawText(drawable(fonts.bold, "O‘ZBEKISTON LIDER YOSHLARI ENSIKLOPEDIYASI"), {
    x: MARGIN, y, size: 9, font: fonts.bold, color: BRAND,
  });

  y -= 30;
  page.drawText(drawable(fonts.bold, "Promo kodlar bo‘yicha arizalar"), {
    x: MARGIN, y, size: 22, font: fonts.bold, color: NAVY_DEEP,
  });

  y -= 20;
  /*
   * VAQT — "shu holatiga ko'ra".
   *
   * Hisobot JONLI ma'lumotdan olinadi va ertaga boshqacha
   * bo'ladi. Sanani "shu holatiga ko'ra" deb yozish uni
   * qachongacha to'g'ri ekanini aniq qiladi.
   */
  page.drawText(
    drawable(fonts.regular, `${formatTashkent(input.generatedAt)} (Toshkent) holatiga ko‘ra`),
    { x: MARGIN, y, size: 10.5, font: fonts.regular, color: INK_SOFT },
  );

  y -= 16;
  const scope = input.query
    ? `Qidiruv: “${input.query}” · ${input.groups.length} ta kod guruhi`
    : `Barcha promo kodlar · ${input.groups.length} ta guruh`;
  page.drawText(drawable(fonts.regular, `${scope} · jami ${input.totalApplications} ta ariza`), {
    x: MARGIN, y, size: 10.5, font: fonts.regular, color: INK_SOFT,
  });

  y -= 18;
  page.drawLine({
    start: { x: MARGIN, y }, end: { x: PAGE_WIDTH - MARGIN, y },
    thickness: 1, color: LINE,
  });

  return y - 26;
}

/** Joy yetmasa yangi sahifa ochadi. */
function ensureSpace(pdf: PDFDocument, cursor: Cursor, needed: number): void {
  if (cursor.y - needed > MARGIN + 30) return;
  cursor.page = addPage(pdf);
  cursor.pageNumber += 1;
  // Keyingi sahifada to'liq sarlavha takrorlanmaydi — faqat lenta.
  cursor.page.drawRectangle({ x: 0, y: PAGE_HEIGHT - 6, width: PAGE_WIDTH, height: 6, color: BRAND });
  cursor.y = PAGE_HEIGHT - 58;
}

/* Ustun kengliklari: ism | telefon | telegram | yosh | sana */
const COLUMNS = [188, 92, 104, 46, 69];

function drawTableHead(page: PDFPage, fonts: Fonts, y: number): number {
  page.drawRectangle({
    x: MARGIN, y: y - 4, width: CONTENT_WIDTH, height: 18, color: SURFACE,
  });
  const labels = ["Nomzod", "Telefon", "Telegram", "Yosh", "Ariza"];
  let x = MARGIN + 6;
  labels.forEach((label, index) => {
    page.drawText(drawable(fonts.bold, label), {
      x, y: y + 1, size: 8.5, font: fonts.bold, color: INK_SOFT,
    });
    x += COLUMNS[index];
  });
  return y - 16;
}

function drawApplicantRow(
  page: PDFPage,
  fonts: Fonts,
  y: number,
  applicant: PromoApplicant,
  index: number,
): number {
  if (index % 2 === 1) {
    page.drawRectangle({
      x: MARGIN, y: y - 4, width: CONTENT_WIDTH, height: 15, color: rgb(0.976, 0.988, 0.996),
    });
  }

  const cells = [
    applicant.fullName,
    applicant.phone ?? "—",
    applicant.telegram ?? "—",
    applicant.ageRange ?? "—",
    applicant.createdAt ? formatTashkent(applicant.createdAt).slice(0, 10) : "—",
  ];

  let x = MARGIN + 6;
  cells.forEach((cell, column) => {
    page.drawText(fit(fonts.regular, cell, 9.5, COLUMNS[column] - 8), {
      x, y, size: 9.5, font: column === 0 ? fonts.bold : fonts.regular,
      color: column === 0 ? NAVY : INK_SOFT,
    });
    x += COLUMNS[column];
  });

  return y - 15;
}

function drawGroup(
  pdf: PDFDocument,
  cursor: Cursor,
  fonts: Fonts,
  group: PromoGroup,
): number {
  let y = cursor.y;

  /* Guruh sarlavhasi — kod va soni. */
  cursor.page.drawRectangle({
    x: MARGIN, y: y - 6, width: CONTENT_WIDTH, height: 24, color: rgb(0.925, 0.968, 0.988),
  });
  cursor.page.drawRectangle({ x: MARGIN, y: y - 6, width: 3, height: 24, color: BRAND });

  cursor.page.drawText(drawable(fonts.bold, group.code), {
    x: MARGIN + 12, y: y + 2, size: 13, font: fonts.bold, color: NAVY_DEEP,
  });
  const countLabel = `${group.total} ta nomzod`;
  cursor.page.drawText(drawable(fonts.regular, countLabel), {
    x: PAGE_WIDTH - MARGIN - 8 - fonts.regular.widthOfTextAtSize(countLabel, 10),
    y: y + 3, size: 10, font: fonts.regular, color: BRAND,
  });
  y -= 30;

  y = drawTableHead(cursor.page, fonts, y);
  group.exact.forEach((applicant, index) => {
    if (y - 15 <= MARGIN + 30) {
      ensureSpace(pdf, cursor, 40);
      // Yangi sahifada jadval sarlavhasi QAYTA chiziladi: ustunsiz
      // qatorlar nima ekanini tushunib bo'lmaydi.
      y = drawTableHead(cursor.page, fonts, cursor.y);
    }
    y = drawApplicantRow(cursor.page, fonts, y, applicant, index);
    cursor.y = y;
  });

  /*
   * O'XSHASH YOZUVLAR ALOHIDA BLOKDA.
   *
   * Ular avtomatik birlashtirilmaydi: "bu ham o'sha kod" degan
   * qaror ODAMNIKI. Shuning uchun ular ko'rinadi, lekin
   * yuqoridagi guruhga qo'shib yuborilmaydi.
   */
  for (const variant of group.similar) {
    if (y - 46 <= MARGIN + 30) {
      ensureSpace(pdf, cursor, 60);
      y = cursor.y;
    }
    y -= 6;
    cursor.page.drawText(
      drawable(fonts.bold, `O‘xshash yozuv: ${variant.code}  (${variant.applicants.length} ta)`),
      { x: MARGIN + 12, y, size: 10, font: fonts.bold, color: rgb(0.62, 0.38, 0.05) },
    );
    y -= 14;
    variant.applicants.forEach((applicant, index) => {
      if (y - 15 <= MARGIN + 30) {
        ensureSpace(pdf, cursor, 40);
        y = drawTableHead(cursor.page, fonts, cursor.y);
      }
      y = drawApplicantRow(cursor.page, fonts, y, applicant, index);
      cursor.y = y;
    });
  }

  cursor.y = y;
  return y;
}

/** Har sahifaga: hujjat nomi, vaqt va sahifa raqami. */
function drawFooters(pdf: PDFDocument, fonts: Fonts, input: PromoReportInput): void {
  const pages = pdf.getPages();
  pages.forEach((page, index) => {
    page.drawLine({
      start: { x: MARGIN, y: MARGIN + 18 }, end: { x: PAGE_WIDTH - MARGIN, y: MARGIN + 18 },
      thickness: 0.7, color: LINE,
    });
    page.drawText(
      drawable(fonts.regular, `Liderlar.uz · ${formatTashkent(input.generatedAt)} holatiga ko‘ra`),
      { x: MARGIN, y: MARGIN + 6, size: 8.5, font: fonts.regular, color: INK_SOFT },
    );
    const label = `${index + 1} / ${pages.length}`;
    page.drawText(drawable(fonts.regular, label), {
      x: PAGE_WIDTH - MARGIN - fonts.regular.widthOfTextAtSize(label, 8.5),
      y: MARGIN + 6, size: 8.5, font: fonts.regular, color: INK_SOFT,
    });
  });
}
