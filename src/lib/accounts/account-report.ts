import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { AccountRow, AccountState, AccountCounts, AccountFilter } from "./account-types.ts";

/**
 * Nomzod hisoblari hisoboti.
 *
 * HAR BIR SON BAZADAN SANALADI. Bu sahifa bitta savolga javob
 * berishi kerak: kimda hisob bor, kimda yo'q, kim kutyapti.
 * Taxminiy raqam bu yerda eng yomon narsa bo'lardi — unga
 * qarab ommaviy taklifnoma yuborish qarori qabul qilinadi.
 */

/**
 * Holatni AUTHORITATIV manbalardan chiqaramiz.
 *
 * Alohida "status" ustuni yaratish vasvasa qiladi, lekin u
 * haqiqat bilan kelishmay qolardi: nomzod bog'langanmi —
 * buni `candidates.user_id` biladi, taklifnoma holatini esa
 * `candidate_activations`. Ikkinchi nusxa faqat chalkashlik
 * qo'shardi.
 */
function deriveState(input: {
  userId: string | null;
  disabled: boolean;
  hasActiveActivation: boolean;
  hasConsumedButUnlinked: boolean;
}): AccountState {
  if (input.hasConsumedButUnlinked && !input.userId) return "needs_attention";
  if (input.userId) return input.disabled ? "blocked" : "active";
  if (input.hasActiveActivation) return "activation_pending";
  return "no_account";
}

export interface AccountReport {
  counts: AccountCounts;
  rows: AccountRow[];
  total: number;
}

export interface LoadOptions {
  filter?: AccountFilter;
  search?: string;
  limit?: number;
  offset?: number;
}

export async function loadAccountReport(options: LoadOptions = {}): Promise<AccountReport> {
  const db = createSupabaseAdminClient();
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const offset = Math.max(options.offset ?? 0, 0);
  const now = new Date().toISOString();

  /* ---- Sonlar: alohida, aniq so'rovlar ---- */

  const [
    totalRes,
    linkedRes,
    unlinkedRes,
    pendingRes,
    telegramRes,
    disabledRes,
  ] = await Promise.all([
    db.from("candidates").select("id", { count: "exact", head: true }).is("deleted_at", null),
    db
      .from("candidates")
      .select("id", { count: "exact", head: true })
      .is("deleted_at", null)
      .not("user_id", "is", null),
    db
      .from("candidates")
      .select("id", { count: "exact", head: true })
      .is("deleted_at", null)
      .is("user_id", null),
    db
      .from("candidate_activations")
      .select("id", { count: "exact", head: true })
      .is("consumed_at", null)
      .is("revoked_at", null)
      .gt("expires_at", now),
    db
      .from("member_telegram_links")
      .select("id", { count: "exact", head: true })
      .is("unlinked_at", null),
    db
      .from("member_accounts")
      .select("profile_id", { count: "exact", head: true })
      .eq("status", "disabled"),
  ]);

  /*
   * "E'tibor kerak" — taklifnoma ishlatilgan, lekin nomzod
   * bog'lanmagan. Supabase Auth va Postgres orasida to'liq
   * atomiklik yo'q, shuning uchun bu holat nazariy emas,
   * amalda bo'lishi mumkin va u KO'RINIB turishi kerak.
   */
  const { data: orphanRows } = await db
    .from("candidate_activations")
    .select("candidate_id, candidates!inner(user_id, deleted_at)")
    .not("consumed_at", "is", null)
    .is("candidates.user_id", null)
    .is("candidates.deleted_at", null);

  const orphanIds = new Set(
    ((orphanRows ?? []) as { candidate_id: string }[]).map((r) => r.candidate_id),
  );

  const counts: AccountCounts = {
    totalCandidates: totalRes.count ?? 0,
    linked: linkedRes.count ?? 0,
    unlinked: unlinkedRes.count ?? 0,
    activationPending: pendingRes.count ?? 0,
    telegramLinked: telegramRes.count ?? 0,
    blocked: disabledRes.count ?? 0,
    needsAttention: orphanIds.size,
  };

  /* ---- Ro'yxat ---- */

  let query = db
    .from("candidates")
    .select(
      "id, slug, full_name, avatar_url, status, user_id, created_at, regions(name)",
      { count: "exact" },
    )
    .is("deleted_at", null);

  const search = options.search?.trim();
  if (search) {
    /*
     * Faqat ISM va SLUG bo'yicha. Email va telefon ataylab
     * qidirilmaydi: ular shaxsiy ma'lumot va ularni qidiruv
     * qatoriga yozish ekran suratlari orqali tarqaladi.
     */
    const safe = search.replace(/[%,()]/g, " ").trim();
    if (safe) query = query.or(`full_name.ilike.%${safe}%,slug.ilike.%${safe}%`);
  }

  const filter = options.filter ?? "all";
  if (filter === "linked") query = query.not("user_id", "is", null);
  if (filter === "unlinked") query = query.is("user_id", null);

  const { data: candidateRows, count: filteredCount } = await query
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  const rows = (candidateRows ?? []) as unknown as {
    id: string;
    slug: string | null;
    full_name: string;
    avatar_url: string | null;
    status: string;
    user_id: string | null;
    created_at: string;
    regions: { name?: string } | null;
  }[];

  if (rows.length === 0) {
    return { counts, rows: [], total: filteredCount ?? 0 };
  }

  const candidateIds = rows.map((r) => r.id);
  const userIds = rows.map((r) => r.user_id).filter((v): v is string => Boolean(v));

  const [activationsRes, accountsRes, telegramLinksRes] = await Promise.all([
    db
      .from("candidate_activations")
      .select("candidate_id, expires_at, consumed_at, revoked_at, created_at")
      .in("candidate_id", candidateIds)
      .order("created_at", { ascending: false }),

    userIds.length
      ? db
          .from("member_accounts")
          .select("profile_id, status, last_login_at")
          .in("profile_id", userIds)
      : Promise.resolve({ data: [] as { profile_id: string; status: string; last_login_at: string | null }[] }),

    userIds.length
      ? db
          .from("member_telegram_links")
          .select("profile_id, telegram_username, linked_at")
          .in("profile_id", userIds)
          .is("unlinked_at", null)
      : Promise.resolve({ data: [] as { profile_id: string; telegram_username: string | null; linked_at: string }[] }),
  ]);

  const activationByCandidate = new Map<
    string,
    { expiresAt: string; consumedAt: string | null; revokedAt: string | null }
  >();
  const consumedUnlinked = new Set<string>();

  for (const a of (activationsRes.data ?? []) as {
    candidate_id: string;
    expires_at: string;
    consumed_at: string | null;
    revoked_at: string | null;
  }[]) {
    // Ro'yxat sanaga qarab tartiblangan — birinchisi eng yangisi.
    if (!activationByCandidate.has(a.candidate_id)) {
      activationByCandidate.set(a.candidate_id, {
        expiresAt: a.expires_at,
        consumedAt: a.consumed_at,
        revokedAt: a.revoked_at,
      });
    }
    if (a.consumed_at) consumedUnlinked.add(a.candidate_id);
  }

  const accountByUser = new Map(
    ((accountsRes.data ?? []) as { profile_id: string; status: string; last_login_at: string | null }[]).map(
      (a) => [a.profile_id, a],
    ),
  );

  const telegramByUser = new Map(
    ((telegramLinksRes.data ?? []) as {
      profile_id: string;
      telegram_username: string | null;
      linked_at: string;
    }[]).map((t) => [t.profile_id, t]),
  );

  const built: AccountRow[] = rows.map((r) => {
    const activation = activationByCandidate.get(r.id);
    const account = r.user_id ? accountByUser.get(r.user_id) : undefined;
    const telegram = r.user_id ? telegramByUser.get(r.user_id) : undefined;

    const hasActive =
      Boolean(activation) &&
      !activation!.consumedAt &&
      !activation!.revokedAt &&
      new Date(activation!.expiresAt) > new Date();

    return {
      candidateId: r.id,
      slug: r.slug,
      fullName: r.full_name,
      avatarUrl: r.avatar_url,
      regionName: r.regions?.name ?? null,
      candidateStatus: r.status,

      profileId: r.user_id,
      hasAccount: Boolean(r.user_id),
      state: deriveState({
        userId: r.user_id,
        disabled: account?.status === "disabled",
        hasActiveActivation: hasActive,
        hasConsumedButUnlinked: consumedUnlinked.has(r.id),
      }),

      activationExpiresAt: hasActive ? activation!.expiresAt : null,
      lastLoginAt: account?.last_login_at ?? null,

      telegramLinked: Boolean(telegram),
      telegramUsername: telegram?.telegram_username ?? null,
    };
  });

  /*
   * Holatga bog'liq filtrlar RO'YXAT QURILGANDAN KEYIN
   * qo'llanadi: holat bir nechta jadvaldan chiqadi va uni
   * bitta SQL shartiga sig'dirib bo'lmaydi.
   */
  const stateFiltered =
    filter === "pending"
      ? built.filter((r) => r.state === "activation_pending")
      : filter === "telegram"
        ? built.filter((r) => r.telegramLinked)
        : filter === "blocked"
          ? built.filter((r) => r.state === "blocked")
          : filter === "attention"
            ? built.filter((r) => r.state === "needs_attention")
            : built;

  return {
    counts,
    rows: stateFiltered,
    total: filter === "all" || filter === "linked" || filter === "unlinked"
      ? (filteredCount ?? stateFiltered.length)
      : stateFiltered.length,
  };
}
