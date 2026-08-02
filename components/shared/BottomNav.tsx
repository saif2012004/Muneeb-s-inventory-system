"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import { LogOut, MoreHorizontal } from "lucide-react";

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  ACCENTS,
  PRIMARY_NAV,
  SECONDARY_NAV,
  isNavItemActive,
} from "@/lib/nav";
import { LOGIN_ROUTE } from "@/lib/routes";
import { cn } from "@/lib/utils";
import { signOut } from "next-auth/react";

const INDICATOR_ID = "bottom-nav-indicator";

export function BottomNav() {
  const pathname = usePathname();
  const reduceMotion = useReducedMotion();
  const [moreOpen, setMoreOpen] = useState(false);

  const moreIsActive = SECONDARY_NAV.some((item) =>
    isNavItemActive(pathname, item.href)
  );

  // A spring reads as "snapping into place"; reduced motion gets a hard cut.
  const indicatorTransition = reduceMotion
    ? { duration: 0 }
    : { type: "spring" as const, stiffness: 500, damping: 40 };

  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-zinc-200 bg-white pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      <div className="flex items-stretch">
        {PRIMARY_NAV.map((item) => {
          const active = isNavItemActive(pathname, item.href);
          const accent = ACCENTS[item.accent];
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative flex min-h-[56px] flex-1 flex-col items-center justify-center gap-1 px-1 pt-1.5 text-[11px] transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                active ? cn(accent.text, "font-medium") : "text-zinc-500"
              )}
            >
              {/* layoutId makes this single element slide between tabs
                  instead of cross-fading in place. */}
              {active ? (
                <motion.span
                  layoutId={INDICATOR_ID}
                  transition={indicatorTransition}
                  className={cn(
                    "absolute inset-x-3 top-0 h-0.5 rounded-full",
                    accent.solid
                  )}
                />
              ) : null}
              <Icon className="size-5 shrink-0" aria-hidden />
              {item.label}
            </Link>
          );
        })}

        <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
          <SheetTrigger
            className={cn(
              "relative flex min-h-[56px] flex-1 flex-col items-center justify-center gap-1 px-1 pt-1.5 text-[11px] transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
              moreIsActive ? "font-medium text-zinc-900" : "text-zinc-500"
            )}
          >
            {moreIsActive ? (
              <motion.span
                layoutId={INDICATOR_ID}
                transition={indicatorTransition}
                className="absolute inset-x-3 top-0 h-0.5 rounded-full bg-zinc-900"
              />
            ) : null}
            <MoreHorizontal className="size-5 shrink-0" aria-hidden />
            More
          </SheetTrigger>

          <SheetContent side="bottom" className="rounded-t-xl">
            <SheetHeader className="text-left">
              <SheetTitle className="text-lg font-semibold">More</SheetTitle>
            </SheetHeader>

            <div className="mt-4 space-y-1">
              {SECONDARY_NAV.map((item) => {
                const active = isNavItemActive(pathname, item.href);
                const accent = ACCENTS[item.accent];
                const Icon = item.icon;

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMoreOpen(false)}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex min-h-11 items-center gap-3 rounded-lg px-3 text-[15px] transition-colors",
                      active
                        ? cn(accent.activeBg, accent.text, "font-medium")
                        : "text-zinc-700 hover:bg-zinc-50"
                    )}
                  >
                    <Icon className="size-[18px] shrink-0" aria-hidden />
                    {item.label}
                  </Link>
                );
              })}

              <button
                type="button"
                onClick={() => signOut({ callbackUrl: LOGIN_ROUTE })}
                className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-[15px] text-zinc-700 transition-colors hover:bg-zinc-50"
              >
                <LogOut className="size-[18px] shrink-0" aria-hidden />
                Log out
              </button>
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </nav>
  );
}
