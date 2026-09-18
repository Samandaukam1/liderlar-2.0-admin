import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import {
  answerCoordinatorCallback,
  editCoordinatorMessage,
  sendCoordinatorMessage,
} from "./bot-api.ts";
import {
  buildReportText,
  buildStartReply,
  claimLostReply,
  CLAIM_WON_REPLY,
  coordinatorKeyboard,
  COORDINATOR_PAUSED_REPLY,
  COORD_MENU,
  formatSom,
  MENU_BY_LABEL,
  NOT_A_COORDINATOR_REPLY,
  parseClaimCallback,
  type CoordinatorReport,
} from "./bot-messages.ts";
import { claimLead } from "./routing-service.ts";
import { businessDate, businessDayRange } from "./routing-rules.ts";

/**
 * KOORDINATOR BOTI — kiruvchi qatlam.
 *
 * KOORDINATOR TELEGRAM RAQAMLI ID BO'YICHA TANILADI, username
 * bo'yicha EMAS: username egasi uni istalgan payt o'zgartiradi va
 * bo'shagan nomni boshqa odam egallashi mumkin. Raqamli id esa
 * akkauntning o'zgarmas identifikatori.
 */

export interface CoordinatorUpdate {
  update_id?: number;
  message?: {
    chat?: { id?: number };
    from?: { id?: number; username?: string };
    text?: string;
  };
  callback_query?: {
    id: string;
    from?: { id?: number };
    data?: string;
    message?: { chat?: { id?: number }; message_id?: number };
  };
}

interface CoordinatorIdentity {
  id: string;
  fullName: string;
  regionId: string | null;
  regionName: string | null;
  status: string;
  isActive: boolean;
}

/** Telegram id -> koordinator. Topilmasa null. */
async function identify(telegramUserId: number | null): Promise<CoordinatorIdentity | null> {
  if (telegramUserId == null) return null;
  const db = createSupabaseAdminClient();
  const { data } = await db
    .from("coordinators")
    .select("id, full_name, region_id, status, is_active, regions(name)")
    .eq("telegram_user_id", telegramUserId)
    .eq("is_active", true)
    .maybeSingle();

  if (!data) return null;
  const row = data as unknown as Record<string, unknown>;
  return {
    id: row.id as string,
    fullName: (row.full_name as string) ?? "",
    regionId: (row.region_id as string | null) ?? null,
    regionName: ((row.regions as { name?: string } | null)?.name) ?? null,
    status: (row.status as string) ?? "active",
    isActive: row.is_active === true,
  };
}

/**
 * Update allaqachon ishlanganmi.
 *
 * Telegram bitta update'ni bir necha marta yetkazishi mumkin
 * (javob kechiksa, u qayta yuboradi). Usiz bitta "band qilish"
 * bosishi ikki marta ishlanardi.
 *
 * Birlamchi kalit bo'yicha insert: ikki parallel ishlov ham
 * ikkalasi "yo'q ekan" deb o'qishi mumkin, insert esa faqat
 * bittasida o'tadi.
 */
async function isDuplicateUpdate(updateId: number | undefined): Promise<boolean> {
  if (updateId == null) return false;
  const db = createSupabaseAdminClient();
  const { error } = await db.from("coordinator_bot_updates").insert({ update_id: updateId });
  // Unikal buzilishi — bu update allaqachon ishlangan.
  return Boolean(error);
}

export async function handleCoordinatorUpdate(update: CoordinatorUpdate): Promise<void> {
  if (await isDuplicateUpdate(update.update_id)) {
    console.log("[coordinator-bot] takroriy update — o‘tkazib yuborildi");
    return;
  }

  if (update.callback_query) {
    await handleCallback(update.callback_query);
    return;
  }

  const message = update.message;
  const chatId = message?.chat?.id;
  const fromId = message?.from?.id ?? null;
  if (chatId == null) return;

  const coordinator = await identify(fromId);
  if (!coordinator) {
    // Ro'yxatda yo'q odam — hech qanday ichki ma'lumot berilmaydi.
    await sendCoordinatorMessage(chatId, NOT_A_COORDINATOR_REPLY);
    return;
  }

  const text = (message?.text ?? "").trim();
  if (text === "/start") {
    await sendCoordinatorMessage(
      chatId,
      buildStartReply(coordinator.fullName, coordinator.regionName),
      { replyKeyboard: coordinatorKeyboard() },
    );
    return;
  }

  const menuKey = MENU_BY_LABEL[text];
  if (!menuKey) {
    await sendCoordinatorMessage(chatId, "Menyudan tanlang.", {
      replyKeyboard: coordinatorKeyboard(),
    });
    return;
  }

  await handleMenu(chatId, coordinator, menuKey);
}

/* -------------------------------- menyu ---------------------------------- */

const STATE_GROUPS: Record<string, readonly string[]> = {
  myClaimed: ["claimed"],
  inProgress: ["contacted", "qualified", "article_confirmed", "intake_pending", "intake_submitted"],
  waitingPayment: ["payment_requested", "payment_claimed", "payment_evidence"],
  mySales: ["payment_confirmed", "won"],
};

async function handleMenu(
  chatId: number,
  coordinator: CoordinatorIdentity,
  key: keyof typeof COORD_MENU,
): Promise<void> {
  const db = createSupabaseAdminClient();

  if (key === "newLeads") {
    // Hali band qilinmagan, shu koordinatorga taklif qilinganlar.
    const { data } = await db
      .from("lead_routing_events")
      .select("lead_id, created_at, coordinator_leads(full_name, state, claim_deadline)")
      .eq("coordinator_id", coordinator.id)
      .eq("event", "offered")
      .order("created_at", { ascending: false })
      .limit(10);

    const open = (data ?? []).filter((row) => {
      const lead = (row as unknown as Record<string, unknown>).coordinator_leads as
        | { state?: string }
        | null;
      return lead?.state === "offered";
    });

    if (open.length === 0) {
      await sendCoordinatorMessage(chatId, "Hozircha yangi lid yo‘q.", {
        replyKeyboard: coordinatorKeyboard(),
      });
      return;
    }

    const lines = ["🆕 YANGI LIDLAR", ""];
    for (const row of open) {
      const lead = (row as unknown as Record<string, unknown>).coordinator_leads as
        | { full_name?: string }
        | null;
      lines.push(`• ${lead?.full_name ?? "(ism yo‘q)"}`);
    }
    lines.push("", "Lidni band qilish uchun kelgan xabardagi tugmani bosing.");
    await sendCoordinatorMessage(chatId, lines.join("\n"), {
      replyKeyboard: coordinatorKeyboard(),
    });
    return;
  }

  if (key === "report") {
    await sendCoordinatorMessage(chatId, buildReportText(await buildReport(coordinator.id)), {
      replyKeyboard: coordinatorKeyboard(),
    });
    return;
  }

  if (key === "earnings") {
    const report = await buildReport(coordinator.id);
    await sendCoordinatorMessage(
      chatId,
      [
        "💰 DAROMADIM",
        "",
        `Bugun: ${formatSom(report.earnedToday)}`,
        `Shu hafta: ${formatSom(report.earnedWeek)}`,
        `Shu oy: ${formatSom(report.earnedMonth)}`,
        "",
        `Ishlab topilgan: ${formatSom(report.earnedAmount)}`,
        `To‘langan: ${formatSom(report.paidAmount)}`,
      ].join("\n"),
      { replyKeyboard: coordinatorKeyboard() },
    );
    return;
  }

  if (key === "leaderboard") {
    await sendCoordinatorMessage(chatId, await buildLeaderboard(), {
      replyKeyboard: coordinatorKeyboard(),
    });
    return;
  }

  if (key === "notifications") {
    await sendCoordinatorMessage(
      chatId,
      coordinator.status === "active"
        ? "🔔 Yangi lid kelganda shu yerga xabar yuboriladi."
        : COORDINATOR_PAUSED_REPLY,
      { replyKeyboard: coordinatorKeyboard() },
    );
    return;
  }

  // Qolganlari — holat bo'yicha ro'yxat.
  const states = STATE_GROUPS[key] ?? [];
  const { data } = await db
    .from("coordinator_leads")
    .select("full_name, state")
    .eq("assigned_coordinator_id", coordinator.id)
    .in("state", states)
    .order("updated_at", { ascending: false })
    .limit(20);

  const rows = data ?? [];
  const title = COORD_MENU[key];
  const body =
    rows.length === 0
      ? "Bu ro‘yxat hozircha bo‘sh."
      : rows.map((r) => `• ${r.full_name as string}`).join("\n");

  await sendCoordinatorMessage(chatId, `${title}\n\n${body}`, {
    replyKeyboard: coordinatorKeyboard(),
  });
}

/* ------------------------------- callback -------------------------------- */

async function handleCallback(
  query: NonNullable<CoordinatorUpdate["callback_query"]>,
): Promise<void> {
  const leadId = parseClaimCallback(query.data);
  if (!leadId) {
    await answerCoordinatorCallback(query.id);
    return;
  }

  const coordinator = await identify(query.from?.id ?? null);
  if (!coordinator) {
    await answerCoordinatorCallback(query.id, "Ruxsat yo‘q");
    return;
  }

  const outcome = await claimLead(leadId, coordinator.id);
  await answerCoordinatorCallback(
    query.id,
    outcome.claimed ? CLAIM_WON_REPLY : claimLostReply(outcome.reason),
  );

  const chatId = query.message?.chat?.id ?? null;
  const messageId = query.message?.message_id ?? null;
  if (chatId != null && messageId != null) {
    // Tugma OLIB TASHLANADI: qolib ketsa, hal bo'lgan savolga
    // ikkinchi marta bosiladi.
    await editCoordinatorMessage(
      chatId,
      messageId,
      outcome.claimed
        ? `${CLAIM_WON_REPLY}\n\nLid: ${leadId.slice(0, 8)}…`
        : claimLostReply(outcome.reason),
    );
  }

  if (outcome.claimed) {
    await logAudit({
      actorId: null,
      action: "coordinator.bot_claim",
      entityType: "coordinator_lead",
      entityId: leadId,
      metadata: { coordinatorId: coordinator.id },
    });
  }
}

/* -------------------------------- hisobot -------------------------------- */

export async function buildReport(coordinatorId: string): Promise<CoordinatorReport> {
  const db = createSupabaseAdminClient();
  const today = businessDate();
  const day = businessDayRange(today);

  const { data: offers } = await db
    .from("lead_routing_events")
    .select("id")
    .eq("coordinator_id", coordinatorId)
    .eq("event", "offered")
    .gte("created_at", day.startIso)
    .lt("created_at", day.endIso);

  const { data: leads } = await db
    .from("coordinator_leads")
    .select("state, offered_at, claimed_at")
    .eq("assigned_coordinator_id", coordinatorId)
    .gte("claimed_at", day.startIso)
    .lt("claimed_at", day.endIso);

  const rows = leads ?? [];
  const count = (states: readonly string[]) =>
    rows.filter((r) => states.includes(r.state as string)).length;

  // O'RTACHA BAND QILISH VAQTI — faqat ikkala vaqt ham bor bo'lsa.
  const durations = rows
    .map((r) => {
      const offered = r.offered_at ? Date.parse(r.offered_at as string) : NaN;
      const claimed = r.claimed_at ? Date.parse(r.claimed_at as string) : NaN;
      return Number.isFinite(offered) && Number.isFinite(claimed)
        ? (claimed - offered) / 1000
        : null;
    })
    .filter((v): v is number => v != null && v >= 0);

  const { data: commissions } = await db
    .from("coordinator_commissions")
    .select("amount_uzs, status, business_date")
    .eq("coordinator_id", coordinatorId);

  const sum = (filter: (row: Record<string, unknown>) => boolean) =>
    (commissions ?? [])
      .filter((row) => filter(row as unknown as Record<string, unknown>))
      .reduce((total, row) => total + ((row.amount_uzs as number) ?? 0), 0);

  const monthPrefix = today.slice(0, 7);
  const weekStart = new Date(Date.parse(`${today}T00:00:00Z`) - 6 * 86_400_000)
    .toISOString()
    .slice(0, 10);

  const active = (row: Record<string, unknown>) => row.status !== "reversed";

  const attention: string[] = [];
  const unclaimed = (offers?.length ?? 0) - rows.length;
  if (unclaimed > 0) attention.push(`${unclaimed} ta lid band qilinmagan`);
  const stale = count(["claimed"]);
  if (stale > 0) attention.push(`${stale} ta lid band qilingan, lekin bog‘lanilmagan`);

  return {
    offered: offers?.length ?? 0,
    claimed: rows.length,
    contacted: count(["contacted", "qualified"]),
    inProgress: count(STATE_GROUPS.inProgress),
    waitingPayment: count(STATE_GROUPS.waitingPayment),
    confirmedSales: count(["payment_confirmed", "won"]),
    lost: count(["lost", "cancelled"]),
    avgClaimSeconds:
      durations.length === 0
        ? null
        : durations.reduce((a, b) => a + b, 0) / durations.length,
    earnedToday: sum((r) => active(r) && r.business_date === today),
    earnedWeek: sum((r) => active(r) && (r.business_date as string) >= weekStart),
    earnedMonth: sum((r) => active(r) && (r.business_date as string).startsWith(monthPrefix)),
    pendingAmount: sum((r) => r.status === "pending"),
    earnedAmount: sum((r) => r.status === "earned"),
    paidAmount: sum((r) => r.status === "paid"),
    reversedAmount: sum((r) => r.status === "reversed"),
    attention,
  };
}

async function buildLeaderboard(): Promise<string> {
  const db = createSupabaseAdminClient();
  const today = businessDate();
  const { data } = await db
    .from("coordinator_commissions")
    .select("coordinator_id, coordinators(full_name)")
    .eq("business_date", today)
    .neq("status", "reversed");

  const counts = new Map<string, { name: string; sales: number }>();
  for (const row of data ?? []) {
    const raw = row as unknown as Record<string, unknown>;
    const id = raw.coordinator_id as string;
    const name = ((raw.coordinators as { full_name?: string } | null)?.full_name) ?? "—";
    const entry = counts.get(id) ?? { name, sales: 0 };
    entry.sales += 1;
    counts.set(id, entry);
  }

  if (counts.size === 0) return "🏆 REYTING\n\nBugun tasdiqlangan sotuv yo‘q.";

  const ranked = [...counts.values()].sort((a, b) => b.sales - a.sales).slice(0, 10);
  return [
    "🏆 REYTING — BUGUN",
    "",
    ...ranked.map((r, i) => `${i + 1}. ${r.name} — ${r.sales} ta sotuv`),
  ].join("\n");
}
