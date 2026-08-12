"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import {
  BookHeart,
  ChevronDown,
  ClipboardCheck,
  LayoutDashboard,
  LineChart,
  PawPrint,
  Settings,
  ShieldCheck,
  Users
} from "lucide-react";

const primaryNavItems = [
  { href: "/", label: "ダッシュボード", mobileLabel: "ホーム", icon: LayoutDashboard },
  { href: "/pets", label: "犬・猫", mobileLabel: "犬・猫", icon: PawPrint },
  { href: "/records", label: "記録", mobileLabel: "記録", icon: BookHeart },
  { href: "/care", label: "お世話管理", mobileLabel: "お世話", icon: ClipboardCheck },
  { href: "/weights", label: "体重管理", mobileLabel: "体重", icon: LineChart }
];

const utilityNavItems = [
  { href: "/settings", label: "設定", icon: Settings },
  { href: "/settings/members", label: "共有", icon: Users }
];

const baseNavItems = [...primaryNavItems, ...utilityNavItems];

export function AppNav({ isAppAdmin = false }: { isAppAdmin?: boolean }) {
  const pathname = usePathname();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const mobileMenuId = useId();
  const mobileMenuContainerRef = useRef<HTMLDivElement>(null);
  const mobileMenuTriggerRef = useRef<HTMLButtonElement>(null);
  const navItems = isAppAdmin ? [...baseNavItems, { href: "/admin", label: "管理", icon: ShieldCheck }] : baseNavItems;
  const activeHref = navItems
    .filter((item) => pathname === item.href || (item.href !== "/" && pathname.startsWith(`${item.href}/`)))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;

  const mobileUtilityNavItems = isAppAdmin
    ? [...utilityNavItems, { href: "/admin", label: "管理", icon: ShieldCheck }]
    : utilityNavItems;
  const isUtilityActive = mobileUtilityNavItems.some((item) => item.href === activeHref);

  useEffect(() => {
    if (!isMobileMenuOpen) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      if (!mobileMenuContainerRef.current?.contains(event.target as Node)) {
        setIsMobileMenuOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsMobileMenuOpen(false);
        mobileMenuTriggerRef.current?.focus();
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isMobileMenuOpen]);

  return (
    <>
      <nav className="lg:hidden" aria-label="主要ナビゲーション">
        <div className="grid grid-cols-5 border-b border-slate-200">
          {primaryNavItems.map((item) => {
            const isActive = item.href === activeHref;

            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={isActive ? "page" : undefined}
                className={`flex min-h-11 items-center justify-center whitespace-nowrap border-b-2 px-1 text-center text-[11px] font-medium transition ${
                  isActive
                    ? "border-moss font-semibold text-moss"
                    : "border-transparent text-slate-600 hover:border-slate-300 hover:text-ink"
                }`}
              >
                {item.mobileLabel}
              </Link>
            );
          })}
        </div>

        <div className="mt-2 flex justify-end">
          <div ref={mobileMenuContainerRef} className="relative">
            <button
              ref={mobileMenuTriggerRef}
              type="button"
              aria-label="メニューを開く"
              aria-expanded={isMobileMenuOpen}
              aria-haspopup="menu"
              aria-controls={mobileMenuId}
              onClick={() => setIsMobileMenuOpen((open) => !open)}
              className={`inline-flex min-h-10 cursor-pointer items-center justify-center gap-1 rounded-md px-2 text-sm font-medium text-moss transition-colors hover:text-moss/75 active:bg-moss/5 active:text-moss/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-moss focus-visible:ring-offset-2 ${
                isUtilityActive ? "font-semibold" : ""
              }`}
            >
              <span>メニュー</span>
              <ChevronDown
                className={`h-3.5 w-3.5 transition-transform duration-200 ease-out ${
                  isMobileMenuOpen ? "rotate-180" : "rotate-0"
                }`}
                aria-hidden
              />
            </button>
            <div
              id={mobileMenuId}
              role="menu"
              aria-label="メニュー"
              aria-hidden={!isMobileMenuOpen}
              className={`absolute right-0 z-30 mt-2 w-60 max-w-[calc(100vw-2rem)] rounded-xl border border-slate-200/80 bg-white/95 p-1.5 shadow-md shadow-slate-900/10 backdrop-blur transition-[opacity,transform] duration-200 ease-out ${
                isMobileMenuOpen
                  ? "translate-y-0 opacity-100"
                  : "pointer-events-none -translate-y-1 opacity-0"
              }`}
            >
              {mobileUtilityNavItems.map((item) => {
                const Icon = item.icon;
                const isActive = item.href === activeHref;

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    role="menuitem"
                    tabIndex={isMobileMenuOpen ? 0 : -1}
                    aria-current={isActive ? "page" : undefined}
                    onClick={() => setIsMobileMenuOpen(false)}
                    className={`flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 text-sm font-semibold text-moss transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-moss/70 ${
                      isActive
                        ? "bg-moss/10 hover:bg-moss/15 active:bg-moss/15"
                        : "hover:bg-moss/10 active:bg-moss/15"
                    }`}
                  >
                    <Icon className="h-4 w-4 shrink-0 text-moss" aria-hidden />
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        </div>
      </nav>

      <nav className="hidden flex-nowrap gap-2 lg:flex" aria-label="画面ナビゲーション">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = item.href === activeHref;

          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive ? "page" : undefined}
              className={`inline-flex items-center gap-2 whitespace-nowrap rounded-md border px-3 py-2 text-sm font-medium transition ${
                isActive
                  ? "border-moss bg-moss text-white shadow-sm"
                  : "border-slate-200 bg-white text-slate-700 hover:border-moss hover:text-moss"
              }`}
            >
              <Icon className="h-4 w-4" aria-hidden />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </>
  );
}
