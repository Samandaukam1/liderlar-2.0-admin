import "server-only";
import { after } from "next/server";
import { getSiteUrl } from "@/lib/site-url";
import { PROFILE_HIGHLIGHT_REVALIDATE_PATH } from "@/lib/elonlar/rules";

const TIMEOUT_MS = 3000;

/**
 * Saytga "biografik sahifa bari o'zgardi" deb xabar beradi.
 *
 * Sayt bar reklamalarini 2 daqiqagacha keshlaydi. Admin reklamani o'chirsa,
 * u darhol yo'qolishi kerak — shuning uchun har o'zgarishdan keyin shu
 * chaqiriladi. `refreshPublicProfiles` bilan bir xil: javobdan keyin
 * (`after()`), 3 soniya, xato yutiladi; xabar yo'qolsa ham kesh 2 daqiqada
 * o'zi yangilanadi.
 */
export function refreshProfileHighlight(): void {
  const send = () => postRefresh();
  try {
    after(send);
  } catch {
    void send();
  }
}

async function postRefresh(): Promise<void> {
  const key = process.env.LIDERLAR_PUBLIC_CONTENT_API_KEY?.trim();
  if (!key) return;
  try {
    const response = await fetch(`${getSiteUrl()}${PROFILE_HIGHLIGHT_REVALIDATE_PATH}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-liderlar-api-key": key },
      body: "{}",
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) console.error("[profile-highlight] web refused refresh:", response.status);
  } catch (error) {
    console.error(
      "[profile-highlight] refresh not sent:",
      error instanceof Error ? error.message : String(error),
    );
  }
}
