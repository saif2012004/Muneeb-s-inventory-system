/**
 * The single fetch path for every browser -> API call.
 *
 * Phase 2.1 made signed-out `/api/` requests return
 * `401 { data: null, error: "You must be signed in." }` instead of a 307 to the
 * HTML login page (see Gotcha 3 / Authentication in CLAUDE.md). That fix only
 * pays off if the client stops assuming success: this module unwraps the
 * `{ data, error }` envelope, and turns every non-OK response into an ApiError
 * carrying the server's own message. Nothing calls `fetch` directly.
 */
import { LOGIN_ROUTE } from "@/lib/routes";

/** A product blocking a delete, as returned in a 409 `blockedBy`. */
export type BlockingProduct = { id: string; name: string; saleCount: number };

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** Populated on a 409 from the catalog delete guard. */
    readonly blockedBy: BlockingProduct[] = []
  ) {
    super(message);
    this.name = "ApiError";
  }

  /** Session gone. The UI must offer a way back to /login, not a retry. */
  get isSessionExpired(): boolean {
    return this.status === 401;
  }

  /**
   * The catalog delete guard refused (lib/catalog-guards.ts). `message` is the
   * server's own text — it names the blocking products and says to deactivate
   * instead — so it must be shown verbatim, never replaced with "Delete failed".
   */
  get isBlockedByHistory(): boolean {
    return this.status === 409;
  }
}

export const SESSION_EXPIRED_MESSAGE =
  "Your session expired — please sign in again.";

type ApiEnvelope<T> =
  | { data: T; error: null }
  | { data: null; error: string; blockedBy?: BlockingProduct[] };

/**
 * How long to wait before giving up on a request.
 *
 * A dropped connection rejects `fetch` immediately, but a STALLED one — the
 * normal failure mode on patchy mobile data, which is what the owner is on —
 * never settles at all. Without a deadline the promise hangs forever, and every
 * caller that disables a button while pending stays disabled forever with it:
 * "Saving…" that never resolves and cannot be retried.
 *
 * 15s is comfortably above a slow-but-working request to a cold serverless
 * function, and well below the point where someone assumes the app is broken.
 */
const REQUEST_TIMEOUT_MS = 15_000;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers: { "Content-Type": "application/json", ...init?.headers },
      // A timeout fires as an AbortError, which lands in the catch below and
      // becomes the same friendly "can't reach the server" ApiError as a hard
      // network failure — from the owner's side the two are the same problem.
      signal: init?.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    // Network-level failure: offline, DNS, connection reset, or our own timeout.
    throw new ApiError(0, "Can't reach the server. Check your connection.");
  }

  if (response.status === 401) {
    throw new ApiError(401, SESSION_EXPIRED_MESSAGE);
  }

  // A non-JSON body means something upstream answered instead of our route
  // (an HTML error page, a proxy). Don't let res.json() throw an opaque
  // SyntaxError — that is exactly the failure mode 2.1 set out to remove.
  let envelope: ApiEnvelope<T>;
  try {
    envelope = (await response.json()) as ApiEnvelope<T>;
  } catch {
    throw new ApiError(
      response.status,
      "The server sent an unexpected response. Please try again."
    );
  }

  if (!response.ok || envelope.error !== null) {
    throw new ApiError(
      response.status,
      envelope.error ?? "Something went wrong. Please try again.",
      // Present only on a 409 from the delete guard; [] everywhere else.
      "blockedBy" in envelope ? (envelope.blockedBy ?? []) : []
    );
  }

  return envelope.data as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "POST", body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};

/** Send the owner back to sign in, preserving where they were. */
export function redirectToLogin(): void {
  const callbackUrl = encodeURIComponent(
    window.location.pathname + window.location.search
  );
  window.location.href = `${LOGIN_ROUTE}?callbackUrl=${callbackUrl}`;
}
