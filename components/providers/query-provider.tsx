"use client";

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * `networkMode: "always"` on both queries and mutations, deliberately.
 *
 * TanStack Query's default is `"online"`, which PAUSES any query or mutation
 * while `navigator.onLine` is false — it never calls the fetcher at all. On a
 * form that disables its submit button while pending, that reads as a permanent
 * "Saving…": no request, no error, no toast, no way out, until connectivity
 * happens to return. Verified in the browser: the button sat disabled
 * indefinitely and no request was ever issued.
 *
 * `"always"` makes the request actually run, so it fails fast and lands in
 * lib/api-client's catch as "Can't reach the server. Check your connection." —
 * the button re-enables and the owner can retry. A visible, retryable error
 * beats a silent freeze. This works together with the request timeout in
 * api-client, which covers the other case: a connection that is technically up
 * but stalled.
 */
export function QueryProvider({ children }: { children: React.ReactNode }) {
  // Created inside state so the client is never shared across requests on the
  // server, and never re-created on re-render in the browser.
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            /**
             * CACHING IS WORTH MORE HERE THAN IN A NORMAL APP.
             *
             * A single database round trip from the deployed function to
             * Supabase costs about **1.07 seconds** — the function runs in
             * `iad1` (Washington) and the database is in `ap-northeast-2`
             * (Seoul). Measured, not estimated. So every avoided refetch is
             * roughly a second the owner does not wait, and a screen that
             * refetches on every visit feels broken on a phone.
             *
             * 5 minutes: navigating away and back — the single most common
             * thing the owner does — serves instantly from cache with no
             * request at all. This is safe because **every mutation
             * invalidates explicitly**, so a write is always reflected
             * immediately; `staleTime` only governs background refreshing of
             * data nobody changed.
             */
            staleTime: 5 * 60 * 1000,
            /**
             * Keep it in memory well past `staleTime`, so returning to a screen
             * shows the previous numbers instantly and refreshes behind them,
             * rather than dropping to skeletons for a second per query.
             */
            gcTime: 30 * 60 * 1000,
            // Single owner, usually one device: a background refetch every time
            // they switch apps costs seconds and buys nothing.
            refetchOnWindowFocus: false,
            /**
             * `refetchOnMount` is deliberately LEFT AT ITS DEFAULT ("refetch if
             * stale"). Setting it to false was tempting — it would skip even
             * more requests — but it would also mean genuinely stale data never
             * refreshes on its own, which is how this app got a dashboard that
             * would not update in the first place. `staleTime` above already
             * gives the fast path; this keeps the correct one.
             */
            retry: 1,
            networkMode: "always",
          },
          mutations: {
            networkMode: "always",
          },
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
