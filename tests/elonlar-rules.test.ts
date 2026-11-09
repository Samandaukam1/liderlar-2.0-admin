import test from "node:test";
import assert from "node:assert/strict";
import {
  ACTIVE_LIMIT_MESSAGE,
  DEFAULT_BAR_STYLE,
  canActivate,
  countActive,
  isAdLive,
  isHttpUrl,
  mapAdRow,
  mapAdsSettingsRow,
  parseBarStyle,
  type AdRow,
} from "../src/lib/elonlar/types.ts";
import {
  adStatus,
  buildAdRecord,
  buildSettingsRecord,
  describeDbError,
  isMissingRelationError,
  reorderIds,
  sortOrderUpdates,
  validateMediaUpload,
  type AdFormInput,
} from "../src/lib/elonlar/rules.ts";

const STYLE_INPUT = { theme: "", entrance: "", attention: "", logoPosition: "", bg: "", fg: "", accent: "" };

function form(patch: Partial<AdFormInput>): AdFormInput {
  return {
    placement: "bot_post",
    title: "Jaxongirman",
    text: "Jaxongirman ilovasini yuklab oling",
    url: "https://jaxongirman.uz/app",
    kind: "",
    buttonLabel: "",
    logoUrl: "",
    imageUrl: "",
    imageWidth: "",
    imageHeight: "",
    style: STYLE_INPUT,
    closeOpensLink: true,
    startsAt: "",
    endsAt: "",
    isActive: true,
    ...patch,
  };
}

test("style faqat oq ro'yxatdagi qiymatlarni qabul qiladi", () => {
  assert.deepEqual(parseBarStyle(null), DEFAULT_BAR_STYLE);
  const s = parseBarStyle({ theme: "evil", entrance: "drop-bounce", attention: "x", bg: "#FFFFFF" });
  assert.equal(s.theme, DEFAULT_BAR_STYLE.theme);
  assert.equal(s.entrance, "drop-bounce");
  assert.equal(s.attention, DEFAULT_BAR_STYLE.attention);
  // Ranglar faqat 'custom' mavzuda saqlanadi.
  assert.equal(s.bg, null);
  const custom = parseBarStyle({ theme: "custom", bg: "#ABCDEF", fg: "red", accent: "#13bce4" });
  assert.equal(custom.bg, "#abcdef");
  assert.equal(custom.fg, null);
  assert.equal(custom.accent, "#13bce4");
});

test("mapAdRow bo'sh qiymatlarni xavfsiz to'ldiradi", () => {
  const row: AdRow = {
    id: "a",
    placement: "profile_bar",
    title: "T",
    is_active: true,
    sort_order: 2,
    text: "Matn",
    url: "https://x.uz",
    kind: "text",
    button_label: null,
    logo_url: null,
    image_url: null,
    image_width: null,
    image_height: null,
    style: null,
    close_opens_link: true,
    starts_at: null,
    ends_at: null,
    shown_count: "5",
    impressions: null,
    clicks: 3,
    last_shown_at: null,
    created_at: "2026-11-09T00:00:00Z",
    updated_at: "2026-11-09T00:00:00Z",
  };
  const ad = mapAdRow(row);
  assert.equal(ad.shownCount, 5);
  assert.equal(ad.impressions, 0);
  assert.equal(ad.clicks, 3);
  assert.deepEqual(ad.style, DEFAULT_BAR_STYLE);
});

test("3 tadan ortig'ini yoqib bo'lmaydi", () => {
  const ads = [1, 2, 3].map((n) => ({ id: String(n), placement: "bot_post" as const, isActive: true }));
  assert.equal(countActive(ads, "bot_post"), 3);
  assert.equal(canActivate(ads, "bot_post", null), false);
  assert.equal(canActivate(ads, "bot_post", "2"), true);
  assert.equal(canActivate(ads, "profile_bar", null), true);
  assert.match(ACTIVE_LIMIT_MESSAGE, /3 ta/);
});

test("muddat: boshlanmagan va tugagan reklama faol emas", () => {
  const now = new Date("2026-11-09T12:00:00Z");
  assert.equal(isAdLive({ isActive: true, startsAt: null, endsAt: null }, now), true);
  assert.equal(isAdLive({ isActive: true, startsAt: "2026-11-10T00:00:00Z", endsAt: null }, now), false);
  assert.equal(isAdLive({ isActive: true, startsAt: null, endsAt: "2026-11-09T12:00:00Z" }, now), false);
  assert.equal(adStatus({ isActive: true, startsAt: "2026-11-10T00:00:00Z", endsAt: null }, now), "scheduled");
  assert.equal(adStatus({ isActive: true, startsAt: null, endsAt: "2026-11-01T00:00:00Z" }, now), "expired");
  assert.equal(adStatus({ isActive: false, startsAt: null, endsAt: null }, now), "off");
});

test("havola faqat http(s)", () => {
  assert.equal(isHttpUrl("https://liderlar.uz"), true);
  assert.equal(isHttpUrl("javascript:alert(1)"), false);
  assert.equal(buildAdRecord(form({ url: "javascript:alert(1)" })).ok, false);
  assert.equal(buildAdRecord(form({ url: "https://a b.uz" })).ok, false);
});

test("bot reklamasi: matn chegarasi va bar maydonlari tozalanadi", () => {
  const ok = buildAdRecord(form({ kind: "image", imageUrl: "https://x.uz/a.webp" }));
  assert.ok(ok.ok);
  if (ok.ok) {
    assert.equal(ok.record.kind, null);
    assert.equal(ok.record.image_url, null);
    assert.equal(ok.record.text, "Jaxongirman ilovasini yuklab oling");
  }
  assert.equal(buildAdRecord(form({ text: "x".repeat(81) })).ok, false);
  assert.equal(buildAdRecord(form({ text: "Bir\nikki   qator" })).ok, true);
});

test("bar: rasmli tur rasmsiz saqlanmaydi, matnli tur matnsiz saqlanmaydi", () => {
  assert.equal(buildAdRecord(form({ placement: "profile_bar", kind: "image", imageUrl: "" })).ok, false);
  assert.equal(buildAdRecord(form({ placement: "profile_bar", kind: "text", text: "" })).ok, false);
  const image = buildAdRecord(
    form({ placement: "profile_bar", kind: "image", imageUrl: "https://x.uz/a.webp", imageWidth: "1280", imageHeight: "160" }),
  );
  assert.ok(image.ok);
  if (image.ok) {
    assert.equal(image.record.text, null);
    assert.equal(image.record.image_width, 1280);
  }
  assert.equal(buildAdRecord(form({ placement: "profile_bar", kind: "" })).ok, false);
});

test("jadval: tugash boshlanishdan oldin bo'lmaydi", () => {
  const bad = buildAdRecord(form({ startsAt: "2026-11-10T10:00", endsAt: "2026-11-10T09:00" }));
  assert.equal(bad.ok, false);
  const good = buildAdRecord(form({ startsAt: "2026-11-10T10:00", endsAt: "2026-11-11T10:00" }));
  assert.ok(good.ok);
});

test("tartib: chetdagini surib bo'lmaydi, faqat o'zgarganlar yoziladi", () => {
  assert.equal(reorderIds(["a", "b", "c"], "a", "up"), null);
  assert.deepEqual(reorderIds(["a", "b", "c"], "b", "up"), ["b", "a", "c"]);
  const updates = sortOrderUpdates(
    [
      { id: "a", sortOrder: 0 },
      { id: "b", sortOrder: 1 },
      { id: "c", sortOrder: 2 },
    ],
    ["b", "a", "c"],
  );
  assert.deepEqual(updates, [
    { id: "b", sort_order: 0 },
    { id: "a", sort_order: 1 },
  ]);
});

test("sozlamalar chegaradan chiqsa xato beradi", () => {
  const base = { rotation: "sequential", appearDelayMs: "1200", cycleSeconds: "8", dismissHours: "12", hideOnScroll: true, botPostPosition: "end" };
  assert.ok(buildSettingsRecord(base).ok);
  assert.equal(buildSettingsRecord({ ...base, rotation: "x" }).ok, false);
  assert.equal(buildSettingsRecord({ ...base, dismissHours: "0" }).ok, false);
  assert.equal(buildSettingsRecord({ ...base, botPostPosition: "middle" }).ok, false);
  assert.equal(mapAdsSettingsRow(null).profileBarRotation, "sequential");
});

test("yuklash tekshiruvi va baza xatolari tushunarli", () => {
  assert.equal(validateMediaUpload({ kind: "logo", mimeType: "image/svg+xml", size: 10 }).ok, false);
  assert.equal(validateMediaUpload({ kind: "image", mimeType: "image/png", size: 6 * 1024 * 1024 }).ok, false);
  assert.ok(validateMediaUpload({ kind: "logo", mimeType: "image/webp", size: 1000 }).ok);
  assert.equal(isMissingRelationError({ code: "42P01", message: "relation \"public.ads\" does not exist" }), true);
  assert.equal(
    describeDbError({ code: "23514", message: "Bir vaqtda ko‘pi bilan 3 ta reklama yoqilishi mumkin." }),
    ACTIVE_LIMIT_MESSAGE,
  );
});
