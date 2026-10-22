import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isUrlFetchFailure, sendPhotoToChats } from "../src/lib/post-studio/photo-fanout.ts";

const URL = "https://example.supabase.co/storage/v1/object/public/candidate-post-assets/p/render.png?v=1";
const BYTES = Buffer.from("png-bytes");

/** Telegram'ning haqiqiy rad javobi (prod log'dan). */
const urlRejected = () => new Error("Bad Request: failed to get HTTP URL content");

test("Telegram'ning URL rad javoblari taniladi, boshqalari emas", () => {
  assert.ok(isUrlFetchFailure(urlRejected()));
  assert.ok(isUrlFetchFailure(new Error("Bad Request: wrong file identifier/HTTP URL specified")));
  assert.ok(isUrlFetchFailure(new Error("Bad Request: wrong type of the web page content")));
  assert.ok(!isUrlFetchFailure(new Error("Forbidden: bot was blocked by the user")));
  assert.ok(!isUrlFetchFailure("failed to get HTTP URL content"));
});

test("birinchi yuborishdan keyin qolgan chatlar file_id oladi", async () => {
  const calls: Array<[number, Buffer | string]> = [];
  const result = await sendPhotoToChats([1, 2, 3], URL, {
    send: async (chatId, photo) => {
      calls.push([chatId, photo]);
      return { fileId: "FILE_ID" };
    },
    download: async () => assert.fail("URL ishlasa yuklab olinmaydi"),
  });
  assert.deepEqual(calls, [[1, URL], [2, "FILE_ID"], [3, "FILE_ID"]]);
  assert.deepEqual(result, { sent: 3, errors: [] });
});

test("Telegram URL'ni ololmasa — baytlar BIR marta yuklanadi va yuboriladi", async () => {
  // Prod'dagi holat: 8 post 16 kun shu xato bilan hech qayerga yetmagan.
  const calls: Array<[number, Buffer | string]> = [];
  let downloads = 0;
  const result = await sendPhotoToChats([1, 2, 3], URL, {
    send: async (chatId, photo) => {
      calls.push([chatId, photo]);
      if (photo === URL) throw urlRejected();
      return { fileId: "FILE_ID" };
    },
    download: async (url) => {
      downloads += 1;
      assert.equal(url, URL);
      return BYTES;
    },
  });
  assert.equal(downloads, 1);
  assert.deepEqual(calls, [[1, URL], [1, BYTES], [2, "FILE_ID"], [3, "FILE_ID"]]);
  assert.deepEqual(result, { sent: 3, errors: [] });
});

test("bloklagan chat boshqalarni to'xtatmaydi va yuklab olishga sabab bo'lmaydi", async () => {
  const result = await sendPhotoToChats([1, 2], URL, {
    send: async (chatId) => {
      if (chatId === 1) throw new Error("Forbidden: bot was blocked by the user");
      return { fileId: "FILE_ID" };
    },
    download: async () => assert.fail("403 URL muammosi emas"),
  });
  assert.equal(result.sent, 1);
  assert.deepEqual(result.errors, [{ chatId: 1, message: "Forbidden: bot was blocked by the user" }]);
});

test("rasm yuklab olinmasa — har chat uchun qayta urinilmaydi, xato yoziladi", async () => {
  let downloads = 0;
  const result = await sendPhotoToChats([1, 2], URL, {
    send: async () => {
      throw urlRejected();
    },
    download: async () => {
      downloads += 1;
      throw new Error("Post rasmi yuklanmadi: HTTP 404");
    },
  });
  assert.equal(downloads, 1);
  assert.equal(result.sent, 0);
  assert.deepEqual(
    result.errors.map((e) => e.message),
    ["Post rasmi yuklanmadi: HTTP 404", "Bad Request: failed to get HTTP URL content"],
  );
});

test("kanal eslatmasi shu modul orqali yuboradi", () => {
  const service = readFileSync("src/lib/post-studio/channel-reminder.ts", "utf8");
  assert.match(service, /await sendPhotoToChats\(chatIds, image,/);
});
