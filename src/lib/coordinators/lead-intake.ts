import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { offerLead } from "./routing-service.ts";
import { getCoordinatorSettings } from "./settings.ts";
import {
  buildLeadNotification,
  claimCallbackData,
  CLAIM_BUTTON_LABEL,
} from "./bot-messages.ts";
import { sendCoordinatorMessage, isCoordinatorBotConfigured } from "./bot-api.ts";

/**
 * ARIZA -> KOORDINATOR LIDI.
 *
 * YANGI ARIZA TIZIMI YARATILMAYDI. Mavjud `applications` jadvali
 * manba bo'lib qoladi; bu yerda undan koordinator navbati uchun
 * yozuv hosil qilinadi.
 *
 * HUDUD ARIZADAN OLINADI va `lead_region_id` ga yoziladi. U keyin
 * HECH QACHON o'zgarmaydi: overflow boshqa hudud koordinatoriga
 * bersa ham, lid qayerdan kelgani o'sha-o'sha qoladi.
 */

export interface CreateLeadResult {
  ok: boolean;
  leadId: string | null;
  /** Nima bo'lgani — chaqiruvchi log yozishi uchun. */
  reason: "created" | "duplicate" | "no_region" | "error";
  offered: boolean;
}

/**
 * Arizadan lid yaratadi va (marshrutlash yoqiq bo'lsa) taklif qiladi.
 *
 * TAKRORLANMASLIK BAZA DARAJASIDA: `uq_lead_application` unikal
 * indeksi bitta arizaga bitta lid kafolatlaydi. "Avval tekshirib,
 * keyin yozish" ikki parallel chaqiruvda ikkalasiga ham "yo'q ekan"
 * deb ko'rinardi va bitta mijoz ikki koordinatorga ketardi.
 */
export async function createLeadFromApplication(
  applicationId: string,
): Promise<CreateLeadResult> {
  const db = createSupabaseAdminClient();

  const { data: application } = await db
    .from("applications")
    .select("id, full_name, region_id, created_at")
    .eq("id", applicationId)
    .maybeSingle();

  if (!application) return { ok: false, leadId: null, reason: "error", offered: false };

  /*
   * HUDUDSIZ LID YARATILMAYDI.
   *
   * Hududiy marshrutlashning butun ma'nosi hududda. Uni "noma'lum"
   * bilan yaratsak, lid darhol overflow'ga tushib, tasodifiy
   * koordinatorga ketardi va hududiy statistika buzilardi.
   *
   * Ariza formasida hudud MAJBURIY, ya'ni bu holat faqat eski
   * yozuvlarda uchraydi.
   */
  if (!application.region_id) {
    return { ok: false, leadId: null, reason: "no_region", offered: false };
  }

  const { data: created, error } = await db
    .from("coordinator_leads")
    .insert({
      application_id: application.id,
      full_name: application.full_name as string,
      lead_region_id: application.region_id as string,
      state: "new",
    })
    .select("id")
    .maybeSingle();

  if (error) {
    // Unikal indeks buzilishi — lid allaqachon bor. Bu xato emas.
    const duplicate = error.code === "23505";
    return {
      ok: duplicate,
      leadId: null,
      reason: duplicate ? "duplicate" : "error",
      offered: false,
    };
  }

  const leadId = created?.id as string | undefined;
  if (!leadId) return { ok: false, leadId: null, reason: "error", offered: false };

  await db.from("lead_routing_events").insert([
    { lead_id: leadId, event: "created", to_state: "new" },
    {
      lead_id: leadId,
      event: "region_resolved",
      metadata: { source: "application", regionId: application.region_id },
    },
  ]);

  await logAudit({
    actorId: null,
    action: "coordinator.lead_created",
    entityType: "coordinator_lead",
    entityId: leadId,
    metadata: { applicationId, regionId: application.region_id },
  });

  const offered = await offerAndNotify(leadId);
  return { ok: true, leadId, reason: "created", offered };
}

/**
 * Lidni taklif qiladi va koordinatorga xabar yuboradi.
 *
 * MARSHRUTLASH O'CHIQ BO'LSA lid SAQLANADI, lekin xabar
 * ketmaydi — u navbatda turadi va yoqilgach yuboriladi.
 */
export async function offerAndNotify(leadId: string): Promise<boolean> {
  const result = await offerLead(leadId);
  if (!result.ok || !result.coordinatorId) return false;

  if (!isCoordinatorBotConfigured()) {
    console.warn("[coordinator] bot sozlanmagan — xabar yuborilmadi");
    return false;
  }

  const db = createSupabaseAdminClient();
  const [{ data: coordinator }, { data: lead }, settings] = await Promise.all([
    db
      .from("coordinators")
      .select("telegram_user_id")
      .eq("id", result.coordinatorId)
      .maybeSingle(),
    db
      .from("coordinator_leads")
      .select("full_name, created_at, regions:lead_region_id(name)")
      .eq("id", leadId)
      .maybeSingle(),
    getCoordinatorSettings(),
  ]);

  const chatId = coordinator?.telegram_user_id as number | null;
  if (chatId == null) {
    // Koordinator botga ulanmagan — buni ko'rish uchun yoziladi.
    await db.from("lead_routing_events").insert({
      lead_id: leadId,
      event: "offered",
      coordinator_id: result.coordinatorId,
      metadata: { delivered: false, reason: "no_telegram_id" },
    });
    return false;
  }

  const row = lead as unknown as Record<string, unknown> | null;
  const text = buildLeadNotification({
    fullName: (row?.full_name as string) ?? "",
    regionName: ((row?.regions as { name?: string } | null)?.name) ?? null,
    appliedAt: (row?.created_at as string | null) ?? null,
    claimWindowMinutes: settings.claimWindowMinutes,
  });

  const sent = await sendCoordinatorMessage(chatId, text, {
    inlineKeyboard: [[{ text: CLAIM_BUTTON_LABEL, callback_data: claimCallbackData(leadId) }]],
  });

  if (!sent.ok) {
    console.error("[coordinator] xabar yuborilmadi:", sent.error);
  }
  return sent.ok;
}

/**
 * Marshrutlash yoqilganda kutib qolgan lidlarni yuboradi.
 *
 * O'CHIQ paytda kelgan lidlar YO'QOLMAYDI — ular `new` holatida
 * turadi va shu yerda navbatga qo'shiladi.
 */
export async function offerPendingLeads(limit = 25): Promise<number> {
  const settings = await getCoordinatorSettings();
  if (!settings.routingEnabled) return 0;

  const db = createSupabaseAdminClient();
  const { data } = await db
    .from("coordinator_leads")
    .select("id")
    .eq("state", "new")
    .is("assigned_coordinator_id", null)
    .order("created_at", { ascending: true })
    .limit(limit);

  let offered = 0;
  for (const row of data ?? []) {
    if (await offerAndNotify(row.id as string)) offered += 1;
  }
  return offered;
}

/* ------------------------ arizalarni qabul qilish ------------------------ */

export const LEAD_INTAKE_SINCE_KEY = "coordinator.lead_intake_since";

/**
 * Qaysi paytdan keyingi arizalar koordinator navbatiga tushadi.
 *
 * NEGA CHEGARA KERAK: bazada minglab eski ariza bor. Chegarasiz
 * birinchi yugurish ularning hammasini navbatga qo'yardi va
 * koordinatorlarga yillar oldingi murojaatlar yog'ilardi.
 *
 * Qiymat marshrutlash BIRINCHI MARTA yoqilganda yoziladi. Ya'ni
 * "yangi tizim shu paytdan boshlab ishlaydi" degani.
 */
export async function getLeadIntakeSince(): Promise<string | null> {
  const db = createSupabaseAdminClient();
  const { data } = await db
    .from("site_settings")
    .select("value")
    .eq("key", LEAD_INTAKE_SINCE_KEY)
    .maybeSingle();
  const raw = (data?.value as string | null)?.trim();
  return raw && Number.isFinite(Date.parse(raw)) ? raw : null;
}

export async function ensureLeadIntakeSince(now: Date = new Date()): Promise<string> {
  const existing = await getLeadIntakeSince();
  if (existing) return existing;

  const value = now.toISOString();
  const db = createSupabaseAdminClient();
  await db
    .from("site_settings")
    .upsert({ key: LEAD_INTAKE_SINCE_KEY, value }, { onConflict: "key" });
  return value;
}

export interface IngestResult {
  scanned: number;
  created: number;
  skippedNoRegion: number;
  duplicates: number;
}

/**
 * Yangi arizalardan lid yasaydi.
 *
 * MANBA — BAZA, Telegram emas. Ariza ommaviy saytdan kiritiladi va
 * admin uning insert'iga ulana olmaydi; shuning uchun cron bazadan
 * o'qiydi. Bu ikki ilova orasida sekret almashishdan ishonchliroq:
 * ariza qaysi yo'l bilan kelmasin, u ko'rinadi.
 */
export async function ingestNewApplications(limit = 25): Promise<IngestResult> {
  const result: IngestResult = { scanned: 0, created: 0, skippedNoRegion: 0, duplicates: 0 };

  const settings = await getCoordinatorSettings();
  if (!settings.routingEnabled) return result;

  const since = await getLeadIntakeSince();
  // Chegara yozilmagan bo'lsa hech narsa qilinmaydi: eski
  // arizalarni tasodifan navbatga qo'yishdan ko'ra kutish yaxshi.
  if (!since) return result;

  const db = createSupabaseAdminClient();
  const { data: applications } = await db
    .from("applications")
    .select("id, region_id")
    .gte("created_at", since)
    .order("created_at", { ascending: true })
    .limit(limit * 4);

  if (!applications || applications.length === 0) return result;

  // Allaqachon lidga aylanganlarini chiqaramiz.
  const ids = applications.map((a) => a.id as string);
  const { data: existing } = await db
    .from("coordinator_leads")
    .select("application_id")
    .in("application_id", ids);
  const done = new Set((existing ?? []).map((r) => r.application_id as string));

  for (const application of applications) {
    if (result.created >= limit) break;
    const id = application.id as string;
    if (done.has(id)) continue;

    result.scanned += 1;
    const created = await createLeadFromApplication(id);
    if (created.reason === "created") result.created += 1;
    else if (created.reason === "duplicate") result.duplicates += 1;
    else if (created.reason === "no_region") result.skippedNoRegion += 1;
  }

  return result;
}
