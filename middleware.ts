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
  matcher: [
    "/((?!api/auth|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|webmanifest)$).*)",
  ],
};
