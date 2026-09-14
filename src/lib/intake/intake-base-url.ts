import "server-only";
import { resolvePublicWebUrl } from "@/lib/post-studio/site-origin";

/**
 * ANKETA HAVOLASINING BAZASI — OMMAVIY SAYT.
 *
 * XATO SHU YERDA EDI: havola `getSiteUrl()` dan yasalardi, u esa
 * `NEXT_PUBLIC_SITE_URL` ni o'qiydi va productionda u ADMIN
 * manzilini ko'rsatadi. Natijada nomzodga
 * `liderlar-2-0-admin.vercel.app/anketa/...` ketardi — bunday
 * havola umuman ochilmaydi, chunki anketa sahifasi ommaviy saytda.
 *
 * `resolvePublicWebUrl()` aynan shu muammo uchun yozilgan: u
 * `site_settings` ni o'qiydi, `*.vercel.app` ni RAD ETADI va
 * `https://liderlar.uz` ga qaytadi. Postlar allaqachon undan
 * foydalanadi; anketa havolasi esa chetda qolib ketgan edi.
 */
export async function buildIntakeBaseUrl(): Promise<string> {
  const origin = await resolvePublicWebUrl();
  return `${origin.replace(/\/+$/, "")}/anketa`;
}
