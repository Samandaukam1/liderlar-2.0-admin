import type { Permission } from "@/lib/permissions";
import {
  LayoutDashboard,
  Users,
  UserPlus,
  Rocket,
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
  Handshake,
  Crown,
  Newspaper,
  FileDiff,
  HeartHandshake,
  Wand2,
  Bell,
  ShieldCheck,
  UserCog,
  ScrollText,
  Settings,
  Palette,
  Scale,
  ArrowDownUp,
  History,
  Ticket,
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
      { label: "Chop etishga tayyorlar", href: "/nomzodlar/anketalar/chop-etishga-tayyorlar", icon: Rocket, permission: "intakes.view", keywords: "batch to'lov nashr telegram bugungi navbat" },
      { label: "Oylik havolalar", href: "/monthly-links", icon: Link2, permission: "tokens.view", keywords: "token 30 kun" },
      { label: "Yuborilgan yangilanishlar", href: "/monthly-updates", icon: Inbox, permission: "updates.view", keywords: "oylik submission" },
      /*
       * Profil tahrirlari — "Yuborilgan yangilanishlar" dan BOSHQA narsa.
       *
       * U oylik havola orqali kelgan to'liq yangilanish; bu esa
       * foydalanuvchining o'zi profil muharririda o'zgartirgan
       * ALOHIDA maydonlari va ularning har biri alohida tasdiqlanadi.
       */
      { label: "Profil tahrirlari", href: "/profil-tahrirlari", icon: FileDiff, permission: "candidates.view", keywords: "tahrir tasdiq korik maydon ozgarish vip" },
      { label: "Biografik maqolalar", href: "/articles", icon: FileText, permission: "articles.view", keywords: "maqola editor" },
      /*
       * A'ZO MAQOLALARI — BIOGRAFIYADAN BOSHQA.
       *
       * Yuqoridagi bo'lim nomzod HAQIDA yozilgan biografiya; bu esa
       * a'zoning O'ZI yozgan maqolasi va u Liderlar Online nashrida
       * chiqadi. Muallifi, oqimi va ommaviy joyi boshqa.
       */
      { label: "Liderlar Online maqolalari", href: "/online-maqolalar", icon: Newspaper, permission: "articles.view", keywords: "azo maqola online nashr tekshiruv muallif" },
      { label: "Arizalar", href: "/applications", icon: ClipboardList, permission: "applications.view" },
      // Liderlar 1.0 arxivi — 2.0 nomzodlaridan ATAYLAB alohida yozuv turi
      // (legacy_posts jadvali), shuning uchun alohida bo'lim.
      { label: "Liderlar 1.0 postlari", href: "/liderlar-1-0", icon: History, permission: "candidates.view", keywords: "legacy arxiv eski sayt tilda nomzodlar import 1.0" },
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
    // Sotuv boti — POST botidan butunlay alohida tizim (boshqa token,
    // boshqa webhook, boshqa jadvallar). Shuning uchun "Postlar" guruhiga
    // qo'shilmadi.
    label: "AI Sotuv",
    items: [
      {
        label: "AI Sotuv",
        href: "/ai-sotuv",
        icon: Handshake,
        permission: "sales.view",
        keywords:
          "sotuv bot telegram business suhbat chat mijoz o'rganish learning knowledge bilim baza uslub style sozlama",
      },
    ],
  },
  {
    /*
     * Koordinatorlar — AI Sotuvdan KEYINGI qatlam.
     *
     * AI birinchi chiziqda mijoz bilan yozishadi; koordinator esa
     * odam sifatida hududiy lidni yopadi. Ikkalasi alohida bot,
     * alohida jadval va alohida ruxsat bilan ishlaydi, shuning
     * uchun alohida bo'lim.
     */
    label: "Koordinatorlar",
    items: [
      {
        label: "Koordinatorlar",
        href: "/koordinatorlar",
        icon: MapPin,
        permission: "coordinators.view",
        keywords:
          "koordinator hudud viloyat xarita lid marshrut talab komissiya reyting nominatsiya",
      },
      {
        /*
         * Promo kodlar — koordinator kodidan BOSHQA savol.
         *
         * Koordinatordagi kod "bu nomzod kimning odami" degan
         * marshrut uchun; bu bo'lim esa "bu kod hali ishlaydimi"
         * degan amal qilish muddati uchun.
         */
        label: "Promo kodlar",
        href: "/promo-kodlar",
        icon: Ticket,
        permission: "coordinators.view",
        keywords: "promo kod muddat amal qilish tugatish kampaniya tavsiya chegirma",
      },
    ],
  },
  {
    /*
     * MEHR 365+ — Liderlar ichidagi ALOHIDA KICHIK BREND.
     *
     * Ensiklopediya nomzodni ko'rsatadi; MEHR esa qilingan
     * ishni tekshiradi va ball beradi. Ikkisi boshqa jadval,
     * boshqa ruxsat va boshqa mas'uliyat, shuning uchun
     * alohida bo'lim.
     */
    label: "MEHR 365+",
    items: [
      {
        label: "MEHR 365+",
        href: "/mehr",
        icon: HeartHandshake,
        permission: "mehr.view",
        keywords:
          "mehr ezgulik volontyor tadbir sertifikat ball reyting tekshiruv qr check-in referral",
      },
    ],
  },
  {
    /*
     * LIDERLAR VIP — TIJORIY QATLAM.
     *
     * Reytingdan ATAYLAB alohida: VIP sotib olinadi, reyting esa
     * qozoniladi. Ikkisini bir bo'limga qo'shish panelda ularni bir
     * xil narsa qilib ko'rsatardi — holbuki §70 ularni tushuncha
     * jihatidan ajratishni talab qiladi.
     */
    label: "Liderlar VIP",
    items: [
      {
        label: "VIP obunalar",
        href: "/vip",
        icon: Crown,
        permission: "vip.view",
        keywords: "vip obuna premium tarif imtiyoz muddat faollashtirish huquq entitlement",
      },
      {
        label: "Premium Challenge",
        href: "/premium-challenge",
        icon: Medal,
        permission: "vip.view",
        keywords: "kunlik challenge bellashuv g'olib ko'rish vip kun tarix referal mukofot",
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
      {
        /*
         * Bu ADMINLAR emas, A'ZOLAR.
         *
         * `/admins` — panelga kiradigan xodimlar. Bu bo'lim esa
         * ensiklopediyadagi nomzodlarning shaxsiy hisoblari:
         * kim tizimga kira oladi, kim Telegramga ulangan.
         * Ikkisini bir joyga qo'shish ruxsatlarni ham
         * chalkashtirardi.
         */
        label: "Foydalanuvchi akkauntlari",
        href: "/foydalanuvchilar",
        icon: UserCog,
        permission: "members.view",
        keywords:
          "akkaunt hisob nomzod faollashtirish aktivatsiya parol telegram bloklash kirish login",
      },
      { label: "Adminlar va rollar", href: "/admins", icon: ShieldCheck, permission: "admins.manage" },
      { label: "Audit log", href: "/audit-log", icon: ScrollText, permission: "audit.view" },
      { label: "Sayt sozlamalari", href: "/settings", icon: Settings, permission: "settings.manage" },
      { label: "Logo va favicon", href: "/brending", icon: Palette, permission: "settings.manage", keywords: "logo favicon ikonka icon brending belgi yorliq" },
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
