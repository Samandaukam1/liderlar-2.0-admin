/**
 * Liderlar 1.0 rasm havolalarining tirikligini tekshiradi.
 *
 * ISHLATISH:
 *   node scripts/check-legacy-images.ts --file ~/Downloads/feed.csv
 *   node scripts/check-legacy-images.ts --file <csv> --sample 200
 *   node scripts/check-legacy-images.ts --db            # import qilingandan keyin
 *
 * NEGA KERAK. Arxiv rasmlari hamon Tilda CDN'ida turibdi va biz ularni o'z
 * Storage'imizga ko'chirmadik. Bu ataylab: CDN ishlab turganda 1990 ta faylni
 * ko'chirish ortiqcha ish. Lekin u BIZNIKI EMAS, shuning uchun uzilishini
 * o'lchash mumkin bo'lishi kerak — asset migratsiyasi alohida bosqich bo'lsa,
 * qaror shu hisobot asosida qabul qilinadi.
 *
 * Faqat HEAD so'rov yuboriladi: rasm tanasi yuklab olinmaydi.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { StreamingCsvParser, isBlankCsvRow, toCsvRecord } from "../src/lib/legacy/csv.ts";
import { LEGACY_CSV_DELIMITER, mapLegacyRow } from "../src/lib/legacy/mapping.ts";

/** Bir vaqtda nechta so'rov. CDN'ni urib yubormaydigan, lekin tez tugaydigan son. */
const CONCURRENCY = 24;
const TIMEOUT_MS = 15_000;

interface Target {
  id: string;
  title: string;
  url: string;
}

function arg(flag: string): string | null {
  const at = process.argv.indexOf(flag);
  return at !== -1 && process.argv[at + 1] ? process.argv[at + 1] : null;
}

async function targetsFromCsv(file: string): Promise<{ targets: Target[]; noImage: Target[] }> {
  const parser = new StreamingCsvParser({ delimiter: LEGACY_CSV_DELIMITER });
  const targets: Target[] = [];
  const noImage: Target[] = [];
  let header: string[] | null = null;

  const handle = (row: string[]) => {
    if (isBlankCsvRow(row)) return;
    if (!header) {
      header = row.map((c) => c.trim());
      return;
    }
    const record = toCsvRecord(header, row);
    if (!record) return;
    const mapped = mapLegacyRow(record);
    if (!mapped.ok) return;
    const entry = { id: mapped.record.legacy_source_id, title: mapped.record.title, url: "" };
    if (mapped.record.cover_image_url) {
      targets.push({ ...entry, url: mapped.record.cover_image_url });
    } else {
      noImage.push(entry);
    }
  };

  const stream = fs.createReadStream(file, { encoding: "utf8", highWaterMark: 1 << 20 });
  for await (const chunk of stream) for (const row of parser.push(chunk as string)) handle(row);
  for (const row of parser.end()) handle(row);
  return { targets, noImage };
}

/** Import qilingandan keyin manba sifatida bazani ishlatish. */
async function targetsFromDb(): Promise<{ targets: Target[]; noImage: Target[] }> {
  const { createClient } = await import("@supabase/supabase-js");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL va SUPABASE_SERVICE_ROLE_KEY kerak.");
  const db = createClient(url, key, { auth: { persistSession: false } });

  const targets: Target[] = [];
  const noImage: Target[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from("legacy_posts")
      .select("legacy_source_id, title, cover_image_url")
      .is("deleted_at", null)
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    for (const row of data ?? []) {
      const entry = {
        id: row.legacy_source_id as string,
        title: row.title as string,
        url: (row.cover_image_url as string | null) ?? "",
      };
      if (entry.url) targets.push(entry);
      else noImage.push(entry);
    }
    if (!data || data.length < PAGE) break;
  }
  return { targets, noImage };
}

async function head(url: string): Promise<{ status: number; error?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, { method: "HEAD", signal: controller.signal });
    return { status: response.status };
  } catch (err) {
    return { status: 0, error: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

async function run(): Promise<void> {
  const useDb = process.argv.includes("--db");
  const rawFile = arg("--file") ?? process.env.LEGACY_FEED_CSV ?? "";
  if (!useDb && !rawFile) throw new Error("--file <csv> yoki --db bering.");

  const { targets, noImage } = useDb
    ? await targetsFromDb()
    : await targetsFromCsv(
        rawFile.startsWith("~") ? path.join(os.homedir(), rawFile.slice(1)) : path.resolve(rawFile),
      );

  const sampleSize = Number(arg("--sample") ?? "0");
  const checked =
    Number.isSafeInteger(sampleSize) && sampleSize > 0 ? targets.slice(0, sampleSize) : targets;

  const hosts = new Map<string, number>();
  for (const t of targets) {
    try {
      hosts.set(new URL(t.url).hostname, (hosts.get(new URL(t.url).hostname) ?? 0) + 1);
    } catch {
      hosts.set("(noto‘g‘ri URL)", (hosts.get("(noto‘g‘ri URL)") ?? 0) + 1);
    }
  }

  let ok = 0;
  const broken: { id: string; title: string; url: string; status: number; error?: string }[] = [];
  let index = 0;

  const worker = async () => {
    for (;;) {
      const at = index++;
      if (at >= checked.length) return;
      const target = checked[at];
      const result = await head(target.url);
      if (result.status >= 200 && result.status < 400) ok += 1;
      else broken.push({ ...target, status: result.status, error: result.error });
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  console.log("");
  console.log(`LEGACY RASM TEKSHIRUVI — manba: ${useDb ? "production DB" : "CSV"}`);
  console.log("");
  console.log(`  rasmli yozuv          ${targets.length}`);
  console.log(`  rasmsiz yozuv         ${noImage.length}`);
  console.log(`  tekshirildi           ${checked.length}`);
  console.log(`  ishlayapti (2xx/3xx)  ${ok}`);
  console.log(`  buzilgan              ${broken.length}`);
  console.log("");
  console.log("  hostlar:", [...hosts.entries()].map(([h, n]) => `${h}=${n}`).join(" "));

  if (noImage.length > 0) {
    console.log("\n  RASMSIZ YOZUVLAR:");
    for (const entry of noImage) console.log(`    ${entry.id}  ${entry.title}`);
  }
  if (broken.length > 0) {
    console.log("\n  BUZILGAN RASMLAR:");
    for (const entry of broken.slice(0, 50)) {
      console.log(`    ${entry.id}  HTTP ${entry.status}  ${entry.error ?? ""}  ${entry.url}`);
    }
    if (broken.length > 50) console.log(`    … va yana ${broken.length - 50} ta`);
  }
  console.log("");
}

run().catch((err: unknown) => {
  console.error(`\n[check-legacy-images] ${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
});
