import { test } from "node:test";
import assert from "node:assert/strict";
import {
  hasPermission,
  permissionsForRoles,
  PERMISSIONS,
  ROLE_PERMISSIONS,
} from "../src/lib/permissions.ts";

test("super_admin har bir ruxsatga ega", () => {
  for (const p of PERMISSIONS) {
    assert.equal(hasPermission(["super_admin"], p), true, p);
  }
});

test("admin uchun taqiqlangan ruxsatlar", () => {
  assert.equal(hasPermission(["admin"], "admins.manage"), false);
  assert.equal(hasPermission(["admin"], "settings.manage"), false);
  assert.equal(hasPermission(["admin"], "rankings.weights"), false);
  assert.equal(hasPermission(["admin"], "candidates.publish"), true);
  assert.equal(hasPermission(["admin"], "updates.merge"), true);
});

test("editor faqat maqola oqimiga ega", () => {
  assert.equal(hasPermission(["editor"], "articles.create"), true);
  assert.equal(hasPermission(["editor"], "articles.submit"), true);
  assert.equal(hasPermission(["editor"], "articles.publish"), false);
  assert.equal(hasPermission(["editor"], "candidates.edit"), false);
  assert.equal(hasPermission(["editor"], "ai.use"), true);
});

test("moderator tekshiradi, lekin birlashtira olmaydi", () => {
  assert.equal(hasPermission(["moderator"], "updates.review"), true);
  assert.equal(hasPermission(["moderator"], "updates.merge"), false);
  assert.equal(hasPermission(["moderator"], "applications.review"), true);
  assert.equal(hasPermission(["moderator"], "applications.convert"), false);
});

test("analyst faqat kuzatadi va eksport qiladi", () => {
  assert.equal(hasPermission(["analyst"], "rankings.view"), true);
  assert.equal(hasPermission(["analyst"], "export.run"), true);
  assert.equal(hasPermission(["analyst"], "rankings.adjust"), false);
});

test("viewer hech narsani o'zgartira olmaydi", () => {
  for (const p of ROLE_PERMISSIONS.viewer) {
    assert.ok(p.endsWith(".view"), `viewer uchun kutilmagan ruxsat: ${p}`);
  }
});

test("rolsiz foydalanuvchi hech narsaga ega emas", () => {
  assert.equal(permissionsForRoles([]).size, 0);
  assert.equal(hasPermission(["unknown_role"], "dashboard.view"), false);
});

test("bir nechta rol birlashadi", () => {
  const set = permissionsForRoles(["editor", "moderator"]);
  assert.ok(set.has("articles.create"));
  assert.ok(set.has("updates.review"));
});
