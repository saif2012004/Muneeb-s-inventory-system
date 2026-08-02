"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Loader2, ShieldAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ApiError, redirectToLogin, type BlockingProduct } from "@/lib/api-client";

/**
 * Confirm dialog for every catalog delete. Design System: destructive actions
 * always confirm.
 *
 * The important part is the 409 branch. lib/catalog-guards.ts refuses to delete
 * anything with sale history and returns a message that already names the
 * blocking products and says what to do instead. That message is shown
 * VERBATIM — a refused delete is a correct, expected outcome, not a crash, so
 * it must never be flattened into "Delete failed".
 */
export function DeleteDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Delete",
  onConfirm,
  secondaryAction,
  onDeactivateBlocked,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel?: string;
  /** Rejects with an ApiError; a 409 is handled here, not by the caller. */
  onConfirm: () => Promise<void>;
  /**
   * Offered alongside Delete where a non-destructive alternative exists —
   * e.g. deactivating a product instead of removing it.
   */
  secondaryAction?: { label: string; run: () => Promise<void> };
  /**
   * Bulk-deactivates the products named in a 409 `blockedBy`, by id. Acts on
   * the structured payload — the prose message is never parsed.
   */
  onDeactivateBlocked?: (products: BlockingProduct[]) => Promise<void>;
}) {
  const [isPending, setIsPending] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [blockedBy, setBlockedBy] = useState<BlockingProduct[]>([]);
  const [error, setError] = useState<string | null>(null);

  // A reopened dialog must not still show the previous attempt's refusal.
  useEffect(() => {
    if (open) {
      setRefusal(null);
      setBlockedBy([]);
      setError(null);
      setIsPending(false);
    }
  }, [open]);

  async function run(action: () => Promise<void>) {
    setIsPending(true);
    setRefusal(null);
    setError(null);
    try {
      await action();
      onOpenChange(false);
    } catch (caught) {
      if (caught instanceof ApiError) {
        if (caught.isSessionExpired) {
          redirectToLogin();
          return;
        }
        if (caught.isBlockedByHistory) {
          setRefusal(caught.message);
          setBlockedBy(caught.blockedBy);
          return;
        }
        setError(caught.message);
        return;
      }
      setError("Something went wrong. Please try again.");
    } finally {
      setIsPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-xl sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {refusal ? (
          // Amber, not rose: nothing broke and nothing was lost. The delete was
          // declined on purpose to protect sale history.
          <div className="flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
            <ShieldAlert
              className="mt-0.5 size-5 shrink-0 text-amber-600"
              aria-hidden
            />
            <div className="min-w-0">
              <p className="text-sm font-medium text-amber-900">
                This can&apos;t be deleted
              </p>
              <p className="mt-1 text-sm text-amber-800">{refusal}</p>

              {/* Rendered from the structured blockedBy payload, so the full
                  list shows even when the message abbreviates it to
                  "and N more". */}
              {blockedBy.length > 0 ? (
                <ul className="mt-3 space-y-1">
                  {blockedBy.map((product) => (
                    <li
                      key={product.id}
                      className="flex items-baseline justify-between gap-3 text-sm text-amber-900"
                    >
                      <span className="truncate">{product.name}</span>
                      <span className="shrink-0 text-xs tabular-nums text-amber-700">
                        {product.saleCount}{" "}
                        {product.saleCount === 1 ? "sale" : "sales"}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}

              <p className="mt-3 text-xs text-amber-700">
                Deactivating retires these products from new sales. It does not
                make this deletable — the sales history is kept either way.
              </p>
            </div>
          </div>
        ) : null}

        {error ? (
          <div className="flex gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4">
            <AlertTriangle
              className="mt-0.5 size-5 shrink-0 text-rose-600"
              aria-hidden
            />
            <p className="text-sm text-rose-800">{error}</p>
          </div>
        ) : null}

        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            type="button"
            variant="outline"
            className="h-11 rounded-lg"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            {refusal ? "Close" : "Cancel"}
          </Button>

          {refusal && blockedBy.length > 0 && onDeactivateBlocked ? (
            <Button
              type="button"
              variant="secondary"
              className="h-11 rounded-lg"
              disabled={isPending}
              onClick={() => run(() => onDeactivateBlocked(blockedBy))}
            >
              {isPending ? (
                <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />
              ) : null}
              Deactivate these
            </Button>
          ) : null}

          {secondaryAction && !refusal ? (
            <Button
              type="button"
              variant="secondary"
              className="h-11 rounded-lg"
              onClick={() => run(secondaryAction.run)}
              disabled={isPending}
            >
              {secondaryAction.label}
            </Button>
          ) : null}

          {/* Once refused, the destructive button is gone — re-clicking it
              would just fail again and read as a broken button. */}
          {refusal ? null : (
            <Button
              type="button"
              variant="destructive"
              className="h-11 rounded-lg"
              onClick={() => run(onConfirm)}
              disabled={isPending}
            >
              {isPending ? (
                <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />
              ) : null}
              {confirmLabel}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
