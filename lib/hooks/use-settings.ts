"use client";

/**
 * TanStack Query bindings for /api/settings.
 *
 * One query, one mutation. The mutation writes the server's response straight
 * into the cache with `setQueryData` INSTEAD of invalidating: settings is a
 * single row that the response already contains in full, so a refetch would buy
 * nothing and cost another ~1.1s round trip (CHECKLIST #14).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api-client";
import type { Settings } from "@/lib/settings-display";
import type { SettingsUpdateInput } from "@/lib/validations/settings";

export const settingsKeys = {
  all: ["settings"] as const,
};

export function useSettings() {
  return useQuery({
    queryKey: settingsKeys.all,
    queryFn: () => api.get<Settings>("/api/settings"),
  });
}

export function useUpdateSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SettingsUpdateInput) =>
      api.patch<Settings>("/api/settings", input),
    onSuccess: (settings) => {
      queryClient.setQueryData(settingsKeys.all, settings);
    },
  });
}
