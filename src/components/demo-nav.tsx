"use client";

import {
  BookHeart,
  ClipboardCheck,
  LayoutDashboard,
  LineChart,
  PawPrint
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

export const DEMO_NAV_ITEMS = [
  { href: "/demo", label: "ホーム", icon: LayoutDashboard },
  { href: "/demo/hamsters", label: "ハムスター", icon: PawPrint },
  { href: "/demo/records", label: "記録", icon: BookHeart },
  { href: "/demo/cleaning", label: "衛生管理", icon: ClipboardCheck },
  { href: "/demo/weights", label: "体重管理", icon: LineChart }
] as const;

export function DemoNav() {
  const pathname = usePathname();
  const activeHref = DEMO_NAV_ITEMS.find(
    (item) => pathname === item.href || (item.href !== "/demo" && pathname.startsWith(`${item.href}/`))
  )?.href;

  return (
    <nav aria-label="サンプル閲覧ナビゲーション">
      <div className="grid grid-cols-5 gap-1 lg:flex lg:flex-wrap lg:gap-2">
        {DEMO_NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = activeHref === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive ? "page" : undefined}
              className={`flex min-w-0 flex-col items-center justify-center gap-1 rounded-md px-1 py-2 text-[11px] font-semibold sm:text-xs lg:flex-row lg:px-3 lg:text-sm ${
                isActive
                  ? "bg-moss text-white"
                  : "border border-slate-200 bg-white text-slate-700 hover:border-moss hover:text-moss"
              }`}
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden />
              <span className="max-w-full truncate">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
