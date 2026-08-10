"use client";

/**
 * TanStack Query bindings for the Phase 2.1 catalog routes.
 *
 * Two queries back the whole page: the category tree, and one flat product
 * list that the UI groups by sub-category client-side. The catalog is ~62 rows,
 * so a single list is cheaper and simpler than a request per sub-category.
 */
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";

import { api } from "@/lib/api-client";

// ---------------------------------------------------------------------------
// Response shapes (mirror the `select` blocks in the 2.1 routes)
// ---------------------------------------------------------------------------

export type SubCategoryNode = {
  id: string;
  name: string;
  categoryId: string;
  productCount: number;
};

export type CategoryNode = {
  id: string;
  name: string;
  createdAt: string;
  subCategories: SubCategoryNode[];
};

export type Product = {
  id: string;
  name: string;
  /** Already a NUMBER — the route serializes the Decimal (Gotcha 2). */
  price: number;
  size: string | null;
  /** Units on hand. Beverages + bakery; milk has no products. */
  stock: number;
  qualityTier: string | null;
  shape: string | null;
  unit: string | null;
  isActive: boolean;
  subCategoryId: string;
  createdAt: string;
  updatedAt: string;
  subCategory: { id: string; name: string; category: { id: string; name: string } };
};

/** The API decides soft vs hard; the UI only reports what happened. */
export type ProductDeleteResult =
  | { deleted: "soft"; product: Product; message: string }
  | { deleted: "hard"; id: string; product: null };

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------

export const catalogKeys = {
  all: ["catalog"] as const,
  tree: () => [...catalogKeys.all, "tree"] as const,
  products: (includeInactive: boolean) =>
    [...catalogKeys.all, "products", includeInactive] as const,
};

/** Both queries share a source of truth, so both refresh after any write. */
function invalidateCatalog(queryClient: QueryClient) {
  return queryClient.invalidateQueries({ queryKey: catalogKeys.all });
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export function useCategories() {
  return useQuery({
    queryKey: catalogKeys.tree(),
    queryFn: () => api.get<CategoryNode[]>("/api/categories"),
  });
}

export function useProducts(includeInactive: boolean) {
  return useQuery({
    queryKey: catalogKeys.products(includeInactive),
    queryFn: () =>
      api.get<Product[]>(
        `/api/products${includeInactive ? "?includeInactive=true" : ""}`
      ),
    // Keeps the table on screen while the "show inactive" toggle refetches,
    // instead of flashing back to skeletons.
    placeholderData: (previous) => previous,
  });
}

// ---------------------------------------------------------------------------
// Category mutations
// ---------------------------------------------------------------------------

export function useCreateCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string }) =>
      api.post<CategoryNode>("/api/categories", input),
    onSuccess: () => invalidateCatalog(queryClient),
  });
}

export function useRenameCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      api.patch<CategoryNode>(`/api/categories/${id}`, { name }),
    onSuccess: () => invalidateCatalog(queryClient),
  });
}

export function useDeleteCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<unknown>(`/api/categories/${id}`),
    onSuccess: () => invalidateCatalog(queryClient),
  });
}

// ---------------------------------------------------------------------------
// Sub-category mutations
// ---------------------------------------------------------------------------

export function useCreateSubCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; categoryId: string }) =>
      api.post<SubCategoryNode>("/api/subcategories", input),
    onSuccess: () => invalidateCatalog(queryClient),
  });
}

export function useRenameSubCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      api.patch<SubCategoryNode>(`/api/subcategories/${id}`, { name }),
    onSuccess: () => invalidateCatalog(queryClient),
  });
}

export function useDeleteSubCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<unknown>(`/api/subcategories/${id}`),
    onSuccess: () => invalidateCatalog(queryClient),
  });
}

// ---------------------------------------------------------------------------
// Product mutations
// ---------------------------------------------------------------------------

export type ProductWriteInput = {
  name: string;
  subCategoryId: string;
  price: number;
  size: string | null;
  /**
   * OPTIONAL on write. A new product takes the column default rather than the
   * dialog inventing a number — stock is counted on the shelf, through the
   * inline editor, not guessed at the moment a catalog row is created.
   */
  stock?: number;
  qualityTier: string | null;
  shape: string | null;
  unit: string | null;
};

export function useCreateProduct() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ProductWriteInput) =>
      api.post<Product>("/api/products", input),
    onSuccess: () => invalidateCatalog(queryClient),
  });
}

export function useUpdateProduct() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...patch
    }: Partial<ProductWriteInput> & { id: string; isActive?: boolean }) =>
      api.patch<Product>(`/api/products/${id}`, patch),
    onSuccess: () => invalidateCatalog(queryClient),
  });
}

/**
 * Inline price editor. Optimistic: the cell shows the new price immediately and
 * rolls back to the exact previous cache snapshot if the request fails.
 *
 * NOTE: there is no `/api/products/[id]/price` endpoint. The 2.1 route accepts
 * a partial PATCH, so sending `{ price }` alone to `/api/products/[id]` is the
 * price-only update — verified in the 2.1 test run.
 */
export function useUpdateProductPrice(includeInactive: boolean) {
  const queryClient = useQueryClient();
  const productsKey = catalogKeys.products(includeInactive);

  return useMutation({
    mutationFn: ({ id, price }: { id: string; price: number }) =>
      api.patch<Product>(`/api/products/${id}`, { price }),

    onMutate: async ({ id, price }) => {
      // Stop an in-flight refetch from clobbering the optimistic value.
      await queryClient.cancelQueries({ queryKey: productsKey });
      const previous = queryClient.getQueryData<Product[]>(productsKey);

      queryClient.setQueryData<Product[]>(productsKey, (current) =>
        current?.map((product) =>
          product.id === id ? { ...product, price } : product
        )
      );

      return { previous };
    },

    onError: (_error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(productsKey, context.previous);
      }
    },

    onSettled: () => invalidateCatalog(queryClient),
  });
}

/**
 * Set a product's stock outright — the owner counting the shelf, not a sale.
 *
 * A SET, not an adjustment: the sale routes own every +/- movement, inside their
 * own transactions. If this offered "add 20" as well there would be two ways
 * stock changes and a race between them the moment a sale lands mid-edit.
 *
 * Optimistic, exactly like the price editor, and for the same reason — the
 * number changes under the owner's finger and rolls back if the save fails, so
 * a failed write can never leave a wrong figure on screen.
 */
export function useUpdateProductStock(includeInactive: boolean) {
  const queryClient = useQueryClient();
  const productsKey = catalogKeys.products(includeInactive);

  return useMutation({
    mutationFn: ({ id, stock }: { id: string; stock: number }) =>
      api.patch<Product>(`/api/products/${id}`, { stock }),

    onMutate: async ({ id, stock }) => {
      await queryClient.cancelQueries({ queryKey: productsKey });
      const previous = queryClient.getQueryData<Product[]>(productsKey);

      queryClient.setQueryData<Product[]>(productsKey, (current) =>
        current?.map((product) =>
          product.id === id ? { ...product, stock } : product
        )
      );

      return { previous };
    },

    onError: (_error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(productsKey, context.previous);
      }
    },

    onSettled: () => invalidateCatalog(queryClient),
  });
}

export function useDeleteProduct() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.delete<ProductDeleteResult>(`/api/products/${id}`),
    onSuccess: () => invalidateCatalog(queryClient),
  });
}
