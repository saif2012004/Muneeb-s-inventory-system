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
            // Avoid refetching immediately on the client after SSR.
            staleTime: 30 * 1000,
            refetchOnWindowFocus: false,
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
