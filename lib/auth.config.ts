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
      return isLoggedIn;
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
