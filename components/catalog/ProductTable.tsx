"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { EyeOff, MoreHorizontal, Pencil, RotateCcw, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { InlinePriceEditor } from "@/components/catalog/InlinePriceEditor";
import { InlineStockEditor } from "@/components/catalog/InlineStockEditor";
import { formatQualityShape, formatSize } from "@/lib/catalog-display";
import type { Product } from "@/lib/hooks/use-catalog";
import { rowInOut } from "@/lib/motion";
import { cn } from "@/lib/utils";

export function ProductTable({
  products,
  includeInactive,
  onEdit,
  onDelete,
  onToggleActive,
}: {
  products: Product[];
  includeInactive: boolean;
  onEdit: (product: Product) => void;
  onDelete: (product: Product) => void;
  onToggleActive: (product: Product, nextActive: boolean) => void;
}) {
  // Design System: never animate against the user's stated preference.
  const reduceMotion = useReducedMotion();

  return (
    <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white">
      <Table>
        <TableHeader>
          {/* Design System: 13/medium uppercase-tracking table headers. */}
          <TableRow className="hover:bg-transparent">
            <TableHead className="text-[13px] font-medium uppercase tracking-wide text-zinc-500">
              Name
            </TableHead>
            <TableHead className="text-[13px] font-medium uppercase tracking-wide text-zinc-500">
              Size
            </TableHead>
            <TableHead className="text-[13px] font-medium uppercase tracking-wide text-zinc-500">
              Quality/Shape
            </TableHead>
            <TableHead className="text-right text-[13px] font-medium uppercase tracking-wide text-zinc-500">
              Price (PKR)
            </TableHead>
            <TableHead className="text-right text-[13px] font-medium uppercase tracking-wide text-zinc-500">
              Stock
            </TableHead>
            <TableHead className="w-12 text-right text-[13px] font-medium uppercase tracking-wide text-zinc-500">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>

        <TableBody>
          <AnimatePresence initial={false}>
            {products.map((product) => (
              <motion.tr
                key={product.id}
                layout={reduceMotion ? false : "position"}
                {...rowInOut(reduceMotion)}
                className={cn(
                  "border-b transition-colors last:border-0 hover:bg-zinc-50/70",
                  // Deactivated rows stay legible but visibly retired.
                  !product.isActive && "bg-zinc-50/60 opacity-60"
                )}
              >
                <TableCell className="font-medium text-zinc-900">
                  <div className="flex items-center gap-2">
                    <span className="truncate">{product.name}</span>
                    {!product.isActive ? (
                      <Badge
                        variant="secondary"
                        className="shrink-0 rounded-md text-[11px] font-medium"
                      >
                        Inactive
                      </Badge>
                    ) : null}
                  </div>
                  {product.unit ? (
                    <span className="text-xs text-zinc-500">
                      per {product.unit}
                    </span>
                  ) : null}
                  {/* SELLING UNITS (Migration F). Shown here because the pack a
                      product sells in, and how many base units that pack costs
                      the shelf, is catalog information the owner has to be able
                      to check without opening the edit dialog — a wrong factor
                      is the one value that silently drains a stock pool. */}
                  {product.units.length > 0 ? (
                    <span className="num block text-xs text-zinc-500">
                      {product.units
                        .map(
                          (unit) =>
                            `${unit.name} = ${unit.baseFactor} ${product.unit ?? "unit"}${
                              unit.baseFactor === 1 ? "" : "s"
                            }`
                        )
                        .join(" · ")}
                    </span>
                  ) : null}
                </TableCell>

                <TableCell className="tabular-nums text-zinc-600">
                  {formatSize(product.size)}
                </TableCell>

                <TableCell className="text-zinc-600">
                  {formatQualityShape(product)}
                </TableCell>

                <TableCell className="text-right">
                  <InlinePriceEditor
                    productId={product.id}
                    productName={product.name}
                    price={product.price}
                    includeInactive={includeInactive}
                    disabled={!product.isActive}
                  />
                </TableCell>

                {/* Stock sits next to price on purpose: they are the two numbers
                    the owner maintains per product, and they are edited the same
                    way. Every other movement of this figure comes from a sale. */}
                <TableCell className="text-right">
                  <InlineStockEditor
                    productId={product.id}
                    productName={product.name}
                    stock={product.stock}
                    unit={product.unit}
                    includeInactive={includeInactive}
                    disabled={!product.isActive}
                  />
                </TableCell>

                <TableCell className="text-right">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-11 rounded-lg md:size-9"
                      >
                        <MoreHorizontal className="size-4" aria-hidden />
                        <span className="sr-only">
                          Actions for {product.name}
                        </span>
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-48">
                      <DropdownMenuItem onSelect={() => onEdit(product)}>
                        <Pencil className="mr-2 size-4" aria-hidden />
                        Edit
                      </DropdownMenuItem>

                      {product.isActive ? (
                        <DropdownMenuItem
                          onSelect={() => onToggleActive(product, false)}
                        >
                          <EyeOff className="mr-2 size-4" aria-hidden />
                          Deactivate
                        </DropdownMenuItem>
                      ) : (
                        <DropdownMenuItem
                          onSelect={() => onToggleActive(product, true)}
                        >
                          <RotateCcw className="mr-2 size-4" aria-hidden />
                          Reactivate
                        </DropdownMenuItem>
                      )}

                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="text-rose-600 focus:bg-rose-50 focus:text-rose-700"
                        onSelect={() => onDelete(product)}
                      >
                        <Trash2 className="mr-2 size-4" aria-hidden />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </motion.tr>
            ))}
          </AnimatePresence>
        </TableBody>
      </Table>
    </div>
  );
}
