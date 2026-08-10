"use client";

import { useMemo, useState } from "react";
import {
  MoreHorizontal,
  FolderPlus,
  LogIn,
  Package,
  PackagePlus,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { DeleteDialog } from "@/components/catalog/DeleteDialog";
import { NameDialog } from "@/components/catalog/NameDialog";
import { ProductDialog } from "@/components/catalog/ProductDialog";
import { ProductTable } from "@/components/catalog/ProductTable";
import { EmptyState } from "@/components/shared/EmptyState";
import { PageHeader } from "@/components/shared/PageHeader";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { ApiError, redirectToLogin } from "@/lib/api-client";
import { categoryAccent } from "@/lib/catalog-display";
import {
  useCategories,
  useCreateCategory,
  useCreateProduct,
  useCreateSubCategory,
  useDeleteCategory,
  useDeleteProduct,
  useDeleteSubCategory,
  useProducts,
  useRenameCategory,
  useRenameSubCategory,
  useUpdateProduct,
  type CategoryNode,
  type Product,
  type ProductWriteInput,
  type SubCategoryNode,
} from "@/lib/hooks/use-catalog";
import { ACCENTS } from "@/lib/nav";
import { cn } from "@/lib/utils";

type DialogState =
  | { kind: "none" }
  | { kind: "add-category" }
  | { kind: "rename-category"; category: CategoryNode }
  | { kind: "delete-category"; category: CategoryNode }
  | { kind: "add-subcategory"; category: CategoryNode }
  | { kind: "rename-subcategory"; subCategory: SubCategoryNode }
  | { kind: "delete-subcategory"; subCategory: SubCategoryNode }
  | { kind: "add-product"; subCategory: SubCategoryNode }
  | { kind: "edit-product"; product: Product; subCategory: SubCategoryNode }
  | { kind: "delete-product"; product: Product };

export function CatalogManager() {
  const [includeInactive, setIncludeInactive] = useState(false);
  const [dialog, setDialog] = useState<DialogState>({ kind: "none" });

  const categoriesQuery = useCategories();
  const productsQuery = useProducts(includeInactive);

  const createCategory = useCreateCategory();
  const renameCategory = useRenameCategory();
  const deleteCategory = useDeleteCategory();
  const createSubCategory = useCreateSubCategory();
  const renameSubCategory = useRenameSubCategory();
  const deleteSubCategory = useDeleteSubCategory();
  const createProduct = useCreateProduct();
  const updateProduct = useUpdateProduct();
  const deleteProduct = useDeleteProduct();

  const close = () => setDialog({ kind: "none" });

  /**
   * Bulk-deactivate the products a 409 named, by id from the structured
   * `blockedBy` payload. Sequential rather than parallel: these lists are
   * short, and one failure shouldn't leave a half-applied batch ambiguous.
   *
   * This does NOT then retry the delete. Deactivating retires the products
   * from future sales; the category or sub-category stays, because its sales
   * history has to. Saying otherwise would be a lie the next click exposes.
   */
  async function deactivateBlocked(products: { id: string; name: string }[]) {
    for (const product of products) {
      await updateProduct.mutateAsync({ id: product.id, isActive: false });
    }
    toast.success(
      products.length === 1
        ? `${products[0].name} deactivated`
        : `${products.length} products deactivated`
    );
  }

  /**
   * Every non-delete mutation funnels through here. A 401 is not a retryable
   * error — the session is gone, so say so plainly and send them to sign in
   * rather than showing a toast they can't act on.
   */
  function reportError(error: unknown, fallback: string) {
    if (error instanceof ApiError) {
      if (error.isSessionExpired) {
        toast.error(error.message);
        redirectToLogin();
        return;
      }
      toast.error(error.message);
      return;
    }
    toast.error(fallback);
  }

  const productsBySubCategory = useMemo(() => {
    const grouped = new Map<string, Product[]>();
    for (const product of productsQuery.data ?? []) {
      const bucket = grouped.get(product.subCategoryId);
      if (bucket) bucket.push(product);
      else grouped.set(product.subCategoryId, [product]);
    }
    return grouped;
  }, [productsQuery.data]);

  // ------------------------------------------------------------------
  // Loading / error / session states
  // ------------------------------------------------------------------

  const sessionExpired =
    (categoriesQuery.error instanceof ApiError &&
      categoriesQuery.error.isSessionExpired) ||
    (productsQuery.error instanceof ApiError &&
      productsQuery.error.isSessionExpired);

  if (sessionExpired) {
    return (
      <>
        <PageHeader title="Catalog" />
        <EmptyState
          icon={LogIn}
          title="Your session expired"
          description="Please sign in again to manage the catalog."
          action={
            <Button className="h-11 rounded-lg" onClick={redirectToLogin}>
              Sign in
            </Button>
          }
        />
      </>
    );
  }

  const queryError = categoriesQuery.error ?? productsQuery.error;
  if (queryError) {
    return (
      <>
        <PageHeader title="Catalog" />
        <EmptyState
          icon={RefreshCw}
          title="Couldn't load the catalog"
          description={
            queryError instanceof ApiError
              ? queryError.message
              : "Something went wrong."
          }
          action={
            <Button
              className="h-11 rounded-lg"
              onClick={() => {
                categoriesQuery.refetch();
                productsQuery.refetch();
              }}
            >
              <RefreshCw className="mr-2 size-4" aria-hidden />
              Try again
            </Button>
          }
        />
      </>
    );
  }

  const categories = categoriesQuery.data ?? [];
  const isLoading = categoriesQuery.isPending || productsQuery.isPending;

  return (
    <>
      <PageHeader
        title="Catalog"
        description="Categories, products and prices. Milk is measured by the litre and lives in the Milk Shop, not here."
        action={
          <Button
            className="h-11 rounded-lg"
            onClick={() => setDialog({ kind: "add-category" })}
          >
            <Plus className="mr-2 size-4" aria-hidden />
            Add category
          </Button>
        }
      />

      <div className="mb-4 flex items-center justify-end gap-3">
        <Label
          htmlFor="show-inactive"
          className="cursor-pointer text-sm text-zinc-600"
        >
          Show inactive
        </Label>
        <Switch
          id="show-inactive"
          checked={includeInactive}
          onCheckedChange={setIncludeInactive}
        />
      </div>

      {isLoading ? (
        <CatalogSkeleton />
      ) : categories.length === 0 ? (
        <EmptyState
          icon={Package}
          title="No categories yet"
          description="Add a category to start building the catalog."
          action={
            <Button
              className="h-11 rounded-lg"
              onClick={() => setDialog({ kind: "add-category" })}
            >
              <Plus className="mr-2 size-4" aria-hidden />
              Add category
            </Button>
          }
        />
      ) : (
        <Accordion
          type="multiple"
          defaultValue={categories.map((category) => category.id)}
          className="space-y-3"
        >
          {categories.map((category) => {
            const accent = categoryAccent(category.name);
            const tone = ACCENTS[accent];

            return (
              <AccordionItem
                key={category.id}
                value={category.id}
                className={cn(
                  "overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm",
                  // Only the category header carries the module accent, so a
                  // screen with both Beverages and Bakery still reads calmly.
                  accent === "blue" && "border-blue-100",
                  accent === "amber" && "border-amber-100"
                )}
              >
                <div className={cn("flex items-center gap-1 px-2", tone.activeBg)}>
                  <AccordionTrigger className="flex-1 px-2 py-4 hover:no-underline">
                    <span
                      className={cn("text-[18px] font-semibold", tone.text)}
                    >
                      {category.name}
                    </span>
                  </AccordionTrigger>

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-11 shrink-0 rounded-lg"
                      >
                        <MoreHorizontal className="size-4" aria-hidden />
                        <span className="sr-only">
                          Actions for {category.name}
                        </span>
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-56">
                      <DropdownMenuItem
                        onSelect={() =>
                          setDialog({ kind: "add-subcategory", category })
                        }
                      >
                        <FolderPlus className="mr-2 size-4" aria-hidden />
                        Add sub-category
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onSelect={() =>
                          setDialog({ kind: "rename-category", category })
                        }
                      >
                        <Pencil className="mr-2 size-4" aria-hidden />
                        Rename category
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="text-rose-600 focus:bg-rose-50 focus:text-rose-700"
                        onSelect={() =>
                          setDialog({ kind: "delete-category", category })
                        }
                      >
                        <Trash2 className="mr-2 size-4" aria-hidden />
                        Delete category
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                <AccordionContent className="space-y-6 px-4 pb-5 pt-4">
                  {category.subCategories.length === 0 ? (
                    <EmptyState
                      icon={FolderPlus}
                      accent={accent}
                      title="No sub-categories yet"
                      description={`Add a brand or product line under ${category.name}.`}
                      action={
                        <Button
                          variant="outline"
                          className="h-11 rounded-lg"
                          onClick={() =>
                            setDialog({ kind: "add-subcategory", category })
                          }
                        >
                          <Plus className="mr-2 size-4" aria-hidden />
                          Add sub-category
                        </Button>
                      }
                    />
                  ) : (
                    category.subCategories.map((subCategory) => {
                      const products =
                        productsBySubCategory.get(subCategory.id) ?? [];
                      const inactiveCount = products.filter(
                        (product) => !product.isActive
                      ).length;

                      return (
                        <section key={subCategory.id} className="space-y-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <h3 className="text-[15px] font-semibold text-zinc-900">
                              {subCategory.name}
                              {/* Derived from the rows actually rendered, not
                                  from the API's total, so the number can never
                                  disagree with what is on screen. aria-label,
                                  or a screen reader runs the name and count
                                  together as "Pepsi16". */}
                              <span
                                className="ml-2 text-sm font-normal text-zinc-500 tabular-nums"
                                aria-label={countLabel(products.length, inactiveCount, includeInactive)}
                              >
                                {products.length}
                                {includeInactive && inactiveCount > 0 ? (
                                  <span className="ml-1 text-zinc-400">
                                    ({inactiveCount} inactive)
                                  </span>
                                ) : null}
                              </span>
                            </h3>

                            <div className="flex items-center gap-1">
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-9 rounded-lg"
                                onClick={() =>
                                  setDialog({ kind: "add-product", subCategory })
                                }
                              >
                                <PackagePlus className="mr-2 size-4" aria-hidden />
                                Add product
                              </Button>

                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="size-9 rounded-lg"
                                  >
                                    <MoreHorizontal className="size-4" aria-hidden />
                                    <span className="sr-only">
                                      Actions for {subCategory.name}
                                    </span>
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="w-56">
                                  <DropdownMenuItem
                                    onSelect={() =>
                                      setDialog({
                                        kind: "rename-subcategory",
                                        subCategory,
                                      })
                                    }
                                  >
                                    <Pencil className="mr-2 size-4" aria-hidden />
                                    Rename sub-category
                                  </DropdownMenuItem>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem
                                    className="text-rose-600 focus:bg-rose-50 focus:text-rose-700"
                                    onSelect={() =>
                                      setDialog({
                                        kind: "delete-subcategory",
                                        subCategory,
                                      })
                                    }
                                  >
                                    <Trash2 className="mr-2 size-4" aria-hidden />
                                    Delete sub-category
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </div>
                          </div>

                          {products.length === 0 ? (
                            <EmptyState
                              icon={Package}
                              accent={accent}
                              title="No products yet. Add one."
                              description={
                                subCategory.productCount > 0
                                  ? "All products here are deactivated. Turn on “Show inactive” to see them."
                                  : undefined
                              }
                              action={
                                <Button
                                  variant="outline"
                                  className="h-11 rounded-lg"
                                  onClick={() =>
                                    setDialog({ kind: "add-product", subCategory })
                                  }
                                >
                                  <Plus className="mr-2 size-4" aria-hidden />
                                  Add product
                                </Button>
                              }
                            />
                          ) : (
                            <ProductTable
                              products={products}
                              includeInactive={includeInactive}
                              onEdit={(product) =>
                                setDialog({
                                  kind: "edit-product",
                                  product,
                                  subCategory,
                                })
                              }
                              onDelete={(product) =>
                                setDialog({ kind: "delete-product", product })
                              }
                              onToggleActive={(product, nextActive) =>
                                updateProduct.mutate(
                                  { id: product.id, isActive: nextActive },
                                  {
                                    onSuccess: () =>
                                      toast.success(
                                        nextActive
                                          ? `${product.name} reactivated`
                                          : `${product.name} deactivated`
                                      ),
                                    onError: (error) =>
                                      reportError(
                                        error,
                                        "Couldn't update the product."
                                      ),
                                  }
                                )
                              }
                            />
                          )}
                        </section>
                      );
                    })
                  )}
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>
      )}

      {/* ---------------------------------------------------------------- */}
      {/* Dialogs                                                          */}
      {/* ---------------------------------------------------------------- */}

      <NameDialog
        open={dialog.kind === "add-category"}
        onOpenChange={(open) => !open && close()}
        title="Add category"
        description="A top-level group, e.g. Beverages or Bakery."
        label="Category name"
        placeholder="e.g. Snacks"
        submitLabel="Add category"
        isPending={createCategory.isPending}
        onSubmit={(name) =>
          createCategory.mutate(
            { name },
            {
              onSuccess: () => {
                toast.success(`${name} added`);
                close();
              },
              onError: (error) =>
                reportError(error, "Couldn't add the category."),
            }
          )
        }
      />

      <NameDialog
        open={dialog.kind === "rename-category"}
        onOpenChange={(open) => !open && close()}
        title="Rename category"
        label="Category name"
        defaultValue={
          dialog.kind === "rename-category" ? dialog.category.name : ""
        }
        submitLabel="Save"
        isPending={renameCategory.isPending}
        onSubmit={(name) => {
          if (dialog.kind !== "rename-category") return;
          renameCategory.mutate(
            { id: dialog.category.id, name },
            {
              onSuccess: () => {
                toast.success("Category renamed");
                close();
              },
              onError: (error) =>
                reportError(error, "Couldn't rename the category."),
            }
          );
        }}
      />

      <NameDialog
        open={dialog.kind === "add-subcategory"}
        onOpenChange={(open) => !open && close()}
        title="Add sub-category"
        description={
          dialog.kind === "add-subcategory"
            ? `A brand or product line inside ${dialog.category.name}.`
            : undefined
        }
        label="Sub-category name"
        placeholder="e.g. Pepsi"
        submitLabel="Add sub-category"
        isPending={createSubCategory.isPending}
        onSubmit={(name) => {
          if (dialog.kind !== "add-subcategory") return;
          createSubCategory.mutate(
            { name, categoryId: dialog.category.id },
            {
              onSuccess: () => {
                toast.success(`${name} added`);
                close();
              },
              onError: (error) =>
                reportError(error, "Couldn't add the sub-category."),
            }
          );
        }}
      />

      <NameDialog
        open={dialog.kind === "rename-subcategory"}
        onOpenChange={(open) => !open && close()}
        title="Rename sub-category"
        label="Sub-category name"
        defaultValue={
          dialog.kind === "rename-subcategory" ? dialog.subCategory.name : ""
        }
        submitLabel="Save"
        isPending={renameSubCategory.isPending}
        onSubmit={(name) => {
          if (dialog.kind !== "rename-subcategory") return;
          renameSubCategory.mutate(
            { id: dialog.subCategory.id, name },
            {
              onSuccess: () => {
                toast.success("Sub-category renamed");
                close();
              },
              onError: (error) =>
                reportError(error, "Couldn't rename the sub-category."),
            }
          );
        }}
      />

      {dialog.kind === "add-product" || dialog.kind === "edit-product" ? (
        <ProductDialog
          open
          onOpenChange={(open) => !open && close()}
          mode={dialog.kind === "add-product" ? "create" : "edit"}
          subCategoryId={dialog.subCategory.id}
          subCategoryName={dialog.subCategory.name}
          product={dialog.kind === "edit-product" ? dialog.product : undefined}
          isPending={createProduct.isPending || updateProduct.isPending}
          onSubmit={(values: ProductWriteInput) => {
            if (dialog.kind === "add-product") {
              createProduct.mutate(values, {
                onSuccess: () => {
                  toast.success(`${values.name} added`);
                  close();
                },
                onError: (error) =>
                  reportError(error, "Couldn't add the product."),
              });
              return;
            }
            if (dialog.kind === "edit-product") {
              updateProduct.mutate(
                {
                  id: dialog.product.id,
                  name: values.name,
                  subCategoryId: values.subCategoryId,
                  size: values.size,
                  qualityTier: values.qualityTier,
                  shape: values.shape,
                  unit: values.unit,
                  // `price` is deliberately absent: the inline editor owns it,
                  // and the PATCH route treats an omitted field as unchanged.
                },
                {
                  onSuccess: () => {
                    toast.success("Product updated");
                    close();
                  },
                  onError: (error) =>
                    reportError(error, "Couldn't update the product."),
                }
              );
            }
          }}
        />
      ) : null}

      <DeleteDialog
        open={dialog.kind === "delete-category"}
        onOpenChange={(open) => !open && close()}
        title="Delete category?"
        description={
          dialog.kind === "delete-category"
            ? `This removes “${dialog.category.name}”, its sub-categories and their products. It will be refused if anything under it has sales recorded.`
            : ""
        }
        confirmLabel="Delete category"
        onDeactivateBlocked={deactivateBlocked}
        onConfirm={async () => {
          if (dialog.kind !== "delete-category") return;
          await deleteCategory.mutateAsync(dialog.category.id);
          toast.success(`${dialog.category.name} deleted`);
        }}
      />

      <DeleteDialog
        open={dialog.kind === "delete-subcategory"}
        onOpenChange={(open) => !open && close()}
        title="Delete sub-category?"
        description={
          dialog.kind === "delete-subcategory"
            ? `This removes “${dialog.subCategory.name}” and its products. It will be refused if any of them have sales recorded.`
            : ""
        }
        confirmLabel="Delete sub-category"
        onDeactivateBlocked={deactivateBlocked}
        onConfirm={async () => {
          if (dialog.kind !== "delete-subcategory") return;
          await deleteSubCategory.mutateAsync(dialog.subCategory.id);
          toast.success(`${dialog.subCategory.name} deleted`);
        }}
      />

      <DeleteDialog
        open={dialog.kind === "delete-product"}
        onOpenChange={(open) => !open && close()}
        title="Delete product?"
        description={
          dialog.kind === "delete-product"
            ? `If “${dialog.product.name}” has sales recorded, it will be deactivated instead of deleted so past sales stay intact.`
            : ""
        }
        confirmLabel="Delete product"
        secondaryAction={
          dialog.kind === "delete-product" && dialog.product.isActive
            ? {
                label: "Deactivate instead",
                run: async () => {
                  if (dialog.kind !== "delete-product") return;
                  await updateProduct.mutateAsync({
                    id: dialog.product.id,
                    isActive: false,
                  });
                  toast.success(`${dialog.product.name} deactivated`);
                },
              }
            : undefined
        }
        onConfirm={async () => {
          if (dialog.kind !== "delete-product") return;
          const result = await deleteProduct.mutateAsync(dialog.product.id);
          // The API decides soft vs hard — report what actually happened
          // rather than assuming the row is gone.
          if (result.deleted === "soft") {
            toast.success(result.message);
          } else {
            toast.success(`${dialog.product.name} deleted`);
          }
        }}
      />
    </>
  );
}

/** Spoken form of the sub-category count, e.g. "5 products, 2 inactive". */
function countLabel(
  total: number,
  inactive: number,
  includeInactive: boolean
): string {
  const noun = total === 1 ? "product" : "products";
  if (includeInactive && inactive > 0) {
    return `${total} ${noun}, ${inactive} inactive`;
  }
  return `${total} ${noun}`;
}

function CatalogSkeleton() {
  return (
    <div className="space-y-3">
      {[0, 1].map((card) => (
        <div
          key={card}
          className="space-y-4 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm"
        >
          <Skeleton className="h-6 w-40 rounded-lg" />
          <div className="space-y-2">
            {[0, 1, 2, 3].map((row) => (
              <Skeleton key={row} className="h-11 w-full rounded-lg" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
