"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { Moon, Sun } from "lucide-react";

type Theme = "light" | "dark";

const AdminThemeContext = createContext<{
  theme: Theme;
  toggleTheme: () => void;
} | null>(null);

export function AdminTheme({
  initialTheme,
  cookieName,
  children,
}: {
  initialTheme: Theme;
  cookieName: string;
  children: ReactNode;
}) {
  const [theme, setTheme] = useState(initialTheme);

  function toggleTheme() {
    const nextTheme = theme === "dark" ? "light" : "dark";
    setTheme(nextTheme);
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${cookieName}=${nextTheme}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
  }

  return (
    <AdminThemeContext.Provider value={{ theme, toggleTheme }}>
      <div data-admin-theme={theme} className="flex min-h-screen">{children}</div>
    </AdminThemeContext.Provider>
  );
}

export function AdminThemeToggle() {
  const settings = useContext(AdminThemeContext);
  if (!settings) return null;

  const isDark = settings.theme === "dark";
  const label = isDark ? "Kunduzgi rejimga o‘tish" : "Tungi rejimga o‘tish";
  const Icon = isDark ? Sun : Moon;

  return (
    <button
      type="button"
      onClick={settings.toggleTheme}
      aria-label={label}
      title={label}
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[14px] border border-line bg-card text-ink-soft transition hover:border-brand/40 hover:text-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-electric"
    >
      <Icon className="h-4.5 w-4.5" aria-hidden="true" />
    </button>
  );
}
