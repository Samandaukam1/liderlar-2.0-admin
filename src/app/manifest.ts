import type { MetadataRoute } from "next";
import { getBranding } from "@/lib/branding/service";
import { versioned } from "@/lib/branding/config";

/**
 * PWA manifesti. Dinamik — 192/512 ikonkalar admin paneldan
 * yuklangan logotipdan hosil qilinadi va bu yerda ishlatiladi.
 * Maxsus logo bo'lmasa ikonkalar ro'yxati bo'sh qoladi: yo'q faylga
 * ishora qilishdan ko'ra, umuman ko'rsatmagan ma'qul.
 *
 * `force-dynamic` MAJBURIY: usiz manifest build paytida bir marta
 * hosil bo'lib qotib qolardi va admin yuklagan yangi logo unga
 * keyingi deploy'gacha tushmasdi.
 */
export const dynamic = "force-dynamic";

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const branding = await getBranding();

  const icons = ([192, 512] as const)
    .filter((size) => branding.icons[size])
    .map((size) => ({
      src: versioned(branding.icons[size], branding.version),
      sizes: `${size}x${size}`,
      type: "image/png",
    }));

  return {
    name: "Liderlar.uz Admin",
    short_name: "Liderlar Admin",
    description: "Liderlar.uz 2.0 boshqaruv paneli",
    start_url: "/",
    display: "standalone",
    background_color: "#0b1b2b",
    theme_color: "#1677ff",
    icons,
  };
}
