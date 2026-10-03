import { requirePermission } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { PageHeader } from "@/components/admin/page-header";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { VipManager, type FlagRow, type VipRow } from "./vip-manager";

export const metadata = { title: "VIP obunalar" };
export const dynamic = "force-dynamic";

/**
 * LIDERLAR VIP — OBUNALARNI NAZORAT QILISH.
 *
 * Bu bo'lim TIJORIY qatlam: kim to'lagan, qachongacha, qaysi huquqlar
 * ochilgan. Reyting bu yerda YO'Q — §70 bo'yicha pul va xizmat
 * ko'rsatkichi aralashtirilmaydi: "VIP sotib olish o'zi ball bermaydi".
 */

/**
 * Obunalarni yuklaydi va "muddati o'tganmi" ni SERVERDA hisoblaydi.
 *
 * KOMPONENTDAN TASHQARIDA: soatni render ichida o'qish React
 * qoidasini buzadi. Brauzerda hisoblanmasligi ham muhim — soati
 * noto'g'ri qo'yilgan kompyuter huquq holatini boshqacha ko'rsatardi
 * va panel serverga zid javob berardi.
 */
async function loadVipRows(): Promise<{ rows: VipRow[]; failed: boolean }> {
  const db = createSupabaseAdminClient();

  const { data, error } = await db
    .from("vip_subscriptions")
    .select(
      "id, profile_id, plan_code, state, started_at, current_period_end, grace_until, created_at, profiles(full_name, username)",
    )
    .order("created_at", { ascending: false })
    .limit(500);

  /*
   * XATO "OBUNA YO'Q" EMAS.
   *
   * Avval xato jim bo'sh ro'yxatga aylanardi va panel "Faol: 0"
   * ko'rsatardi — admin obunalar yo'qolgan deb o'ylashi mumkin edi.
   */
  if (error) {
    console.error("[vip] obunalar o'qilmadi:", error.message);
    return { rows: [], failed: true };
  }

  const now = Date.now();

  const rows = (data ?? []).map((row) => {
    const periodEnd = (row.current_period_end as string | null) ?? null;
    const graceUntil = (row.grace_until as string | null) ?? null;
    const profile = row.profiles as { full_name?: string; username?: string } | null;

    /*
     * HUQUQ BERYAPTIMI — holat VA sana bo'yicha.
     *
     * Aynan `entitlements.ts` dagi qoida. Takrorlanishi xunuk, lekin
     * admin repo web repodan import qila olmaydi (ikki alohida
     * deploy). Shu sababli bu yerda faqat KO'RSATISH uchun hisob:
     * haqiqiy to'siq har doim server tomonda.
     */
    const until = graceUntil ?? periodEnd;
    const state = row.state as VipRow["state"];
    const granting =
      (state === "active" || state === "grace_period") &&
      (until === null || now <= new Date(until).getTime());

    return {
      id: row.id as string,
      profileId: row.profile_id as string,
      fullName: profile?.full_name?.trim() || "(ism yo'q)",
      username: profile?.username ?? null,
      planCode: row.plan_code as string,
      state,
      startedAt: (row.started_at as string | null) ?? null,
      currentPeriodEnd: periodEnd,
      graceUntil,
      granting,
      /*
       * Fon vazifasi kechikkanini ko'rsatish uchun: holat hali
       * `active`, lekin sana o'tgan. Admin buni ko'rishi kerak —
       * aks holda "nega huquq ishlamayapti" degan savol javobsiz
       * qolardi.
       */
      stale:
        (state === "active" || state === "grace_period") &&
        until !== null &&
        now > new Date(until).getTime(),
    };
  });

  return { rows, failed: false };
}

async function loadFlags(): Promise<{ flags: FlagRow[]; failed: boolean }> {
  const db = createSupabaseAdminClient();
  const { data, error } = await db
    .from("feature_flags")
    .select("key, is_enabled, description")
    .order("key", { ascending: true });

  if (error) {
    console.error("[vip] flaglar o'qilmadi:", error.message);
    return { flags: [], failed: true };
  }

  return {
    flags: (data ?? []).map((row) => ({
      key: row.key as string,
      enabled: row.is_enabled === true,
      description: (row.description as string | null) ?? null,
    })),
    failed: false,
  };
}

export default async function VipPage() {
  const ctx = await requirePermission("vip.view");
  const canManage = hasPermission(ctx.roles, "vip.manage");
  // Flaglarni yoqish boshqa mas'uliyat: butun tizim chiqarish holati.
  const canManageFlags = hasPermission(ctx.roles, "settings.manage");

  const [vip, flagState] = await Promise.all([loadVipRows(), loadFlags()]);
  const { rows } = vip;
  const { flags } = flagState;

  const counts = {
    active: rows.filter((r) => r.state === "active").length,
    grace: rows.filter((r) => r.state === "grace_period").length,
    pending: rows.filter((r) => r.state === "pending").length,
    suspended: rows.filter((r) => r.state === "suspended").length,
    expired: rows.filter((r) => r.state === "expired").length,
    cancelled: rows.filter((r) => r.state === "cancelled").length,
  };

  const vipOn = flags.find((f) => f.key === "vip.enabled")?.enabled === true;

  return (
    <div>
      <PageHeader
        title="Liderlar VIP"
        description="Obunalar, huquqlar va chiqarish flaglari"
        breadcrumbs={[{ label: "Liderlar VIP" }]}
      />

      {(vip.failed || flagState.failed) && (
        <p role="alert" className="mb-4 rounded-card border border-coral/40 bg-coral/5 px-4 py-3 text-xs leading-relaxed text-ink">
          <b>Ma’lumotni to‘liq o‘qib bo‘lmadi.</b>{" "}
          {vip.failed ? "Obunalar ro‘yxati va sonlar ko‘rsatilmayapti. " : ""}
          {flagState.failed ? "Flaglar holati noma’lum — ularni hozir o‘zgartirmang. " : ""}
          Sahifani yangilang; takrorlansa, server logidagi “[vip]” yozuvini tekshiring.
        </p>
      )}

      {/* Flaglar o'qilmagan bo'lsa "o'chirilgan" deyilmaydi — bu yolg'on bo'lardi. */}
      {!flagState.failed && !vipOn && (
        <p className="mb-4 rounded-card border border-amber-300 bg-amber-50 px-4 py-3 text-xs leading-relaxed text-amber-900">
          <b>VIP tizimi o‘chirilgan.</b> <code>vip.enabled</code> flagi yoqilmaguncha
          obunalar huquq <b>bermaydi</b> — faol obuna ham. Bu ataylab: nosozlik
          chiqsa, bitta flag bilan hammasi to‘xtatiladi.
        </p>
      )}

      <p className="mb-4 flex flex-wrap items-center gap-2 text-xs text-ink-soft">
        <span className="rounded-full bg-surface px-2.5 py-1 font-bold text-ink">
          Faol: {counts.active}
        </span>
        <span className="rounded-full bg-surface px-2.5 py-1">
          Imtiyoz muddatida: {counts.grace}
        </span>
        <span className="rounded-full bg-surface px-2.5 py-1">
          To‘lov kutilyapti: {counts.pending}
        </span>
        <span className="rounded-full bg-surface px-2.5 py-1">
          To‘xtatilgan: {counts.suspended}
        </span>
        <span className="rounded-full bg-surface px-2.5 py-1">
          Tugagan: {counts.expired}
        </span>
        <span className="rounded-full bg-surface px-2.5 py-1">
          Bekor qilingan: {counts.cancelled}
        </span>
      </p>

      <VipManager
        rows={rows}
        flags={flags}
        canManage={canManage}
        canManageFlags={canManageFlags}
      />
    </div>
  );
}
