"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Confirm before a destructive action. Design System: every destructive action
 * gets a confirm dialog.
 *
 * Generic on purpose. The milk module alone deletes deliveries, purchases and
 * sales, and retires farmers — four near-identical dialogs that would drift.
 * `DeleteSaleDialog` stays as it is: it is already shipped and verified, and
 * rewriting working screens is not what this phase is for.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  pendingLabel = "Working…",
  variant = "destructive",
  requireConfirmationText,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  pendingLabel?: string;
  variant?: "destructive" | "default";
  requireConfirmationText?: string;
  onConfirm: () => Promise<void>;
}) {
  const [isPending, setIsPending] = useState(false);
  const [typedValue, setTypedValue] = useState("");

  async function confirm() {
    setIsPending(true);
    try {
      await onConfirm();
      onOpenChange(false);
      setTypedValue("");
    } finally {
      // Runs even when onConfirm throws, so a failed action leaves a usable
      // dialog rather than a permanently spinning button.
      setIsPending(false);
    }
  }

  const confirmationRequired =
    requireConfirmationText !== undefined &&
    requireConfirmationText.trim().length > 0;
  const matchesConfirmationText =
    !confirmationRequired || typedValue === requireConfirmationText;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!isPending) {
          onOpenChange(next);
          if (!next) setTypedValue("");
        }
      }}
    >
      <DialogContent className="rounded-xl sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {confirmationRequired ? (
          <div className="mt-2 space-y-2">
            <label className="block text-sm font-medium text-zinc-700">
              Type "{requireConfirmationText}" to confirm
            </label>
            <input
              value={typedValue}
              onChange={(event) => setTypedValue(event.target.value)}
              placeholder={requireConfirmationText}
              className="h-11 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none ring-0 placeholder:text-zinc-400 focus:border-emerald-500"
              autoComplete="off"
            />
          </div>
        ) : null}

        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            variant="outline"
            className="h-11 rounded-lg"
            disabled={isPending}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            variant={variant}
            className="h-11 rounded-lg"
            disabled={isPending || !matchesConfirmationText}
            onClick={confirm}
          >
            {isPending ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />
                {pendingLabel}
              </>
            ) : (
              confirmLabel
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
