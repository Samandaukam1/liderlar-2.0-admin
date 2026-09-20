import type { Metadata, Viewport } from "next";
import Script from "next/script";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "MEHR 365+",
  // Telegram ichidagi vosita — qidiruvda chiqishi kerak emas.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  // Tadbir joyida telefon quyoshda ushlanadi — kontrast muhim.
  themeColor: "#0b3555",
};

/**
 * MEHR Mini App qobig'i.
 *
 * Admin panel layout'idan ATAYLAB alohida: bu sahifa Telegram
 * ichida, oddiy a'zoda ochiladi va unda admin sessiyasi ham,
 * yon menyu ham bo'lmaydi.
 */
export default function MehrAppLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {/*
        Telegram WebApp SDK. `beforeInteractive` shart: sahifa
        birinchi chizilishida `initData` allaqachon mavjud
        bo'lishi kerak, aks holda birinchi so'rov imzosiz ketardi.
      */}
      <Script src="https://telegram.org/js/telegram-web-app.js" strategy="beforeInteractive" />
      <div className="mehr-app">{children}</div>
    </>
  );
}
