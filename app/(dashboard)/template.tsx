"use client";

import { useEffect } from "react";
import { motion, useReducedMotion } from "framer-motion";

import { enterUp, TWEEN } from "@/lib/motion";

/**
 * MODULE-level, deliberately not component state.
 *
 * `template.tsx` gets a FRESH instance per navigation, so component state
 * always starts false and could never distinguish "first load" from "third
 * navigation". A module flag survives those remounts and is exactly the
 * distinction we need. It resets on a full reload, which is correct — that is
 * a first load again.
 */
let hasHydrated = false;

/**
 * THE route transition. Design System → Motion: "Page/tab transitions: subtle
 * fade + 8px slide, ~200ms."
 *
 * ---------------------------------------------------------------------------
 * WHY A TEMPLATE AND NOT THE LAYOUT
 * ---------------------------------------------------------------------------
 * `layout.tsx` renders ONCE and persists across navigations, so a motion
 * wrapper there would animate on first load and never again. `template.tsx` is
 * the opposite: Next gives each navigation a fresh instance, which is exactly
 * what makes the entrance replay per route.
 *
 * That remount is the cost as well as the mechanism. It applies only to this
 * wrapper and the page below it — the sidebar, bottom nav and providers live in
 * `layout.tsx` and are untouched, and TanStack Query's cache is held in
 * `QueryProvider` above, so a revisited screen paints from cache rather than
 * refetching. Verified on 2026-08-11 across all eight modules: no refetch
 * storms, no doubled toasts, no lost form state.
 *
 * ---------------------------------------------------------------------------
 * ONE ANIMATION PER NAVIGATION
 * ---------------------------------------------------------------------------
 * Five screens used to run their own `enterUp` on their summary section. With
 * this template they were removed: a page fading in WHILE its first card slides
 * up reads as two competing animations for one navigation, and the Design
 * System asks for motion to be purposeful.
 *
 * The one deliberate survivor is the "Sale recorded" card in
 * `components/sales/NewSaleForm.tsx` — that appears on a STATE change, not a
 * navigation, so this template never fires for it. Do not "clean it up" for
 * consistency; it would simply pop in.
 *
 * ---------------------------------------------------------------------------
 * 🔒 THE FIRST SERVER-RENDERED PAINT MUST NOT ANIMATE. LOAD-BEARING.
 * ---------------------------------------------------------------------------
 * `useReducedMotion()` cannot work on the server — there is no `matchMedia`
 * there, so it is falsy and SSR paints the travelling `initial` styles
 * (`opacity: 0; transform: translateY(8px)`) into the HTML. The client then
 * animates from whatever the server painted, and a reduced-motion user gets the
 * slide anyway. Reproduced on 2026-08-11: with reduced motion on, a full page
 * load still travelled 8px.
 *
 * The CSS `@media (prefers-reduced-motion: reduce)` block in globals.css does
 * NOT catch this — framer-motion drives inline transforms with rAF, not CSS
 * transitions, so a `transition-duration` override has nothing to bite on.
 *
 * So the first paint after a full load is rendered WITHOUT the entrance, and
 * every client-side navigation after it animates normally. That is also the
 * right behaviour on its own terms: a hard reload is not a route transition,
 * and animating a page that the browser just painted from scratch reads as a
 * flash rather than a transition.
 *
 * Do not "simplify" this to `enterUp(reduceMotion)` alone — it silently
 * reintroduces both the reduced-motion violation and a hydration mismatch.
 */
export default function DashboardTemplate({
  children,
}: {
  children: React.ReactNode;
}) {
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    hasHydrated = true;
  }, []);

  // `initial: false` on the very first paint => framer-motion renders the
  // resting state directly, so the server and client agree and nothing travels.
  const entrance = hasHydrated
    ? enterUp(reduceMotion, TWEEN.page)
    : { ...enterUp(reduceMotion, TWEEN.page), initial: false as const };

  return <motion.div {...entrance}>{children}</motion.div>;
}
