/**
 * Route constants shared by the Edge middleware config and client components.
 *
 * Deliberately dependency-free: importing lib/auth.config from a client
 * component would drag `next/server` into the browser bundle.
 */

/** Where a freshly signed-in owner lands. Single place to change it. */
export const DEFAULT_LOGIN_REDIRECT = "/";

export const LOGIN_ROUTE = "/login";
