"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { ApiError } from "@/lib/api-client";
import { useUpdateProductStock } from "@/lib/hooks/use-catalog";
import { cn } from "@/lib/utils";

/**
 * Click the stock figure to edit it. Commits on Enter or blur, cancels on Escape.
 *
 * Deliberately the same interaction as InlinePriceEditor sitting beside it —
 * two adjacent editable numbers that behaved differently would be a trap, and
 * the owner learns one gesture for both.
 *
 * ---------------------------------------------------------------------------
 * THIS SETS STOCK, IT DOES NOT ADJUST IT
 * ---------------------------------------------------------------------------
 * The value typed here becomes the stock, full stop. Every RELATIVE movement
 * (-8 for a sale, +8 when that sale is deleted, ±the difference on an edit) is
 * owned by the sale routes and happens inside their transactions. Keeping the
 * two apart is what stops a restock and a sale racing to read-modify-write the
 * same row: this writes an absolute, they write a guarded increment.
 *
 * Blank is NOT treated as 0, unlike the price editor. There, blank plausibly
 * means "no price set yet"; here it is far more likely to be a half-finished
 * edit, and turning it into "zero units, every sale now blocked" is not a guess
 * worth making. Blank cancels.
 */
export function InlineStockEditor({
  productId,
  productName,
  stock,
  includeInactive,
  disabled,
  autoFocus,
}: {
  productId: string;
  productName: string;
  stock: number;
  includeInactive: boolean;
  disabled?: boolean;
  /** Opens straight into edit mode — used by the Restock action. */
  autoFocus?: boolean;
}) {
  const [isEditing, setIsEditing] = useState(Boolean(autoFocus));
  const [draft, setDraft] = useState(String(stock));
  const inputRef = useRef<HTMLInputElement>(null);
  // Enter triggers blur, which would otherwise commit the same edit twice.
  const committedRef = useRef(false);

  const updateStock = useUpdateProductStock(includeInactive);

  useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [isEditing]);

  function startEditing() {
    if (disabled) return;
    setDraft(String(stock));
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
    // See the note above: a blank box is an abandoned edit, not "zero units".
    if (trimmed === "") return;

    const next = Number(trimmed);

    // Mirrors the server rule in lib/validations/catalog.ts, so an obviously bad
    // value never costs a round trip.
    if (!Number.isFinite(next) || !Number.isInteger(next) || next < 0) {
      toast.error("Enter a whole number of units, 0 or more.");
      return;
    }
    if (next === stock) return;

    updateStock.mutate(
      { id: productId, stock: next },
      {
        onSuccess: () =>
          toast.success(
            `${productName}: ${next} ${next === 1 ? "unit" : "units"} in stock`
          ),
        onError: (error) =>
          toast.error(
            error instanceof ApiError
              ? error.message
              : "Couldn't save the stock. Please try again."
          ),
      }
    );
  }

  if (isEditing) {
    return (
      <input
        ref={inputRef}
        type="text"
        // Design System: numeric inputs open the phone's number pad.
        inputMode="numeric"
        value={draft}
        aria-label={`Stock for ${productName}`}
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
        className="h-9 w-20 rounded-lg border border-zinc-300 bg-white px-2 text-right text-sm tabular-nums text-zinc-900 outline-none ring-2 ring-zinc-900/10 focus:border-zinc-400"
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
        // Out of stock is the state that BLOCKS sales, so it is the one state
        // worth colouring — the owner should be able to spot it while scrolling
        // rather than discovering it when a sale is refused.
        stock === 0 && !disabled && "font-medium text-rose-600"
      )}
      title={disabled ? undefined : "Click to edit stock"}
    >
      {updateStock.isPending ? (
        <Loader2 className="size-3.5 animate-spin text-zinc-400" aria-hidden />
      ) : null}
      {stock === 0 ? "Out of stock" : stock}
    </button>
  );
}
