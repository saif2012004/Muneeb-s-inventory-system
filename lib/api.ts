/**
 * Shared Route Handler helpers. See "API Route Conventions" in CLAUDE.md.
 *
 * Every response is `{ data, error }` — exactly one side is populated, so a
 * caller can branch on `error` without inspecting the status code.
 */
import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { serialize, type DecimalLike } from "@/lib/serialize";

export type ApiSuccess<T> = { data: T; error: null };
export type ApiFailure = { data: null; error: string };
export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

/** 200 by default; pass 201 for a create. */
export function ok<T>(data: T, status = 200): NextResponse<ApiSuccess<T>> {
  return NextResponse.json({ data, error: null }, { status });
}

/** A message safe to show the owner verbatim. Never leak a Prisma error here. */
export function fail(error: string, status: number): NextResponse<ApiFailure> {
  return NextResponse.json({ data: null, error }, { status });
}

/**
 * 409 for a delete the catalog guard refused, with the blocking rows attached.
 *
 * `error` stays the human-readable sentence (and remains the fallback for any
 * client that ignores the extra field); `blockedBy` is the machine-readable
 * form, so the UI can list the products and act on them BY ID rather than
 * scraping names out of the prose.
 */
export function failBlocked(
  error: string,
  blockedBy: { id: string; name: string; saleCount: number }[]
): NextResponse {
  return NextResponse.json({ data: null, error, blockedBy }, { status: 409 });
}

/**
 * 409 for a sale refused because a product has insufficient stock.
 *
 * Same contract as `failBlocked` and for the same reason: `error` is the
 * sentence to show, `shortBy` is the machine-readable list the UI acts on. The
 * Restock action needs the product ID and the numbers — scraping them back out
 * of the prose is how a UI ends up subtly disagreeing with the server about
 * what is short and by how much.
 *
 * A SEPARATE field from `blockedBy` deliberately: that one means "this product
 * has sale history, you may not delete it", this one means "there aren't enough
 * units". Different problems, different remedies, and collapsing them into one
 * field would force every consumer to guess which it received.
 */
export function failStockBlocked(
  error: string,
  shortBy: {
    productId: string;
    name: string;
    available: DecimalLike;
    requested: DecimalLike;
    shortfall: DecimalLike;
  }[]
): NextResponse {
  // SERIALIZE. `shortBy` carries stock figures, and since Migration D
  // `Product.stock` is a Decimal — which JSON.stringify emits as the STRING
  // "100", not the number 100. See Gotcha 2 in CLAUDE.md.
  //
  // `loadSaleProducts` already normalises stock to a number before any of these
  // figures are computed, so today every value arriving here is a plain number
  // and serialize() is a no-op on it. This is the backstop for the next caller:
  // the unified /api/sales will build shortfalls from its own query, and a
  // Decimal leaking into this payload would not fail to compile — it would ship
  // `available: "100"` and break `InlineStockEditor`'s `next === stock` guard in
  // the browser, silently, exactly where the owner is trying to restock mid-sale.
  return NextResponse.json(
    { data: null, error, shortBy: serialize(shortBy) },
    { status: 409 }
  );
}

/**
 * Logs the real error server-side and returns a generic message. Raw Prisma
 * errors carry column names and connection details — never send them out.
 */
export function serverError(context: string, error: unknown): NextResponse<ApiFailure> {
  console.error(`[api:${context}]`, error);
  return fail("Something went wrong. Please try again.", 500);
}

/**
 * Auth.js v5 session check — `auth()`, never `getServerSession` (v5 has no
 * such export). Returns a 401 response when signed out, or `null` to continue.
 *
 *   const denied = await requireOwner();
 *   if (denied) return denied;
 */
export async function requireOwner(): Promise<NextResponse<ApiFailure> | null> {
  const session = await auth();
  if (!session?.user) return fail("You must be signed in.", 401);
  return null;
}

/** First Zod issue as a human-readable string, for a 400 body. */
export function firstIssue(error: { issues: { message: string }[] }): string {
  return error.issues[0]?.message ?? "Invalid request.";
}
