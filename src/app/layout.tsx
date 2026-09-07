import type { Metadata } from "next";
import { Manrope, Oswald } from "next/font/google";
import "./globals.css";
import { ToastProvider } from "@/components/ui/toast";
import { getBranding } from "@/lib/branding/service";
import { BRANDING_ICON_SIZES, hasCustomIcons, versioned } from "@/lib/branding/config";

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin", "cyrillic"],
});

const oswald = Oswald({
  variable: "--font-oswald",
  subsets: ["latin", "cyrillic"],
});

/**
 * Ikonkalar bazadan o'qiladi, shuning uchun statik `metadata` emas,
 * `generateMetadata` ishlatiladi — admin paneldan yuklangan logo
 * qayta build qilmasdan kuchga kiradi.
 *
 * ESLATMA: `src/app/favicon.ico` ATAYLAB `public/` ga ko'chirildi.
 * U app segmentida tursa, Next avtomatik `<link rel="icon">` qo'shadi va
 * bizning ikonkalarimiz bilan IKKITA raqobatchi teg paydo bo'lardi —
 * qaysi biri g'olib chiqishi brauzerga bog'liq bo'lib qolardi. Endi
 * manba bitta: quyidagi ro'yxat. `public/favicon.ico` esa `/favicon.ico`
 * ni to'g'ridan-to'g'ri so'ragan eski klientlar uchun zaxira bo'lib
 * qoladi.
 */
export async function generateMetadata(): Promise<Metadata> {
  const branding = await getBranding();

  const icons: NonNullable<Metadata["icons"]> = hasCustomIcons(branding)
    ? {
        icon: BRANDING_ICON_SIZES.filter((size) => branding.icons[size.size] && size.size <= 192)
          .map((size) => ({
            url: versioned(branding.icons[size.size], branding.version),
            sizes: `${size.size}x${size.size}`,
            type: "image/png",
          })),
        apple: branding.icons[180]
          ? [{ url: versioned(branding.icons[180], branding.version), sizes: "180x180" }]
          : undefined,
        shortcut: branding.icons[32]
          ? versioned(branding.icons[32], branding.version)
          : undefined,
      }
    : { icon: "/favicon.ico", shortcut: "/favicon.ico" };

  return {
    title: {
      default: "Liderlar.uz Admin",
      template: "%s — Liderlar.uz Admin",
    },
    description: "Liderlar.uz 2.0 boshqaruv paneli",
    robots: { index: false, follow: false },
    icons,
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="uz" className={`${manrope.variable} ${oswald.variable} h-full`}>
      <body className="min-h-full">
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
