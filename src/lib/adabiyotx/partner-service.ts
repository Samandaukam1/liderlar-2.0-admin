import "server-only";
import { createHash } from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { refreshPublicProfiles } from "@/lib/public-profile-refresh";
import { getSiteUrl } from "@/lib/site-url";
import {
  librarySchema,
  normalizeLinkCode,
  ownWorkItem,
  pointsForScore,
  readBookItem,
  resolvePartnerConfig,
  toIsoOrNow,
  type AdabiyotXUser,
  type BookReadRequest,
  type CandidateItemUpsert,
  type PartnerBook,
} from "./partner-core";

/**
 * AdabiyotX hisob bog'lash — BAZA BILAN ISHLAYDIGAN QISM.
 *
 * Barcha yozuvlar service_role bilan: jadvallarga brauzerdan yozish
 * siyosati yo'q, faqat shu server kodi yozadi.
 */

export interface LinkedCandidate {
  id: string;
  slug: string | null;
  full_name: string;
  avatar_url: string | null;
  status: string;
  profile_url: string | null;
}

export interface AccountLink {
  liderlar_user_id: string;
  adabiyotx_user_id: string;
  full_name: string | null;
  username: string | null;
  linked_at: string;
  candidate: LinkedCandidate | null;
}

export type LinkOutcome =
  | { ok: true; link: AccountLink; already: boolean }
  | { ok: false; code: "TOKEN_INVALID" | "TOKEN_EXPIRED" | "TOKEN_USED" | "ALREADY_LINKED_OTHER" | "DB_ERROR"; error: string };

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

async function loadCandidateForUser(userId: string): Promise<LinkedCandidate | null> {
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("candidates")
    .select("id, slug, full_name, avatar_url, status")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!data) return null;
  const slug = (data.slug as string | null) ?? null;
  return {
    id: data.id as string,
    slug,
    full_name: data.full_name as string,
    avatar_url: (data.avatar_url as string | null) ?? null,
    status: data.status as string,
    profile_url: slug && data.status === "published" ? `${getSiteUrl()}/liderlar/${slug}` : null,
  };
}

async function describeLink(row: {
  user_id: string;
  adabiyotx_user_id: string;
  linked_at: string;
}): Promise<AccountLink> {
  const admin = createSupabaseAdminClient();
  const [{ data: profile }, candidate] = await Promise.all([
    admin.from("profiles").select("full_name, username").eq("id", row.user_id).maybeSingle(),
    loadCandidateForUser(row.user_id),
  ]);
  return {
    liderlar_user_id: row.user_id,
    adabiyotx_user_id: row.adabiyotx_user_id,
    full_name: (profile?.full_name as string | null) ?? candidate?.full_name ?? null,
    username: (profile?.username as string | null) ?? null,
    linked_at: row.linked_at,
    candidate,
  };
}

/** Bog'langan hisob (AdabiyotX foydalanuvchisi bo'yicha). */
export async function findLinkByAdabiyotXUser(adabiyotxUserId: string): Promise<AccountLink | null> {
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("adabiyotx_account_links")
    .select("user_id, adabiyotx_user_id, linked_at")
    .eq("adabiyotx_user_id", adabiyotxUserId)
    .maybeSingle();
  if (!data) return null;
  return describeLink(data as { user_id: string; adabiyotx_user_id: string; linked_at: string });
}

export async function findLinkByLiderlarUser(userId: string): Promise<AccountLink | null> {
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("adabiyotx_account_links")
    .select("user_id, adabiyotx_user_id, linked_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (!data) return null;
  return describeLink(data as { user_id: string; adabiyotx_user_id: string; linked_at: string });
}

/**
 * Token yoki kodni ishlatib hisoblarni bog'laydi.
 *
 * Token — QR / deep link'dagi xom qiymat (bazada faqat hash). Kod — a'zo
 * ilovaga qo'lda kiritgan 8 belgi. Ikkalasi ham bir martalik va 15 daqiqa.
 */
export async function linkAccounts(input: { token?: string; code?: string; user: AdabiyotXUser }): Promise<LinkOutcome> {
  const admin = createSupabaseAdminClient();
  const now = new Date();

  let query = admin
    .from("adabiyotx_link_tokens")
    .select("id, user_id, expires_at, used_at")
    .order("created_at", { ascending: false })
    .limit(1);
  if (input.token) query = query.eq("token_hash", hashToken(input.token));
  else query = query.eq("code", normalizeLinkCode(input.code ?? "")).is("used_at", null);

  const { data: tokens, error: tokenError } = await query;
  if (tokenError) return { ok: false, code: "DB_ERROR", error: "Tokenni tekshirib bo‘lmadi." };
  const token = tokens?.[0] as { id: string; user_id: string; expires_at: string; used_at: string | null } | undefined;
  if (!token) return { ok: false, code: "TOKEN_INVALID", error: "Bog‘lash kodi topilmadi. Kabinetda yangi kod oling." };
  if (token.used_at) return { ok: false, code: "TOKEN_USED", error: "Bu kod allaqachon ishlatilgan. Kabinetda yangi kod oling." };
  if (new Date(token.expires_at).getTime() < now.getTime()) {
    return { ok: false, code: "TOKEN_EXPIRED", error: "Kodning muddati tugagan. Kabinetda yangi kod oling." };
  }

  // Bu AdabiyotX hisobi boshqa a'zoga bog'langan bo'lsa — rad.
  const { data: existing } = await admin
    .from("adabiyotx_account_links")
    .select("user_id, adabiyotx_user_id, linked_at")
    .eq("adabiyotx_user_id", input.user.id)
    .maybeSingle();
  if (existing && existing.user_id !== token.user_id) {
    return {
      ok: false,
      code: "ALREADY_LINKED_OTHER",
      error: "Bu AdabiyotX hisobi boshqa Liderlar hisobiga bog‘langan. Avval o‘sha yerda uzing.",
    };
  }

  // Bitta so'rov — yangi yoki yangilangan bog'lanish. A'zo yangi AdabiyotX
  // hisobini ulasa, eskisi almashadi (u ataylab yangi kod chiqargan).
  const payload = {
    user_id: token.user_id,
    adabiyotx_user_id: input.user.id,
    adabiyotx_username: input.user.username ?? null,
    adabiyotx_full_name: input.user.full_name ?? null,
    adabiyotx_avatar_url: input.user.avatar_url ?? null,
    linked_at: now.toISOString(),
  };
  const { data: saved, error: saveError } = await admin
    .from("adabiyotx_account_links")
    .upsert(payload, { onConflict: "user_id" })
    .select("user_id, adabiyotx_user_id, linked_at")
    .single();
  if (saveError || !saved) {
    console.error("ADABIYOTX_LINK_SAVE_FAILED", { code: saveError?.code, message: saveError?.message });
    return { ok: false, code: "DB_ERROR", error: "Bog‘lanish saqlanmadi." };
  }

  await admin
    .from("adabiyotx_link_tokens")
    .update({ used_at: now.toISOString() })
    .eq("user_id", token.user_id)
    .is("used_at", null);

  const link = await describeLink(saved as { user_id: string; adabiyotx_user_id: string; linked_at: string });
  return { ok: true, link, already: Boolean(existing) };
}

/** Bog'lanishni o'chiradi (o'qilgan kitoblar va ballar qoladi). */
export async function unlinkByAdabiyotXUser(adabiyotxUserId: string): Promise<{ found: boolean; liderlarUserId: string | null }> {
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("adabiyotx_account_links")
    .delete()
    .eq("adabiyotx_user_id", adabiyotxUserId)
    .select("user_id");
  const row = data?.[0] as { user_id: string } | undefined;
  return { found: Boolean(row), liderlarUserId: row?.user_id ?? null };
}

export async function unlinkByLiderlarUser(userId: string): Promise<{ found: boolean; adabiyotxUserId: string | null }> {
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("adabiyotx_account_links")
    .delete()
    .eq("user_id", userId)
    .select("adabiyotx_user_id");
  const row = data?.[0] as { adabiyotx_user_id: string } | undefined;
  return { found: Boolean(row), adabiyotxUserId: row?.adabiyotx_user_id ?? null };
}

async function upsertItems(items: CandidateItemUpsert[]): Promise<number> {
  if (items.length === 0) return 0;
  const admin = createSupabaseAdminClient();
  const candidateId = items[0]!.candidate_id;
  // Yangi yozuvlar mavjudlarning oxiriga tizilsin.
  const { data: last } = await admin
    .from("candidate_adabiyotx_items")
    .select("sort_order")
    .eq("candidate_id", candidateId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  let next = ((last?.sort_order as number | undefined) ?? -1) + 1;

  const { data: existing } = await admin
    .from("candidate_adabiyotx_items")
    .select("external_id, relationship_type, sort_order, is_visible")
    .eq("candidate_id", candidateId)
    .in("external_id", items.map((item) => item.external_id));
  const known = new Map(
    ((existing ?? []) as { external_id: string; relationship_type: string; sort_order: number; is_visible: boolean }[]).map((row) => [
      `${row.relationship_type}:${row.external_id}`,
      row,
    ]),
  );

  const rows = items.map((item) => {
    const prior = known.get(`${item.relationship_type}:${item.external_id}`);
    return {
      ...item,
      // Admin yashirgan bo'lsa — yashirinligicha qoladi; tartibi ham saqlanadi.
      is_visible: prior ? prior.is_visible : item.is_visible,
      sort_order: prior ? prior.sort_order : next++,
    };
  });

  const { error } = await admin
    .from("candidate_adabiyotx_items")
    .upsert(rows, { onConflict: "candidate_id,external_id,relationship_type" });
  if (error) {
    console.error("ADABIYOTX_ITEMS_UPSERT_FAILED", { code: error.code, message: error.message });
    throw new Error("Materiallar yozilmadi.");
  }
  return rows.length;
}

export interface BookReadOutcome {
  linked: boolean;
  points: number;
  candidate: LinkedCandidate | null;
  profileUrl: string | null;
}

/** Testdan o'tgan kitob: ball + biografiyadagi "O'qigan kitoblari" qatori. */
export async function recordBookRead(request: BookReadRequest): Promise<BookReadOutcome> {
  const link = await findLinkByAdabiyotXUser(request.adabiyotx_user_id);
  if (!link) return { linked: false, points: 0, candidate: null, profileUrl: null };

  const admin = createSupabaseAdminClient();
  const points = pointsForScore(request.score, request.max_score);
  const completedAt = toIsoOrNow(request.completed_at);
  const { error } = await admin.from("adabiyotx_book_reads").upsert(
    {
      user_id: link.liderlar_user_id,
      adabiyotx_user_id: request.adabiyotx_user_id,
      book_id: request.book.id,
      title: request.book.title.slice(0, 500),
      author_name: request.book.author_name?.slice(0, 300) ?? null,
      cover_url: request.book.cover_url ?? null,
      external_url: `https://adabiyotx.uz/book/${request.book.id}`,
      score: points,
      max_score: request.max_score,
      completed_at: completedAt,
    },
    { onConflict: "user_id,book_id" },
  );
  if (error) {
    console.error("ADABIYOTX_BOOK_READ_SAVE_FAILED", { code: error.code, message: error.message });
    throw new Error("O‘qilgan kitob saqlanmadi.");
  }

  if (link.candidate) {
    await upsertItems([
      readBookItem(link.candidate.id, {
        book: request.book,
        score: points,
        max_score: request.max_score,
        completed_at: completedAt,
      }),
    ]);
    refreshPublicProfiles([link.candidate.id]);
  }
  return { linked: true, points, candidate: link.candidate, profileUrl: link.candidate?.profile_url ?? null };
}

/** AdabiyotX'da muallif sifatida biriktirilgan kitoblar → "Ijodiy ishlari". */
export async function syncOwnWorks(adabiyotxUserId: string, works: PartnerBook[]): Promise<{ linked: boolean; upserted: number }> {
  const link = await findLinkByAdabiyotXUser(adabiyotxUserId);
  if (!link) return { linked: false, upserted: 0 };
  if (!link.candidate) return { linked: true, upserted: 0 };
  const upserted = await upsertItems(works.map((book) => ownWorkItem(link.candidate!.id, book)));
  if (upserted > 0) refreshPublicProfiles([link.candidate.id]);
  return { linked: true, upserted };
}

/* ------------------------------------------------------------------
 * liderlar-admin → AdabiyotX
 * ------------------------------------------------------------------ */

async function partnerFetch(path: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<Response | null> {
  const config = resolvePartnerConfig(process.env);
  if (!config) {
    console.error("[adabiyotx] ADABIYOTX_PARTNER_API_BASE_URL / ADABIYOTX_INTEGRATION_API_KEY sozlanmagan");
    return null;
  }
  try {
    return await fetch(`${config.baseUrl}${path}`, {
      ...init,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "x-adabiyotx-api-key": config.apiKey,
        ...(init.headers ?? {}),
      },
      cache: "no-store",
      signal: AbortSignal.timeout(init.timeoutMs ?? 8000),
    });
  } catch (error) {
    console.error("[adabiyotx] partner so'rovi yiqildi:", path, error instanceof Error ? error.message : String(error));
    return null;
  }
}

/** AdabiyotX'ga "bu hisob uzildi" deb aytadi (eng yaxshi harakat). */
export async function notifyAdabiyotXUnlink(adabiyotxUserId: string): Promise<boolean> {
  const response = await partnerFetch("/api/partners/liderlar/unlink", {
    method: "POST",
    body: JSON.stringify({ adabiyotx_user_id: adabiyotxUserId }),
  });
  return Boolean(response?.ok);
}

/** AdabiyotX'dan a'zoning kutubxonasini (yozgan va o'qigan kitoblari) tortib, nomzodga yozadi. */
export async function pullLibraryFromAdabiyotX(userId: string): Promise<{ ok: true; works: number; reads: number } | { ok: false; error: string }> {
  const link = await findLinkByLiderlarUser(userId);
  if (!link) return { ok: false, error: "AdabiyotX hisobi bog‘lanmagan." };
  const response = await partnerFetch(`/api/partners/liderlar/users/${encodeURIComponent(link.adabiyotx_user_id)}/library`, { method: "GET" });
  if (!response || !response.ok) return { ok: false, error: "AdabiyotX javob bermadi. Keyinroq urinib ko‘ring." };
  const parsed = librarySchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) return { ok: false, error: "AdabiyotX javobi tushunarsiz." };

  let works = 0;
  let reads = 0;
  if (link.candidate) {
    works = await upsertItems(parsed.data.works.map((book) => ownWorkItem(link.candidate!.id, book)));
  }
  for (const read of parsed.data.reads) {
    await recordBookRead({
      adabiyotx_user_id: link.adabiyotx_user_id,
      book: read.book,
      score: read.score,
      max_score: read.max_score,
      completed_at: read.completed_at,
    });
    reads += 1;
  }
  if (link.candidate) refreshPublicProfiles([link.candidate.id]);
  return { ok: true, works, reads };
}
