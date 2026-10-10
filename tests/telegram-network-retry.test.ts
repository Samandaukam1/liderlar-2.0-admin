import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  describeNetworkError,
  fetchTelegram,
  TELEGRAM_NETWORK_ATTEMPTS,
  TelegramNetworkError,
} from "../src/lib/telegram/network-retry.ts";

/** undici'ning haqiqiy shakli: `TypeError("fetch failed")` + `cause`. */
function fetchFailed(code: string, message = `connect ${code} 149.154.167.220:443`): TypeError {
  const cause = Object.assign(new Error(message), { code });
  return new TypeError("fetch failed", { cause });
}

const noSleep = async () => {};
const URL = "https://api.telegram.org/bot123456:ABC-def_ghi/sendMessage";

test("tarmoq uzilishidan keyin qayta urinadi va javobni qaytaradi", async () => {
  let calls = 0;
  const waits: number[] = [];
  const response = await fetchTelegram(
    URL,
    { method: "POST", body: "{}" },
    {
      fetch: async () => {
        calls += 1;
        if (calls < 3) throw fetchFailed("ETIMEDOUT");
        return new Response('{"ok":true}', { status: 200 });
      },
      sleep: async (ms) => {
        waits.push(ms);
      },
    },
  );
  assert.equal(response.status, 200);
  assert.equal(calls, 3);
  assert.deepEqual(waits, [300, 900]);
});

test("HTTP javob (hatto 500) qayta urinilmaydi — u transportning ishi", async () => {
  let calls = 0;
  const response = await fetchTelegram(
    URL,
    { method: "POST" },
    {
      fetch: async () => {
        calls += 1;
        return new Response("{}", { status: 500 });
      },
      sleep: noSleep,
    },
  );
  assert.equal(response.status, 500);
  assert.equal(calls, 1);
});

test("hamma urinish yiqilsa — sabab kodi bilan xato, token log'ga chiqmaydi", async () => {
  let calls = 0;
  await assert.rejects(
    fetchTelegram(
      URL,
      { method: "POST" },
      {
        fetch: async () => {
          calls += 1;
          throw fetchFailed("ECONNRESET", "request to bot123456:ABC-def_ghi reset");
        },
        sleep: noSleep,
      },
    ),
    (err: unknown) => {
      assert.ok(err instanceof TelegramNetworkError);
      assert.equal(err.code, "ECONNRESET");
      assert.equal(err.attempts, TELEGRAM_NETWORK_ATTEMPTS);
      assert.match(err.message, /fetch failed: request to bot\*\*\* reset \(3 urinish\)/);
      assert.doesNotMatch(err.message, /ABC-def_ghi/);
      return true;
    },
  );
  assert.equal(calls, TELEGRAM_NETWORK_ATTEMPTS);
});

test("chaqiruvchi bekor qilgan so'rov qayta urinilmaydi", async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  await assert.rejects(
    fetchTelegram(
      URL,
      { method: "POST", signal: controller.signal },
      {
        fetch: async () => {
          calls += 1;
          throw new DOMException("aborted", "AbortError");
        },
        sleep: noSleep,
      },
    ),
    { name: "AbortError" },
  );
  assert.equal(calls, 1);
});

test("AggregateError sababidan ham kod olinadi (IPv4/IPv6 ikkovi yiqilganda)", () => {
  const inner = Object.assign(new Error("connect ETIMEDOUT"), { code: "ETIMEDOUT" });
  const aggregate = new AggregateError([inner], "");
  const err = new TypeError("fetch failed", { cause: aggregate });
  const { code, detail } = describeNetworkError(err);
  assert.equal(code, "ETIMEDOUT");
  assert.equal(detail, "fetch failed: ETIMEDOUT");
});

test("uchala bot transporti ham fetchTelegram orqali yuboradi", () => {
  for (const file of [
    "src/lib/post-studio/telegram-api.ts",
    "src/lib/coordinators/bot-api.ts",
    "src/lib/member-bot/bot-api.ts",
  ]) {
    const code = readFileSync(file, "utf8");
    assert.match(code, /await fetchTelegram\(`\$\{TELEGRAM_API\}\/bot/, file);
  }
});
