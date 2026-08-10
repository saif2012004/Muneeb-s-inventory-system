import { NextResponse } from "next/server";
import { AuthError } from "next-auth";

import { signIn } from "@/lib/auth";
import { DEFAULT_LOGIN_REDIRECT, LOGIN_ROUTE } from "@/lib/routes";
import { signInSchema } from "@/lib/validations/auth";

/**
 * The login form's NO-JAVASCRIPT fallback. POST ONLY — this file exports no
 * GET, so Next answers a GET with 405 and the credential path is incapable of
 * accepting them in a query string.
 *
 * Why this route exists at all: with the client bundle absent or not yet
 * hydrated, `<form>` submits natively. A form with no `method` defaults to GET,
 * which serialises the owner's email and password into the URL — browser
 * history, server and proxy access logs, and any onward `Referer`. Reproduced
 * during Phase 5 mobile verification while every chunk was 404ing from a
 * corrupted `.next`. Giving the form `method="post" action="<this route>"`
 * makes that submission a POST with a form-encoded body, under every condition.
 *
 * When JS *is* working, react-hook-form's `handleSubmit` calls
 * `e.preventDefault()` synchronously, so the native submit never fires and this
 * route is never reached — the client `signIn()` path is unchanged.
 *
 * Prisma + bcrypt run in `authorize()`, so this is Node, not Edge.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The origin this request was actually addressed to, proxy headers included. */
function selfOrigin(request: Request): string {
  const host =
    request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!host) return new URL(request.url).origin;
  const proto =
    request.headers.get("x-forwarded-proto") ??
    new URL(request.url).protocol.replace(":", "");
  return `${proto}://${host}`;
}

/**
 * Auth.js guards its own callback endpoint with a CSRF token; `signIn()` calls
 * it with `skipCSRFCheck`, so this route has to bring its own. A browser always
 * sends `Origin` on a form POST, so requiring it to match ours rejects a
 * cross-site form that would otherwise log the owner into someone else's
 * account. `Referer` is only a fallback for clients that omit `Origin`.
 */
function isSameOrigin(request: Request): boolean {
  const expected = selfOrigin(request);
  const origin = request.headers.get("origin");
  if (origin) return origin === expected;

  const referer = request.headers.get("referer");
  if (!referer) return false;
  try {
    return new URL(referer).origin === expected;
  } catch {
    return false;
  }
}

/**
 * `callbackUrl` rides in on the form, so it is attacker-controlled exactly like
 * the query-string copy the client form sanitises in `resolveCallbackUrl()`.
 * Same rule, enforced again server-side: resolve against our own origin, drop
 * anything off-site, and never bounce back to the login page.
 *
 * It must accept an ABSOLUTE same-origin URL, not just a path: the middleware
 * writes `?callbackUrl=http://host/beverages`, and the form passes that through
 * verbatim. A relative-only rule sends every deep link to the dashboard instead
 * — caught in verification, where signing in from /beverages landed on "/".
 */
function resolveCallbackPath(
  raw: FormDataEntryValue | null,
  origin: string
): string {
  if (typeof raw !== "string" || raw === "") return DEFAULT_LOGIN_REDIRECT;
  // "//evil.com" parses as protocol-relative and would leave the site.
  if (raw.startsWith("//")) return DEFAULT_LOGIN_REDIRECT;
  try {
    const url = new URL(raw, origin);
    if (url.origin !== origin) return DEFAULT_LOGIN_REDIRECT;
    if (url.pathname === LOGIN_ROUTE) return DEFAULT_LOGIN_REDIRECT;
    return `${url.pathname}${url.search}`;
  } catch {
    return DEFAULT_LOGIN_REDIRECT;
  }
}

/**
 * 303, not 307. A 307 preserves the method, so the browser would re-POST the
 * credentials to the destination. `redirect()` from next/navigation issues 307
 * inside a Route Handler (it only uses 303 in a Server Action), which is why
 * `signIn` is called with `redirect: false` and the response is built here.
 * The session cookie is still applied: Next merges anything written to
 * `cookies()` into the returned Response.
 */
function seeOther(request: Request, path: string): NextResponse {
  return NextResponse.redirect(new URL(path, selfOrigin(request)), 303);
}

export async function POST(request: Request) {
  const origin = selfOrigin(request);

  if (!isSameOrigin(request)) {
    return seeOther(request, `${LOGIN_ROUTE}?error=CredentialsSignin`);
  }

  const formData = await request.formData();
  const parsed = signInSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  // Deliberately the same destination as a wrong password: the no-JS path must
  // not become an oracle the client path isn't.
  if (!parsed.success) {
    return seeOther(request, `${LOGIN_ROUTE}?error=CredentialsSignin`);
  }

  const callbackPath = resolveCallbackPath(formData.get("callbackUrl"), origin);
  let signedInTo: string;

  try {
    // `redirect: false` because `redirect()` from next/navigation issues a 307
    // here (see seeOther). The session cookie is still written — signIn puts it
    // on `cookies()`, and Next merges that into whatever Response we return.
    signedInTo = await signIn("credentials", {
      email: parsed.data.email,
      password: parsed.data.password,
      redirect: false,
      redirectTo: callbackPath,
    });
  } catch (error) {
    // A wrong password arrives here as CredentialsSignin.
    if (error instanceof AuthError) {
      return seeOther(request, `${LOGIN_ROUTE}?error=CredentialsSignin`);
    }
    console.error("[no-js-login] sign-in threw", error);
    return seeOther(request, `${LOGIN_ROUTE}?error=Configuration`);
  }

  /**
   * DO NOT drop this check for "signIn didn't throw, so we're in".
   *
   * Auth.js does not always throw on failure: when `assertConfig` rejects the
   * config it returns a 500 *before* the raw/throw path, so `signIn` resolves
   * normally, sets no cookie, and hands back its own endpoint URL. Caught in
   * verification with NEXTAUTH_SECRET missing — the route happily 303'd to "/"
   * for a browser that had no session, which then bounced to /login with no
   * explanation. On success the returned URL is the callback target we asked
   * for, so anything else is a failure and is treated as one.
   */
  const target = new URL(callbackPath, origin);
  const resolved = new URL(signedInTo, origin);
  if (resolved.href !== target.href) {
    console.error(
      `[no-js-login] sign-in resolved to ${resolved.pathname}, expected ${target.pathname} — no session was established`
    );
    return seeOther(request, `${LOGIN_ROUTE}?error=Configuration`);
  }

  return seeOther(request, callbackPath);
}
