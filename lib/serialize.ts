/**
 * Decimal -> number serializers. See Gotcha 2 in CLAUDE.md.
 *
 * A Prisma `Decimal` is an OBJECT, not a JS number. Sent through a Route
 * Handler as JSON it becomes `{ s, e, d }` or a string, which turns
 * `total + total` into string concatenation and renders as "[object Object]"
 * in Recharts and count-up animations.
 *
 * Rule: every route that returns money or liters must serialize first, and all
 * money math stays server-side on Decimals.
 *
 * Every Decimal in this schema is scale-2 — Decimal(10,2) for money,
 * Decimal(8,2) for liters — so `toFixed(2)` is lossless here and also strips
 * binary-float noise (e.g. 0.1 + 0.2).
 */
import { Prisma } from "@prisma/client";

/** Anything that can stand in for a Decimal column, including nullable ones. */
type DecimalLike = Prisma.Decimal | number | string;

/**
 * Recursively rewrites Decimal fields to `number` at the type level so callers
 * get accurate types back from {@link serialize}.
 */
export type Serialized<T> = T extends Prisma.Decimal
  ? number
  : T extends Date
    ? Date
    : T extends Array<infer U>
      ? Array<Serialized<U>>
      : T extends object
        ? { [K in keyof T]: Serialized<T[K]> }
        : T;

function decimalToNumber(value: DecimalLike): number {
  if (typeof value === "number") return Number(value.toFixed(2));
  if (typeof value === "string") return Number(Number(value).toFixed(2));
  return Number(value.toFixed(2));
}

/**
 * Convert a single money Decimal to a number. Returns 0 for null/undefined so
 * callers can sum without null checks — an absent amount is an amount of zero.
 */
export function serializeMoney(value: DecimalLike | null | undefined): number {
  if (value === null || value === undefined) return 0;
  return decimalToNumber(value);
}

/**
 * Same as {@link serializeMoney}, but preserves null. Use where "no delivery
 * recorded" must stay distinguishable from "recorded as 0" — e.g.
 * `MilkDelivery.morningLiters`.
 */
export function serializeLiters(
  value: DecimalLike | null | undefined
): number | null {
  if (value === null || value === undefined) return null;
  return decimalToNumber(value);
}

/**
 * Deep serializer: walks a Prisma result and turns every Decimal into a number,
 * leaving Dates, strings, numbers and nulls untouched. Handles nested includes
 * (e.g. a sale with its items, each with a product).
 *
 *   return NextResponse.json({ data: serialize(sale), error: null });
 */
export function serialize<T>(value: T): Serialized<T> {
  return serializeValue(value) as Serialized<T>;
}

function serializeValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;

  if (Prisma.Decimal.isDecimal(value)) {
    return decimalToNumber(value as Prisma.Decimal);
  }

  // Dates are left alone: JSON.stringify already emits ISO-8601, and they must
  // stay UTC until the display layer converts them to Asia/Karachi.
  if (value instanceof Date) return value;

  if (Array.isArray(value)) return value.map(serializeValue);

  if (typeof value === "object") {
    // Only walk plain objects. Anything with a custom prototype (Buffer, Map,
    // a class instance) is passed through untouched.
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) return value;

    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      out[key] = serializeValue(val);
    }
    return out;
  }

  return value;
}
