"use client";

import { useEffect, useState } from "react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  CUSTOMER_TYPES,
  CUSTOMER_TYPE_LABELS,
  type CustomerType,
} from "@/lib/validations/customers";

/**
 * Add or edit a customer. One dialog for both, because the fields are identical
 * and two would drift.
 *
 * The inline "add customer" popover on the sale form stays as it is — it exists
 * so the owner can add a walk-in without losing a half-typed sale. This is the
 * hub's version, where there's room for a proper dialog.
 */
export function CustomerDialog({
  open,
  onOpenChange,
  mode,
  initial,
  isPending,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "edit";
  initial?: { name: string; phone: string | null; type: CustomerType };
  isPending: boolean;
  onSubmit: (values: {
    name: string;
    phone: string | null;
    type: CustomerType;
  }) => void;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [type, setType] = useState<CustomerType>("shop");

  // Reseed whenever the dialog opens, so editing customer B never shows
  // customer A's details left over from the last time it was used.
  useEffect(() => {
    if (!open) return;
    setName(initial?.name ?? "");
    setPhone(initial?.phone ?? "");
    setType(initial?.type ?? "shop");
  }, [open, initial]);

  const trimmed = name.trim();
  const canSubmit = trimmed.length > 0 && !isPending;

  function submit() {
    if (!canSubmit) return;
    onSubmit({ name: trimmed, phone: phone.trim() || null, type });
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !isPending && onOpenChange(next)}>
      <DialogContent className="rounded-xl sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {mode === "create" ? "Add customer" : "Edit customer"}
          </DialogTitle>
          <DialogDescription>
            {mode === "create"
              ? "Hotels, shops and individuals you sell to."
              : "Changing these details doesn't affect past sales or payments."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="customer-name">Name</Label>
            <Input
              id="customer-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. Al Madina Hotel"
              className="h-11 rounded-lg"
              autoComplete="off"
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  submit();
                }
              }}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="customer-phone">Phone (optional)</Label>
            <Input
              id="customer-phone"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              placeholder="0300-1234567"
              inputMode="tel"
              className="h-11 rounded-lg"
              autoComplete="off"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="customer-type">Type</Label>
            <Select
              value={type}
              onValueChange={(next) => setType(next as CustomerType)}
            >
              <SelectTrigger id="customer-type" className="h-11 rounded-lg">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CUSTOMER_TYPES.map((customerType) => (
                  <SelectItem key={customerType} value={customerType}>
                    {CUSTOMER_TYPE_LABELS[customerType]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

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
            className="h-11 rounded-lg"
            disabled={!canSubmit}
            onClick={submit}
          >
            {isPending ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />
                Saving…
              </>
            ) : mode === "create" ? (
              "Add customer"
            ) : (
              "Save changes"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
