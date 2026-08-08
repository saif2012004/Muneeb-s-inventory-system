import type { NextAuthConfig } from "next-auth";
import { NextResponse } from "next/server";

import { DEFAULT_LOGIN_REDIRECT, LOGIN_ROUTE } from "@/lib/routes";

/**
 * EDGE-SAFE Auth.js config. See Gotcha 3 in CLAUDE.md.
 *
 * This file is imported by middleware.ts, which runs on the Edge runtime.
 * Nothing here may touch bcryptjs, the Prisma client, or any Node built-in.
 * The `providers` array is deliberately empty: the Credentials provider does a
 * database lookup, so it is added in lib/auth.ts (Node) instead.
 *
 * The callbacks below only read the token / URL, never the database.
 */

export default {
  // v5 reads AUTH_SECRET by default; passed explicitly so the name in
  // CLAUDE.md's env contract (NEXTAUTH_SECRET) is what actually applies.
  secret: process.env.NEXTAUTH_SECRET,

  // Required. v5 auto-trusts the host only when AUTH_URL / AUTH_TRUST_HOST /
  // VERCEL is set, or NODE_ENV !== "production" — it does NOT look at
  // NEXTAUTH_URL. Without this, a production build outside Vercel throws
  // UntrustedHost inside middleware and every request reads as signed out.
  trustHost: true,

  /**
   * PINNED, not inferred — this is what makes preview deployments work.
   *
   * Auth.js decides the session-cookie NAME from whether it thinks the site is
   * https: `__Secure-authjs.session-token` when it is, plain
   * `authjs.session-token` when it isn't. Left to infer, it reads that from the
   * resolved auth URL — and `NEXTAUTH_URL` is only set for Production.
   *
   * The result, measured on a real deployment:
   *
   *   production  ->  Set-Cookie: __Secure-authjs.session-token …; Secure
   *   preview     ->  Set-Cookie: authjs.session-token …          (no Secure)
   *
   * The sign-in route and `/api/auth/*` both used the insecure name and worked,
   * so you could sign in and `/api/auth/session` returned your user — but the
   * EDGE MIDDLEWARE, handling an https request, looked for the `__Secure-`
   * cookie, found nothing, and treated every request as signed out. Preview
   * deployments therefore 307'd every page to /login and 401'd every API call
   * to a perfectly valid session.
   *
   * Setting it explicitly removes the inference entirely: middleware and route
   * handlers read the same static value from this one config object, so they
   * cannot disagree. Vercel always serves https, so it is true there and false
   * locally, where `next dev` is plain http and a Secure cookie would be
   * dropped by the browser.
   */
  useSecureCookies: process.env.VERCEL === "1",

  session: { strategy: "jwt" },

  pages: {
    signIn: LOGIN_ROUTE,
    error: LOGIN_ROUTE,
  },

  providers: [],

  callbacks: {
    /**
     * Invoked by middleware on every matched request.
     *   true                    -> allow
     *   false                   -> Auth.js redirects to pages.signIn
     *   NextResponse.redirect() -> custom redirect
     */
    authorized({ auth, request }) {
      const isLoggedIn = !!auth?.user;
      const { pathname } = request.nextUrl;

      if (pathname === LOGIN_ROUTE) {
        // Already signed in? Don't show the login form again.
        if (isLoggedIn) {
          return NextResponse.redirect(
            new URL(DEFAULT_LOGIN_REDIRECT, request.nextUrl)
          );
        }
        return true;
      }

      // Everything else the matcher lets through is owner-only.
      if (isLoggedIn) return true;

      // A signed-out API call must NOT be redirected. Returning false sends a
      // 307 to the HTML login page, which a fetch() follows transparently —
      // the caller then gets HTML and dies inside res.json() with an opaque
      // parse error instead of "your session expired". Answer API requests in
      // the same { data, error } shape the routes use, so the UI can show a
      // real message. Page requests still redirect to /login as before.
      if (pathname.startsWith("/api/")) {
        return NextResponse.json(
          { data: null, error: "You must be signed in." },
          { status: 401 }
        );
      }

      return false;
    },

    jwt({ token, user }) {
      // `user` is only present on the sign-in call; persist the id onto the
      // token so later requests can read it without a database round-trip.
      if (user) token.id = user.id;
      return token;
    },

    session({ session, token }) {
      if (session.user && typeof token.id === "string") {
        session.user.id = token.id;
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
