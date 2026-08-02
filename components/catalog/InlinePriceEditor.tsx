"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { ApiError } from "@/lib/api-client";
import { formatCatalogPrice } from "@/lib/catalog-display";
import { useUpdateProductPrice } from "@/lib/hooks/use-catalog";
import { cn } from "@/lib/utils";

/**
 * Click the price to edit it. Commits on Enter or blur, cancels on Escape.
 *
 * The mutation is optimistic (see useUpdateProductPrice): the new figure shows
 * instantly and the cache rolls back to its previous snapshot if the request
 * fails, so a failed save can never leave a wrong price on screen.
 */
export function InlinePriceEditor({
  productId,
  productName,
  price,
  includeInactive,
  disabled,
}: {
  productId: string;
  productName: string;
  price: number;
  includeInactive: boolean;
  disabled?: boolean;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(String(price));
  const inputRef = useRef<HTMLInputElement>(null);
  // Enter triggers blur, which would otherwise commit the same edit twice.
  const committedRef = useRef(false);

  const updatePrice = useUpdateProductPrice(includeInactive);

  useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [isEditing]);

  function startEditing() {
    if (disabled) return;
    setDraft(price === 0 ? "" : String(price));
    committedRef.current = false;
    setIsEditing(true);
  }

  function cancel() {
    committedRef.current = true;
    setIsEditing(false);
  }

  function commit() {
    if (committedRef.current) return;
    committedRef.current = true;
    setIsEditing(false);

    const trimmed = draft.trim();
    const nextPrice = trimmed === "" ? 0 : Number(trimmed);

    // Mirrors the server rule in lib/validations/catalog.ts, so an obviously
    // bad value never costs a round-trip.
    if (!Number.isFinite(nextPrice) || nextPrice < 0) {
      toast.error("Enter a price of 0 or more.");
      return;
    }
    if (nextPrice === price) return;

    updatePrice.mutate(
      { id: productId, price: nextPrice },
      {
        onSuccess: () =>
          toast.success(`${productName} set to ${formatCatalogPrice(nextPrice)}`),
        onError: (error) =>
          toast.error(
            error instanceof ApiError
              ? error.message
              : "Couldn't save the price. Please try again."
          ),
      }
    );
  }

  if (isEditing) {
    return (
      <input
        ref={inputRef}
        type="text"
        // Design System: numeric inputs use inputMode="decimal" so the phone
        // shows a number pad instead of the full keyboard.
        inputMode="decimal"
        value={draft}
        aria-label={`Price for ${productName}`}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit();
          }
          if (event.key === "Escape") {
            event.preventDefault();
            cancel();
          }
        }}
        className="h-9 w-28 rounded-lg border border-zinc-300 bg-white px-2 text-right text-sm tabular-nums text-zinc-900 outline-none ring-2 ring-zinc-900/10 focus:border-zinc-400"
      />
    );
  }

  return (
    <button
      type="button"
      onClick={startEditing}
      disabled={disabled}
      // 44px min touch target per the Design System.
      className={cn(
        "inline-flex h-9 min-h-[44px] items-center justify-end gap-2 rounded-lg px-2 text-sm tabular-nums transition-colors md:min-h-0",
        disabled
          ? "cursor-default text-zinc-400"
          : "text-zinc-900 hover:bg-zinc-100",
        price === 0 && !disabled && "text-zinc-400"
      )}
      title={disabled ? undefined : "Click to edit price"}
    >
      {updatePrice.isPending ? (
        <Loader2 className="size-3.5 animate-spin text-zinc-400" aria-hidden />
      ) : null}
      {price === 0 ? "Set price" : formatCatalogPrice(price)}
    </button>
  );
}
