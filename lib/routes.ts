/**
 * Route constants shared by the Edge middleware config and client components.
 *
 * Deliberately dependency-free: importing lib/auth.config from a client
 * component would drag `next/server` into the browser bundle.
 */

/** Where a freshly signed-in owner lands. Single place to change it. */
export const DEFAULT_LOGIN_REDIRECT = "/";

export const LOGIN_ROUTE = "/login";

/**
 * POST-only credential endpoint used by the login form's no-JS fallback.
 *
 * Lives under `/api/auth` on purpose: the middleware matcher excludes that
 * prefix, so a signed-out POST reaches it instead of being answered with the
 * 401 envelope every other `/api/` path gets. The path segment is hyphenated,
 * so it cannot collide with any Auth.js action (`signin`, `callback`, …)
 * handled by the `[...nextauth]` catch-all.
 */
export const NO_JS_LOGIN_ROUTE = "/api/auth/no-js-login";
