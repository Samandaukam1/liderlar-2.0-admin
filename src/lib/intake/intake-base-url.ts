import "server-only";
import { headers } from "next/headers";

/**
 * ANKETA HAVOLASINING BAZASI — YAGONA MANBA.
 *
 * ANKETA FORMASI ADMIN ILOVASIDA YASHAYDI (`src/app/anketa/[token]`).
 * Ommaviy saytda (`liderlar-web`) bunday marshrut YO'Q va rewrite ham
 * yo'q — tekshirildi. Shuning uchun havolani `liderlar.uz` ga
 * yo'naltirish uni O'LIK qiladi: 404.
 *
 * Tartib admin panelining o'z mexanizmi bilan bir xil:
 *
 *   1. `INTAKE_BASE_URL` — server env, RUNTIME da o'qiladi. Forma
 *      kelajakda boshqa manzilga ko'chsa (masalan ommaviy saytga),
 *      shu bitta qiymat hamma ishlab chiqaruvchini bir vaqtda
 *      to'g'irlaydi: bot ham, panel ham, sotuv oqimi ham.
 *   2. JONLI SO'ROV HOSTI — deploy manzili qanday bo'lsa, shunday.
 *   3. `NEXT_PUBLIC_INTAKE_BASE_URL` — eski, build paytida
 *      muhrlanadigan qiymat. Oxirgi zaxira.
 *
 * `NEXT_PUBLIC_SITE_URL` (ya'ni `getSiteUrl()`) BU YERDA
 * ISHLATILMAYDI: u sayt manzili, anketa manzili emas, va ikkalasi
 * bir xil bo'lishi shart emas.
 */
export async function buildIntakeBaseUrl(): Promise<string | undefined> {
  const override = process.env.INTAKE_BASE_URL?.trim();
  if (override) return override.replace(/\/+$/, "");

  try {
    const incoming = await headers();
    const host = incoming.get("x-forwarded-host") ?? incoming.get("host");
    if (host) {
      const isLocal = host.startsWith("localhost") || host.startsWith("127.0.0.1");
      const proto = incoming.get("x-forwarded-proto") ?? (isLocal ? "http" : "https");
      return `${proto}://${host}/anketa`;
    }
  } catch {
    // Webhook kontekstida `headers()` mavjud; bo'lmasa quyidagi
    // zaxiraga tushamiz.
  }

  const legacy = process.env.NEXT_PUBLIC_INTAKE_BASE_URL?.trim();
  return legacy ? legacy.replace(/\/+$/, "") : undefined;
}
