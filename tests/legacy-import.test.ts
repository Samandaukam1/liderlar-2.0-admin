import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  buildLegacyPath,
  buildLegacySlug,
  extractLegacyPostId,
  LEGACY_PATH_PREFIX,
  slugifyLegacyTitle,
} from "../src/lib/legacy/slug.ts";
import { sanitizeLegacyHtml } from "../src/lib/legacy/sanitize-html.ts";
import {
  LEGACY_CSV_COLUMNS,
  LEGACY_CSV_DELIMITER,
  legacyRowFingerprint,
  mapLegacyRow,
  parseLegacyCategories,
  parseLegacyDate,
  parseLegacyStatus,
  pickLegacyImage,
} from "../src/lib/legacy/mapping.ts";
import { StreamingCsvParser, isBlankCsvRow, toCsvRecord } from "../src/lib/legacy/csv.ts";

/* ------------------------------- CSV shape -------------------------------- */

test("the exported column list matches the real feed header", () => {
  // Exactly the 19 columns of the Tilda export, in order.
  assert.equal(LEGACY_CSV_COLUMNS.length, 19);
  assert.equal(LEGACY_CSV_COLUMNS[0], "Post ID");
  assert.equal(LEGACY_CSV_COLUMNS[1], "Alias");
  assert.equal(LEGACY_CSV_COLUMNS[8], "Date");
  assert.equal(LEGACY_CSV_COLUMNS[9], "Visibility");
  assert.equal(LEGACY_CSV_DELIMITER, ";");
});

test("the streaming parser keeps quoted newlines inside one record", () => {
  // The real file has 2200 physical lines but 1991 records: the article HTML
  // carries newlines inside quoted fields. Splitting on "\n" would shred it.
  const parser = new StreamingCsvParser({ delimiter: ";" });
  const rows = [
    ...parser.push('"Post ID";Title\n"abc";"Bir\nikki"\n'),
    ...parser.end(),
  ];
  assert.deepEqual(rows, [
    ["Post ID", "Title"],
    ["abc", "Bir\nikki"],
  ]);
});

test("the parser handles escaped quotes, CRLF and a chunk split mid-field", () => {
  const parser = new StreamingCsvParser({ delimiter: ";" });
  const rows = [
    ...parser.push('a;"He said ""hi"""\r\nb;'),
    ...parser.push('"tail"\r\n'),
    ...parser.end(),
  ];
  assert.deepEqual(rows, [
    ["a", 'He said "hi"'],
    ["b", "tail"],
  ]);
});

test("a row whose column count does not match is refused, not silently shifted", () => {
  assert.equal(toCsvRecord(["a", "b"], ["1"]), null);
  assert.deepEqual(toCsvRecord(["a", "b"], ["1", "2"]), { a: "1", b: "2" });
  assert.ok(isBlankCsvRow([""]));
  assert.ok(!isBlankCsvRow(["x"]));
});

/* ------------------------------ legacy slug ------------------------------- */

test("the slug rule reproduces the real 1.0 URLs found in the source data", () => {
  // Not invented: these two full liderlar.uz links survived inside two article
  // bodies in the export, where one duplicate record links to the other.
  assert.equal(
    buildLegacySlug("9bidsfxtk1", "ASOMIDDINOV BEHRUZBEK NURIDDIN O‘G‘LI"),
    "9bidsfxtk1-asomiddinov-behruzbek-nuriddin-ogli",
  );
  assert.equal(
    buildLegacySlug("eux0ts6bh1", "ASOMIDDINOV BEHRUZBEK NURIDDIN O‘G‘LI"),
    "eux0ts6bh1-asomiddinov-behruzbek-nuriddin-ogli",
  );
  assert.equal(LEGACY_PATH_PREFIX, "/nomzodlar");
  assert.equal(buildLegacyPath("x"), "/nomzodlar/x");
});

test("uzbek apostrophes are dropped rather than turned into separators", () => {
  for (const apostrophe of ["‘", "’", "ʻ", "ʼ", "'"]) {
    assert.equal(slugifyLegacyTitle(`ALIYEV BEK O${apostrophe}G${apostrophe}LI`), "aliyev-bek-ogli");
  }
  assert.equal(slugifyLegacyTitle("NURMUHAMMADOV SHOHRÓZ"), "nurmuhammadov-shohroz");
  // One title in the export starts with a Cyrillic А.
  assert.equal(slugifyLegacyTitle("АSTANOVA KAMOLA"), "astanova-kamola");
});

test("an explicit Tilda alias wins, and the post id prefix stays recoverable", () => {
  assert.equal(buildLegacySlug("jh8j2kasx1", "XASANOV SANJAR", "xasanov-sanjar"), "xasanov-sanjar");
  assert.equal(extractLegacyPostId("9bidsfxtk1-asomiddinov"), "9bidsfxtk1");
  assert.equal(extractLegacyPostId("xasanov-sanjar"), null);
});

/* ------------------------------ sanitization ------------------------------ */

test("script, iframe, style and their contents never survive", () => {
  const dirty =
    '<div class="t-redactor__text">Salom<script>alert(1)</script>' +
    '<iframe src="https://evil.test"></iframe><style>body{display:none}</style>dunyo</div>';
  const { html } = sanitizeLegacyHtml(dirty);
  assert.ok(!/script|iframe|style|alert/i.test(html), html);
  assert.equal(html, "<p>Salomdunyo</p>");
});

test("javascript: and data: links are refused, http(s) links are hardened", () => {
  const js = sanitizeLegacyHtml('<a href="javascript:alert(1)">bos</a>').html;
  assert.ok(!js.includes("javascript"), js);
  assert.equal(js, "bos", "the text stays, the link does not");

  // A tab inside the scheme still executes in a browser, so it is stripped first.
  const sneaky = sanitizeLegacyHtml('<a href="java\tscript:alert(1)">bos</a>').html;
  assert.ok(!sneaky.includes("script:"), sneaky);

  assert.ok(!sanitizeLegacyHtml('<a href="data:text/html,<b>x">y</a>').html.includes("data:"));

  const ok = sanitizeLegacyHtml('<a href="https://liderlar.uz">Sayt</a>').html;
  assert.equal(
    ok,
    '<a href="https://liderlar.uz" target="_blank" rel="noopener noreferrer nofollow">Sayt</a>',
  );
});

test("an encoded ampersand in a link is not escaped twice", () => {
  // Real data: an href arrives as "…?utm_source=x&amp;utm_content=y". Escaping
  // that again produced "&amp;amp;", and the browser then saw a parameter
  // literally named "amp;utm_content" — a broken link.
  const { html } = sanitizeLegacyHtml(
    '<a href="https://x.test/a?utm_source=share&amp;utm_content=profile">Havola</a>',
  );
  assert.ok(!html.includes("&amp;amp;"), html);
  assert.ok(html.includes("?utm_source=share&amp;utm_content=profile"));
});

test("a double-encoded javascript: URL still cannot get through", () => {
  for (const href of ["&#106;avascript:alert(1)", "&amp;#106;avascript:alert(1)", "&#x6a;avascript:alert(1)"]) {
    const { html } = sanitizeLegacyHtml(`<a href="${href}">bos</a>`);
    assert.ok(!/javascript:/i.test(html), html);
    assert.equal(html, "bos");
  }
});

test("event handlers, inline styles and Tilda classes are all dropped", () => {
  const { html } = sanitizeLegacyHtml(
    '<h3 class="t-redactor__h3" style="color:red" onclick="steal()" contenteditable="true">Sarlavha</h3>',
  );
  assert.equal(html, "<h3>Sarlavha</h3>");
});

test("Tilda's div paragraphs become real paragraphs", () => {
  // 83k of these in the export. Unwrapping them instead would fuse the whole
  // article into one block of text.
  const { html } = sanitizeLegacyHtml(
    '<div class="t-redactor__text">Bir</div><div class="t-redactor__text">Ikki</div>',
  );
  assert.equal(html, "<p>Bir</p><p>Ikki</p>");
});

test("structure that carries meaning is kept", () => {
  const { html, text } = sanitizeLegacyHtml(
    '<h2 class="t-redactor__h2">Bosh</h2><ul><li><strong>Bir</strong></li><li>Ikki</li></ul>' +
      '<blockquote class="t-redactor__quote">Iqtibos</blockquote>',
  );
  assert.equal(
    html,
    "<h2>Bosh</h2><ul><li><strong>Bir</strong></li><li>Ikki</li></ul><blockquote>Iqtibos</blockquote>",
  );
  assert.equal(text, "Bosh Bir Ikki Iqtibos");
});

test("a stray angle bracket is escaped, never resurrected as a tag", () => {
  const { html } = sanitizeLegacyHtml("5 < 7 va 9 > 3");
  assert.ok(!/<[a-z]/i.test(html));
  assert.equal(html, "5 &lt; 7 va 9 &gt; 3");
});

test("unclosed tags are closed rather than leaking into the rest of the page", () => {
  const { html } = sanitizeLegacyHtml("<strong>ochiq");
  assert.equal(html, "<strong>ochiq</strong>");
});

test("inline images survive only over https", () => {
  assert.match(sanitizeLegacyHtml('<img src="https://static.tildacdn.com/a.png">').html, /^<img src="https:\/\/static\.tildacdn\.com\/a\.png" alt="" loading="lazy" \/>$/);
  assert.equal(sanitizeLegacyHtml('<img src="http://x.test/a.png">').html, "");
  assert.equal(sanitizeLegacyHtml('<img src="javascript:alert(1)">').html, "");
});

/* -------------------------------- mapping --------------------------------- */

const ROW = {
  "Post ID": "ft51p0jv31",
  Alias: "",
  Title: "QUCHQOROVA RUXSHONA MUHAMMADJON QIZI",
  Category: "Ta'lim;Tashkilotchilik;Ta'lim",
  "Media Type": "image",
  Media: "https://static.tildacdn.com/tild3263/efe.png",
  Description: "Bo‘lajak yurist",
  Text: '<div class="t-redactor__text">Matn</div>',
  Date: "2026-08-02 01:53:00+05:00",
  Visibility: "published",
  "Thumb Image": "",
  "Author Name": "",
  "Author URL": "",
  "Author Image": "",
  "SEO Title": "",
  "SEO Description": "",
  "SEO Keywords": "",
  "Social Title": "",
  "Social Description": "",
};

test("a real row maps to a complete record", () => {
  const result = mapLegacyRow(ROW);
  assert.ok(result.ok);
  const r = result.record;
  assert.equal(r.legacy_source_id, "ft51p0jv31");
  assert.equal(r.legacy_slug, "ft51p0jv31-quchqorova-ruxshona-muhammadjon-qizi");
  assert.equal(r.legacy_path, "/nomzodlar/ft51p0jv31-quchqorova-ruxshona-muhammadjon-qizi");
  assert.equal(r.legacy_alias, null);
  assert.equal(r.legacy_status, "published");
  assert.equal(r.cover_image_url, "https://static.tildacdn.com/tild3263/efe.png");
  assert.deepEqual(r.legacy_categories, ["Ta'lim", "Tashkilotchilik"], "de-duplicated");
  assert.equal(r.content_html, "<p>Matn</p>");
  assert.equal(r.content_text, "Matn");
  assert.deepEqual(result.warnings, []);
});

test("the legacy date is the source's own instant, never the import time", () => {
  // 01:53 at +05:00 is 20:53 UTC the day before — the same moment, not a
  // different date invented by the importer.
  assert.equal(parseLegacyDate("2026-08-02 01:53:00+05:00"), "2026-08-01T20:53:00.000Z");
  const before = Date.now();
  const mapped = mapLegacyRow(ROW);
  assert.ok(mapped.ok);
  assert.equal(mapped.record.legacy_created_at, "2026-08-01T20:53:00.000Z");
  assert.ok(new Date(mapped.record.legacy_created_at!).getTime() < before);
});

test("a missing or unreadable date stays unknown instead of being invented", () => {
  assert.equal(parseLegacyDate(""), null);
  assert.equal(parseLegacyDate("   "), null);
  assert.equal(parseLegacyDate(undefined), null);
  assert.equal(parseLegacyDate("kecha"), null);

  const mapped = mapLegacyRow({ ...ROW, Date: "" });
  assert.ok(mapped.ok);
  assert.equal(mapped.record.legacy_created_at, null);
  assert.ok(mapped.warnings.includes("missing_date"));
});

test("a missing image or body is reported but does not block the import", () => {
  const mapped = mapLegacyRow({ ...ROW, Media: "", "Thumb Image": "", Text: "" });
  assert.ok(mapped.ok, "still importable");
  assert.equal(mapped.record.cover_image_url, null);
  assert.ok(mapped.warnings.includes("missing_image"));
  assert.ok(mapped.warnings.includes("missing_content"));
});

test("a row with no post id or no title cannot be imported", () => {
  const noId = mapLegacyRow({ ...ROW, "Post ID": "" });
  assert.ok(!noId.ok);
  assert.ok(noId.issues.includes("missing_post_id"));

  const noTitle = mapLegacyRow({ ...ROW, Title: "" });
  assert.ok(!noTitle.ok);
  assert.ok(noTitle.issues.includes("missing_title"));
});

test("an unrecognised visibility is treated as draft, never published", () => {
  assert.equal(parseLegacyStatus("published"), "published");
  assert.equal(parseLegacyStatus("PUBLISHED"), "published");
  assert.equal(parseLegacyStatus("draft"), "draft");
  assert.equal(parseLegacyStatus("nimadir"), "draft");
  assert.equal(parseLegacyStatus(""), "draft");
});

test("only https images are accepted, Media before Thumb Image", () => {
  assert.equal(pickLegacyImage({ Media: "https://a.test/x.png", "Thumb Image": "https://b.test/y.png" }), "https://a.test/x.png");
  assert.equal(pickLegacyImage({ Media: "", "Thumb Image": "https://b.test/y.png" }), "https://b.test/y.png");
  assert.equal(pickLegacyImage({ Media: "http://a.test/x.png", "Thumb Image": "" }), null);
});

test("categories are split on the source separator, trimmed and de-duplicated", () => {
  assert.deepEqual(parseLegacyCategories("Ta'lim;Tashkilotchilik"), ["Ta'lim", "Tashkilotchilik"]);
  assert.deepEqual(parseLegacyCategories(" Sport ; Sport ;"), ["Sport"]);
  assert.deepEqual(parseLegacyCategories(""), []);
  assert.deepEqual(parseLegacyCategories(undefined), []);
});

/* ------------------------------ idempotency ------------------------------- */

test("the fingerprint changes with the source and not with our code", () => {
  const a = legacyRowFingerprint(ROW);
  assert.equal(a, legacyRowFingerprint({ ...ROW }), "stable for identical input");
  assert.notEqual(a, legacyRowFingerprint({ ...ROW, Title: "BOSHQA" }));
  // Whitespace-only differences must not look like a change, or --resume would
  // rewrite all 1991 rows on every run.
  assert.equal(a, legacyRowFingerprint({ ...ROW, Title: `${ROW.Title}  ` }));
});

test("the importer upserts on the source id, so a second run cannot duplicate", () => {
  const script = fs.readFileSync("scripts/import-legacy-feed.ts", "utf8");
  assert.match(script, /onConflict: "legacy_source_id"/);
  // A repeat of the same id inside one file is skipped rather than racing.
  assert.match(script, /report\.duplicates \+= 1/);

  // And the database enforces it independently of the script.
  const migration = fs.readFileSync(
    "supabase/migrations/20260907100000_legacy_posts.sql",
    "utf8",
  );
  assert.match(
    migration,
    /create unique index if not exists uq_legacy_posts_source_id[\s\S]*?legacy_source_id/,
  );
});

test("nothing is written unless --apply is passed", () => {
  const script = fs.readFileSync("scripts/import-legacy-feed.ts", "utf8");
  assert.match(script, /apply: has\("--apply"\)/);
  assert.match(script, /const db = options\.apply \? supabaseAdmin\(\) : null;/);
  // Every write goes through flush(), and flush is only reachable with a client.
  assert.match(script, /if \(db\) await flush\(/);
  for (const flag of ["--dry-run", "--apply", "--resume", "--limit"]) {
    assert.ok(script.includes(flag), `${flag} is supported`);
  }
});

/* --------------------------- admin list + schema --------------------------- */

test("the admin list pages the database, never the browser", () => {
  const page = fs.readFileSync("src/app/(admin)/liderlar-1-0/page.tsx", "utf8");
  // 1991 rows: the range must be applied in SQL, and the count taken by the
  // database rather than from the fetched array.
  assert.match(page, /listRange\(page\)/);
  assert.match(page, /\.range\(from, to\)/);
  assert.match(page, /count: "exact"/);
  assert.match(page, /<Pagination/);
  assert.ok(!page.includes(".limit(2000)"));

  // Search and filters are server-side too.
  assert.match(page, /title\.ilike/);
  assert.match(page, /\.eq\("legacy_status", filters\.status\)/);
  assert.match(page, /DataTableToolbar/);

  // Every column the brief asks for.
  for (const header of ["F.I.Sh.", "Legacy slug", "Eski URL", "Qo‘shilgan sana", "Status", "Yo‘nalish"]) {
    assert.ok(page.includes(header), `column: ${header}`);
  }
  assert.ok(page.includes("Ko‘rish") && page.includes("Tahrirlash"));
  assert.ok(page.includes("cover_image_url"), "the row shows the image");
});

test("legacy rows are stored apart from 2.0 candidates", () => {
  const migration = fs.readFileSync(
    "supabase/migrations/20260907100000_legacy_posts.sql",
    "utf8",
  );
  // Its own table, so the 1912 published legacy rows cannot leak into ranking,
  // search, the sitemap, TOP-100 or the 2.0 candidate list.
  assert.match(migration, /create table if not exists public\.legacy_posts/);
  assert.match(migration, /source_version text not null default '1\.0'/);
  for (const column of ["legacy_source_id", "legacy_slug", "legacy_path", "legacy_created_at"]) {
    assert.ok(migration.includes(column), `column: ${column}`);
  }
  // Draft legacy posts stay private.
  assert.match(migration, /legacy_status = 'published' and deleted_at is null/);
  // The link to a 2.0 profile is optional and never a replacement.
  assert.match(migration, /candidate_id uuid references public\.candidates\(id\) on delete set null/);
  // No new column is added to `candidates` for this.
  assert.ok(!migration.includes("alter table public.candidates"));
});

test("the source identifiers and the source date are not editable", () => {
  const action = fs.readFileSync("src/lib/actions/legacy-posts.ts", "utf8");
  const schema = action.slice(action.indexOf("const schema"), action.indexOf("export interface"));
  for (const field of ["legacy_slug", "legacy_path", "legacy_source_id", "legacy_created_at"]) {
    assert.ok(!schema.includes(field), `${field} is not an editable field`);
  }
  // Admin-supplied HTML goes through the same allowlist as the import.
  assert.match(action, /sanitizeLegacyHtml/);
});
