/**
 * Bo'lakma-bo'lak (streaming) CSV o'quvchi — sof modul, bog'liqliksiz.
 *
 * NEGA O'ZIMIZNIKI. Import qilinadigan fayl 18MB va uning 17.6MB'i bitta
 * ustunda — HTML matn. Uni `fs.readFileSync` + `split("\n")` bilan o'qish ikki
 * jihatdan noto'g'ri: butun fayl xotiraga chiqadi, va tirnoq ichidagi qator
 * uzilishlari qatorni o'rtasidan kesib tashlaydi (faylda 2200 fizik satr bor,
 * yozuv esa 1991 ta). Bu parser bo'laklarni qabul qiladi va faqat TUGAGAN
 * yozuvlarni qaytaradi.
 */

export interface CsvParserOptions {
  /** Ustun ajratuvchi. Tilda eksporti `;` ishlatadi. */
  delimiter?: string;
  quote?: string;
}

export class StreamingCsvParser {
  private readonly delimiter: string;
  private readonly quote: string;

  private field = "";
  private row: string[] = [];
  /** Tirnoq ichidamizmi — ajratuvchi va qator uzilishi bu yerda oddiy matn. */
  private inQuotes = false;
  /** Tirnoq ichida tirnoq ko'rdik: yopilish yoki `""` (ekranlangan tirnoq). */
  private quotePending = false;
  private started = false;
  private sawCr = false;

  constructor(options: CsvParserOptions = {}) {
    this.delimiter = options.delimiter ?? ",";
    this.quote = options.quote ?? '"';
  }

  /** Navbatdagi bo'lak; qaytadigan qiymat — shu bo'lakda TUGAGAN yozuvlar. */
  push(chunk: string): string[][] {
    const rows: string[][] = [];
    let text = chunk;

    // BOM faqat eng boshida bo'lishi mumkin.
    if (!this.started) {
      this.started = true;
      if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    }

    for (const char of text) {
      if (this.sawCr) {
        this.sawCr = false;
        // CRLF — bitta qator uzilishi. Yolg'iz CR ham qator uzilishi sanaladi.
        if (char === "\n") continue;
      }

      if (this.quotePending) {
        this.quotePending = false;
        if (char === this.quote) {
          this.field += this.quote; // `""` → bitta tirnoq
          continue;
        }
        this.inQuotes = false;
        // tirnoq yopildi — belgi odatdagidek qayta ishlanadi
      }

      if (this.inQuotes) {
        if (char === this.quote) this.quotePending = true;
        else this.field += char;
        continue;
      }

      if (char === this.quote && this.field === "") {
        this.inQuotes = true;
        continue;
      }
      if (char === this.delimiter) {
        this.row.push(this.field);
        this.field = "";
        continue;
      }
      if (char === "\n" || char === "\r") {
        this.sawCr = char === "\r";
        rows.push(this.finishRow());
        continue;
      }
      this.field += char;
    }

    return rows;
  }

  /** Fayl tugadi: oxirgi yozuv qator uzilishisiz tugagan bo'lishi mumkin. */
  end(): string[][] {
    if (this.inQuotes || this.quotePending) {
      this.inQuotes = false;
      this.quotePending = false;
    }
    if (this.field !== "" || this.row.length > 0) return [this.finishRow()];
    return [];
  }

  private finishRow(): string[] {
    this.row.push(this.field);
    const row = this.row;
    this.row = [];
    this.field = "";
    return row;
  }
}

/**
 * Ustun nomlarini qatorga bog'laydi.
 *
 * Ustunlar soni mos kelmasa `null` qaytadi — bunday qator jimgina noto'g'ri
 * maydonlarga tarqalib ketgandan ko'ra, hisobotda "yaroqsiz" bo'lib
 * ko'ringani afzal.
 */
export function toCsvRecord(
  columns: readonly string[],
  row: readonly string[],
): Record<string, string> | null {
  if (row.length !== columns.length) return null;
  const record: Record<string, string> = {};
  columns.forEach((name, index) => {
    record[name] = row[index] ?? "";
  });
  return record;
}

/** Bo'sh qator (fayl oxiridagi qator uzilishi) — yozuv emas. */
export function isBlankCsvRow(row: readonly string[]): boolean {
  return row.length === 0 || (row.length === 1 && row[0].trim() === "");
}
