import "server-only";
import {
  buildAdabiyotXSearchUrl,
  normalizeAdabiyotXResponse,
  resolveAdabiyotXSearchConfig,
  sanitizeAdabiyotXQuery,
} from "./core";
import type { AdabiyotXSearchItem } from "./types";

export type AdabiyotXSearchResult =
  | { ok: true; items: AdabiyotXSearchItem[] }
  | {
      ok: false;
      code:
        | "ADABIYOTX_SEARCH_NOT_CONFIGURED"
        | "ADABIYOTX_SEARCH_FAILED";
      error: string;
    };

/**
 * AdabiyotX endpoint construction, credentials and response mapping are kept
 * behind this adapter. The browser only calls the local admin route.
 */
export async function searchAdabiyotXCatalog(
  query: string,
  options: { signal?: AbortSignal } = {},
): Promise<AdabiyotXSearchResult> {
  const cleanQuery = sanitizeAdabiyotXQuery(query);
  const resolved = resolveAdabiyotXSearchConfig(process.env);
  if (!resolved.ok) {
    return {
      ok: false,
      code: "ADABIYOTX_SEARCH_NOT_CONFIGURED",
      error: "AdabiyotX qidiruvi hali sozlanmagan.",
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  const abortFromCaller = () => controller.abort();
  options.signal?.addEventListener("abort", abortFromCaller, { once: true });

  try {
    const url = buildAdabiyotXSearchUrl(resolved.config, cleanQuery);
    const headers = new Headers({
      Accept: "application/json",
      "x-adabiyotx-api-key": resolved.config.apiKey,
    });

    const response = await fetch(url, {
      method: "GET",
      headers,
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) {
      return {
        ok: false,
        code: "ADABIYOTX_SEARCH_FAILED",
        error: "AdabiyotX katalogidan javob olib bo‘lmadi.",
      };
    }

    // adabiyotx.uz SPA fallback'i noma'lum path uchun 200 + HTML qaytaradi,
    // shuning uchun JSON emasligi alohida xatolik sifatida ushlanadi.
    const contentType = response.headers.get("content-type") ?? "";
    if (!/\bjson\b/i.test(contentType)) {
      return {
        ok: false,
        code: "ADABIYOTX_SEARCH_FAILED",
        error: "AdabiyotX katalogi JSON javob qaytarmadi.",
      };
    }

    const payload: unknown = await response.json();
    return { ok: true, items: normalizeAdabiyotXResponse(payload) };
  } catch {
    return {
      ok: false,
      code: "ADABIYOTX_SEARCH_FAILED",
      error: "AdabiyotX katalogiga ulanib bo‘lmadi.",
    };
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abortFromCaller);
  }
}
