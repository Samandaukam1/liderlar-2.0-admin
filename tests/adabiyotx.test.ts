import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildAdabiyotXSearchUrl,
  hasUniqueAdabiyotXReorderIds,
  isAdabiyotXRelationshipContentValid,
  normalizeAdabiyotXContentType,
  normalizeAdabiyotXResponse,
  normalizeAdabiyotXUrl,
  normalizeSafeCoverUrl,
  resolveAdabiyotXSearchConfig,
  sanitizeAdabiyotXQuery,
  stableExternalIdFromUrl,
} from "../src/lib/adabiyotx/core.ts";
import {
  mapCandidateAdabiyotXRow,
  mapPublicCandidateAdabiyotXRow,
} from "../src/lib/adabiyotx/types.ts";

const candidateId = "3c583fcb-36f5-4d8c-886d-bafb08451ea9";
const integrationKey = "51c53c6e-339d-48da-9688-d37716368008";
const itemIdA = "45f0ef23-1c59-4f49-ae84-96e66adf6d3a";
const itemIdB = "e5a60204-cb84-43f0-901e-3ad874af3146";

test("AdabiyotX URL allowlist begona va lokal manzillarni rad etadi", () => {
  assert.equal(
    normalizeAdabiyotXUrl("https://adabiyotx.uz/books/1#info"),
    "https://adabiyotx.uz/books/1",
  );
  assert.equal(
    normalizeAdabiyotXUrl("https://catalog.adabiyotx.uz/asar/1"),
    "https://catalog.adabiyotx.uz/asar/1",
  );
  assert.equal(normalizeAdabiyotXUrl("https://adabiyotx.uz.evil.test/1"), null);
  assert.equal(normalizeAdabiyotXUrl("javascript:alert(1)"), null);
  assert.equal(normalizeAdabiyotXUrl("data:text/plain,bad"), null);
  assert.equal(normalizeAdabiyotXUrl("file:///tmp/bad"), null);
  assert.equal(normalizeAdabiyotXUrl("https://localhost/book"), null);
  assert.equal(normalizeAdabiyotXUrl("http://adabiyotx.uz/book"), null);
});

test("manual URL uchun external_id stabil SHA-256 qiymat", () => {
  const first = stableExternalIdFromUrl(
    "https://adabiyotx.uz/books/1#description",
  );
  const second = stableExternalIdFromUrl(" https://adabiyotx.uz/books/1 ");
  assert.equal(first, second);
  assert.match(first ?? "", /^url:[a-f0-9]{64}$/);
});

test("qidiruv query qiymati trim, sanitize va limit qilinadi", () => {
  assert.equal(sanitizeAdabiyotXQuery("  she’r\u0000   kitobi  "), "she’r kitobi");
  assert.equal(sanitizeAdabiyotXQuery("a".repeat(200)).length, 120);
});

test("kitob, maqola, she’r va ssenariy turlari normalize qilinadi", () => {
  assert.equal(normalizeAdabiyotXContentType("kitob"), "book");
  assert.equal(normalizeAdabiyotXContentType("maqola"), "article");
  assert.equal(normalizeAdabiyotXContentType("she’r"), "poem");
  assert.equal(normalizeAdabiyotXContentType("ssenariy"), "scenario");
});

test("AdabiyotX katalog javobi barcha asosiy material turlarini map qiladi", () => {
  const items = normalizeAdabiyotXResponse({
    data: {
      items: [
        {
          id: 1,
          type: "kitob",
          title: "Kitob",
          url: "https://adabiyotx.uz/book/1",
        },
        {
          id: 2,
          type: "maqola",
          title: "Maqola",
          url: "https://adabiyotx.uz/article/2",
        },
        {
          id: 3,
          type: "she’r",
          title: "She’r",
          url: "https://adabiyotx.uz/poem/3",
        },
        {
          id: 4,
          type: "ssenariy",
          title: "Ssenariy",
          url: "https://adabiyotx.uz/scenario/4",
        },
      ],
    },
  });
  assert.deepEqual(
    items.map((item) => item.contentType),
    ["book", "article", "poem", "scenario"],
  );
});

test("qidiruv config bo‘lmasa o‘zboshimcha endpoint qurilmaydi", () => {
  assert.deepEqual(resolveAdabiyotXSearchConfig({}), { ok: false });
  const resolved = resolveAdabiyotXSearchConfig({
    ADABIYOTX_API_BASE_URL: "https://api.adabiyotx.uz/v1",
    ADABIYOTX_CATALOG_SEARCH_PATH: "catalog/search",
    ADABIYOTX_INTEGRATION_API_KEY: "test-only-key",
  });
  assert.equal(resolved.ok, true);
  if (resolved.ok) {
    assert.equal(
      buildAdabiyotXSearchUrl(resolved.config, "  tarix  ").toString(),
      "https://api.adabiyotx.uz/v1/catalog/search?q=tarix",
    );
  }
});

test("real AdabiyotX katalog endpointi to‘g‘ri URL beradi", () => {
  const resolved = resolveAdabiyotXSearchConfig({
    ADABIYOTX_API_BASE_URL: "https://adabiyotx.uz",
    ADABIYOTX_CATALOG_SEARCH_PATH: "/api/public/catalog/search",
    ADABIYOTX_INTEGRATION_API_KEY: "test-only-key",
  });
  assert.equal(resolved.ok, true);
  if (resolved.ok) {
    assert.equal(
      buildAdabiyotXSearchUrl(resolved.config, " alisher navoiy ").toString(),
      "https://adabiyotx.uz/api/public/catalog/search?q=alisher+navoiy",
    );
  }
});

test("manual create own_work va read_book semantikasini validatsiya qiladi", () => {
  for (const contentType of [
    "book",
    "article",
    "poem",
    "scenario",
    "other",
  ] as const) {
    assert.equal(
      isAdabiyotXRelationshipContentValid("own_work", contentType),
      true,
    );
  }
  assert.equal(
    isAdabiyotXRelationshipContentValid("read_book", "book"),
    true,
  );
  assert.equal(
    isAdabiyotXRelationshipContentValid("read_book", "article"),
    false,
  );
});

test("sort order takrorlangan IDlarni rad etadi", () => {
  assert.equal(
    hasUniqueAdabiyotXReorderIds([
      { id: itemIdA, sortOrder: 0 },
      { id: itemIdB, sortOrder: 1 },
    ]),
    true,
  );
  assert.equal(
    hasUniqueAdabiyotXReorderIds([
      { id: itemIdA, sortOrder: 0 },
      { id: itemIdA, sortOrder: 1 },
    ]),
    false,
  );
});

test("database snake_case frontend camelCase ga map qilinadi", () => {
  const item = mapCandidateAdabiyotXRow({
    id: itemIdA,
    candidate_id: candidateId,
    candidate_integration_key: integrationKey,
    external_id: "book-1",
    relationship_type: "own_work",
    content_type: "book",
    title: "Kitob",
    author_name: null,
    description: null,
    cover_url: null,
    external_url: "https://adabiyotx.uz/book/1",
    published_at: null,
    sort_order: 2,
    is_visible: true,
    metadata: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  });
  assert.equal(item.candidateId, candidateId);
  assert.equal(item.candidateIntegrationKey, integrationKey);
  assert.equal(item.externalId, "book-1");
  assert.equal(item.sortOrder, 2);
  assert.equal(item.isVisible, true);
  assert.deepEqual(item.metadata, {});
});

test("public mapper ichki candidate, visibility, metadata va vaqt maydonlarini chiqarmaydi", () => {
  const item = mapPublicCandidateAdabiyotXRow({
    id: itemIdA,
    candidate_integration_key: integrationKey,
    external_id: "book-1",
    relationship_type: "own_work",
    content_type: "book",
    title: "Kitob",
    author_name: "Muallif",
    description: null,
    cover_url: null,
    external_url: "https://adabiyotx.uz/book/1",
    published_at: null,
    sort_order: 0,
    is_visible: true,
    created_at: "2026-01-01T00:00:00.000Z",
  });
  assert.deepEqual(Object.keys(item), [
    "id",
    "externalId",
    "relationshipType",
    "contentType",
    "title",
    "authorName",
    "description",
    "coverUrl",
    "externalUrl",
    "publishedAt",
    "sortOrder",
  ]);
});

test("cover faqat public HTTPS URL bo‘lsa qabul qilinadi", () => {
  assert.equal(
    normalizeSafeCoverUrl("https://cdn.example.uz/covers/1.jpg"),
    "https://cdn.example.uz/covers/1.jpg",
  );
  assert.equal(normalizeSafeCoverUrl("https://127.0.0.1/secret"), null);
  assert.equal(normalizeSafeCoverUrl("data:image/png;base64,AA"), null);
});

test("migration duplicate, RLS, atomic reorder va cascade talablarini saqlaydi", () => {
  const sql = readFileSync(
    "supabase/migrations/0014_candidate_adabiyotx_items.sql",
    "utf8",
  );
  assert.match(sql, /on delete cascade/i);
  assert.match(sql, /add column if not exists integration_key uuid/i);
  assert.match(sql, /integration_key set default gen_random_uuid\(\)/i);
  assert.match(sql, /where integration_key is null/i);
  assert.match(sql, /integration_key set not null/i);
  assert.match(sql, /unique index if not exists uq_candidates_integration_key/i);
  assert.match(sql, /candidate_integration_key uuid not null/i);
  assert.match(sql, /set_candidate_adabiyotx_integration_key/i);
  assert.match(
    sql,
    /candidate_integration_key,\s*relationship_type,\s*is_visible,\s*sort_order/i,
  );
  assert.match(sql, /unique \(candidate_id, external_id, relationship_type\)/i);
  assert.match(sql, /is_visible = true/i);
  assert.match(sql, /public\.is_admin\(\)/i);
  assert.match(sql, /public\.has_permission\('candidates\.edit'\)/i);
  assert.match(sql, /reorder_candidate_adabiyotx_items/i);
  assert.match(sql, /relationship_type <> 'read_book' or content_type = 'book'/i);
});

test("admin route auth, delete candidate scope va cover fallback regressiyalari", () => {
  const routeFiles = [
    "src/app/api/admin/integrations/adabiyotx/search/route.ts",
    "src/app/api/admin/candidates/[candidateId]/adabiyotx-items/route.ts",
    "src/app/api/admin/candidates/[candidateId]/adabiyotx-items/[itemId]/route.ts",
    "src/app/api/admin/candidates/[candidateId]/adabiyotx-items/reorder/route.ts",
  ];
  for (const routeFile of routeFiles) {
    assert.match(readFileSync(routeFile, "utf8"), /checkPermission\(/);
  }
  const createRoute = readFileSync(routeFiles[1], "utf8");
  const itemRoute = readFileSync(
    routeFiles[2],
    "utf8",
  );
  const adapter = readFileSync("src/lib/adabiyotx/adapter.ts", "utf8");
  const panel = readFileSync(
    "src/app/(admin)/candidates/[id]/adabiyotx-panel.tsx",
    "utf8",
  );
  assert.match(createRoute, /ITEM_ALREADY_LINKED/);
  assert.match(createRoute, /status: 201/);
  assert.match(itemRoute, /\.eq\("candidate_id", candidateId\)/);
  assert.match(itemRoute, /export async function DELETE/);
  assert.doesNotMatch(adapter, /NEXT_PUBLIC_ADABIYOTX/);
  assert.match(adapter, /"x-adabiyotx-api-key": resolved\.config\.apiKey/);
  assert.doesNotMatch(adapter, /Authorization/);
  assert.doesNotMatch(panel, /ADABIYOTX_INTEGRATION_API_KEY|x-adabiyotx-api-key/);
  assert.match(panel, /onError=\{\(\) => setFailedSrc\(src\)\}/);
  assert.match(panel, /Hozircha material biriktirilmagan\./);
});

test("cross-project public route faqat visible material va xavfsiz response beradi", () => {
  const route = readFileSync(
    "src/app/api/public/candidates/[integrationKey]/adabiyotx-items/route.ts",
    "utf8",
  );
  assert.match(route, /uuidSchema\.safeParse\(integrationKey\)/);
  assert.match(route, /status: 400/);
  assert.match(route, /\.eq\("candidate_integration_key", integrationKey\)/);
  assert.match(route, /\.eq\("is_visible", true\)/);
  assert.match(route, /\.order\("sort_order", \{ ascending: true \}\)/);
  assert.match(route, /\.order\("created_at", \{ ascending: false \}\)/);
  assert.match(route, /LIDERLAR_PUBLIC_CONTENT_API_KEY/);
  assert.match(route, /x-liderlar-api-key/);
  assert.match(route, /Cache-Control/);
  assert.doesNotMatch(route, /created_by/);
  assert.doesNotMatch(route, /metadata/);
});
