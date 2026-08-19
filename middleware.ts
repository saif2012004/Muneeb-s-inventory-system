import NextAuth from "next-auth";

import authConfig from "@/lib/auth.config";

/**
 * Runs on the Edge runtime, so it imports lib/auth.config ONLY — never
 * lib/auth, which pulls in Prisma and bcryptjs. See Gotcha 3 in CLAUDE.md.
 *
 * The gating itself lives in the `authorized` callback in auth.config.
 */
const { auth } = NextAuth(authConfig);

export default auth;

export const config = {
  // Everything except Auth.js's own endpoints, Next internals and static files.
  // /api/auth must be excluded or the sign-in POST would be gated by the very
  // check it is meant to satisfy.
  //
  // 🔴 `sw.js` and `offline.html` are excluded BY NAME (CHECKLIST #11). The
  // service worker is fetched by the browser's registration machinery and the
  // offline page by the worker itself; gated, both 307 to /login,
  // `navigator.serviceWorker.register()` chokes on a text/html response, and
  // the install silently never happens. The icons and the manifest are already
  // covered by the extension list.
  //
  // Named rather than adding `js|html` to that list: a blanket `.js` exclusion
  // would also un-gate any future route that happened to end in .js.
  matcher: [
    "/((?!api/auth|_next/static|_next/image|favicon.ico|sw\\.js|offline\\.html|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|webmanifest)$).*)",
  ],
};
