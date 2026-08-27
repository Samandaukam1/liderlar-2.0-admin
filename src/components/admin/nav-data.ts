import type { Permission } from "@/lib/permissions";
import {
  LayoutDashboard,
  Users,
  UserPlus,
  Link2,
  Inbox,
  FileText,
  Trophy,
  SlidersHorizontal,
  Mic,
  CalendarDays,
  BookOpen,
  Quote,
  Medal,
  Compass,
  MapPin,
  ClipboardList,
  Image,
  Sparkles,
  Bot,
  MonitorPlay,
  Megaphone,
  Wand2,
  Bell,
  ShieldCheck,
  ScrollText,
  Settings,
  Scale,
  ArrowDownUp,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  permission: Permission;
  keywords?: string;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Asosiy",
    items: [
      { label: "Dashboard", href: "/", icon: LayoutDashboard, permission: "dashboard.view" },
    ],
  },
  {
    label: "Nomzodlar",
    items: [
      { label: "Nomzodlar", href: "/candidates", icon: Users, permission: "candidates.view", keywords: "lider profil" },
      { label: "Nomzod anketalari", href: "/nomzodlar/anketalar", icon: UserPlus, permission: "intakes.view", keywords: "anketa intake qo'shish yangi nomzod havola" },
      { label: "Oylik havolalar", href: "/monthly-links", icon: Link2, permission: "tokens.view", keywords: "token 30 kun" },
      { label: "Yuborilgan yangilanishlar", href: "/monthly-updates", icon: Inbox, permission: "updates.view", keywords: "oylik submission" },
      { label: "Biografik maqolalar", href: "/articles", icon: FileText, permission: "articles.view", keywords: "maqola editor" },
      { label: "Arizalar", href: "/applications", icon: ClipboardList, permission: "applications.view" },
    ],
  },
  {
    label: "Postlar",
    items: [
      {
        label: "Postlar",
        href: "/postlar",
        icon: Megaphone,
        permission: "posts.view",
        keywords: "post studio telegram bot iqtibos shablon 1080 ijtimoiy tarmoq",
      },
    ],
  },
  {
    label: "Reyting",
    items: [
      { label: "Reyting", href: "/rankings", icon: Trophy, permission: "rankings.view" },
      { label: "Reyting sozlamalari", href: "/ranking-settings", icon: SlidersHorizontal, permission: "rankings.manage", keywords: "og'irlik formula" },
      { label: "TOP 100", href: "/top100", icon: Medal, permission: "top100.view" },
    ],
  },
  {
    label: "Kontent",
    items: [
      { label: "Podcastlar", href: "/podcasts", icon: Mic, permission: "podcasts.view" },
      { label: "Podcast taqvimi", href: "/podcast-calendar", icon: CalendarDays, permission: "podcasts.view" },
      { label: "Liderlar Online", href: "/journals", icon: BookOpen, permission: "journals.view", keywords: "jurnal" },
      { label: "Iqtiboslar", href: "/quotes", icon: Quote, permission: "quotes.view" },
      { label: "Yo‘nalishlar", href: "/directions", icon: Compass, permission: "taxonomy.view", keywords: "kategoriya" },
      { label: "Hududlar", href: "/regions", icon: MapPin, permission: "taxonomy.view", keywords: "viloyat" },
      { label: "Media kutubxonasi", href: "/media", icon: Image, permission: "media.view", keywords: "rasm fayl" },
    ],
  },
  {
    label: "Aqlli vositalar",
    items: [
      { label: "Jaxongir AI", href: "/ai", icon: Sparkles, permission: "ai.use", keywords: "sun'iy intellekt muharrir" },
      { label: "AI Assistant", href: "/ai-assistant", icon: Bot, permission: "ai_assistant.manage", keywords: "widget avatar animatsiya user panel jaxongir" },
      { label: "Burchak video", href: "/corner-video", icon: MonitorPlay, permission: "corner_video.manage", keywords: "video burchak widget tugma havola user panel pip" },
    ],
  },
  {
    label: "AI Promtlar",
    items: [
      { label: "Nomzod link rasm yaratish promtlari", href: "/ai-prompts", icon: Wand2, permission: "ai_prompts.view", keywords: "prompt rasm fon kiyim rang" },
    ],
  },
  {
    label: "Tizim",
    items: [
      { label: "Bildirishnomalar", href: "/notifications", icon: Bell, permission: "notifications.view" },
      { label: "Adminlar va rollar", href: "/admins", icon: ShieldCheck, permission: "admins.manage" },
      { label: "Audit log", href: "/audit-log", icon: ScrollText, permission: "audit.view" },
      { label: "Sayt sozlamalari", href: "/settings", icon: Settings, permission: "settings.manage" },
      { label: "Huquqiy sahifalar", href: "/legal", icon: Scale, permission: "legal.manage", keywords: "oferta maxfiylik" },
      { label: "Import va eksport", href: "/import-export", icon: ArrowDownUp, permission: "import.run", keywords: "csv json" },
    ],
  },
];

export function visibleGroups(permissions: readonly string[]): NavGroup[] {
  const set = new Set(permissions);
  return NAV_GROUPS.map((g) => ({
    ...g,
    items: g.items.filter((i) => set.has(i.permission)),
  })).filter((g) => g.items.length > 0);
}
