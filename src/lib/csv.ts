/** RFC 4180-ish CSV parser used by the import wizard. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const src = text.replace(/^﻿/, "");

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

/*
 * FORMULA INJECTION HIMOYASI (OWASP "CSV Injection").
 *
 * Eksportdagi qiymatlarning bir qismini tashqi odam yozadi (ariza,
 * anketa, bot). Excel/Sheets `=`, `+`, `-`, `@` (yoki Tab/CR) bilan
 * boshlangan hujayrani FORMULA deb bajaradi: `=HYPERLINK(...)` faylni
 * ochgan xodimning ma'lumotini tashqariga yuborishi, DDE esa buyruq
 * ishga tushirishi mumkin. Oldidagi `'` hujayrani matnga aylantiradi.
 *
 * Oddiy son (`-5`, `+998901234567`) formula bo'la olmaydi — u
 * tegilmaydi, aks holda ballar va telefon raqamlari `'` bilan chiqardi.
 */
const FORMULA_START = /^[=+\-@\t\r]/;
const PLAIN_NUMBER = /^[+-]?\d+(\.\d+)?$/;

function neutralizeFormula(s: string): string {
  return FORMULA_START.test(s) && !PLAIN_NUMBER.test(s) ? `'${s}` : s;
}

export function toCsv(rows: Array<Array<string | number | null | undefined>>): string {
  const escape = (v: string | number | null | undefined) => {
    const s = neutralizeFormula(v == null ? "" : String(v));
    return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  };
  return rows.map((r) => r.map(escape).join(",")).join("\r\n");
}
