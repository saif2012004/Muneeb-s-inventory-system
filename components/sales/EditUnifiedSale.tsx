"use client";

import { LogIn, RefreshCw } from "lucide-react";

import { UnifiedSaleForm } from "@/components/sales/UnifiedSaleForm";
import { EmptyState } from "@/components/shared/EmptyState";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError, redirectToLogin } from "@/lib/api-client";
import { useUnifiedSale } from "@/lib/hooks/use-unified-sales";

/**
 * Loads one bill and hands it to the shared form in EDIT mode.
 *
 * A thin wrapper on purpose: the form is the same component the till uses, so
 * the two screens cannot drift on how a line renders, what a total says, or how
 * a stock refusal behaves. All this adds is the fetch and its three states.
 */
export function EditUnifiedSale({ saleId }: { saleId: string }) {
  const query = useUnifiedSale(saleId);

  if (query.isPending) {
    return (
      <>
        <PageHeader title="Edit sale" accent="zinc" />
        <div className="space-y-3">
          <Skeleton className="h-11 w-full rounded-lg" />
          <Skeleton className="h-11 w-full rounded-lg" />
          <Skeleton className="h-56 w-full rounded-xl" />
        </div>
      </>
    );
  }

  if (query.error) {
    const expired = query.error instanceof ApiError && query.error.isSessionExpired;
    return (
      <>
        <PageHeader title="Edit sale" accent="zinc" />
        <EmptyState
          icon={expired ? LogIn : RefreshCw}
          title={expired ? "Your session expired" : "Couldn't load this sale"}
          description={
            query.error instanceof ApiError
              ? query.error.message
              : "Something went wrong."
          }
          accent="zinc"
          action={
            <Button
              className="h-11 rounded-lg bg-zinc-900 hover:bg-zinc-800"
              onClick={() => (expired ? redirectToLogin() : query.refetch())}
            >
              {expired ? "Sign in" : "Try again"}
            </Button>
          }
        />
      </>
    );
  }

  if (!query.data) return null;

  return <UnifiedSaleForm sale={query.data} />;
}
