"use client";

import { useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { SaleBrandGroup, SaleProductOption } from "@/lib/sale-catalog";
import { cn } from "@/lib/utils";

/**
 * Grouped product picker, shared by every sale module.
 *
 * Rows are grouped by brand (the SubCategory) and labelled with whatever
 * attributes the product actually carries. cmdk searches the composed label, so
 * any fragment reaches the row: "1.5", "30", "premium", "circle".
 *
 * ---------------------------------------------------------------------------
 * DEGRADING FOR PRODUCTS WITH NO ATTRIBUTES
 * ---------------------------------------------------------------------------
 * Beverages always have a size, so a row could safely show `detail` alone
 * ("1.5L › 30% off") under the group heading. Bakery cannot: Buns and Eggs have
 * no size, no tier and no shape, so their detail is EMPTY.
 *
 * A row is therefore rendered as:
 *   detail present -> the detail        ("Large › Circle", "1.5L › 30% off")
 *   detail empty   -> the brand itself  ("Buns", "Eggs")
 *
 * so a brand whose product carries no attributes reads as a single named choice
 * rather than a heading above a blank row.
 */
export function ProductPicker({
  groups,
  selected,
  onSelect,
  invalid,
  searchPlaceholder = "Search products…",
}: {
  groups: SaleBrandGroup[];
  selected: SaleProductOption | undefined;
  onSelect: (option: SaleProductOption) => void;
  invalid?: boolean;
  searchPlaceholder?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn(
            "h-11 w-full justify-between rounded-lg text-left font-normal",
            invalid && "border-rose-400 focus-visible:ring-rose-400"
          )}
        >
          {selected ? (
            <span className="flex min-w-0 flex-col leading-tight">
              <span className="truncate font-medium text-zinc-900">
                {selected.brand}
              </span>
              {selected.detail ? (
                <span className="truncate text-xs text-zinc-500">
                  {selected.detail}
                </span>
              ) : null}
            </span>
          ) : (
            <span className="text-zinc-500">Choose a product…</span>
          )}
          <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" aria-hidden />
        </Button>
      </PopoverTrigger>

      <PopoverContent className="w-[min(360px,90vw)] p-0" align="start">
        <Command>
          <CommandInput placeholder={searchPlaceholder} className="h-11" />
          <CommandList>
            <CommandEmpty>
              <span className="text-sm text-zinc-500">No product found.</span>
            </CommandEmpty>

            {groups.map((group) => (
              <CommandGroup key={group.brand} heading={group.brand}>
                {group.options.map((option) => (
                  <CommandItem
                    key={option.product.id}
                    value={option.label}
                    onSelect={() => {
                      onSelect(option);
                      setOpen(false);
                    }}
                    className="h-11 cursor-pointer"
                  >
                    <Check
                      className={cn(
                        "mr-2 size-4 shrink-0",
                        option.product.id === selected?.product.id
                          ? "opacity-100"
                          : "opacity-0"
                      )}
                      aria-hidden
                    />
                    {/* Falls back to the brand so an attribute-less product
                        (Buns, Eggs) still names itself instead of rendering an
                        empty row under its own heading. */}
                    <span className="flex-1 truncate">
                      {option.detail || option.brand}
                    </span>
                    {/* Seeded products all sit at 0 until priced. Flagging it
                        before selection saves a surprise in the price field. */}
                    {option.needsPrice ? (
                      <span className="ml-2 shrink-0 text-xs text-amber-600">
                        set price
                      </span>
                    ) : null}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
