import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CANONICAL_PUBLIC_SITE_URL,
  candidateArticlePath,
  isVercelDeploymentUrl,
  normalizeEnvPublicUrl,
  normalizePublicWebUrl,
  originOfConfirmedUrl,
  PUBLIC_WEB_SETTING_KEY,
  publicSiteUrlFromEnv,
} from "../src/lib/public-site.ts";
import { buildUpdateLink } from "../src/lib/tokens.ts";
import { buildInstagramFollowUpText } from "../src/lib/post-studio/instagram-followup-message.ts";

test("canonical public domain is liderlar.uz, written down exactly once", () => {
  assert.equal(CANONICAL_PUBLIC_SITE_URL, "https://liderlar.uz");
  assert.equal(PUBLIC_WEB_SETTING_KEY, "public_web.base_url");
});

test("candidate URL shape is /liderlar/<slug>", () => {
  assert.equal(candidateArticlePath("gulnoza-rasuljonova"), "/liderlar/gulnoza-rasuljonova");
  assert.equal(
    `${CANONICAL_PUBLIC_SITE_URL}${candidateArticlePath("gulnoza-rasuljonova")}`,
    "https://liderlar.uz/liderlar/gulnoza-rasuljonova",
  );
});

test("an unset, blank or localhost env var falls back to the canonical domain", () => {
  assert.equal(publicSiteUrlFromEnv(undefined), CANONICAL_PUBLIC_SITE_URL);
  assert.equal(publicSiteUrlFromEnv(""), CANONICAL_PUBLIC_SITE_URL);
  assert.equal(publicSiteUrlFromEnv("   "), CANONICAL_PUBLIC_SITE_URL);
  assert.equal(publicSiteUrlFromEnv("http://localhost:3000"), CANONICAL_PUBLIC_SITE_URL);
  assert.equal(publicSiteUrlFromEnv("http://127.0.0.1:3000"), CANONICAL_PUBLIC_SITE_URL);
});

test("a Vercel deployment URL never becomes a public address", () => {
  assert.ok(isVercelDeploymentUrl("https://liderlar-web.vercel.app"));
  assert.ok(isVercelDeploymentUrl("liderlar-2-0-git-main.vercel.app"));
  assert.ok(!isVercelDeploymentUrl("https://liderlar.uz"));
  assert.ok(!isVercelDeploymentUrl(""));

  assert.equal(normalizeEnvPublicUrl("https://liderlar-web.vercel.app"), null);
  assert.equal(publicSiteUrlFromEnv("https://liderlar-web.vercel.app"), CANONICAL_PUBLIC_SITE_URL);
  assert.equal(publicSiteUrlFromEnv("liderlar-2-0.vercel.app"), CANONICAL_PUBLIC_SITE_URL);
});

test("env formatting mistakes are healed rather than propagated", () => {
  assert.equal(publicSiteUrlFromEnv("liderlar.uz"), "https://liderlar.uz");
  assert.equal(publicSiteUrlFromEnv("http://liderlar.uz"), "https://liderlar.uz");
  assert.equal(publicSiteUrlFromEnv("https://liderlar.uz/"), "https://liderlar.uz");
  assert.equal(publicSiteUrlFromEnv("  https://liderlar.uz//  "), "https://liderlar.uz");
});

test("an explicitly configured setting still allows a non-canonical origin", () => {
  // site_settings is a human decision — the documented escape hatch — so unlike
  // an env var it is not second-guessed.
  assert.equal(
    normalizePublicWebUrl("https://liderlar-web.vercel.app"),
    "https://liderlar-web.vercel.app",
  );
  assert.equal(normalizePublicWebUrl("http://localhost:3000"), null);
  assert.equal(normalizePublicWebUrl(""), null);
  assert.equal(
    originOfConfirmedUrl("https://liderlar.uz/liderlar/abduraxmanov"),
    "https://liderlar.uz",
  );
});

test("monthly update links use the canonical domain, not a raw env value", () => {
  const before = process.env.NEXT_PUBLIC_SITE_URL;
  try {
    delete process.env.NEXT_PUBLIC_SITE_URL;
    assert.equal(buildUpdateLink("tok123"), "https://liderlar.uz/yangilash/tok123");

    process.env.NEXT_PUBLIC_SITE_URL = "https://liderlar-web.vercel.app";
    assert.equal(buildUpdateLink("tok123"), "https://liderlar.uz/yangilash/tok123");

    process.env.NEXT_PUBLIC_SITE_URL = "http://localhost:3000";
    assert.equal(buildUpdateLink("tok123"), "https://liderlar.uz/yangilash/tok123");
  } finally {
    if (before === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
    else process.env.NEXT_PUBLIC_SITE_URL = before;
  }
});

test("the Instagram follow-up names the handle and says what it is for", () => {
  const text = buildInstagramFollowUpText("liderlar_uz");
  assert.equal(text, "📸 Instagram:\n@liderlar_uz\n\nCollaboration post uchun.");
  assert.ok(!text.includes("@@"));
});
