import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  EVIDENCE_ACCEPT,
  EVIDENCE_BUCKET,
  EVIDENCE_LINK_SECONDS,
  EVIDENCE_MAX_BYTES,
  EVIDENCE_TYPES,
  buildEvidencePath,
  describeEvidence,
  evidenceDownloadName,
  evidenceExtension,
  isUuid,
  matchesEvidenceBytes,
  validEvidenceMeta,
  validEvidencePath,
} from "../src/lib/profile-editor/evidence-rules.ts";

/*
 * SERTIFIKAT DALILI — YOPIQ BUCKET (§8).
 *
 * BU FAYL IKKALA REPODA AYNAN BIR XIL. Migratsiya admin repoda, yuklash
 * xizmati sayt repoda, tahririyat havolasi admin repoda — har biri o'z
 * reposi topilgandagina tekshiriladi, topilmasa sababi yozilib o'tkazib
 * yuboriladi.
 */

const SELF = (JSON.parse(readFileSync("package.json", "utf8")) as { name: string }).name;
const IS_ADMIN = SELF === "liderlar-admin";
const OTHER = join("..", IS_ADMIN ? "liderlar-web" : "liderlar-admin");
const HAS_OTHER = existsSync(join(OTHER, "package.json"));
const ADMIN = IS_ADMIN ? "." : HAS_OTHER ? OTHER : null;
const WEB = IS_ADMIN ? (HAS_OTHER ? OTHER : null) : ".";
const NEEDS_OTHER = HAS_OTHER ? false : `${OTHER} topilmadi — ikki repoli tekshiruv o'tkazib yuborildi`;
const NEEDS_ADMIN = ADMIN ? false : "liderlar-admin topilmadi";
const NEEDS_WEB = WEB ? false : "liderlar-web topilmadi";

const RULES = "src/lib/profile-editor/evidence-rules.ts";
const MIGRATION = "supabase/migrations/20261002233000_certificate_evidence.sql";

const CANDIDATE = "3f2a9c1e-0b7d-4e21-9a55-6c1d2e3f4a5b";
const CERTIFICATE = "8d4e2f10-1a2b-4c3d-8e9f-0a1b2c3d4e5f";
const FILE = "c0ffee00-1234-4abc-8def-0123456789ab";

function read(root: string | null, path: string): string {
  assert.ok(root, "repo topilmadi");
  return readFileSync(join(root, path), "utf8");
}

/* ------------------------------------------------------------------ *
 * QOIDALAR FAYLI
 * ------------------------------------------------------------------ */

test("qoidalar fayli hech narsa import qilmaydi", () => {
  assert.doesNotMatch(readFileSync(RULES, "utf8"), /^\s*import\s/m);
});

test("qoidalar fayli ikki repoda bayt-baytigacha bir xil", { skip: NEEDS_OTHER }, () => {
  assert.equal(readFileSync(RULES, "utf8"), readFileSync(join(OTHER, RULES), "utf8"));
});

test("dalil testining o'zi ikki repoda bir xil", { skip: NEEDS_OTHER }, () => {
  const self = "tests/certificate-evidence.test.ts";
  assert.equal(readFileSync(self, "utf8"), readFileSync(join(OTHER, self), "utf8"));
});

/* ------------------------------------------------------------------ *
 * TUR VA HAJM
 * ------------------------------------------------------------------ */

test("ruxsat etilgan tur va hajm", () => {
  for (const mime of Object.keys(EVIDENCE_TYPES)) {
    assert.equal(validEvidenceMeta(mime, 1), true, mime);
    assert.equal(validEvidenceMeta(mime, EVIDENCE_MAX_BYTES), true, mime);
  }
  assert.equal(EVIDENCE_MAX_BYTES, 10 * 1024 * 1024);
  assert.equal(EVIDENCE_ACCEPT, "application/pdf,image/jpeg,image/png,image/webp");
});

test("noto'g'ri tur yoki hajm rad etiladi", () => {
  const bad: Array<[unknown, unknown]> = [
    ["image/gif", 100],
    ["text/html", 100],
    ["image/svg+xml", 100],
    ["constructor", 100],
    ["__proto__", 100],
    ["application/pdf", 0],
    ["application/pdf", -1],
    ["application/pdf", 1.5],
    ["application/pdf", EVIDENCE_MAX_BYTES + 1],
    ["application/pdf", "100"],
    [null, 100],
  ];
  for (const [mime, size] of bad) {
    assert.equal(validEvidenceMeta(mime, size), false, `${String(mime)} / ${String(size)}`);
  }
});

test("kengaytma faqat o'z xossalaridan olinadi", () => {
  assert.equal(evidenceExtension("application/pdf"), "pdf");
  assert.equal(evidenceExtension("image/jpeg"), "jpg");
  // Prototipdagi funksiya "kengaytma" bo'lib yo'lga tushmasin.
  assert.equal(evidenceExtension("constructor"), null);
  assert.equal(evidenceExtension("toString"), null);
  assert.equal(evidenceExtension(42), null);
});

/* ------------------------------------------------------------------ *
 * YO'L
 * ------------------------------------------------------------------ */

test("yo'l serverda yasaladi va bazadagi shaklga mos keladi", () => {
  const path = buildEvidencePath(CANDIDATE, CERTIFICATE, FILE, "application/pdf");
  assert.equal(path, `candidates/${CANDIDATE}/${CERTIFICATE}/${FILE}.pdf`);
  // Bazadagi CHECK bilan bir xil andoza.
  assert.match(path!, /^candidates\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(pdf|jpg|png|webp)$/);

  // Katta harfli id ham kichik harfga keltiriladi (CHECK faqat kichik harf qabul qiladi).
  assert.equal(
    buildEvidencePath(CANDIDATE.toUpperCase(), CERTIFICATE, FILE, "image/png"),
    `candidates/${CANDIDATE}/${CERTIFICATE}/${FILE}.png`,
  );
});

test("noto'g'ri id yoki tur bilan yo'l yasalmaydi", () => {
  assert.equal(buildEvidencePath("../x", CERTIFICATE, FILE, "application/pdf"), null);
  assert.equal(buildEvidencePath(CANDIDATE, "abc", FILE, "application/pdf"), null);
  assert.equal(buildEvidencePath(CANDIDATE, CERTIFICATE, "x", "application/pdf"), null);
  assert.equal(buildEvidencePath(CANDIDATE, CERTIFICATE, FILE, "text/html"), null);
  assert.equal(buildEvidencePath(CANDIDATE, CERTIFICATE, FILE, "constructor"), null);
});

test("brauzer qaytargan yo'l faqat shu nomzod va shu sertifikatniki bo'lsa qabul qilinadi", () => {
  const good = `candidates/${CANDIDATE}/${CERTIFICATE}/${FILE}.pdf`;
  assert.equal(validEvidencePath(good, CANDIDATE, CERTIFICATE), true);
  assert.equal(validEvidencePath(good, CANDIDATE.toUpperCase(), CERTIFICATE), true);

  const other = "11111111-2222-4333-8444-555555555555";
  const bad = [
    `candidates/${other}/${CERTIFICATE}/${FILE}.pdf`, // begona nomzod
    `candidates/${CANDIDATE}/${other}/${FILE}.pdf`, // begona sertifikat
    `candidates/${CANDIDATE}/${CERTIFICATE}/../${other}/${FILE}.pdf`,
    `candidates/${CANDIDATE}/${CERTIFICATE}/x/${FILE}.pdf`,
    `candidates/${CANDIDATE}/${CERTIFICATE}/${FILE}.html`,
    `candidates/${CANDIDATE}/${CERTIFICATE}/${FILE.toUpperCase()}.pdf`,
    `candidates/${CANDIDATE}/${CERTIFICATE}/${FILE}.pdf.html`,
    `/candidates/${CANDIDATE}/${CERTIFICATE}/${FILE}.pdf`,
    "",
  ];
  for (const path of bad) assert.equal(validEvidencePath(path, CANDIDATE, CERTIFICATE), false, path);
  assert.equal(validEvidencePath(42, CANDIDATE, CERTIFICATE), false);
  assert.equal(validEvidencePath(good, "nope", CERTIFICATE), false);
});

test("uuid tekshiruvi", () => {
  assert.equal(isUuid(CANDIDATE), true);
  assert.equal(isUuid(CANDIDATE.toUpperCase()), true);
  assert.equal(isUuid(`${CANDIDATE} `), false);
  assert.equal(isUuid("not-a-uuid"), false);
  assert.equal(isUuid(null), false);
});

/* ------------------------------------------------------------------ *
 * SEHRLI BAYTLAR
 * ------------------------------------------------------------------ */

const bytes = (...values: number[]) => new Uint8Array(values);
const text = (value: string) => new TextEncoder().encode(value);

test("haqiqiy fayl boshlari tanib olinadi", () => {
  assert.equal(matchesEvidenceBytes(text("%PDF-1.7\n%âãÏÓ"), "application/pdf"), true);
  assert.equal(matchesEvidenceBytes(text("%PDF-2.0\n"), "application/pdf"), true);
  assert.equal(matchesEvidenceBytes(bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0x10), "image/jpeg"), true);
  assert.equal(
    matchesEvidenceBytes(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d), "image/png"),
    true,
  );
  assert.equal(matchesEvidenceBytes(text("RIFF\x24\x00\x00\x00WEBPVP8 "), "image/webp"), true);
});

test("turga mos kelmaydigan mazmun rad etiladi", () => {
  // HTML yoki skript rasm deb yuklansa, tahririyat brauzerida ochilardi.
  assert.equal(matchesEvidenceBytes(text("<!doctype html><script>"), "image/png"), false);
  assert.equal(matchesEvidenceBytes(text("<svg xmlns="), "image/jpeg"), false);
  assert.equal(matchesEvidenceBytes(text("%PDF-9.9\n"), "application/pdf"), false);
  assert.equal(matchesEvidenceBytes(text("RIFF\x24\x00\x00\x00WAVEfmt "), "image/webp"), false);
  // Rasm PDF deb yuklansa ham rad.
  assert.equal(matchesEvidenceBytes(bytes(0xff, 0xd8, 0xff, 0xe0), "application/pdf"), false);
  // Bo'sh va juda qisqa fayl.
  assert.equal(matchesEvidenceBytes(new Uint8Array(0), "image/jpeg"), false);
  assert.equal(matchesEvidenceBytes(bytes(0xff, 0xd8), "image/jpeg"), false);
  assert.equal(matchesEvidenceBytes(text("%PDF-1.7"), "text/plain"), false);
});

/* ------------------------------------------------------------------ *
 * KO'RSATISH
 * ------------------------------------------------------------------ */

test("yuklab olish nomi ichki yo'lni oshkor qilmaydi", () => {
  assert.equal(evidenceDownloadName("application/pdf"), "sertifikat-dalili.pdf");
  assert.equal(evidenceDownloadName("image/webp"), "sertifikat-dalili.webp");
  assert.equal(evidenceDownloadName("text/html"), "sertifikat-dalili.bin");
  assert.equal(evidenceDownloadName("constructor"), "sertifikat-dalili.bin");
});

test("dalil tavsifi: tur va hajm", () => {
  assert.equal(describeEvidence("application/pdf", 1.5 * 1024 * 1024), "PDF · 1,5 MB");
  assert.equal(describeEvidence("image/png", 2048), "Rasm · 2 KB");
  assert.equal(describeEvidence("image/jpeg", 100), "Rasm · 1 KB");
});

test("imzolangan havola qisqa muddatli", () => {
  assert.ok(EVIDENCE_LINK_SECONDS > 0 && EVIDENCE_LINK_SECONDS <= 300);
  assert.equal(EVIDENCE_BUCKET, "certificate-evidence");
});

/* ------------------------------------------------------------------ *
 * MIGRATSIYA (admin repo)
 * ------------------------------------------------------------------ */

test("bucket yopiq va chegaralari kod bilan bir xil", { skip: NEEDS_ADMIN }, () => {
  const sql = read(ADMIN, MIGRATION);
  assert.match(sql, /'certificate-evidence',\s*'certificate-evidence',\s*false,\s*10485760,/);
  assert.match(sql, /on conflict \(id\) do update\s+set public = false/);
  assert.equal(10485760, EVIDENCE_MAX_BYTES);

  const allowed = /array\[([^\]]+)\]/.exec(sql)?.[1].split(",").map((item) => item.trim().replaceAll("'", ""));
  assert.deepEqual(allowed, Object.keys(EVIDENCE_TYPES));
  assert.match(sql, /mime_type in \('application\/pdf', 'image\/jpeg', 'image\/png', 'image\/webp'\)/);
  assert.match(sql, /size_bytes > 0 and size_bytes <= 10485760/);
});

test("umumiy admin storage siyosatlari dalil bucketini qamramaydi", { skip: NEEDS_ADMIN }, () => {
  /*
   * Siyosatlar OR bilan birlashadi: `media.view` ruxsati bor har bir
   * xodim shaxsiy hujjatni storage API orqali o'qimasligi uchun keng
   * siyosatlarning o'zi shu bucketni chiqarib qayta ta'riflanadi.
   */
  const sql = read(ADMIN, MIGRATION);
  for (const [name, verb, permission] of [
    ["admins read all buckets", "select", "media.view"],
    ["admins upload media", "insert", "media.upload"],
    ["admins delete media", "delete", "media.delete"],
  ]) {
    const pattern = new RegExp(
      `create policy "${name}"\\s+on storage\\.objects for ${verb}[\\s\\S]*?` +
        `has_permission\\('${permission.replace(".", "\\.")}'\\) and bucket_id <> 'certificate-evidence'\\)`,
    );
    assert.match(sql, pattern, name);
  }
});

test("hech bir migratsiya dalil bucketiga storage siyosati bermaydi", { skip: NEEDS_ADMIN }, () => {
  // Yuklash va o'qish faqat server bergan imzolangan havola orqali.
  const dir = join(ADMIN!, "supabase/migrations");
  const bad: string[] = [];
  for (const name of readdirSync(dir).filter((file) => file.endsWith(".sql"))) {
    const sql = readFileSync(join(dir, name), "utf8");
    if (/bucket_id\s*(=|in\s*\()[^;]*certificate-evidence/i.test(sql)) bad.push(name);
  }
  assert.deepEqual(bad, []);
});

test("dalil jadvali: RLS yoqilgan, yozish faqat service_role funksiyalari orqali", { skip: NEEDS_ADMIN }, () => {
  const sql = read(ADMIN, MIGRATION);
  assert.match(sql, /alter table public\.certificate_evidence enable row level security;/);
  assert.doesNotMatch(sql, /on public\.certificate_evidence for (insert|update|delete|all)/);
  assert.match(sql, /constraint certificate_evidence_path_owner check/);

  for (const fn of [
    "attach_certificate_evidence(uuid, uuid, uuid, text, text, bigint)",
    "detach_certificate_evidence(uuid, uuid)",
  ]) {
    const escaped = fn.replace(/[()]/g, "\\$&");
    assert.match(sql, new RegExp(`revoke all on function public\\.${escaped}\\s+from public, anon, authenticated;`), fn);
    assert.match(sql, new RegExp(`grant execute on function public\\.${escaped}\\s+to service_role;`), fn);
  }
});

test("dalil o'zgarsa sertifikat qayta tekshiruvga tushadi", { skip: NEEDS_ADMIN }, () => {
  const sql = read(ADMIN, MIGRATION);
  const attach = sql.slice(sql.indexOf("function public.attach_certificate_evidence"));
  assert.match(attach, /set trust = 'pending_review',\s+reviewed_by = null,\s+reviewed_at = null,\s+review_note = null,\s+evidence_url = null/);
  // Parallel ikkinchi yuklash eski yo'lni yo'qotmasligi uchun qulf.
  assert.match(attach, /for update;/);
  assert.match(attach, /return nullif\(v_old_path, p_path\);/);
});

/* ------------------------------------------------------------------ *
 * YUKLASH XIZMATI (sayt repo)
 * ------------------------------------------------------------------ */

test("yuklash: huquq, egalik, server yasagan yo'l va baytlar tekshiruvi", { skip: NEEDS_WEB }, () => {
  const service = read(WEB, "src/lib/profile-editor/evidence-service.ts");
  const sign = service.slice(service.indexOf("export async function signEvidenceUpload"), service.indexOf("export async function commitEvidenceUpload"));
  const commit = service.slice(service.indexOf("export async function commitEvidenceUpload"), service.indexOf("export async function removeCertificateEvidence"));

  // Imzo: avval huquq, keyin egalik; yo'l serverda tasodifiy uuid bilan.
  assert.ok(sign.indexOf("requireEntitlement(") < sign.indexOf("ownCertificate("));
  assert.match(sign, /buildEvidencePath\(\s*owned\.candidateId,\s*owned\.certificateId,\s*randomUUID\(\)/);
  assert.match(sign, /createSignedUploadUrl\(path\)/);

  // Tasdiqlash: yo'l egaga tegishli, tur/hajm storage'dan, baytlar tekshiriladi.
  assert.match(commit, /validEvidencePath\(input\.path, owned\.candidateId, owned\.certificateId\)/);
  assert.match(commit, /object\.metadata\?\.mimetype/);
  assert.match(commit, /matchesEvidenceBytes\(head, mime\)/);
  // Baytlar bazaga bog'lashdan OLDIN tekshiriladi.
  assert.ok(commit.indexOf("matchesEvidenceBytes(") < commit.indexOf('"attach_certificate_evidence"'));
  // Rad etilgan va bog'lanmagan fayl bucketda qolmaydi.
  assert.ok((commit.match(/removeObject\(/g) ?? []).length >= 4, "rad etilgan fayl o'chirilmaydi");
});

test("egasiga havola: faqat o'z sertifikati, yo'l sahifaga chiqmaydi", { skip: NEEDS_WEB }, () => {
  const service = read(WEB, "src/lib/profile-editor/evidence-service.ts");
  const own = service.slice(service.indexOf("export async function ownEvidenceLink"));
  assert.match(own, /\.eq\("candidate_id", resolved\.owned\.candidateId\)/);
  assert.match(own, /createSignedUrl\(data\.path as string, EVIDENCE_LINK_SECONDS/);

  const route = read(WEB, "src/app/api/profile/certificate-evidence/[id]/route.ts");
  assert.match(route, /"Cache-Control": "private, no-store"/);
  assert.match(route, /"Referrer-Policy": "no-referrer"/);

  // Sahifa komponentlari bucket yo'lini ko'rsatmaydi — faqat marshrut havolasi.
  const section = read(WEB, "src/components/profile-editor/certificates-section.tsx");
  assert.doesNotMatch(section, /certificate-evidence\/candidates\//);
  assert.match(section, /\/api\/profile\/certificate-evidence\//);
});

/* ------------------------------------------------------------------ *
 * TAHRIRIYAT HAVOLASI (admin repo)
 * ------------------------------------------------------------------ */

test("tahririyat: candidates.edit talab qilinadi va har ochish jurnalga yoziladi", { skip: NEEDS_ADMIN }, () => {
  const route = read(ADMIN, "src/app/api/profile/certificate-evidence/[id]/route.ts");
  assert.match(route, /checkPermission\("candidates\.edit"\)/);
  assert.match(route, /recordAudit\("profile\.certificate\.evidence_viewed"/);
  assert.match(route, /createSignedUrl\(data\.path as string, EVIDENCE_LINK_SECONDS/);
  assert.match(route, /"Cache-Control": "private, no-store"/);
  // Jurnal havola berilgandan KEYIN, yo'naltirishdan OLDIN yoziladi.
  assert.ok(route.indexOf("createSignedUrl(") < route.indexOf("recordAudit("));
  assert.ok(route.indexOf("recordAudit(") < route.indexOf("NextResponse.redirect("));
});
