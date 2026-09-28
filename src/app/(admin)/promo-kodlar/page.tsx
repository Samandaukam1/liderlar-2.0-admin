import { requirePermission } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { PageHeader } from "@/components/admin/page-header";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { PromoManager, type PromoCodeRow } from "./promo-manager";

export const metadata = { title: "Promo kodlar" };
export const dynamic = "force-dynamic";

/**
 * PROMO KODLARNI NAZORAT QILISH.
 *
 * Bu bo'lim AMAL QILISH haqida: kod ro'yxatga olinadi va uning
 * muddatini tugatish mumkin. Muddati tugagan kodni nomzod arizada
 * yozsa, forma uni qabul qilmaydi va sababini aytadi.
 *
 * LID MARSHRUTI BU YERDA EMAS. Koordinatorning kodi
 * `/koordinatorlar` bo'limida turadi va u "bu nomzod kimning
 * odami" degan boshqa savolga javob beradi. Ikkalasini bir joyga
 * qo'shish koordinatorning kodini muddati tugagani uchun
 * o'chirishga majbur qilardi.
 */
/**
 * Kodlarni yuklaydi va "muddati tugaganmi" ni SERVERDA hisoblaydi.
 *
 * KOMPONENTDAN TASHQARIDA, ataylab. Soatni render ichida o'qish
 * React qoidasini buzadi (`react-hooks/purity`) — va bu shunchaki
 * lint injiqligi emas: render toza bo'lishi kerak. Bu yerda esa
 * soat bir marta, ma'lumot yuklashda o'qiladi.
 *
 * Brauzerda hisoblanmasligi ham muhim: soati noto'g'ri qo'yilgan
 * kompyuter kodni boshqacha ko'rsatardi va panel ariza formasiga
 * zid javob berardi.
 */
async function loadPromoRows(): Promise<PromoCodeRow[]> {
  const db = createSupabaseAdminClient();
  const { data } = await db
    .from("promo_codes")
    .select("id, code, raw_code, label, notes, expires_at, created_at")
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(500);

  const now = Date.now();
  return (data ?? []).map((row) => {
    const expiresAt = (row.expires_at as string | null) ?? null;
    return {
      id: row.id as string,
      code: row.code as string,
      rawCode: (row.raw_code as string) ?? (row.code as string),
      label: (row.label as string | null) ?? null,
      notes: (row.notes as string | null) ?? null,
      expiresAt,
      createdAt: row.created_at as string,
      expired: expiresAt != null && new Date(expiresAt).getTime() <= now,
    };
  });
}

export default async function PromoCodesPage() {
  const ctx = await requirePermission("coordinators.view");
  const canManage = hasPermission(ctx.roles, "coordinators.manage");

  const rows = await loadPromoRows();
  const expiredCount = rows.filter((row) => row.expired).length;

  return (
    <div>
      <PageHeader
        title="Promo kodlar"
        description="Kodlarni ro‘yxatga olish va amal qilish muddatini tugatish"
        breadcrumbs={[{ label: "Promo kodlar" }]}
      />

      <p className="mb-4 rounded-card border border-line bg-surface px-4 py-3 text-xs leading-relaxed text-ink-soft">
        Muddati tugagan kodni nomzod arizada yozsa, forma uni{" "}
        <b>qabul qilmaydi</b> va «Bu promo kod amal qilish muddati tugagan» deb
        yozadi. Tekshirish <b>saxiy</b>: kirillcha yozuv, bo‘shliq va tire,
        chalkashadigan belgilar (0/O, 1/I) hamda takrorlangan bo‘g‘in
        («TSULTAVSIYA» → «TSULTAVSIYASIYA») ham o‘sha kod deb qaraladi.
        Ro‘yxatda bo‘lmagan kod esa to‘silmaydi.
      </p>

      <p className="mb-4 flex flex-wrap items-center gap-2 text-xs text-ink-soft">
        <span className="rounded-full bg-surface px-2.5 py-1 font-bold text-ink">
          Amal qiladi: {rows.length - expiredCount}
        </span>
        <span className="rounded-full bg-surface px-2.5 py-1">
          Muddati tugagan: {expiredCount}
        </span>
      </p>

      <PromoManager rows={rows} canManage={canManage} />
    </div>
  );
}
