import { NextResponse } from "next/server";

import { fail, firstIssue, ok, requireOwner, serverError } from "@/lib/api";
import {
  endOfKarachiDay,
  startOfKarachiDay,
  todayKeyInKarachi,
} from "@/lib/format";
import {
  DELIVERY_SELECT,
  computeDeliveryTotals,
  getFarmerBalances,
  summariseFarmerBalances,
} from "@/lib/milk";
import { prisma } from "@/lib/prisma";
import { serialize } from "@/lib/serialize";
import { quickEntrySchema } from "@/lib/validations/milk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * QUICK ENTRY — one date, every farmer, one save.
 *
 * This is the screen the milk module exists for. Twice a day the owner stands
 * at the shop while farmers arrive; opening a form per farmer, picking a date
 * per farmer and typing a rate per farmer is not a workflow anyone completes
 * twice a day. So: one date at the top, a row per farmer, morning and evening
 * side by side, save once.
 *
 * THE GRID IS THE DAY. GET returns every active farmer with whatever is already
 * recorded for that date, so the owner edits a filled-in day rather than
 * re-typing it. That also means the morning entry and the evening entry write to
 * the SAME row — the evening pass loads the morning litres, adds the evening
 * ones, and updates.
 */

/** How far back to look for a farmer's last rate, in days. */
const RATE_LOOKBACK_DAYS = 60;

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * GET /api/milk/deliveries/quick-entry?date=YYYY-MM-DD
 *
 * Defaults to today IN KARACHI, never `new Date()`. After 7pm PKT — which is
 * exactly when the evening entry happens — the UTC day has already rolled over,
 * so a server-side `new Date()` would open the grid on tomorrow and the evening
 * milk would be filed a day late (Gotcha 4).
 *
 * Three queries, awaited in series. Never `Promise.all` (connection_limit=1).
 */
export async function GET(request: Request): Promise<NextResponse> {
  const denied = await requireOwner();
  if (denied) return denied;

  try {
    const { searchParams } = new URL(request.url);
    const dateKey = searchParams.get("date")?.trim() || todayKeyInKarachi();

    if (!DATE_ONLY.test(dateKey) || Number.isNaN(new Date(dateKey).getTime())) {
      return fail("That date isn't valid. Use YYYY-MM-DD.", 400);
    }

    const dayStart = startOfKarachiDay(dateKey);
    const dayEnd = endOfKarachiDay(dateKey);

    // Only ACTIVE farmers get a row: a retired farmer should not be offered a
    // fresh delivery, and the delivery routes refuse one anyway.
    const farmers = await prisma.farmer.findMany({
      where: { isActive: true },
      select: { id: true, name: true, phone: true },
      orderBy: { name: "asc" },
    });

    if (farmers.length === 0) {
      return ok({ deliveryDate: dateKey, rows: [] });
    }

    const farmerIds = farmers.map((farmer) => farmer.id);

    const existing = await prisma.milkDelivery.findMany({
      where: {
        farmerId: { in: farmerIds },
        deliveryDate: { gte: dayStart, lt: dayEnd },
      },
      select: DELIVERY_SELECT,
    });
    const byFarmer = new Map(existing.map((row) => [row.farmerId, row]));

    // Each farmer's most recent rate, so the owner types it once rather than
    // per row. Bounded to a recent window ON PURPOSE: Prisma's `distinct`
    // deduplicates IN MEMORY by default, so "latest delivery per farmer" via
    // distinct would fetch every delivery row the farmer has ever had. A rate
    // older than RATE_LOOKBACK_DAYS is stale enough not to prefill anyway.
    const recent = await prisma.milkDelivery.findMany({
      where: {
        farmerId: { in: farmerIds },
        deliveryDate: {
          gte: startOfKarachiDay(
            new Date(dayStart.getTime() - RATE_LOOKBACK_DAYS * 86_400_000)
          ),
          lt: dayEnd,
        },
      },
      select: { farmerId: true, ratePerLiter: true },
      orderBy: [{ deliveryDate: "desc" }, { createdAt: "desc" }],
    });

    // First row wins — the list is already newest-first.
    const lastRate = new Map<string, (typeof recent)[number]["ratePerLiter"]>();
    for (const row of recent) {
      if (!lastRate.has(row.farmerId)) lastRate.set(row.farmerId, row.ratePerLiter);
    }

    const rows = farmers.map((farmer) => {
      const delivery = byFarmer.get(farmer.id) ?? null;
      return {
        farmerId: farmer.id,
        name: farmer.name,
        phone: farmer.phone,
        // Decimals -> numbers (Gotcha 2). null morning/evening stay null, so a
        // farmer who skipped the morning shows an EMPTY box, not "0".
        delivery: delivery ? serialize(delivery) : null,
        suggestedRate: serialize(
          delivery?.ratePerLiter ?? lastRate.get(farmer.id) ?? null
        ),
      };
    });

    return ok({ deliveryDate: dateKey, rows });
  } catch (error) {
    return serverError("milk.deliveries.quick-entry.GET", error);
  }
}

/**
 * POST /api/milk/deliveries/quick-entry
 *
 * Body: { deliveryDate, entries: [{ farmerId, morningLiters?, eveningLiters?, ratePerLiter }] }
 *
 * ---------------------------------------------------------------------------
 * WHAT AN EMPTY ROW MEANS
 * ---------------------------------------------------------------------------
 * A row with no litres is SKIPPED, not deleted. On this screen "blank" is the
 * normal state for a farmer who simply did not come today — it is not a request
 * to remove anything, and the grid lists every farmer whether or not they
 * delivered.
 *
 * But blanking out a row that ALREADY has a delivery is ambiguous, and silently
 * ignoring it would be the worst outcome: the owner clears a wrong entry, saves,
 * gets a success toast, and the entry is still there. So those rows come back in
 * `clearedButKept` and the UI tells the owner they must delete that delivery
 * explicitly — deletion is a destructive action and gets its own confirm, per
 * the Design System.
 *
 * ---------------------------------------------------------------------------
 * ONE TRANSACTION
 * ---------------------------------------------------------------------------
 * All writes commit together: a half-saved morning round would leave the owner
 * unable to tell which farmers were recorded. Reads happen BEFORE the
 * transaction opens — with `connection_limit=1` the transaction holds the only
 * connection, so any query issued on `prisma` (rather than `tx`) while it is
 * open would wait for a connection that the transaction itself is holding, and
 * deadlock until the pool timeout.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const denied = await requireOwner();
  if (denied) return denied;

  try {
    const parsed = quickEntrySchema.safeParse(await request.json());
    if (!parsed.success) return fail(firstIssue(parsed.error), 400);

    const { deliveryDate, entries } = parsed.data;

    // Two rows for the same farmer would race each other inside the
    // transaction — the second would create a duplicate for the day that the
    // single-delivery route refuses.
    const seen = new Set<string>();
    for (const entry of entries) {
      if (seen.has(entry.farmerId)) {
        return fail("The same farmer appears twice in one save.", 400);
      }
      seen.add(entry.farmerId);
    }

    const farmerIds = Array.from(seen);

    const farmers = await prisma.farmer.findMany({
      where: { id: { in: farmerIds } },
      select: { id: true, name: true, isActive: true },
    });
    const farmerById = new Map(farmers.map((farmer) => [farmer.id, farmer]));

    // Checked up front so a stale grid surfaces as a sentence rather than a raw
    // foreign-key violation partway through the write.
    const missing = farmerIds.filter((id) => !farmerById.has(id));
    if (missing.length > 0) {
      return fail(
        "Some farmers on this screen no longer exist. Reload and try again.",
        404
      );
    }
    const retired = farmers.filter((farmer) => !farmer.isActive);
    if (retired.length > 0) {
      return fail(
        `${retired.map((f) => `"${f.name}"`).join(", ")} ${retired.length === 1 ? "is" : "are"} retired. Reload the screen and try again.`,
        409
      );
    }

    const dayStart = startOfKarachiDay(deliveryDate);
    const dayEnd = endOfKarachiDay(deliveryDate);

    const existing = await prisma.milkDelivery.findMany({
      where: {
        farmerId: { in: farmerIds },
        deliveryDate: { gte: dayStart, lt: dayEnd },
      },
      select: { id: true, farmerId: true },
    });
    const existingByFarmer = new Map(
      existing.map((row) => [row.farmerId, row.id])
    );

    // Split the work BEFORE opening the transaction, so the transaction does
    // nothing but write.
    const writes: {
      farmerId: string;
      deliveryId: string | null;
      totals: ReturnType<typeof computeDeliveryTotals>;
    }[] = [];
    const clearedButKept: { farmerId: string; name: string; deliveryId: string }[] =
      [];

    for (const entry of entries) {
      const hasMilk = (entry.morningLiters ?? 0) + (entry.eveningLiters ?? 0) > 0;
      const deliveryId = existingByFarmer.get(entry.farmerId) ?? null;

      if (!hasMilk) {
        if (deliveryId) {
          clearedButKept.push({
            farmerId: entry.farmerId,
            // Non-null: every id was proved present above.
            name: farmerById.get(entry.farmerId)!.name,
            deliveryId,
          });
        }
        continue;
      }

      writes.push({
        farmerId: entry.farmerId,
        deliveryId,
        totals: computeDeliveryTotals(
          entry.morningLiters,
          entry.eveningLiters,
          entry.ratePerLiter
        ),
      });
    }

    let created = 0;
    let updated = 0;

    if (writes.length > 0) {
      await prisma.$transaction(
        async (tx) => {
          for (const write of writes) {
            if (write.deliveryId) {
              await tx.milkDelivery.update({
                where: { id: write.deliveryId },
                data: { deliveryDate, ...write.totals },
              });
              updated += 1;
            } else {
              await tx.milkDelivery.create({
                data: {
                  farmerId: write.farmerId,
                  deliveryDate,
                  ...write.totals,
                },
              });
              created += 1;
            }
          }
        },
        // The default 5s ceiling is too tight: these are sequential round trips
        // over one connection, and a full round of farmers on a slow phone
        // connection would abort halfway through an otherwise valid save.
        { timeout: 25_000, maxWait: 15_000 }
      );
    }

    // Fresh balances for everyone touched, from the shared calculation — the
    // grid shows what each farmer is now owed without a second round trip.
    const balances = await getFarmerBalances(farmerIds);
    const summary = summariseFarmerBalances(Array.from(balances.values()));

    return ok(
      serialize({
        deliveryDate,
        created,
        updated,
        skipped: entries.length - writes.length,
        clearedButKept,
        balances: Object.fromEntries(balances),
        summary,
      }),
      created > 0 ? 201 : 200
    );
  } catch (error) {
    return serverError("milk.deliveries.quick-entry.POST", error);
  }
}
