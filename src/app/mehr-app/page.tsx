import { MehrMiniApp } from "./mini-app";
import { getMehrFlags } from "@/lib/mehr/flags";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * MEHR Mini App kirish nuqtasi.
 *
 * Serverda FAQAT ochiq ma'lumot tayyorlanadi: bayroqlar,
 * kategoriyalar va hududlar. Shaxsga oid hech nima bu yerda
 * yuklanmaydi — kim ekanini faqat mijoz yuboradigan Telegram
 * imzosi aytadi va u har API so'rovida qayta tekshiriladi.
 */
export default async function MehrAppPage() {
  const flags = await getMehrFlags();
  const db = createSupabaseAdminClient();

  const [categories, regions] = await Promise.all([
    db.from("mehr_categories").select("id, name").eq("is_active", true).order("sort_order"),
    db.from("regions").select("id, name").order("sort_order"),
  ]);

  return (
    <MehrMiniApp
      enabled={flags.activityCreationEnabled}
      checkinEnabled={flags.qrCheckinEnabled}
      categories={(categories.data ?? []) as { id: string; name: string }[]}
      regions={(regions.data ?? []) as { id: string; name: string }[]}
    />
  );
}
