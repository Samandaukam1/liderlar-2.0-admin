import type { Metadata } from "next";
import { Manrope, Oswald } from "next/font/google";
import "./globals.css";
import { ToastProvider } from "@/components/ui/toast";

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin", "cyrillic"],
});

const oswald = Oswald({
  variable: "--font-oswald",
  subsets: ["latin", "cyrillic"],
});

export const metadata: Metadata = {
  title: {
    default: "Liderlar.uz Admin",
    template: "%s — Liderlar.uz Admin",
  },
  description: "Liderlar.uz 2.0 boshqaruv paneli",
  robots: { index: false, follow: false },
};

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
