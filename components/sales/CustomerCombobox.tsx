"use client";

import { useState } from "react";
import { Check, ChevronsUpDown, Loader2, UserPlus, X } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useCreateCustomer, type Customer } from "@/lib/hooks/use-customers";
import type { AccentKey } from "@/lib/nav";
import { MODULE_BUTTON_CLASS, MODULE_RING_CLASS } from "@/lib/nav";
import { cn } from "@/lib/utils";
import {
  CUSTOMER_TYPES,
  CUSTOMER_TYPE_LABELS,
  type CustomerType,
} from "@/lib/validations/customers";

/**
 * Customer picker for the new-sale form.
 *
 * Two states by design: nothing chosen shows a searchable combobox; a choice
 * shows a removable chip. A shop owner records several sales to the same
 * customer in a row, so the selected state has to be obvious at a glance and
 * cheap to correct.
 */
export function CustomerCombobox({
  customers,
  isLoading,
  value,
  onChange,
  invalid,
  accent = "zinc",
  id,
}: {
  customers: Customer[];
  isLoading: boolean;
  value: string;
  onChange: (customerId: string) => void;
  invalid?: boolean;
  /**
   * Put on the TRIGGER, so the caller's <Label htmlFor> actually reaches a
   * focusable control. Without it the label pointed at nothing: clicking it did
   * nothing, screen readers got no association, and a failed submit had no
   * element to scroll to.
   */
  id?: string;
  /** Module accent, so the picker matches the screen it sits on. */
  accent?: AccentKey;
}) {
  const [open, setOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

  const selected = customers.find((customer) => customer.id === value);

  if (isLoading) {
    return <Skeleton className="h-11 w-full rounded-lg" />;
  }

  if (selected) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Badge
          variant="secondary"
          className="h-11 gap-2 rounded-lg px-3 text-sm font-medium"
        >
          <span className="max-w-[220px] truncate">{selected.name}</span>
          <span className="text-xs font-normal text-zinc-500">
            {CUSTOMER_TYPE_LABELS[selected.type]}
          </span>
          <button
            type="button"
            // 44px touch target, per the Design System — the visual chip is
            // shorter than the hit area on purpose.
            className={cn(
              "-mr-1 flex size-8 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-200 hover:text-zinc-900 focus-visible:outline-none focus-visible:ring-2",
              MODULE_RING_CLASS[accent]
            )}
            onClick={() => onChange("")}
          >
            <X className="size-4" aria-hidden />
            <span className="sr-only">Clear customer {selected.name}</span>
          </button>
        </Badge>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className={cn(
              "h-11 min-w-[220px] flex-1 justify-between rounded-lg font-normal",
              invalid && "border-rose-400 focus-visible:ring-rose-400"
            )}
          >
            <span className="text-zinc-500">Search customers…</span>
            <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" aria-hidden />
          </Button>
        </PopoverTrigger>

        <PopoverContent className="w-[min(320px,90vw)] p-0" align="start">
          <Command>
            <CommandInput placeholder="Search by name…" className="h-11" />
            <CommandList>
              <CommandEmpty>
                <span className="text-sm text-zinc-500">
                  No customer found. Add them below.
                </span>
              </CommandEmpty>
              <CommandGroup>
                {customers.map((customer) => (
                  <CommandItem
                    key={customer.id}
                    // `value` is what cmdk searches; the id alone is unsearchable.
                    value={`${customer.name} ${customer.phone ?? ""}`}
                    onSelect={() => {
                      onChange(customer.id);
                      setOpen(false);
                    }}
                    className="h-11 cursor-pointer"
                  >
                    <Check
                      className={cn(
                        "mr-2 size-4",
                        customer.id === value ? "opacity-100" : "opacity-0"
                      )}
                      aria-hidden
                    />
                    <span className="flex-1 truncate">{customer.name}</span>
                    <span className="ml-2 shrink-0 text-xs text-zinc-500">
                      {CUSTOMER_TYPE_LABELS[customer.type]}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      <AddCustomerPopover
        open={addOpen}
        onOpenChange={setAddOpen}
        accent={accent}
        onCreated={(customer) => {
          onChange(customer.id);
          setAddOpen(false);
        }}
      />
    </div>
  );
}

/**
 * Inline "add customer". A new hotel walking in mid-sale must not force the
 * owner out to the customers page and back, losing the lines they have typed.
 */
function AddCustomerPopover({
  open,
  onOpenChange,
  onCreated,
  accent,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (customer: Customer) => void;
  accent: AccentKey;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [type, setType] = useState<CustomerType>("shop");

  const createCustomer = useCreateCustomer();
  const trimmedName = name.trim();

  function submit() {
    if (trimmedName.length === 0) return;

    createCustomer.mutate(
      { name: trimmedName, phone: phone.trim() || null, type },
      {
        onSuccess: (customer) => {
          toast.success(`${customer.name} added`);
          setName("");
          setPhone("");
          setType("shop");
          onCreated(customer);
        },
        // The server's message is specific ("A customer named X already
        // exists."), so show it rather than a generic failure.
        onError: (error) => toast.error(error.message),
      }
    );
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className="h-11 shrink-0 rounded-lg"
        >
          <UserPlus className="mr-2 size-4" aria-hidden />
          New
        </Button>
      </PopoverTrigger>

      <PopoverContent className="w-[min(320px,90vw)] space-y-3" align="end">
        <p className="text-[15px] font-semibold text-zinc-900">Add customer</p>

        <div className="space-y-1.5">
          <Label htmlFor="new-customer-name">Name</Label>
          <Input
            id="new-customer-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. Al Madina Hotel"
            className="h-11 rounded-lg"
            autoComplete="off"
            onKeyDown={(event) => {
              // Enter submits the popover, not the sale form behind it.
              if (event.key === "Enter") {
                event.preventDefault();
                submit();
              }
            }}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="new-customer-phone">Phone (optional)</Label>
          <Input
            id="new-customer-phone"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            placeholder="0300-1234567"
            inputMode="tel"
            className="h-11 rounded-lg"
            autoComplete="off"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="new-customer-type">Type</Label>
          <Select value={type} onValueChange={(next) => setType(next as CustomerType)}>
            <SelectTrigger id="new-customer-type" className="h-11 rounded-lg">
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

        <Button
          type="button"
          className={cn("h-11 w-full rounded-lg", MODULE_BUTTON_CLASS[accent])}
          disabled={trimmedName.length === 0 || createCustomer.isPending}
          onClick={submit}
        >
          {createCustomer.isPending ? (
            <>
              <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />
              Adding…
            </>
          ) : (
            "Add customer"
          )}
        </Button>
      </PopoverContent>
    </Popover>
  );
}
