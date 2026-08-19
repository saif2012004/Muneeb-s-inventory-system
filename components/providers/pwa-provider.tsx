"use client";

import { useEffect, useState } from "react";
import { Download, X } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * SERVICE WORKER REGISTRATION + THE INSTALL PROMPT (CHECKLIST #11).
 *
 * ---------------------------------------------------------------------------
 * WHY A CUSTOM PROMPT AT ALL
 * ---------------------------------------------------------------------------
 * Chrome's own install banner is easy to miss and easy to dismiss forever by
 * accident. The owner is the only user of this app and will install it exactly
 * once, on one phone — a visible, explained prompt is worth more here than it
 * would be on a public site, and once installed it never appears again.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS DELIBERATELY DOES NOT DO
 * ---------------------------------------------------------------------------
 * No re-prompting on a timer, no nagging after a dismissal. Dismissing is
 * remembered in `localStorage`, and the browser's own menu ("Add to home
 * screen") remains available forever if he changes his mind.
 */

/** `beforeinstallprompt` is Chromium-only and not in the DOM lib. */
type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const DISMISSED_KEY = "pwa-install-dismissed";

export function PwaProvider() {
  const [installEvent, setInstallEvent] = useState<InstallPromptEvent | null>(null);

  // ------------------------------------------------------------------
  // Register the service worker
  // ------------------------------------------------------------------
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    /**
     * Registered in DEV TOO, deliberately — but see `public/sw.js`: it caches
     * only `/_next/static/`, which is content-hashed, so it cannot serve stale
     * code. Skipping dev registration would mean the one thing most likely to
     * break in production is the one thing never exercised locally.
     */
    const register = () => {
      navigator.serviceWorker.register("/sw.js").catch((error) => {
        // A failed registration must never break the app — it is an
        // enhancement. Log it so it is visible rather than silent.
        console.error("[pwa] service worker registration failed", error);
      });
    };

    // After load: registration competes with the app's own first data fetches
    // otherwise, and on a slow connection those matter more.
    if (document.readyState === "complete") register();
    else {
      window.addEventListener("load", register);
      return () => window.removeEventListener("load", register);
    }
  }, []);

  // ------------------------------------------------------------------
  // Catch the install opportunity
  // ------------------------------------------------------------------
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.localStorage.getItem(DISMISSED_KEY) === "1") return;

    function onBeforeInstall(event: Event) {
      // Stop Chrome's own mini-infobar so there are not two prompts.
      event.preventDefault();
      setInstallEvent(event as InstallPromptEvent);
    }

    // Fires when the install completes — by our button or the browser menu.
    function onInstalled() {
      setInstallEvent(null);
      window.localStorage.setItem(DISMISSED_KEY, "1");
    }

    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (!installEvent) return null;

  async function install() {
    if (!installEvent) return;
    await installEvent.prompt();
    // Either way the event is single-use: Chrome will not let it be reused.
    await installEvent.userChoice;
    setInstallEvent(null);
  }

  function dismiss() {
    window.localStorage.setItem(DISMISSED_KEY, "1");
    setInstallEvent(null);
  }

  return (
    /**
     * Sits ABOVE the mobile bottom nav (which is h-16 = 64px) rather than over
     * it — covering the nav with a promo is how an owner ends up unable to
     * reach Quick entry.
     */
    <div className="fixed inset-x-0 bottom-20 z-50 mx-auto w-[calc(100%-2rem)] max-w-md sm:bottom-6">
      <div className="flex items-center gap-3 rounded-xl border border-zinc-200 bg-white p-3 shadow-lg">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-zinc-900">
          <Download className="size-5 text-white" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-zinc-900">Install the app</p>
          <p className="text-xs text-zinc-500">
            Add it to your home screen — opens full screen, no address bar.
          </p>
        </div>
        <Button size="sm" className="h-11 shrink-0 rounded-lg" onClick={install}>
          Install
        </Button>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Not now"
          className="-mr-1 flex size-11 shrink-0 items-center justify-center rounded-lg text-zinc-400 hover:bg-zinc-50 hover:text-zinc-600"
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>
    </div>
  );
}
