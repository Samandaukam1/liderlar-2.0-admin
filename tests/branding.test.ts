import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ALL_BRANDING_KEYS,
  BRANDING_BUCKET,
  BRANDING_ICON_SIZES,
  BRANDING_KEYS,
  BRANDING_MAX_BYTES,
  brandingObjectPath,
  EMPTY_BRANDING,
  hasCustomIcons,
  parseBranding,
  validateBrandingUpload,
  versioned,
} from "../src/lib/branding/config.ts";

const ROOT = new URL("..", import.meta.url).pathname;

/* ------------------------------- o‘qish -------------------------------- */

test("sozlamalardan brending o‘qiladi", () => {
  const branding = parseBranding({
    [BRANDING_KEYS.logo]: "https://cdn/logo.png",
    branding_icon_32_url: "https://cdn/icon-32.png",
    branding_icon_180_url: "https://cdn/icon-180.png",
    [BRANDING_KEYS.version]: "abc123",
  });

  assert.equal(branding.logoUrl, "https://cdn/logo.png");
  assert.equal(branding.icons[32], "https://cdn/icon-32.png");
  assert.equal(branding.icons[180], "https://cdn/icon-180.png");
  assert.equal(branding.version, "abc123");
  assert.equal(hasCustomIcons(branding), true);
});

test("BO‘SH satr “o‘rnatilmagan” deb qaraladi", () => {
  // Tozalashda qator o'chirilmay, qiymati bo'shatiladi — u "logo bor"
  // deb hisoblansa, panel yo'q faylga ishora qilib qolardi.
  const branding = parseBranding({
    [BRANDING_KEYS.logo]: "   ",
    branding_icon_32_url: "",
    [BRANDING_KEYS.version]: null,
  });

  assert.equal(branding.logoUrl, null);
  assert.deepEqual(branding.icons, {});
  assert.equal(hasCustomIcons(branding), false);
});

test("hech narsa berilmasa bo‘sh brending", () => {
  assert.deepEqual(parseBranding({}), EMPTY_BRANDING);
  assert.equal(hasCustomIcons(EMPTY_BRANDING), false);
});

/* ------------------------------ kesh buzish ----------------------------- */

test("versiya URL ga qo‘shiladi", () => {
  // Brauzer favicon'ni juda uzoq keshlaydi; versiyasiz eski belgi
  // haftalab qolib ketishi mumkin edi.
  assert.equal(versioned("https://cdn/i.png", "v1"), "https://cdn/i.png?v=v1");
  assert.equal(versioned("https://cdn/i.png?x=1", "v1"), "https://cdn/i.png?x=1&v=v1");
  // Versiya yo'q bo'lsa URL o'zgarmaydi.
  assert.equal(versioned("https://cdn/i.png", null), "https://cdn/i.png");
});

test("saqlash yo‘li versiyalangan va tozalangan", () => {
  assert.equal(brandingObjectPath("v1", "icon-32.png"), "v1/icon-32.png");
  // Yo'l ichiga chiqib ketishga urinish to'siladi.
  assert.equal(brandingObjectPath("v1", "../../etc/passwd"), "v1/....etcpasswd");
  assert.equal(brandingObjectPath("v1", ""), "v1/asset");
});

/* ------------------------------ tekshiruv ------------------------------- */

test("faqat tasvir formatlari qabul qilinadi", () => {
  for (const mime of ["image/png", "image/jpeg", "image/webp", "image/svg+xml"]) {
    assert.deepEqual(validateBrandingUpload({ mimeType: mime, size: 1000 }), { ok: true }, mime);
  }
  for (const mime of ["application/pdf", "text/html", "application/octet-stream", ""]) {
    assert.equal(validateBrandingUpload({ mimeType: mime, size: 1000 }).ok, false, mime);
  }
});

test("hajm chegarasi va bo‘sh fayl tekshiriladi", () => {
  assert.equal(
    validateBrandingUpload({ mimeType: "image/png", size: BRANDING_MAX_BYTES }).ok,
    true,
  );
  assert.equal(
    validateBrandingUpload({ mimeType: "image/png", size: BRANDING_MAX_BYTES + 1 }).ok,
    false,
  );
  assert.equal(validateBrandingUpload({ mimeType: "image/png", size: 0 }).ok, false);
});

/* ------------------------------ o‘lchamlar ------------------------------ */

test("har o‘lcham aniq bir joy uchun va kalitlari mos", () => {
  const sizes = BRANDING_ICON_SIZES.map((icon) => icon.size);
  assert.deepEqual(sizes, [16, 32, 180, 192, 512]);
  assert.equal(new Set(sizes).size, sizes.length);

  for (const icon of BRANDING_ICON_SIZES) {
    assert.equal(icon.key, `branding_icon_${icon.size}_url`);
    assert.ok(icon.purpose.length > 0, `${icon.size} uchun izoh yo‘q`);
    // Har o'lcham kalitini tozalash ro'yxati ham bilishi shart.
    assert.ok(ALL_BRANDING_KEYS.includes(icon.key), icon.key);
  }
  for (const key of Object.values(BRANDING_KEYS)) {
    assert.ok(ALL_BRANDING_KEYS.includes(key), key);
  }
});

/* --------------------------- ikkilanish yo‘q ---------------------------- */

test("app segmentida favicon.ico QOLMAGAN — ikkita raqobatchi teg bo‘lmasin", () => {
  // `src/app/favicon.ico` tursa, Next avtomatik <link rel="icon"> qo'shadi
  // va bizning ikonkalarimiz bilan qaysi biri g'olib chiqishi brauzerga
  // bog'liq bo'lib qolardi.
  assert.equal(existsSync(join(ROOT, "src/app/favicon.ico")), false);
  // Zaxira sifatida `/favicon.ico` baribir javob beradi.
  assert.equal(existsSync(join(ROOT, "public/favicon.ico")), true);
});

test("ildiz layout ikonkalarni bazadan oladi", () => {
  const layout = readFileSync(join(ROOT, "src/app/layout.tsx"), "utf8");
  assert.match(layout, /export async function generateMetadata/);
  assert.match(layout, /getBranding\(\)/);
  // Maxsus logo bo'lmasa standart faviconga qaytadi.
  assert.match(layout, /icon: "\/favicon\.ico"/);
});

/* ------------------------------ migratsiya ------------------------------ */

test("brending bucket'i OCHIQ", () => {
  // Favicon brauzer tomonidan sessiyasiz so'raladi — imzolangan havola
  // bilan berib bo'lmaydi.
  const migration = readFileSync(
    join(ROOT, "supabase/migrations/20260907220000_branding_assets.sql"),
    "utf8",
  );
  assert.match(migration, /insert into storage\.buckets \(id, name, public\) values\s*\n\s*\('branding', 'branding', true\)/);
  assert.match(migration, /on conflict \(id\) do update/);
  assert.equal(BRANDING_BUCKET, "branding");
});

test("yuklash ruxsat tekshiruvidan o‘tadi", () => {
  const route = readFileSync(join(ROOT, "src/app/api/admin/branding/route.ts"), "utf8");
  // Ikkala metod ham alohida tekshiradi.
  const post = route.slice(route.indexOf("export async function POST"), route.indexOf("export async function DELETE"));
  const del = route.slice(route.indexOf("export async function DELETE"));
  for (const [name, block] of [["POST", post], ["DELETE", del]] as const) {
    assert.match(block, /checkPermission\("settings\.manage"\)/, name);
    assert.match(block, /status: 403/, name);
  }
  // Fayl serverda ham qayta tekshiriladi — klientdagi filtr himoya emas.
  assert.match(post, /validateBrandingUpload/);
});
