/**
 * THE settings read/write. SERVER ONLY — this imports Prisma.
 *
 * Client components use `lib/settings-display.ts`, which is dependency-free.
 *
 * ---------------------------------------------------------------------------
 * ONE ROW, ALWAYS PRESENT
 * ---------------------------------------------------------------------------
 * The migration seeds `id = "app"` and a CHECK constraint pins it, so every read
 * is a single `findUnique` that cannot miss and no caller has to handle "no
 * settings yet". `getSettings()` still copes with an absent row rather than
 * throwing — if the seed were ever lost, the receipt should print the shouting
 * placeholders, not 500.
 */
import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import {
  SETTINGS_ID,
  SETTINGS_PLACEHOLDERS,
  type Settings,
} from "@/lib/settings-display";
import type { SettingsUpdateInput } from "@/lib/validations/settings";

/** A row as it comes back from Postgres. Dates are Date objects here. */
type SettingsRow = {
  shopName: string;
  shopPhone: string | null;
  shopAddress: string | null;
  configuredAt: Date | null;
  updatedAt: Date;
};

/**
 * Dates -> ISO strings at the boundary, the same discipline Decimals get
 * (Gotcha 2). No money on this model, so there is nothing else to convert.
 */
function serializeSettings(row: SettingsRow): Settings {
  return {
    shopName: row.shopName,
    shopPhone: row.shopPhone,
    shopAddress: row.shopAddress,
    configuredAt: row.configuredAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * What an unseeded database would look like. Never written — used only so a
 * missing row degrades to "obviously unconfigured" instead of an exception.
 */
function fallbackSettings(): Settings {
  return {
    shopName: SETTINGS_PLACEHOLDERS.shopName,
    shopPhone: SETTINGS_PLACEHOLDERS.shopPhone,
    shopAddress: SETTINGS_PLACEHOLDERS.shopAddress,
    configuredAt: null,
    updatedAt: new Date(0).toISOString(),
  };
}

/** ONE query. Safe to call from a receipt handler. */
export async function getSettings(): Promise<Settings> {
  const row = await prisma.settings.findUnique({
    where: { id: SETTINGS_ID },
    select: {
      shopName: true,
      shopPhone: true,
      shopAddress: true,
      configuredAt: true,
      updatedAt: true,
    },
  });

  return row ? serializeSettings(row) : fallbackSettings();
}

/**
 * Save the owner's details. ONE round trip.
 *
 * `configuredAt = COALESCE("configuredAt", now())` is why this is raw SQL: it
 * stamps the FIRST save and leaves it alone on every save after, which the ORM
 * cannot express without reading the row first. At ~1.1s per round trip
 * (CHECKLIST #14) a read-then-write would double the cost of every save to
 * compute a value Postgres can decide for itself.
 *
 * `updatedAt` is set explicitly because `@updatedAt` is applied by the Prisma
 * client on ORM writes — a raw UPDATE bypasses it, and the column is NOT NULL.
 *
 * `WHERE id = ${SETTINGS_ID}` plus the CHECK constraint means this can only ever
 * touch the single row.
 */
export async function updateSettings(
  input: SettingsUpdateInput
): Promise<Settings> {
  const rows = await prisma.$queryRaw<SettingsRow[]>(Prisma.sql`
    UPDATE "Settings"
       SET "shopName"     = ${input.shopName},
           "shopPhone"    = ${input.shopPhone},
           "shopAddress"  = ${input.shopAddress},
           "configuredAt" = COALESCE("configuredAt", now()),
           "updatedAt"    = now()
     WHERE "id" = ${SETTINGS_ID}
     RETURNING "shopName", "shopPhone", "shopAddress", "configuredAt", "updatedAt"
  `);

  const row = rows[0];
  if (!row) {
    // The seeded row is gone. Not recoverable here, and silently re-creating it
    // would hide a real problem with the database.
    throw new Error("Settings row is missing — the seed row id='app' was deleted.");
  }

  return serializeSettings(row);
}
