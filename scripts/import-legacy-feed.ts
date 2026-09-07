/**
 * Liderlar 1.0 (Tilda) feed CSV'sini `legacy_posts` jadvaliga import qiladi.
 *
 * ISHLATISH:
 *   node scripts/import-legacy-feed.ts --dry-run --file ~/Downloads/feed.csv
 *   node scripts/import-legacy-feed.ts --apply   --file ~/Downloads/feed.csv
 *   node scripts/import-legacy-feed.ts --apply   --limit 50
 *   node scripts/import-legacy-feed.ts --apply   --resume
 *
 * BAYROQLAR:
 *   --dry-run   hech narsa yozmaydi, faqat hisobot (BEKOR QILINMASA — SHU)
 *   --apply     haqiqiy yozuv. --dry-run bilan birga berilmaydi.
 *   --resume    bazadagi checksum bilan bir xil qatorlarni o'tkazib yuboradi
 *   --limit N   birinchi N ta YOZUVni ishlaydi (bo'sh qatorlar sanalmaydi)
 *   --file P    CSV yo'li (standart: ~/Downloads/feed-*.csv emas, aniq yo'l)
 *   --json      hisobotni JSON qilib chiqaradi (CI uchun)
 *   --sample N  hisobotdan keyin N ta haqiqiy yozuvning to'liq mappingini
 *               ko'rsatadi (tekshirish uchun; yozuvga ta'sir qilmaydi)
 *
 * IDEMPOTENTLIK. Yozuv `legacy_source_id` (Tilda "Post ID") bo'yicha upsert
 * qilinadi va bazada shu ustun ustidan unique indeks bor. Bitta CSV'ni ikki
 * marta ishlatsangiz ikkinchi nusxa YARATILMAYDI — mavjud yozuv yangilanadi.
 * `--resume` esa undan ham arzon: checksum o'zgarmagan qator umuman
 * yozilmaydi, shuning uchun uzilib qolgan import qaytadan boshidan
 * yugurtirilsa ham faqat qolganini qiladi.
 *
 * XOTIRA. Fayl bo'lakma-bo'lak o'qiladi va yozuvlar to'plamlarga bo'lib
 * yuboriladi; 18MB CSV hech qachon butunlay xotirada turmaydi.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { StreamingCsvParser, isBlankCsvRow, toCsvRecord } from "../src/lib/legacy/csv.ts";
import {
  LEGACY_CSV_COLUMNS,
  LEGACY_CSV_DELIMITER,
  legacyRowFingerprint,
  mapLegacyRow,
  type LegacyPostRecord,
  type LegacyWarning,
} from "../src/lib/legacy/mapping.ts";

const BATCH_SIZE = 100;

interface Options {
  file: string;
  apply: boolean;
  resume: boolean;
  limit: number | null;
  json: boolean;
  sample: number;
}

function parseArgs(argv: string[]): Options {
  const has = (flag: string) => argv.includes(flag);
  const value = (flag: string): string | null => {
    const at = argv.indexOf(flag);
    return at !== -1 && argv[at + 1] ? argv[at + 1] : null;
  };

  if (has("--apply") && has("--dry-run")) {
    throw new Error("--apply va --dry-run birga berilmaydi.");
  }

  const rawSample = value("--sample");
  const sample = rawSample === null ? 0 : Number(rawSample);
  if (rawSample !== null && (!Number.isSafeInteger(sample) || sample < 1)) {
    throw new Error(`--sample musbat butun son bo'lishi kerak, berilgani: ${rawSample}`);
  }

  const rawLimit = value("--limit");
  const limit = rawLimit === null ? null : Number(rawLimit);
  if (limit !== null && (!Number.isSafeInteger(limit) || limit < 1)) {
    throw new Error(`--limit musbat butun son bo'lishi kerak, berilgani: ${rawLimit}`);
  }

  const file = value("--file") ?? process.env.LEGACY_FEED_CSV ?? "";
  if (!file) {
    throw new Error("CSV yo'li berilmadi. --file <path> yoki LEGACY_FEED_CSV ishlating.");
  }

  return {
    file: file.startsWith("~") ? path.join(os.homedir(), file.slice(1)) : path.resolve(file),
    // Yozish ATAYLAB aniq talab qilinadi: bayroqsiz ishga tushirish hech
    // qachon productionga yozmaydi.
    apply: has("--apply"),
    resume: has("--resume"),
    limit,
    json: has("--json"),
    sample,
  };
}

interface Report {
  file: string;
  mode: "dry-run" | "apply";
  total: number;
  valid: number;
  invalid: number;
  duplicates: number;
  /**
   * Bir xil F.I.Sh. bilan bir nechta AYRIM yozuv.
   *
   * Bular takror import EMAS: har birining o'z Post ID'si va o'z 1.0
   * havolasi bor (ikki "Asomiddinov" yozuvi bir-biriga havola ham qiladi),
   * shuning uchun ikkalasi ham import qilinadi. Bu tahririyat uchun signal —
   * qaysi biri qolishini odam hal qiladi, skript emas.
   */
  duplicateTitles: number;
  missingSlug: number;
  missingDate: number;
  missingImage: number;
  missingContent: number;
  readyToImport: number;
  published: number;
  draft: number;
  raggedRows: number;
  written: number;
  inserted: number;
  updated: number;
  skippedUnchanged: number;
  invalidExamples: { line: number; postId: string; title: string; issues: string[] }[];
  duplicateExamples: { postId: string; title: string; firstLine: number; line: number }[];
  duplicateTitleExamples: { title: string; postIds: string[] }[];
  samples: LegacyPostRecord[];
}

function emptyReport(options: Options): Report {
  return {
    file: options.file,
    mode: options.apply ? "apply" : "dry-run",
    total: 0,
    valid: 0,
    invalid: 0,
    duplicates: 0,
    duplicateTitles: 0,
    missingSlug: 0,
    missingDate: 0,
    missingImage: 0,
    missingContent: 0,
    readyToImport: 0,
    published: 0,
    draft: 0,
    raggedRows: 0,
    written: 0,
    inserted: 0,
    updated: 0,
    skippedUnchanged: 0,
    invalidExamples: [],
    duplicateExamples: [],
    duplicateTitleExamples: [],
    samples: [],
  };
}

function countWarnings(report: Report, warnings: LegacyWarning[]): void {
  if (warnings.includes("missing_date")) report.missingDate += 1;
  if (warnings.includes("missing_image")) report.missingImage += 1;
  if (warnings.includes("missing_content")) report.missingContent += 1;
}

function supabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL va SUPABASE_SERVICE_ROLE_KEY kerak (--apply uchun).",
    );
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

type Client = ReturnType<typeof supabaseAdmin>;

interface Pending {
  record: LegacyPostRecord;
  checksum: string;
}

/**
 * Bir to'plamni yozadi.
 *
 * IDEMPOTENTLIK QANDAY ISHLAYDI. Avval shu to'plamdagi `legacy_source_id` lar
 * bo'yicha mavjud qatorlar o'qiladi; topilganlari YANGILANADI (o'z `id` si
 * bo'yicha), topilmaganlari QO'SHILADI. Shuning uchun bitta CSV ikki marta
 * ishlatilsa ham ikkinchi nusxa yaratilmaydi.
 *
 * Nega `upsert(..., { onConflict: "legacy_source_id" })` emas: jadvaldagi
 * unique indeks QISMAN (`where deleted_at is null`), Postgres esa qisman
 * indeksni `ON CONFLICT (ustun)` bilan ishlata olmaydi — u indeksga mos
 * `WHERE` bandini talab qiladi, PostgREST esa uni yubormaydi. Production'da
 * aynan shu xato chiqdi: "there is no unique or exclusion constraint matching
 * the ON CONFLICT specification". Birlamchi kalit (`id`) bo'yicha upsert esa
 * to'liq unique, shuning uchun yangilash o'sha yo'l bilan ketadi.
 *
 * Qisman indeks baribir himoya bo'lib qoladi: ikkita parallel yugurish bir
 * xil `legacy_source_id` ni qo'shmoqchi bo'lsa, ikkinchisini baza rad etadi.
 *
 * `--resume` da checksum o'zgarmagan qator umuman yozilmaydi.
 */
async function flush(db: Client, batch: Pending[], report: Report, resume: boolean): Promise<void> {
  if (batch.length === 0) return;

  const sourceIds = batch.map((item) => item.record.legacy_source_id);
  const { data: existingRows, error: readError } = await db
    .from("legacy_posts")
    .select("id, legacy_source_id, import_checksum")
    .in("legacy_source_id", sourceIds);
  if (readError) throw new Error(`mavjud qatorlarni o'qishda xato: ${readError.message}`);

  const existing = new Map(
    (existingRows ?? []).map((row) => [
      row.legacy_source_id as string,
      { id: row.id as string, checksum: (row.import_checksum as string | null) ?? null },
    ]),
  );

  let toWrite = batch;
  if (resume) {
    toWrite = batch.filter(
      (item) => existing.get(item.record.legacy_source_id)?.checksum !== item.checksum,
    );
    report.skippedUnchanged += batch.length - toWrite.length;
  }
  if (toWrite.length === 0) return;

  const payload = (item: Pending) => ({
    ...item.record,
    source_version: "1.0",
    import_checksum: item.checksum,
    imported_at: new Date().toISOString(),
  });

  const inserts = toWrite
    .filter((item) => !existing.has(item.record.legacy_source_id))
    .map(payload);
  const updates = toWrite
    .filter((item) => existing.has(item.record.legacy_source_id))
    .map((item) => ({ id: existing.get(item.record.legacy_source_id)!.id, ...payload(item) }));

  if (inserts.length > 0) {
    const { error } = await db.from("legacy_posts").insert(inserts);
    if (error) throw new Error(`qo'shishda xato: ${error.message}`);
    report.inserted += inserts.length;
  }
  if (updates.length > 0) {
    const { error } = await db.from("legacy_posts").upsert(updates, { onConflict: "id" });
    if (error) throw new Error(`yangilashda xato: ${error.message}`);
    report.updated += updates.length;
  }
  report.written += toWrite.length;
}

async function run(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(options.file)) throw new Error(`CSV topilmadi: ${options.file}`);

  const report = emptyReport(options);
  const db = options.apply ? supabaseAdmin() : null;
  const seen = new Map<string, number>();
  const titles = new Map<string, string[]>();
  const parser = new StreamingCsvParser({ delimiter: LEGACY_CSV_DELIMITER });

  let header: string[] | null = null;
  let line = 0;
  let stop = false;
  let batch: Pending[] = [];

  const handleRow = async (row: string[]): Promise<void> => {
    if (stop || isBlankCsvRow(row)) return;
    if (!header) {
      header = row.map((c) => c.trim());
      const missing = LEGACY_CSV_COLUMNS.filter((c) => !header!.includes(c));
      if (missing.length > 0) {
        throw new Error(`CSV sarlavhasida ustunlar yetishmayapti: ${missing.join(", ")}`);
      }
      return;
    }

    line += 1;
    if (options.limit !== null && report.total >= options.limit) {
      stop = true;
      return;
    }
    report.total += 1;

    const record = toCsvRecord(header, row);
    if (!record) {
      report.raggedRows += 1;
      report.invalid += 1;
      if (report.invalidExamples.length < 5) {
        report.invalidExamples.push({ line, postId: "", title: "", issues: ["ragged_row"] });
      }
      return;
    }

    const mapped = mapLegacyRow(record);
    countWarnings(report, mapped.warnings);

    if (!mapped.ok) {
      report.invalid += 1;
      if (mapped.issues.includes("missing_slug")) report.missingSlug += 1;
      if (report.invalidExamples.length < 5) {
        report.invalidExamples.push({
          line,
          postId: (record["Post ID"] ?? "").trim(),
          title: (record["Title"] ?? "").trim(),
          issues: mapped.issues,
        });
      }
      return;
    }

    report.valid += 1;
    const id = mapped.record.legacy_source_id;
    const firstLine = seen.get(id);
    if (firstLine !== undefined) {
      // Fayl ichidagi takror: ikkinchi nusxa YOZILMAYDI, aks holda bitta
      // upsert boshqasini bosib ketardi va qaysi biri yutgani tasodifga
      // bog'liq bo'lardi.
      report.duplicates += 1;
      if (report.duplicateExamples.length < 5) {
        report.duplicateExamples.push({
          postId: id,
          title: mapped.record.title,
          firstLine,
          line,
        });
      }
      return;
    }
    seen.set(id, line);

    const titleKey = mapped.record.title.toLowerCase();
    const sameTitle = titles.get(titleKey);
    if (sameTitle) sameTitle.push(id);
    else titles.set(titleKey, [id]);

    if (mapped.record.legacy_status === "published") report.published += 1;
    else report.draft += 1;
    report.readyToImport += 1;
    if (report.samples.length < options.sample) report.samples.push(mapped.record);

    if (db) {
      batch.push({
        record: mapped.record,
        checksum: createHash("sha256").update(legacyRowFingerprint(record)).digest("hex"),
      });
      if (batch.length >= BATCH_SIZE) {
        await flush(db, batch, report, options.resume);
        batch = [];
      }
    }
  };

  const stream = fs.createReadStream(options.file, { encoding: "utf8", highWaterMark: 1 << 20 });
  for await (const chunk of stream) {
    for (const row of parser.push(chunk as string)) {
      await handleRow(row);
      if (stop) break;
    }
    if (stop) break;
  }
  stream.destroy();
  if (!stop) {
    for (const row of parser.end()) await handleRow(row);
  }
  if (db) await flush(db, batch, report, options.resume);

  for (const [, ids] of titles) {
    if (ids.length < 2) continue;
    report.duplicateTitles += ids.length;
  }
  for (const [title, ids] of titles) {
    if (ids.length < 2 || report.duplicateTitleExamples.length >= 5) continue;
    report.duplicateTitleExamples.push({ title, postIds: ids });
  }

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  printReport(report);
}

function printReport(report: Report): void {
  const line = (label: string, value: number | string) =>
    console.log(`  ${label.padEnd(24)} ${value}`);

  console.log("");
  console.log(`LIDERLAR 1.0 IMPORT — ${report.mode.toUpperCase()}`);
  console.log(`  ${report.file}`);
  console.log("");
  line("total", report.total);
  line("valid", report.valid);
  line("duplicates (Post ID)", report.duplicates);
  line("duplicate names", report.duplicateTitles);
  line("invalid", report.invalid);
  line("missing slug", report.missingSlug);
  line("missing date", report.missingDate);
  line("missing image", report.missingImage);
  line("missing content", report.missingContent);
  line("READY TO IMPORT", report.readyToImport);
  console.log("");
  line("  · published", report.published);
  line("  · draft", report.draft);
  if (report.raggedRows > 0) line("ragged rows", report.raggedRows);

  if (report.mode === "apply") {
    console.log("");
    line("written", report.written);
    line("  · inserted", report.inserted);
    line("  · updated", report.updated);
    line("skipped (unchanged)", report.skippedUnchanged);
  } else {
    console.log("");
    console.log("  Hech narsa yozilmadi. Yozish uchun: --apply");
  }

  if (report.invalidExamples.length > 0) {
    console.log("\n  YAROQSIZ (birinchi 5):");
    for (const e of report.invalidExamples) {
      console.log(`    satr ${e.line}: ${e.postId || "(id yo‘q)"} ${e.title} — ${e.issues.join(", ")}`);
    }
  }
  if (report.duplicateExamples.length > 0) {
    console.log("\n  TAKRORLANGAN Post ID (birinchi 5):");
    for (const e of report.duplicateExamples) {
      console.log(`    ${e.postId} — satr ${e.line} (birinchisi: ${e.firstLine}) ${e.title}`);
    }
  }
  if (report.duplicateTitleExamples.length > 0) {
    console.log("\n  BIR XIL F.I.Sh., AYRIM YOZUVLAR (birinchi 5):");
    for (const e of report.duplicateTitleExamples) {
      console.log(`    ${e.title} — ${e.postIds.join(", ")}`);
    }
  }
  if (report.samples.length > 0) {
    console.log("\n  NAMUNA MAPPING:");
    for (const r of report.samples) {
      console.log(`\n    F.I.Sh.        ${r.title}`);
      console.log(`    legacy path    ${r.legacy_path}`);
      console.log(`    legacy id      ${r.legacy_source_id}`);
      console.log(`    date           ${r.legacy_created_at ?? "(yo‘q)"}`);
      console.log(`    image          ${r.cover_image_url ?? "(yo‘q)"}`);
      console.log(`    status         ${r.legacy_status}`);
      console.log(`    categories     ${r.legacy_categories.join(", ") || "(yo‘q)"}`);
      console.log(`    summary        ${(r.summary ?? "").slice(0, 90)}`);
      console.log(`    content_html   ${r.content_html.length} belgi | ${r.content_html.slice(0, 70)}…`);
      console.log(`    content_text   ${r.content_text.length} belgi`);
      console.log(`    public URL     https://liderlar.uz${r.legacy_path}`);
    }
  }
  console.log("");
}

run().catch((err: unknown) => {
  console.error(`\n[import-legacy-feed] ${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
});
