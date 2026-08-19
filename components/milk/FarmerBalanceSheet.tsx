"use client";

import { useMemo, useState } from "react";
import { ArrowLeft, LogIn, RefreshCw, Scale, Users } from "lucide-react";
import Link from "next/link";

import { AnimatedMoney } from "@/components/shared/AnimatedMoney";
import { EmptyState } from "@/components/shared/EmptyState";
import { FarmerStatementDialog } from "@/components/milk/FarmerStatementDialog";
import { MoneyText } from "@/components/shared/MoneyText";
import { PageHeader } from "@/components/shared/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ApiError, redirectToLogin } from "@/lib/api-client";
import { formatDate, formatLiters, formatPKR } from "@/lib/format";
import { useFarmers, type FarmerWithBalance } from "@/lib/hooks/use-milk";
import {
  FARMER_BALANCE_TEXT_CLASS,
  farmerBalanceLabel,
  farmerBalanceMagnitude,
  farmerBalanceMoneyTone,
  farmerBalanceTone,
} from "@/lib/milk-display";
import { cn } from "@/lib/utils";

/**
 * The all-farmers balance sheet — "who do I owe, and how much".
 *
 * ---------------------------------------------------------------------------
 * THIS FILE COMPUTES NOTHING. THAT IS THE POINT OF THE PHASE.
 * ---------------------------------------------------------------------------
 * Every figure comes from the server: `getFarmerBalances()` returns each
 * farmer's balance in a FIXED TWO queries regardless of how many farmers exist,
 * and `summariseFarmerBalances()` produces the owed/advanced split. Both live in
 * lib/milk.ts and are already verified. Re-deriving either here would give the
 * owner two numbers that can disagree, and would walk into the one-query-per-
 * farmer N+1 that CLAUDE.md guardrails.
 *
 * The sign→colour→wording mapping is likewise imported wholesale from
 * lib/milk-display.ts. Positive = the OWNER owes the farmer = emerald, the
 * opposite of a customer's outstanding. Nothing here tests the sign by hand.
 *
 * ---------------------------------------------------------------------------
 * RETIRED FARMERS ARE INCLUDED WHEN THEY STILL HAVE A BALANCE
 * ---------------------------------------------------------------------------
 * `includeInactive: true`, deliberately. Retiring a farmer does not settle what
 * they are owed — the Phase 5 retire flow says so explicitly in its own toast
 * ("was retired, but you still owe them X"). A balance sheet that dropped them
 * would quietly remove a real debt from the only screen whose job is totalling
 * debts. Retired farmers with a ZERO balance are hidden, since they are neither
 * owed nor owing and would only pad the list.
 */
export function FarmerBalanceSheet() {
  const [outstandingOnly, setOutstandingOnly] = useState(false);

  // includeInactive so a retired-but-unpaid farmer cannot vanish from the
  // totals. See the note above.
  const farmersQuery = useFarmers({
    withBalances: true,
    includeInactive: true,
  });

  const farmers = useMemo(
    () => farmersQuery.data?.farmers ?? [],
    [farmersQuery.data]
  );
  const summary = farmersQuery.data?.summary ?? null;

  /**
   * The farmers this sheet is ABOUT, before the settled filter is applied.
   *
   * A retired farmer with nothing outstanding is finished business and is
   * excluded entirely. Everyone else — active, or retired but still carrying a
   * balance — belongs on the sheet.
   */
  const included = useMemo(
    () =>
      farmers.filter(
        (farmer) => farmer.isActive || farmer.netBalanceOwed !== 0
      ),
    [farmers]
  );

  /**
   * The context line describes exactly {@link included}, so its count can never
   * disagree with the number of rows underneath it. Previously it used the
   * server's `farmerCount`, which counts every farmer fetched — so the sheet
   * read "7 farmers" above 6 rows.
   *
   * Summing already-serialized numbers held in memory for a display line is the
   * same latitude the customers hub takes; the AUTHORITATIVE money answer (owed
   * vs advanced) still comes from the server and is untouched by this. It has to
   * be: every farmer excluded here is net-zero by definition, so they contribute
   * nothing to either the owed or the advanced bucket.
   */
  const context = useMemo(() => {
    let liters = 0;
    let milk = 0;
    let purchases = 0;
    for (const farmer of included) {
      liters += farmer.totalLiters;
      milk += farmer.totalMilkValue;
      purchases += farmer.totalPurchases;
    }
    return { count: included.length, liters, milk, purchases };
  }, [included]);

  const rows = useMemo(() => {
    const visible = included.filter((farmer) => {
      if (outstandingOnly && farmer.netBalanceOwed === 0) return false;
      return true;
    });

    // Biggest payable first — the owner's actual question is "who do I owe
    // most", not "who comes first alphabetically". Ties broken by name so the
    // order is stable between renders.
    return [...visible].sort((a, b) => {
      if (b.netBalanceOwed !== a.netBalanceOwed) {
        return b.netBalanceOwed - a.netBalanceOwed;
      }
      return a.name.localeCompare(b.name);
    });
  }, [included, outstandingOnly]);

  const settledCount = included.filter(
    (farmer) => farmer.netBalanceOwed === 0
  ).length;

  const header = (
    <>
      <Link
        href="/milk"
        className="mb-3 inline-flex min-h-[44px] items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-900"
      >
        <ArrowLeft className="size-4" aria-hidden />
        Milk shop
      </Link>
      <PageHeader
        title="Balance sheet"
        accent="emerald"
        description="What you owe every farmer, biggest first."
        /**
         * WAS a plain `farmer_balances` CSV — every farmer, one row each, no
         * dates and no detail. That answers "what do I owe everyone", which
         * this screen already shows on screen. It is now the statement: one
         * farmer, a date range, and the deliveries and purchases behind the
         * number. See FarmerStatementDialog.
         */
        action={<FarmerStatementDialog farmers={farmers} />}
      />
    </>
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
          description="Please sign in again to see the balance sheet."
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
          title="Couldn't load the balance sheet"
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

      {/* Summary ------------------------------------------------------
          Owed and advanced are shown SEPARATELY and never netted. Two
          farmers, one owed 5,000 and one 5,000 ahead, would net to "nothing
          to pay" while the first still has to be handed 5,000 in cash. Same
          principle as the receivables hub, and it is enforced server-side in
          summariseFarmerBalances — this just renders both. */}
      <div
        className="mb-4 grid gap-3 sm:grid-cols-2"
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
              countUpOnMount
              className="mt-2 block text-[28px] font-bold leading-tight text-emerald-600"
            />
          )}
          <p className="mt-1 text-sm text-zinc-500">
            cash to pay out — advances are not deducted
          </p>
        </div>

        <div className="rounded-xl border border-rose-100 bg-white p-5 shadow-sm">
          <p className="text-[13px] font-medium uppercase tracking-wide text-zinc-500">
            Farmers ahead
          </p>
          {farmersQuery.isPending ? (
            <Skeleton className="mt-3 h-9 w-28 rounded-lg" />
          ) : (
            <p className="num mt-2 text-[28px] font-bold leading-tight text-rose-600">
              {formatPKR(summary?.totalAdvanced ?? 0)}
            </p>
          )}
          <p className="mt-1 text-sm text-zinc-500">
            taken in goods beyond their milk
          </p>
        </div>
      </div>

      {/* Context for the numbers above. Describes exactly the farmers on this
          sheet, so the count always matches the rows below it. */}
      {!farmersQuery.isPending && summary ? (
        <p className="num mb-4 text-sm text-zinc-500">
          {context.count} {context.count === 1 ? "farmer" : "farmers"}
          <span className="mx-1.5 text-zinc-300">·</span>
          {formatLiters(context.liters)} bought
          <span className="mx-1.5 text-zinc-300">·</span>
          {formatPKR(context.milk)} milk
          <span className="mx-1.5 text-zinc-300">·</span>
          {formatPKR(context.purchases)} purchases
        </p>
      ) : null}

      {/* Filter --------------------------------------------------------
          shadcn's Switch renders 36×20px, under the Design System's 44px
          minimum — measured at 360px, not assumed. The `size-11` span gives it
          a real 44×44 tap area without changing how the switch looks, and the
          whole row is a <label>, so the text is tappable too. (A <button> is a
          labelable element, so `htmlFor` genuinely forwards the click.)

          Fixed here rather than deferred: the 28px TabsTrigger is a pre-existing
          shadcn default queued for the Phase 8 app-wide sweep, but this control
          is new in this phase, so it ships correct. */}
      <label
        htmlFor="outstanding-only"
        className="mb-3 flex min-h-[44px] w-fit cursor-pointer items-center gap-2"
      >
        <span className="flex size-11 shrink-0 items-center justify-center">
          <Switch
            id="outstanding-only"
            checked={outstandingOnly}
            onCheckedChange={setOutstandingOnly}
          />
        </span>
        <span className="text-sm text-zinc-600">
          Only farmers with a balance
          {settledCount > 0 ? (
            <span className="num text-zinc-400"> ({settledCount} settled)</span>
          ) : null}
        </span>
      </label>

      {/* Rows ---------------------------------------------------------- */}
      {farmersQuery.isPending ? (
        <div className="space-y-3">
          {[0, 1, 2].map((row) => (
            <Skeleton key={row} className="h-[76px] w-full rounded-xl" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={outstandingOnly ? Scale : Users}
          accent="emerald"
          title={
            outstandingOnly
              ? "Everyone is settled"
              : farmers.length === 0
                ? "No farmers yet"
                : "Nothing to show"
          }
          description={
            outstandingOnly
              ? "No farmer is owed anything and no one is running ahead."
              : farmers.length === 0
                ? "Add farmers and record deliveries — their balances appear here."
                : "Try turning the filter off."
          }
          action={
            outstandingOnly ? (
              <Button
                variant="outline"
                className="h-11 rounded-lg"
                onClick={() => setOutstandingOnly(false)}
              >
                Show everyone
              </Button>
            ) : farmers.length === 0 ? (
              <Button asChild className="h-11 rounded-lg">
                <Link href="/milk">Go to farmers</Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          {/* Mobile: cards. A five-column table at 360px would either scroll
              horizontally or crush the money columns, and money the owner has
              to act on must never be off-screen. */}
          <div className="space-y-3 md:hidden">
            {rows.map((farmer) => (
              <BalanceCard key={farmer.id} farmer={farmer} />
            ))}
          </div>

          {/* Desktop: a real table — this is a ledger, and columns that line
              up are the whole reason to read it on a big screen. */}
          <div className="hidden overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm md:block">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="text-[13px] font-medium uppercase tracking-wide text-zinc-500">
                    Farmer
                  </TableHead>
                  <TableHead className="text-right text-[13px] font-medium uppercase tracking-wide text-zinc-500">
                    Milk
                  </TableHead>
                  <TableHead className="text-right text-[13px] font-medium uppercase tracking-wide text-zinc-500">
                    Purchases
                  </TableHead>
                  <TableHead className="text-right text-[13px] font-medium uppercase tracking-wide text-zinc-500">
                    Net balance
                  </TableHead>
                  <TableHead className="text-right text-[13px] font-medium uppercase tracking-wide text-zinc-500">
                    Last activity
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((farmer) => (
                  <BalanceRow key={farmer.id} farmer={farmer} />
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </>
  );
}

/** Most recent thing that happened, either side of the ledger. */
function lastActivityOf(farmer: FarmerWithBalance): string | null {
  return (
    [farmer.lastDeliveryDate, farmer.lastPurchaseDate]
      .filter((value): value is string => Boolean(value))
      .sort()
      .pop() ?? null
  );
}

function RetiredBadge() {
  return (
    <Badge
      variant="secondary"
      className="shrink-0 rounded-md text-[11px] font-medium"
    >
      Retired
    </Badge>
  );
}

function BalanceRow({ farmer }: { farmer: FarmerWithBalance }) {
  const tone = farmerBalanceTone(farmer.netBalanceOwed);
  const lastActivity = lastActivityOf(farmer);

  return (
    <TableRow>
      <TableCell className="font-medium text-zinc-900">
        <Link
          href={`/milk/farmers/${farmer.id}`}
          className="inline-flex items-center gap-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
        >
          {farmer.name}
          {!farmer.isActive ? <RetiredBadge /> : null}
        </Link>
      </TableCell>
      <TableCell className="num text-right text-zinc-600">
        {formatPKR(farmer.totalMilkValue)}
      </TableCell>
      <TableCell className="num text-right text-zinc-600">
        {formatPKR(farmer.totalPurchases)}
      </TableCell>
      <TableCell className="text-right">
        <MoneyText
          value={farmerBalanceMagnitude(farmer.netBalanceOwed)}
          tone={farmerBalanceMoneyTone(farmer.netBalanceOwed)}
          className="font-semibold"
        />
        <span className={cn("ml-2 text-xs", FARMER_BALANCE_TEXT_CLASS[tone])}>
          {farmerBalanceLabel(farmer.netBalanceOwed)}
        </span>
      </TableCell>
      <TableCell className="num text-right text-zinc-500">
        {lastActivity ? formatDate(lastActivity) : "—"}
      </TableCell>
    </TableRow>
  );
}

function BalanceCard({ farmer }: { farmer: FarmerWithBalance }) {
  const tone = farmerBalanceTone(farmer.netBalanceOwed);
  const lastActivity = lastActivityOf(farmer);

  return (
    <Link
      href={`/milk/farmers/${farmer.id}`}
      className="block rounded-xl border border-zinc-200 bg-white p-4 shadow-sm transition-colors hover:bg-zinc-50/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="truncate text-[15px] font-medium text-zinc-900">
              {farmer.name}
            </p>
            {!farmer.isActive ? <RetiredBadge /> : null}
          </div>
          <p className="num mt-1 text-sm text-zinc-500">
            Milk {formatPKR(farmer.totalMilkValue)}
            <span className="mx-1.5 text-zinc-300">·</span>
            Purchases {formatPKR(farmer.totalPurchases)}
          </p>
          <p className="num mt-0.5 text-xs text-zinc-400">
            {lastActivity ? `Last activity ${formatDate(lastActivity)}` : "No activity yet"}
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
