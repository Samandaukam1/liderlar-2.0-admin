import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  sendMemberMessage,
  editMemberMessage,
  answerMemberCallback,
} from "./bot-api.ts";
import {
  mainMenu,
  mehrMenu,
  notLinkedMessage,
  linkSuccessMessage,
  linkFailureMessage,
  pointsMessage,
  certificatesMessage,
  notAvailableYet,
  MEMBER_MENU_ACTIONS as A,
  CATEGORY_LABEL,
  type BotMessage,
  type PointsSummary,
  type CertificateSummary,
  type InlineButton,
} from "./messages.ts";
import { consumeTelegramLink, findProfileByTelegramId } from "@/lib/member/link-service";
import { CERTIFICATE_ROLE_LABEL } from "@/lib/mehr/certificate-code";
import { resolveAdminOrigin } from "./admin-origin.ts";
import { getSiteUrl } from "@/lib/site-url";

/**
 * A'zo botining marshrutlagichi.
 *
 * ASOSIY QOIDA: SHAXS — BOG'LANGAN PROFIL.
 *
 * Har bir javob `findProfileByTelegramId` dan boshlanadi.
 * Bog'lanmagan odamga ma'lumot ko'rsatilmaydi — hatto bo'sh
 * ro'yxat ham emas: "sizda ball yo'q" degan javobning o'zi
 * hisob mavjudligini tasdiqlab qo'yardi.
 */

interface TgUser {
  id: number;
  first_name?: string;
  username?: string;
}

export interface MemberUpdate {
  message?: {
    message_id: number;
    chat: { id: number };
    from?: TgUser;
    text?: string;
  };
  callback_query?: {
    id: string;
    from: TgUser;
    message?: { message_id: number; chat: { id: number } };
    data?: string;
  };
}

/**
 * Mini App manzili.
 *
 * Odatda uni alohida sozlash SHART EMAS: u admin panelning
 * o'z manzilidan kelib chiqadi. Alohida o'zgaruvchi faqat
 * Mini App boshqa domenga chiqarilgan holat uchun qoldirilgan.
 *
 * Manzil umuman topilmasa — null. Shunda bot tugmani
 * KO'RSATMAYDI: bosilganda hech nima qilmaydigan tugma
 * buzuq mahsulot belgisi.
 */
function miniAppUrl(): string | null {
  /*
   * Telegram web_app tugmasi FAQAT HTTPS manzilni qabul qiladi
   * va lokal manzilga umuman yeta olmaydi. Shu yerda
   * `NEXT_PUBLIC_ADMIN_URL` da dev sozlamasidan qolgan
   * `http://localhost:3001` turgan edi.
   *
   * Yaroqsiz manzil bilan tugma ko'rsatilsa, u bosilganda
   * Telegram xato berardi — buzuq tugma esa yo'q tugmadan
   * yomonroq. Shuning uchun yaroqsiz bo'lsa null.
   */
  const resolved = resolveAdminOrigin([
    { name: "MEMBER_MINI_APP_URL", value: process.env.MEMBER_MINI_APP_URL },
    { name: "NEXT_PUBLIC_ADMIN_URL", value: process.env.NEXT_PUBLIC_ADMIN_URL },
    { name: "VERCEL_PROJECT_PRODUCTION_URL", value: process.env.VERCEL_PROJECT_PRODUCTION_URL },
  ]);

  if (!resolved.ok) return null;

  return resolved.source === "MEMBER_MINI_APP_URL"
    ? resolved.origin + new URL(process.env.MEMBER_MINI_APP_URL!.trim()).pathname
    : new URL("/mehr-app", resolved.origin).toString();
}

function loginUrl(): string {
  return `${getSiteUrl()}/kabinet`;
}

function verifyUrl(code: string): string {
  return `${getSiteUrl()}/mehr365/sertifikat/${code}`;
}

export async function handleMemberUpdate(update: MemberUpdate): Promise<void> {
  if (update.callback_query) return handleCallback(update.callback_query);
  if (update.message) return handleMessage(update.message);
}

async function handleMessage(message: NonNullable<MemberUpdate["message"]>): Promise<void> {
  const from = message.from;
  if (!from) return;

  const chatId = message.chat.id;
  const text = (message.text ?? "").trim();

  /*
   * /start <token> — BOG'LASH.
   *
   * Token saytdagi autentifikatsiyalangan seansdan chiqadi.
   * Bot uni faqat ISHLATADI, yaratmaydi.
   */
  if (text.startsWith("/start")) {
    const param = text.slice("/start".length).trim();

    if (param) {
      const result = await consumeTelegramLink(param, from.id, from.username ?? null);
      const reply = result.ok
        ? linkSuccessMessage(result.displayName)
        : linkFailureMessage(result.reason);
      await sendMemberMessage(chatId, reply.text, reply.buttons);
      return;
    }

    const profileId = await findProfileByTelegramId(from.id);
    if (!profileId) {
      const msg = notLinkedMessage(loginUrl());
      await sendMemberMessage(chatId, msg.text, msg.buttons);
      return;
    }

    const menu = mainMenu(await displayName(profileId));
    await sendMemberMessage(chatId, menu.text, menu.buttons);
    return;
  }

  // Boshqa har qanday matn — menyuga qaytaradi.
  const profileId = await findProfileByTelegramId(from.id);
  if (!profileId) {
    const msg = notLinkedMessage(loginUrl());
    await sendMemberMessage(chatId, msg.text, msg.buttons);
    return;
  }

  const menu = mainMenu(await displayName(profileId));
  await sendMemberMessage(chatId, menu.text, menu.buttons);
}

async function handleCallback(
  query: NonNullable<MemberUpdate["callback_query"]>,
): Promise<void> {
  /*
   * Telegram callback javobini 10 soniya ichida kutadi, aks
   * holda tugma "osilib qoladi". Shuning uchun javob EN AVVAL
   * beriladi — baza so'rovidan oldin.
   */
  await answerMemberCallback(query.id);

  const chatId = query.message?.chat.id;
  const messageId = query.message?.message_id;
  if (!chatId || !messageId) return;

  const profileId = await findProfileByTelegramId(query.from.id);
  if (!profileId) {
    const msg = notLinkedMessage(loginUrl());
    await editMemberMessage(chatId, messageId, msg.text, msg.buttons);
    return;
  }

  const reply = await buildReply(query.data ?? "", profileId);
  await editMemberMessage(chatId, messageId, reply.text, reply.buttons);
}

async function buildReply(action: string, profileId: string): Promise<BotMessage> {
  switch (action) {
    case A.home:
      return mainMenu(await displayName(profileId));

    case A.mehr:
      return mehrMenu(miniAppUrl());

    case A.points:
      return pointsMessage(await loadPoints(profileId));

    case A.certificates:
      return certificatesMessage(await loadCertificates(profileId));

    case A.profile:
      return profileMessage(profileId);

    /*
     * HALI TAYYOR EMAS — OCHIQ AYTILADI.
     *
     * Soxta raqam yoki bo'sh ro'yxat ko'rsatish odamni
     * ishontirib, keyin aldaydi.
     */
    case A.rank:
    case A.mehrRank:
      return notAvailableYet("Reyting");
    case A.referral:
      return notAvailableYet("Referral");
    case A.support:
      return notAvailableYet("Murojaatlar");
    case A.security:
      return notAvailableYet("Xavfsizlik");
    case A.mehrActivities:
      return notAvailableYet("Ezgulik ishlari ro'yxati");
    case A.mehrMine:
      return myActivitiesMessage(profileId);

    default:
      return mainMenu(await displayName(profileId));
  }
}

async function displayName(profileId: string): Promise<string | null> {
  const db = createSupabaseAdminClient();
  const { data } = await db.from("profiles").select("full_name").eq("id", profileId).maybeSingle();
  return (data?.full_name as string | null)?.trim() || null;
}

async function profileMessage(profileId: string): Promise<BotMessage> {
  const db = createSupabaseAdminClient();

  const [{ data: profile }, { data: candidate }] = await Promise.all([
    db.from("profiles").select("full_name").eq("id", profileId).maybeSingle(),
    db
      .from("candidates")
      .select("slug, status, regions(name)")
      .eq("user_id", profileId)
      .is("deleted_at", null)
      .maybeSingle(),
  ]);

  const lines = [`👤 <b>Profilim</b>\n`, `Ism: <b>${profile?.full_name ?? "—"}</b>`];

  const region = (candidate?.regions as { name?: string } | null)?.name;
  if (region) lines.push(`Hudud: ${region}`);

  const buttons: InlineButton[][] = [[{ text: "🏠 Asosiy menyu", callback_data: A.home }]];

  if (candidate?.status === "published" && candidate.slug) {
    lines.push(`\nEnsiklopediyadagi profilingiz tayyor.`);
    buttons.unshift([
      { text: "🔗 Profilimni ochish", url: `${getSiteUrl()}/liderlar/${candidate.slug}` },
    ]);
  } else if (candidate) {
    lines.push(`\nEnsiklopediya profili hali nashr qilinmagan.`);
  }

  return { text: lines.join("\n"), buttons };
}

async function loadPoints(profileId: string): Promise<PointsSummary> {
  const db = createSupabaseAdminClient();

  const [{ data: aggregates }, { data: recent }] = await Promise.all([
    db
      .from("point_aggregates")
      .select("category, total_points")
      .eq("profile_id", profileId)
      .eq("period", "all")
      .eq("period_key", "all"),
    db
      .from("point_ledger")
      .select("points, category, created_at, note")
      .eq("profile_id", profileId)
      .order("created_at", { ascending: false })
      .limit(5),
  ]);

  const rows = (aggregates ?? []) as { category: string; total_points: number }[];
  const total = Number(rows.find((r) => r.category === "total")?.total_points ?? 0);

  return {
    total,
    byCategory: rows
      .filter((r) => r.category !== "total" && Number(r.total_points) !== 0)
      .map((r) => ({
        label: CATEGORY_LABEL[r.category] ?? r.category,
        points: Number(r.total_points),
      })),
    recent: ((recent ?? []) as { points: number; category: string; created_at: string; note: string | null }[]).map(
      (r) => ({
        label: r.note?.trim() || CATEGORY_LABEL[r.category] || r.category,
        points: Number(r.points),
        date: new Date(r.created_at).toLocaleDateString("uz-UZ"),
      }),
    ),
  };
}

async function loadCertificates(profileId: string): Promise<CertificateSummary[]> {
  const db = createSupabaseAdminClient();

  const { data } = await db
    .from("certificates")
    .select("code, role, status, issued_at, mehr_activities(title)")
    .eq("recipient_profile_id", profileId)
    .order("issued_at", { ascending: false })
    .limit(10);

  return ((data ?? []) as unknown as {
    code: string;
    role: string | null;
    status: string;
    issued_at: string;
    mehr_activities: { title?: string } | null;
  }[]).map((r) => ({
    activityTitle: r.mehr_activities?.title ?? "Ezgulik ishi",
    roleLabel:
      CERTIFICATE_ROLE_LABEL[r.role as keyof typeof CERTIFICATE_ROLE_LABEL] ?? "Ishtirokchi",
    issuedDate: new Date(r.issued_at).toLocaleDateString("uz-UZ"),
    code: r.code,
    revoked: r.status === "revoked",
    verifyUrl: verifyUrl(r.code),
  }));
}

async function myActivitiesMessage(profileId: string): Promise<BotMessage> {
  const db = createSupabaseAdminClient();

  const { data } = await db
    .from("mehr_participants")
    .select("role, mehr_activities(title, status)")
    .eq("profile_id", profileId)
    .order("created_at", { ascending: false })
    .limit(10);

  const rows = (data ?? []) as unknown as {
    role: string;
    mehr_activities: { title?: string; status?: string } | null;
  }[];

  if (rows.length === 0) {
    return {
      text:
        "📊 <b>Faoliyatim</b>\n\n" +
        "Hozircha ezgulik ishi yo'q.\n\n" +
        "Tadbirda qatnashing yoki o'zingiz tashkil qiling.",
      buttons: [
        [{ text: "❤️ MEHR 365+", callback_data: A.mehr }],
        [{ text: "🏠 Asosiy menyu", callback_data: A.home }],
      ],
    };
  }

  const STATUS_LABEL: Record<string, string> = {
    draft: "⏳ qoralama",
    submitted: "🔍 tekshiruvda",
    changes_requested: "✏️ tuzatish so'ralgan",
    approved: "✅ tasdiqlangan",
    rejected: "❌ rad etilgan",
  };

  const lines = ["📊 <b>Faoliyatim</b>\n"];
  for (const r of rows) {
    const role = CERTIFICATE_ROLE_LABEL[r.role as keyof typeof CERTIFICATE_ROLE_LABEL] ?? r.role;
    lines.push(
      `• <b>${r.mehr_activities?.title ?? "—"}</b>\n  ${role} · ${
        STATUS_LABEL[r.mehr_activities?.status ?? ""] ?? r.mehr_activities?.status ?? "—"
      }`,
    );
  }

  return {
    text: lines.join("\n"),
    buttons: [[{ text: "🏠 Asosiy menyu", callback_data: A.home }]],
  };
}
