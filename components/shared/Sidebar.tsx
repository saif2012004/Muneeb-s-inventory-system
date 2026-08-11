"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import { signOut } from "next-auth/react";
import { LogOut } from "lucide-react";

import { Button } from "@/components/ui/button";
import { enterLeft } from "@/lib/motion";
import { ACCENTS, NAV_ITEMS, isNavItemActive } from "@/lib/nav";
import { LOGIN_ROUTE } from "@/lib/routes";
import { cn } from "@/lib/utils";

export function Sidebar({ ownerName }: { ownerName: string }) {
  const pathname = usePathname();
  const reduceMotion = useReducedMotion();

  return (
    <motion.aside
      {...enterLeft(reduceMotion)}
      className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-zinc-200 bg-white md:flex"
    >
      <div className="px-5 py-6">
        <p className="text-[15px] font-semibold text-zinc-900">
          Business Manager
        </p>
        <p className="mt-0.5 text-[13px] text-zinc-500">Pepsi · Bakery · Milk</p>
      </div>

      <nav className="flex-1 space-y-1 px-3" aria-label="Main">
        {NAV_ITEMS.map((item) => {
          const active = isNavItemActive(pathname, item.href);
          const accent = ACCENTS[item.accent];
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex min-h-11 items-center gap-3 rounded-lg px-3 text-[15px] transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                active
                  ? cn(accent.activeBg, accent.text, "font-medium")
                  : "text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900"
              )}
            >
              <Icon className="size-[18px] shrink-0" aria-hidden />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-zinc-200 p-3">
        <div className="px-2 pb-2">
          <p className="truncate text-sm font-medium text-zinc-900">
            {ownerName}
          </p>
          <p className="text-[13px] text-zinc-500">Owner</p>
        </div>
        <Button
          variant="ghost"
          onClick={() => signOut({ callbackUrl: LOGIN_ROUTE })}
          className="h-11 w-full justify-start gap-3 rounded-lg px-3 text-[15px] font-normal text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900"
        >
          <LogOut className="size-[18px]" aria-hidden />
          Log out
        </Button>
      </div>
    </motion.aside>
  );
}
