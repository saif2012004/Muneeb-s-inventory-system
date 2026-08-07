"use client";

import { useMemo, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  ArrowRight,
  LogIn,
  Milk,
  Plus,
  RefreshCw,
  Search,
  Users,
  X,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";

import { FarmerDialog } from "@/components/milk/FarmerDialog";
import { AnimatedMoney } from "@/components/shared/AnimatedMoney";
import { EmptyState } from "@/components/shared/EmptyState";
import { MoneyText } from "@/components/shared/MoneyText";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError, redirectToLogin } from "@/lib/api-client";
import { formatDate, formatLiters } from "@/lib/format";
import {
  useCreateFarmer,
  useFarmers,
  type FarmerWithBalance,
} from "@/lib/hooks/use-milk";
import {
  FARMER_BALANCE_TEXT_CLASS,
  farmerBalanceLabel,
  farmerBalanceMagnitude,
  farmerBalanceMoneyTone,
  farmerBalanceTone,
} from "@/lib/milk-display";
import { MODULE_BUTTON_CLASS } from "@/lib/sale-modules";
import { cn } from "@/lib/utils";

/**
 * The milk hub. Its job is answering "what do I owe each farmer", so the default
 * sort is by net balance, biggest debt first — not alphabetical.
 *
 * Every figure comes from the server's calculation (lib/milk.ts). Nothing here
 * derives a balance, including the summary.
 *
 * ACCENT: emerald, everywhere on this screen. Never mixed with the beverages
 * blue or the bakery amber (Design System).
 */
export function MilkHub() {
  const reduceMotion = useReducedMotion();
  const [search, setSearch] = useState("");
  const [addOpen, setAddOpen] = useState(false);

  const farmersQuery = useFarmers({ withBalances: true });
  const createFarmer = useCreateFarmer();

  const farmers = useMemo(
    () => farmersQuery.data?.farmers ?? [],
    [farmersQuery.data]
  );
  const summary = farmersQuery.data?.summary ?? null;

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    const filtered = term
      ? farmers.filter(
          (farmer) =>
            farmer.name.toLowerCase().includes(term) ||
            (farmer.phone ?? "").toLowerCase().includes(term)
        )
      : farmers;

    // Biggest debt first; ties broken by name so the order is stable.
    return [...filtered].sort((a, b) => {
      if (b.netBalanceOwed !== a.netBalanceOwed) {
        return b.netBalanceOwed - a.netBalanceOwed;
      }
      return a.name.localeCompare(b.name);
    });
  }, [farmers, search]);

  const header = (
    <PageHeader
      title="Milk Shop"
      accent="emerald"
      description="Farmers, deliveries and what you owe them."
      action={
        <Button
          asChild
          className={cn("h-11 rounded-lg", MODULE_BUTTON_CLASS.emerald)}
        >
          {/* The twice-daily job, so it is the primary action on the hub. */}
          <Link href="/milk/quick-entry">
            <Zap className="mr-2 size-4" aria-hidden />
            Quick entry
          </Link>
        </Button>
      }
    />
  );

  // ------------------------------------------------------------------
  // Session / error states
  // ------------------------------------------------------------------

  if (
    farmersQuery.error instanceof ApiError &&
    farmersQuery.error.isSessionExpired
  ) {
    return (
      <>
        {header}
        <EmptyState
          icon={LogIn}
          accent="emerald"
          title="Your session expired"
          description="Please sign in again to see your farmers."
          action={
            <Button className="h-11 rounded-lg" onClick={redirectToLogin}>
              Sign in
            </Button>
          }
        />
      </>
    );
  }

  if (farmersQuery.error) {
    return (
      <>
        {header}
        <EmptyState
          icon={RefreshCw}
          accent="emerald"
          title="Couldn't load farmers"
          description={
            farmersQuery.error instanceof ApiError
              ? farmersQuery.error.message
              : "Something went wrong."
          }
          action={
            <Button
              className="h-11 rounded-lg"
              onClick={() => farmersQuery.refetch()}
            >
              <RefreshCw className="mr-2 size-4" aria-hidden />
              Try again
            </Button>
          }
        />
      </>
    );
  }

  return (
    <>
      {header}

      {/* Summary bar -------------------------------------------------- */}
      <motion.div
        initial={reduceMotion ? false : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 420, damping: 34 }}
        className="mb-4 grid gap-3 sm:grid-cols-3"
      >
        <div className="rounded-xl border border-emerald-100 bg-white p-5 shadow-sm">
          <p className="text-[13px] font-medium uppercase tracking-wide text-zinc-500">
            You owe farmers
          </p>
          {farmersQuery.isPending ? (
            <Skeleton className="mt-3 h-9 w-32 rounded-lg" />
          ) : (
            <AnimatedMoney
              value={summary?.totalOwedToFarmers ?? 0}
              // A summary tile fetched once, so it counts up from 0 rather than
              // appearing at its final value.
              countUpOnMount
              className="mt-2 block text-[28px] font-bold leading-tight text-emerald-600"
            />
          )}
          <p className="mt-1 text-sm text-zinc-500">
            {/*
              Debts and advances are NEVER netted against each other — see
              summariseFarmerBalances. Two farmers, one owed 5,000 and one 5,000
              ahead, would net to "nothing to pay" while the first still has to
              be paid 5,000 in cash.
            */}
            across all farmers
          </p>
        </div>

        <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
          <p className="text-[13px] font-medium uppercase tracking-wide text-zinc-500">
            Milk bought
          </p>
          {farmersQuery.isPending ? (
            <Skeleton className="mt-3 h-9 w-24 rounded-lg" />
          ) : (
            <p className="num mt-2 text-[28px] font-bold leading-tight text-zinc-900">
              {formatLiters(summary?.totalLiters ?? 0)}
            </p>
          )}
          <p className="mt-1 text-sm text-zinc-500">all time</p>
        </div>

        <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
          <p className="text-[13px] font-medium uppercase tracking-wide text-zinc-500">
            Farmers
          </p>
          {farmersQuery.isPending ? (
            <Skeleton className="mt-3 h-9 w-16 rounded-lg" />
          ) : (
            <p className="num mt-2 text-[28px] font-bold leading-tight text-zinc-900">
              {farmers.length}
            </p>
          )}
          <p className="mt-1 text-sm text-zinc-500">active</p>
        </div>
      </motion.div>

      {/* Milk sales are the OTHER direction — money in, not out. Kept on its
          own screen so the buying and selling sides never blur together. */}
      <Link
        href="/milk/sales"
        className="mb-4 flex min-h-[56px] items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-white px-4 py-3 shadow-sm transition-colors hover:bg-zinc-50/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
      >
        <span className="flex items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
            <Milk className="size-4" aria-hidden />
          </span>
          <span className="min-w-0">
            <span className="block text-[15px] font-medium text-zinc-900">
              Milk sales
            </span>
            <span className="block text-sm text-zinc-500">
              Milk you sold to hotels and shops
            </span>
          </span>
        </span>
        <ArrowRight className="size-4 shrink-0 text-zinc-400" aria-hidden />
      </Link>

      {/* Farmers list ------------------------------------------------- */}
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-zinc-900">Farmers</h2>
        <Button
          variant="outline"
          className="h-11 rounded-lg"
          onClick={() => setAddOpen(true)}
        >
          <Plus className="mr-2 size-4" aria-hidden />
          Add farmer
        </Button>
      </div>

      <div className="relative mb-4">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-400"
          aria-hidden
        />
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search by name or phone…"
          className="h-11 rounded-lg pl-9"
          autoComplete="off"
        />
        {search ? (
          <button
            type="button"
            onClick={() => setSearch("")}
            className="absolute right-2 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-100 hover:text-zinc-900"
          >
            <X className="size-4" aria-hidden />
            <span className="sr-only">Clear search</span>
          </button>
        ) : null}
      </div>

      {farmersQuery.isPending ? (
        <div className="space-y-3">
          {[0, 1, 2].map((row) => (
            <Skeleton key={row} className="h-[88px] w-full rounded-xl" />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <EmptyState
          icon={Users}
          accent="emerald"
          title={search ? "No farmers match that search" : "No farmers yet"}
          description={
            search
              ? "Try a different name or phone number."
              : "Add the farmers who deliver milk to you, then use quick entry each morning and evening."
          }
          action={
            search ? (
              <Button
                variant="outline"
                className="h-11 rounded-lg"
                onClick={() => setSearch("")}
              >
                Clear search
              </Button>
            ) : (
              <Button
                className={cn("h-11 rounded-lg", MODULE_BUTTON_CLASS.emerald)}
                onClick={() => setAddOpen(true)}
              >
                <Plus className="mr-2 size-4" aria-hidden />
                Add farmer
              </Button>
            )
          }
        />
      ) : (
        <div className="space-y-3">
          {visible.map((farmer) => (
            <FarmerCard key={farmer.id} farmer={farmer} />
          ))}
        </div>
      )}

      <FarmerDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        mode="create"
        isPending={createFarmer.isPending}
        onSubmit={(values) =>
          createFarmer.mutate(values, {
            onSuccess: (created) => {
              toast.success(`${created.name} added`);
              setAddOpen(false);
            },
            onError: (error) => {
              if (error instanceof ApiError && error.isSessionExpired) {
                toast.error(error.message);
                redirectToLogin();
                return;
              }
              toast.error(
                error instanceof ApiError
                  ? error.message
                  : "Couldn't add the farmer."
              );
            },
          })
        }
      />
    </>
  );
}

/** One farmer row. A card at every width — money must never scroll out of view. */
function FarmerCard({ farmer }: { farmer: FarmerWithBalance }) {
  const tone = farmerBalanceTone(farmer.netBalanceOwed);

  // The most recent thing that happened, either side of the ledger.
  const lastActivity = [farmer.lastDeliveryDate, farmer.lastPurchaseDate]
    .filter((value): value is string => Boolean(value))
    .sort()
    .pop();

  return (
    <Link
      href={`/milk/farmers/${farmer.id}`}
      className="block rounded-xl border border-zinc-200 bg-white p-4 shadow-sm transition-colors hover:bg-zinc-50/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[15px] font-medium text-zinc-900">
            {farmer.name}
          </p>
          <p className="num mt-1 text-sm text-zinc-500">
            {farmer.phone ? (
              <>
                {farmer.phone}
                <span className="mx-1.5 text-zinc-300">·</span>
              </>
            ) : null}
            {lastActivity
              ? `Last activity ${formatDate(lastActivity)}`
              : "No activity yet"}
          </p>
        </div>

        <div className="shrink-0 text-right">
          <MoneyText
            value={farmerBalanceMagnitude(farmer.netBalanceOwed)}
            tone={farmerBalanceMoneyTone(farmer.netBalanceOwed)}
            className="text-[17px] font-semibold"
          />
          <p className={cn("mt-0.5 text-xs", FARMER_BALANCE_TEXT_CLASS[tone])}>
            {farmerBalanceLabel(farmer.netBalanceOwed)}
          </p>
        </div>
      </div>
    </Link>
  );
}
