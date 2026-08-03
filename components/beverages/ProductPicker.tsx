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
import type { BeverageBrandGroup, BeverageOption } from "@/lib/beverage-catalog";
import { cn } from "@/lib/utils";

/**
 * Grouped product picker: Brand → Size → discount tier.
 *
 * Grouped rather than three chained selects because the owner already knows the
 * whole thing as one name — "Pepsi 1.5 the thirty" — and typing "1.5" or "30"
 * should reach it in one gesture. cmdk searches the composed label, so any
 * fragment of brand, size or tier narrows the list.
 */
export function ProductPicker({
  groups,
  selected,
  onSelect,
  invalid,
}: {
  groups: BeverageBrandGroup[];
  selected: BeverageOption | undefined;
  onSelect: (option: BeverageOption) => void;
  invalid?: boolean;
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
          <CommandInput placeholder="Brand, size or discount…" className="h-11" />
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
                    <span className="flex-1 truncate">
                      {option.detail || option.brand}
                    </span>
                    {/* Seeded products all sit at 0 until the owner prices
                        them. Flagging it here, before selection, saves a
                        surprise in the price field. */}
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
