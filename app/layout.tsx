import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";

import { PwaProvider } from "@/components/providers/pwa-provider";
import { QueryProvider } from "@/components/providers/query-provider";
import { Toaster } from "@/components/ui/sonner";
import { cn } from "@/lib/utils";

import "./globals.css";

// Design System: one family, weights 400/500/600/700.
const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Business Manager",
    template: "%s · Business Manager",
  },
  description: "Beverages, bakery and milk shop management.",

  /**
   * PWA (CHECKLIST #11).
   *
   * ⚠️ The manifest is a STATIC `public/manifest.webmanifest`, not the typed
   * `app/manifest.ts` that Next documents. That is not a preference — a dynamic
   * metadata route CANNOT BUILD in this repo, because the folder path contains
   * an apostrophe ("Muneeb's inventory system"). Next's metadata-route loader
   * interpolates the file path into a single-quoted JS string, so the apostrophe
   * closes it early and webpack fails with "Module parse failed: Unexpected
   * token". The same breakage would hit `icon.tsx`, `sitemap.ts`, `robots.ts`
   * and `opengraph-image.tsx`.
   *
   * The cost is that nothing type-checks the manifest's shape. If the folder is
   * ever renamed without the apostrophe, `app/manifest.ts` becomes usable.
   */
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/icon-192.png", type: "image/png", sizes: "192x192" },
    ],
    // iOS ignores the manifest's icons entirely and reads this one.
    apple: "/apple-touch-icon.png",
  },
  appleWebApp: {
    // iOS has no `beforeinstallprompt` and no install button — "Add to Home
    // Screen" from the share sheet is the only route, and without this it opens
    // in Safari chrome instead of standalone.
    capable: true,
    title: "Shop",
    statusBarStyle: "default",
  },
  // The app is behind a login and has nothing to index.
  robots: { index: false, follow: false },
};

// Mobile-first: lock the viewport so numeric inputs don't zoom the page.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  /**
   * Two values, not one: the phone picks by system theme. Both are the app's
   * own surfaces so the status bar never clashes with the header under it.
   */
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fafafa" },
    { media: "(prefers-color-scheme: dark)", color: "#18181b" },
  ],
  // Installed apps run under the notch/home indicator; the layout already pads
  // itself, and this is what lets it use the full screen.
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={inter.variable}>
      <body className={cn("min-h-dvh bg-background font-sans antialiased")}>
        {/**
         * 🔴 CATCH `beforeinstallprompt` BEFORE REACT HYDRATES. Do not move this
         * into a component.
         *
         * Chrome fires the event ONCE, as soon as it decides the app is
         * installable, and never replays it. `PwaProvider` attaches its listener
         * in a `useEffect`, which runs only after hydration — and on a return
         * visit the service worker is already controlling the page, so Chrome
         * decides "installable" almost immediately. On a cheap Android the event
         * therefore fires and is GONE before React is listening, and the install
         * prompt silently never appears.
         *
         * That is exactly how it failed (2026-08-23): the prompt showed when the
         * app was new — first visit, no service worker yet, so installability was
         * decided late enough to be caught — and stopped once the worker was
         * installed. It then failed on a never-installed phone too, which is what
         * ruled out the "already installed" and localStorage explanations.
         *
         * This runs during HTML parsing, long before hydration, and parks the
         * event on `window` for `PwaProvider` to pick up. The custom event covers
         * the other order — React mounting first and the event arriving later.
         */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){window.__pwaInstallEvent=null;window.addEventListener("beforeinstallprompt",function(e){e.preventDefault();window.__pwaInstallEvent=e;window.dispatchEvent(new Event("pwa-install-available"));});window.addEventListener("appinstalled",function(){window.__pwaInstallEvent=null;});})();`,
          }}
        />
        <QueryProvider>
          {children}
          <Toaster position="top-center" richColors closeButton />
          {/* Registers the service worker and offers the install prompt once. */}
          <PwaProvider />
        </QueryProvider>
      </body>
    </html>
  );
}
