import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { PageHeader } from "@/components/admin/page-header";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getTelegramSettings } from "@/lib/post-studio/telegram";
import { BotAccessManager, type BotAccessRowView } from "./bot-access-manager";

export const metadata = { title: "Botlar boshqaruvi" };
export const dynamic = "force-dynamic";

/**
 * BOTLAR BOSHQARUVI.
 *
 * Kim qaysi botning qaysi funksiyasidan foydalanadi — `bot_access`
 * jadvali. Bot kodi har tugma bosilganda shu jadvalni qayta o'qiydi,
 * ya'ni o'zgarish darhol kuchga kiradi (deploy ham, migratsiya ham
 * kerak emas).
 */
export default async function BotAccessPage() {
  await requirePermission("settings.manage");
  const db = createSupabaseAdminClient();

  const [{ data, error }, settings, coordinators] = await Promise.all([
    db
      .from("bot_access")
      .select("id, telegram_id, display_name, note, permissions, is_active, own_only, updated_at")
      .order("is_active", { ascending: false })
      .order("display_name", { ascending: true }),
    getTelegramSettings().catch(() => null),
    db.from("coordinators").select("id", { count: "exact", head: true }).not("telegram_user_id", "is", null),
  ]);

  const rows: BotAccessRowView[] = (data ?? []).map((row) => ({
    id: row.id as string,
    telegramId: String(row.telegram_id),
    displayName: row.display_name as string,
    note: (row.note as string | null) ?? "",
    permissions: (row.permissions as string[] | null) ?? [],
    isActive: row.is_active as boolean,
    ownOnly: Boolean(row.own_only),
    updatedAt: row.updated_at as string,
  }));

  return (
    <>
      <PageHeader
        title="Botlar boshqaruvi"
        description="Telegram ID bo‘yicha kim qaysi botning qaysi funksiyasidan foydalanishini belgilang. O‘zgarish darhol kuchga kiradi."
        breadcrumbs={[{ label: "Botlar boshqaruvi" }]}
      />

      {error ? (
        <p className="mb-4 rounded-card border border-coral/50 bg-coral/10 px-4 py-3 text-sm text-ink">
          Ro‘yxat o‘qilmadi: {error.message}. Migratsiya (<code>20261005120000_bot_access.sql</code>) qo‘llanganini tekshiring.
        </p>
      ) : null}

      <BotAccessManager rows={rows} studioUsername={settings?.username ?? null} />

      <section className="mt-8 grid gap-4 md:grid-cols-2">
        <div className="rounded-card border border-line bg-card p-5 shadow-card">
          <h2 className="text-sm font-bold text-ink">Koordinator boti</h2>
          <p className="mt-1 text-sm leading-relaxed text-ink-soft">
            Har koordinator Telegram’ini o‘zi ulaydi va bot faqat o‘z hududidagi arizalarni ko‘rsatadi. Hozir{" "}
            <strong className="text-ink">{coordinators.count ?? 0}</strong> ta koordinator ulangan.
          </p>
          <Link href="/koordinatorlar" className="mt-3 inline-block text-sm font-bold text-brand hover:underline">
            Koordinatorlar sahifasida boshqarish →
          </Link>
        </div>
        <div className="rounded-card border border-line bg-card p-5 shadow-card">
          <h2 className="text-sm font-bold text-ink">A’zolar boti (MEHR 365+)</h2>
          <p className="mt-1 text-sm leading-relaxed text-ink-soft">
            A’zolar botga o‘z akkauntini kabinetdagi havola orqali o‘zlari ulaydi — bu yerda ruxsat berish shart emas.
            Bog‘langan akkauntlar foydalanuvchilar ro‘yxatida ko‘rinadi.
          </p>
          <Link href="/foydalanuvchilar" className="mt-3 inline-block text-sm font-bold text-brand hover:underline">
            Foydalanuvchi akkauntlari →
          </Link>
        </div>
      </section>
    </>
  );
}
