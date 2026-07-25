"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ChevronsLeft,
  ChevronsRight,
  LogOut,
  Menu,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { visibleGroups } from "./nav-data";
import { Avatar, RoleBadge } from "./badges";

interface SidebarProps {
  fullName: string;
  email: string;
  avatarUrl: string | null;
  roles: string[];
  permissions: string[];
  signOutAction: () => Promise<void>;
}

function NavList({
  permissions,
  collapsed,
  onNavigate,
}: {
  permissions: string[];
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const groups = visibleGroups(permissions);

  return (
    <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-4" aria-label="Asosiy menyu">
      {groups.map((group) => (
        <div key={group.label}>
          {!collapsed && (
            <p className="mb-1.5 px-3 text-[10px] font-bold uppercase tracking-[0.14em] text-cyan-light/50">
              {group.label}
            </p>
          )}
          <ul className="space-y-0.5">
            {group.items.map((item) => {
              const active =
                item.href === "/"
                  ? pathname === "/"
                  : pathname.startsWith(item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    title={collapsed ? item.label : undefined}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "group relative flex items-center gap-3 rounded-[13px] px-3 py-2 text-[13px] font-semibold transition-colors duration-150",
                      active
                        ? "bg-gradient-to-r from-brand/80 to-electric/70 text-white shadow-[0_6px_18px_rgba(22,119,255,0.35)]"
                        : "text-[#b7c8dc] hover:bg-white/[0.06] hover:text-white",
                      collapsed && "justify-center px-2",
                    )}
                  >
                    <item.icon
                      className={cn(
                        "h-[18px] w-[18px] shrink-0",
                        active ? "text-cyan-light" : "text-[#7f95ad] group-hover:text-cyan-light",
                      )}
                    />
                    {!collapsed && <span className="truncate">{item.label}</span>}
                    {active && !collapsed && (
                      <motion.span
                        layoutId="nav-dot"
                        className="absolute right-3 h-1.5 w-1.5 rounded-full bg-cyan"
                      />
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function Profile({
  fullName,
  email,
  avatarUrl,
  roles,
  collapsed,
  signOutAction,
}: SidebarProps & { collapsed: boolean }) {
  return (
    <div className="border-t border-white/10 p-3">
      <div className={cn("flex items-center gap-3", collapsed && "justify-center")}>
        <Avatar name={fullName} src={avatarUrl} size={34} />
        {!collapsed && (
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-bold text-white">{fullName}</p>
            <p className="truncate text-[11px] text-[#7f95ad]">{email}</p>
          </div>
        )}
        <form action={signOutAction}>
          <button
            type="submit"
            title="Chiqish"
            aria-label="Chiqish"
            className="rounded-lg p-1.5 text-[#7f95ad] transition hover:bg-white/10 hover:text-coral"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </form>
      </div>
      {!collapsed && roles.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {roles.map((r) => (
            <RoleBadge key={r} role={r} />
          ))}
        </div>
      )}
    </div>
  );
}

function Logo({ collapsed }: { collapsed: boolean }) {
  return (
    <Link href="/" className="flex items-center gap-2.5 px-5 py-5">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-cyan to-electric font-display text-lg font-bold text-white shadow-[0_6px_20px_rgba(0,199,232,0.4)]">
        L
      </span>
      {!collapsed && (
        <span className="min-w-0">
          <span className="block font-display text-[15px] font-semibold uppercase tracking-[0.12em] text-white">
            Liderlar.uz
          </span>
          <span className="block text-[10px] font-bold uppercase tracking-[0.2em] text-cyan-light/70">
            Admin 2.0
          </span>
        </span>
      )}
    </Link>
  );
}

export function AdminSidebar(props: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <>
      {/* Mobile trigger */}
      <button
        onClick={() => setMobileOpen(true)}
        aria-label="Menyuni ochish"
        className="fixed bottom-5 left-5 z-[60] flex h-12 w-12 items-center justify-center rounded-2xl bg-navy-deep text-white shadow-pop lg:hidden"
      >
        <Menu className="h-5 w-5" />
      </button>

      {/* Desktop sidebar */}
      <motion.aside
        animate={{ width: collapsed ? 76 : 264 }}
        transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
        className="sticky top-0 z-40 hidden h-screen shrink-0 flex-col bg-navy-sidebar lg:flex"
      >
        <div className="flex items-center justify-between pr-3">
          <Logo collapsed={collapsed} />
          <button
            onClick={() => setCollapsed((v) => !v)}
            aria-label={collapsed ? "Menyuni kengaytirish" : "Menyuni yig‘ish"}
            className="rounded-lg p-1.5 text-[#7f95ad] transition hover:bg-white/10 hover:text-white"
          >
            {collapsed ? (
              <ChevronsRight className="h-4 w-4" />
            ) : (
              <ChevronsLeft className="h-4 w-4" />
            )}
          </button>
        </div>
        <NavList permissions={props.permissions} collapsed={collapsed} />
        <Profile {...props} collapsed={collapsed} />
      </motion.aside>

      {/* Mobile drawer */}
      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[70] bg-navy-deep/50 backdrop-blur-sm lg:hidden"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) setMobileOpen(false);
            }}
          >
            <motion.aside
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
              className="flex h-full w-[280px] flex-col bg-navy-sidebar"
            >
              <div className="flex items-center justify-between pr-3">
                <Logo collapsed={false} />
                <button
                  onClick={() => setMobileOpen(false)}
                  aria-label="Yopish"
                  className="rounded-lg p-1.5 text-[#7f95ad] hover:text-white"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <NavList
                permissions={props.permissions}
                collapsed={false}
                onNavigate={() => setMobileOpen(false)}
              />
              <Profile {...props} collapsed={false} />
            </motion.aside>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
