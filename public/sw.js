/**
 * THE SERVICE WORKER (CHECKLIST #11).
 *
 * ---------------------------------------------------------------------------
 * 🔴 IT CACHES BUILD ASSETS AND NOTHING ELSE. NEVER CACHE `/api/`.
 * ---------------------------------------------------------------------------
 * This app's data is stock, prices, sales and farmer balances. A cached API
 * response is a WRONG NUMBER shown confidently: the owner sells 12 bottles, the
 * till still says 100 in stock, and the shortfall guard he relies on is
 * measuring against a figure from ten minutes ago. Nothing here is worth that.
 *
 * So the rule is absolute and the code enforces it in one place: anything under
 * `/api/` is passed straight to the network, and a response is only ever put in
 * the cache if it came from `/_next/static/`.
 *
 * ---------------------------------------------------------------------------
 * WHY `/_next/static/` IS SAFE TO CACHE FOREVER
 * ---------------------------------------------------------------------------
 * Next content-hashes those filenames. A changed file gets a NEW name, so a
 * cache-first hit can never serve stale code — the old name simply stops being
 * requested. This is the one class of URL where cache-first is not a trade-off.
 *
 * Everything else — HTML, the manifest, icons — is network-first, because the
 * app is useless offline anyway (see below) and a stale shell is a support call.
 *
 * ---------------------------------------------------------------------------
 * THIS DOES NOT MAKE THE APP WORK OFFLINE, DELIBERATELY
 * ---------------------------------------------------------------------------
 * Recording a sale offline would mean queuing writes and reconciling stock
 * later. Two queued sales of the last 5 bottles both succeed locally and one
 * must lose — and the owner finds out afterwards. That is a real feature with
 * real risk, not a service-worker setting, and it is not what #11 asked for.
 *
 * What the owner gets instead: instant startup, and an honest offline page
 * rather than the browser's dinosaur.
 */

// Bump to invalidate everything. The build id would be better, but a service
// worker in `public/` is served verbatim and cannot read one.
const VERSION = "v1";
const STATIC_CACHE = `static-${VERSION}`;
const SHELL_CACHE = `shell-${VERSION}`;
const OFFLINE_URL = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.add(OFFLINE_URL))
      // Take over as soon as the new worker is ready rather than waiting for
      // every tab to close. On a phone the app is usually the only tab, so
      // "waiting" means the update never lands.
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== STATIC_CACHE && key !== SHELL_CACHE)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Only GET is cacheable at all. A POST/PATCH/DELETE is a sale, a stock move
  // or a payment — it must always reach the server.
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Cross-origin (fonts, anything else) — leave it to the browser.
  if (url.origin !== self.location.origin) return;

  // 🔴 THE DATA RULE. Never touched, never cached, no exceptions.
  if (url.pathname.startsWith("/api/")) return;

  // Immutable, content-hashed build output: cache-first is correct here.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ??
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches.open(STATIC_CACHE).then((cache) => cache.put(request, copy));
            }
            return response;
          })
      )
    );
    return;
  }

  // Page navigations: always the network, so the owner never reads a stale
  // screen. Fall back to the offline page only when the network genuinely fails.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() =>
        caches.match(OFFLINE_URL).then((hit) => hit ?? Response.error())
      )
    );
  }

  // Everything else falls through to the browser's own handling.
});
