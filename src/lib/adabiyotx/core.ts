import { createHash } from "node:crypto";
import type {
  AdabiyotXContentType,
  AdabiyotXSearchItem,
} from "./types";

const ADABIYOTX_ROOT_HOST = "adabiyotx.uz";
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/g;

function hostnameWithoutBrackets(hostname: string): string {
  return hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
}

function isPrivateHostname(hostname: string): boolean {
  const host = hostnameWithoutBrackets(hostname);
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host === "::1" ||
    host.startsWith("fc") ||
    host.startsWith("fd") ||
    host.startsWith("fe80:")
  ) {
    return true;
  }

  const parts = host.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d+$/.test(part))) {
    return false;
  }
  const octets = parts.map(Number);
  if (octets.some((part) => part < 0 || part > 255)) return true;
  return (
    octets[0] === 0 ||
    octets[0] === 10 ||
    octets[0] === 127 ||
    (octets[0] === 169 && octets[1] === 254) ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168) ||
    octets[0] >= 224
  );
}

export function normalizeAdabiyotXUrl(value: string): string | null {
  try {
    const url = new URL(value.trim());
    const hostname = hostnameWithoutBrackets(url.hostname);
    const belongsToAdabiyotX =
      hostname === ADABIYOTX_ROOT_HOST ||
      hostname.endsWith(`.${ADABIYOTX_ROOT_HOST}`);
    if (
      url.protocol !== "https:" ||
      !belongsToAdabiyotX ||
      url.username ||
      url.password ||
      (url.port && url.port !== "443")
    ) {
      return null;
    }
    url.hash = "";
    url.searchParams.sort();
    return url.toString();
  } catch {
    return null;
  }
}

export function normalizeSafeCoverUrl(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      (url.port && url.port !== "443") ||
      isPrivateHostname(url.hostname)
    ) {
      return null;
    }
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

export function sanitizeAdabiyotXQuery(value: string): string {
  return value
    .replace(CONTROL_CHARACTERS, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

export function stableExternalIdFromUrl(value: string): string | null {
  const normalized = normalizeAdabiyotXUrl(value);
  if (!normalized) return null;
  const digest = createHash("sha256").update(normalized).digest("hex");
  return `url:${digest}`;
}

export function normalizeAdabiyotXContentType(
  value: unknown,
): AdabiyotXContentType {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[ʻ’']/g, "")
    .replace(/[\s_-]+/g, "");

  if (["book", "kitob"].includes(normalized)) return "book";
  if (["article", "maqola"].includes(normalized)) return "article";
  if (["poem", "poetry", "sher", "sheer"].includes(normalized)) return "poem";
  if (["scenario", "screenplay", "script", "ssenariy"].includes(normalized)) {
    return "scenario";
  }
  return "other";
}

export function isAdabiyotXRelationshipContentValid(
  relationshipType: string,
  contentType: string,
): boolean {
  return relationshipType !== "read_book" || contentType === "book";
}

export function hasUniqueAdabiyotXReorderIds(
  items: ReadonlyArray<{ id: string }>,
): boolean {
  return new Set(items.map((item) => item.id)).size === items.length;
}

function record(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

function extractItems(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  const root = record(payload);
  if (!root) return [];
  if (Array.isArray(root.items)) return root.items;
  if (Array.isArray(root.results)) return root.results;
  if (Array.isArray(root.data)) return root.data;
  const data = record(root.data);
  if (data && Array.isArray(data.items)) return data.items;
  if (data && Array.isArray(data.results)) return data.results;
  return [];
}

function normalizePublishedAt(value: unknown): string | null {
  const raw = stringValue(value);
  if (!raw) return null;
  const timestamp = Date.parse(raw);
  return Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString();
}

/**
 * The only place that knows about possible AdabiyotX response field names.
 * Once their catalog contract is documented, this mapper can be narrowed
 * without changing routes or UI.
 */
export function normalizeAdabiyotXResponse(
  payload: unknown,
): AdabiyotXSearchItem[] {
  const normalized: AdabiyotXSearchItem[] = [];

  for (const rawItem of extractItems(payload)) {
    const item = record(rawItem);
    if (!item) continue;
    const title = stringValue(item.title, item.name);
    const externalUrl = normalizeAdabiyotXUrl(
      stringValue(item.external_url, item.externalUrl, item.url, item.link) ?? "",
    );
    if (!title || !externalUrl) continue;

    const externalId =
      stringValue(item.external_id, item.externalId, item.id, item.uuid) ??
      stableExternalIdFromUrl(externalUrl);
    if (!externalId) continue;

    const author = record(item.author);
    normalized.push({
      externalId: externalId.slice(0, 500),
      contentType: normalizeAdabiyotXContentType(
        item.content_type ?? item.contentType ?? item.type ?? item.kind,
      ),
      title: title.slice(0, 500),
      authorName:
        stringValue(
          item.author_name,
          item.authorName,
          author?.name,
          typeof item.author === "string" ? item.author : null,
        )?.slice(0, 300) ?? null,
      description:
        stringValue(item.description, item.excerpt, item.summary)?.slice(0, 5000) ??
        null,
      coverUrl: normalizeSafeCoverUrl(
        stringValue(
          item.cover_url,
          item.coverUrl,
          item.cover,
          item.image_url,
          item.image,
        ),
      ),
      externalUrl,
      publishedAt: normalizePublishedAt(
        item.published_at ?? item.publishedAt ?? item.date,
      ),
    });
  }

  return normalized;
}

export interface AdabiyotXSearchConfig {
  baseUrl: string;
  searchPath: string;
  apiKey: string;
}

export function resolveAdabiyotXSearchConfig(
  env: Record<string, string | undefined>,
): { ok: true; config: AdabiyotXSearchConfig } | { ok: false } {
  const baseUrl = env.ADABIYOTX_API_BASE_URL?.trim();
  const searchPath = env.ADABIYOTX_CATALOG_SEARCH_PATH?.trim();
  const apiKey = env.ADABIYOTX_INTEGRATION_API_KEY?.trim();
  if (!baseUrl || !searchPath || !apiKey) return { ok: false };

  try {
    const base = new URL(baseUrl);
    if (
      base.protocol !== "https:" ||
      base.username ||
      base.password ||
      isPrivateHostname(base.hostname)
    ) {
      return { ok: false };
    }
    const resolved = new URL(searchPath, base.toString().replace(/\/?$/, "/"));
    if (resolved.origin !== base.origin) return { ok: false };
    return {
      ok: true,
      config: {
        baseUrl: base.toString(),
        searchPath,
        apiKey,
      },
    };
  } catch {
    return { ok: false };
  }
}

export function buildAdabiyotXSearchUrl(
  config: AdabiyotXSearchConfig,
  query: string,
): URL {
  const cleanQuery = sanitizeAdabiyotXQuery(query);
  const base = config.baseUrl.replace(/\/?$/, "/");
  const hasPlaceholder = config.searchPath.includes("{query}");
  const path = hasPlaceholder
    ? config.searchPath.replaceAll("{query}", encodeURIComponent(cleanQuery))
    : config.searchPath;
  const url = new URL(path, base);
  if (url.origin !== new URL(base).origin) {
    throw new Error("AdabiyotX qidiruv path'i base URL originiga mos emas");
  }
  if (!hasPlaceholder) url.searchParams.set("q", cleanQuery);
  return url;
}
