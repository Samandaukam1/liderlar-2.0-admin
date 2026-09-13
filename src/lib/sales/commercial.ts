import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { parseCommercial, EMPTY_COMMERCIAL, type CommercialFacts } from "./commercial-facts.ts";

/**
 * Tijoriy faktlarni bazadan o'qish.
 *
 * Qoidalar SOF modulda (`commercial-facts.ts`) — bu yerda faqat I/O.
 */
export async function getCommercialFacts(): Promise<CommercialFacts> {
  try {
    const db = createSupabaseAdminClient();
    const { data } = await db
      .from("sales_settings")
      .select("value")
      .eq("key", "commercial")
      .maybeSingle();
    return parseCommercial(data?.value);
  } catch {
    // Baza yetib bo'lmasa narx TAXMIN QILINMAYDI.
    return EMPTY_COMMERCIAL;
  }
}

export {
  buildCommercialBlock,
  EMPTY_COMMERCIAL,
  formatSom,
  parseCommercial,
  type CommercialFacts,
} from "./commercial-facts.ts";
