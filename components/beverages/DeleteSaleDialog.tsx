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
 * Confirm before deleting a sale. Design System: every destructive action gets
 * a confirm dialog.
 *
 * Worded plainly because this one really is irreversible — unlike a Product,
 * nothing references a sale, so the API hard-deletes it and its lines. There is
 * no soft-delete fallback to soften the wording with.
 */
export function DeleteSaleDialog({
  open,
  onOpenChange,
  customerName,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customerName: string;
  onConfirm: () => Promise<void>;
}) {
  const [isDeleting, setIsDeleting] = useState(false);

  async function confirm() {
    setIsDeleting(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } finally {
      // Runs even when onConfirm throws, so a failed delete leaves a usable
      // dialog rather than a permanently spinning button.
      setIsDeleting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !isDeleting && onOpenChange(next)}>
      <DialogContent className="rounded-xl sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delete this sale?</DialogTitle>
          <DialogDescription>
            The sale to {customerName} and all of its line items will be removed
            permanently. This can&apos;t be undone.
          </DialogDescription>
        </DialogHeader>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            variant="outline"
            className="h-11 rounded-lg"
            disabled={isDeleting}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            className="h-11 rounded-lg"
            disabled={isDeleting}
            onClick={confirm}
          >
            {isDeleting ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />
                Deleting…
              </>
            ) : (
              "Delete sale"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
