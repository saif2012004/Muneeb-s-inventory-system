"use client";

import { useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  ArrowLeft,
  LogIn,
  Milk,
  Pencil,
  Plus,
  RefreshCw,
  ShoppingBasket,
  Trash2,
  UserMinus,
} from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";

import { DeliveryDialog } from "@/components/milk/DeliveryDialog";
import { FarmerDialog } from "@/components/milk/FarmerDialog";
import { PurchaseDialog } from "@/components/milk/PurchaseDialog";
import { AnimatedMoney } from "@/components/shared/AnimatedMoney";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { EmptyState } from "@/components/shared/EmptyState";
import { MoneyText } from "@/components/shared/MoneyText";
import { PageHeader } from "@/components/shared/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { enterUp, TWEEN } from "@/lib/motion";
import { ApiError, redirectToLogin } from "@/lib/api-client";
import { formatDate, formatLiters, formatPKR } from "@/lib/format";
import {
  useCreateDelivery,
  useCreatePurchase,
  useDeleteDelivery,
  useDeletePurchase,
  useFarmerProfile,
  useRetireFarmer,
  useUpdateDelivery,
  useUpdateFarmer,
  useUpdatePurchase,
  type Delivery,
  type FarmerPurchase,
} from "@/lib/hooks/use-milk";
import {
  FARMER_BALANCE_TEXT_CLASS,
  farmerBalanceLabel,
  farmerBalanceMagnitude,
  farmerBalanceTone,
  formatSessionLiters,
} from "@/lib/milk-display";
import { MODULE_BUTTON_CLASS } from "@/lib/nav";
import { cn } from "@/lib/utils";

/**
 * One farmer: what they delivered, what they took, and what they are owed.
 *
 * The whole screen is fed by a SINGLE request (`/api/milk/farmers/[id]`) that
 * returns the farmer, the balance, both tables and the ledger — derived server-
 * side from one fetch of the rows. Splitting it into four calls is how Phase 4b
 * exhausted a one-connection pool.
 *
 * REMINDER ON THE SIGN: a positive balance means the OWNER OWES THE FARMER,
 * the opposite of a customer's outstanding. All colour and wording decisions go
 * through lib/milk-display.ts.
 */
export function FarmerProfile({ farmerId }: { farmerId: string }) {
  const reduceMotion = useReducedMotion();
  const profileQuery = useFarmerProfile(farmerId);

  const updateFarmer = useUpdateFarmer();
  const retireFarmer = useRetireFarmer();
  const createDelivery = useCreateDelivery(farmerId);
  const updateDelivery = useUpdateDelivery(farmerId);
  const deleteDelivery = useDeleteDelivery(farmerId);
  const createPurchase = useCreatePurchase(farmerId);
  const updatePurchase = useUpdatePurchase(farmerId);
  const deletePurchase = useDeletePurchase(farmerId);

  const [editFarmerOpen, setEditFarmerOpen] = useState(false);
  const [retireOpen, setRetireOpen] = useState(false);
  const [deliveryDialog, setDeliveryDialog] = useState<{
    open: boolean;
    target: Delivery | null;
  }>({ open: false, target: null });
  const [purchaseDialog, setPurchaseDialog] = useState<{
    open: boolean;
    target: FarmerPurchase | null;
  }>({ open: false, target: null });
  const [deleteTarget, setDeleteTarget] = useState<
    | { kind: "delivery"; row: Delivery }
    | { kind: "purchase"; row: FarmerPurchase }
    | null
  >(null);

  /** Every mutation reports the same way, so failures never pass silently. */
  function handleError(fallback: string) {
    return (error: unknown) => {
      if (error instanceof ApiError && error.isSessionExpired) {
        toast.error(error.message);
        redirectToLogin();
        return;
      }
      toast.error(error instanceof ApiError ? error.message : fallback);
    };
  }

  const backLink = (
    <Link
      href="/milk"
      className="mb-3 inline-flex min-h-[44px] items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-900"
    >
      <ArrowLeft className="size-4" aria-hidden />
      All farmers
    </Link>
  );

  // ------------------------------------------------------------------
  // Session / error / loading
  // ------------------------------------------------------------------

  if (
    profileQuery.error instanceof ApiError &&
    profileQuery.error.isSessionExpired
  ) {
    return (
      <>
        {backLink}
        <EmptyState
          icon={LogIn}
          accent="emerald"
          title="Your session expired"
          description="Please sign in again to see this farmer."
          action={
            <Button className="h-11 rounded-lg" onClick={redirectToLogin}>
              Sign in
            </Button>
          }
        />
      </>
    );
  }

  if (profileQuery.error) {
    return (
      <>
        {backLink}
        <EmptyState
          icon={RefreshCw}
          accent="emerald"
          title="Couldn't load this farmer"
          description={
            profileQuery.error instanceof ApiError
              ? profileQuery.error.message
              : "Something went wrong."
          }
          action={
            <Button
              className="h-11 rounded-lg"
              onClick={() => profileQuery.refetch()}
            >
              <RefreshCw className="mr-2 size-4" aria-hidden />
              Try again
            </Button>
          }
        />
      </>
    );
  }

  if (profileQuery.isPending || !profileQuery.data) {
    return (
      <>
        {backLink}
        <Skeleton className="mb-4 h-9 w-48 rounded-lg" />
        <Skeleton className="mb-4 h-[132px] w-full rounded-xl" />
        <div className="space-y-3">
          {[0, 1, 2].map((row) => (
            <Skeleton key={row} className="h-[76px] w-full rounded-xl" />
          ))}
        </div>
      </>
    );
  }

  const { farmer, balance, deliveries, purchases, ledger } = profileQuery.data;
  const tone = farmerBalanceTone(balance.netBalanceOwed);

  return (
    <>
      {backLink}

      <PageHeader
        title={farmer.name}
        accent="emerald"
        description={
          [farmer.phone, farmer.address].filter(Boolean).join(" · ") ||
          "No contact details"
        }
        action={
          <div className="flex gap-2">
            <Button
              variant="outline"
              className="h-11 rounded-lg"
              onClick={() => setEditFarmerOpen(true)}
            >
              <Pencil className="mr-2 size-4" aria-hidden />
              Edit
            </Button>
            {farmer.isActive ? (
              <Button
                variant="outline"
                className="h-11 rounded-lg"
                onClick={() => setRetireOpen(true)}
              >
                <UserMinus className="mr-2 size-4" aria-hidden />
                Retire
              </Button>
            ) : null}
          </div>
        }
      />

      {!farmer.isActive ? (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          This farmer is retired. Their history and balance are kept, but new
          deliveries and purchases are blocked until you reactivate them.
        </div>
      ) : null}

      {/* Balance ------------------------------------------------------- */}
      <div
        className="mb-4 rounded-xl border border-emerald-100 bg-white p-5 shadow-sm"
      >
        <p className="text-[13px] font-medium uppercase tracking-wide text-zinc-500">
          {farmerBalanceLabel(balance.netBalanceOwed)}
        </p>
        <AnimatedMoney
          value={farmerBalanceMagnitude(balance.netBalanceOwed)}
          countUpOnMount
          className={cn(
            "mt-2 block text-[32px] font-bold leading-tight",
            FARMER_BALANCE_TEXT_CLASS[tone]
          )}
        />

        <div className="mt-4 grid grid-cols-3 gap-3 border-t border-zinc-100 pt-4">
          <div>
            <p className="text-xs text-zinc-500">Milk</p>
            <p className="num mt-0.5 text-sm font-medium text-zinc-900">
              {formatPKR(balance.totalMilkValue)}
            </p>
          </div>
          <div>
            <p className="text-xs text-zinc-500">Purchases</p>
            <p className="num mt-0.5 text-sm font-medium text-zinc-900">
              {formatPKR(balance.totalPurchases)}
            </p>
          </div>
          <div>
            <p className="text-xs text-zinc-500">Litres</p>
            <p className="num mt-0.5 text-sm font-medium text-zinc-900">
              {formatLiters(balance.totalLiters)}
            </p>
          </div>
        </div>
      </div>

      {/* Actions ------------------------------------------------------- */}
      <div className="mb-4 grid grid-cols-2 gap-3">
        <Button
          className={cn("h-11 rounded-lg", MODULE_BUTTON_CLASS.emerald)}
          disabled={!farmer.isActive}
          onClick={() => setDeliveryDialog({ open: true, target: null })}
        >
          <Plus className="mr-2 size-4" aria-hidden />
          Delivery
        </Button>
        <Button
          variant="outline"
          className="h-11 rounded-lg"
          disabled={!farmer.isActive}
          onClick={() => setPurchaseDialog({ open: true, target: null })}
        >
          <Plus className="mr-2 size-4" aria-hidden />
          Purchase
        </Button>
      </div>

      {/* Tabs ---------------------------------------------------------- */}
      <Tabs defaultValue="deliveries">
        <TabsList className="mb-3 w-full">
          <TabsTrigger value="deliveries" className="flex-1">
            Deliveries
          </TabsTrigger>
          <TabsTrigger value="purchases" className="flex-1">
            Purchases
          </TabsTrigger>
          <TabsTrigger value="ledger" className="flex-1">
            Ledger
          </TabsTrigger>
        </TabsList>

        <TabsContent value="deliveries">
            {/* Radix mounts a panel only when it becomes active, so this
                motion.div is fresh on every tab switch and its entrance
                plays each time — no AnimatePresence needed for a panel that
                Radix itself unmounts. */}
            <motion.div {...enterUp(reduceMotion, TWEEN.page)} className="space-y-3">
          {deliveries.length === 0 ? (
            <EmptyState
              icon={Milk}
              accent="emerald"
              title="No deliveries yet"
              description="Record what this farmer brought, or use quick entry for everyone at once."
            />
          ) : (
            deliveries.map((delivery) => (
              <div
                key={delivery.id}
                className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="num text-[15px] font-medium text-zinc-900">
                      {formatDate(delivery.deliveryDate)}
                    </p>
                    <p className="num mt-1 text-sm text-zinc-500">
                      {/*
                        A null session is an em dash, never "0 L" — the farmer
                        did not come, which is not the same as arriving with
                        nothing. See formatSessionLiters.
                      */}
                      Morning {formatSessionLiters(delivery.morningLiters)}
                      <span className="mx-1.5 text-zinc-300">·</span>
                      Evening {formatSessionLiters(delivery.eveningLiters)}
                    </p>
                    <p className="num mt-1 text-sm text-zinc-500">
                      {formatLiters(delivery.totalLiters)} ×{" "}
                      {formatPKR(delivery.ratePerLiter)}
                    </p>
                    {delivery.notes ? (
                      <p className="mt-1 text-sm text-zinc-500">
                        {delivery.notes}
                      </p>
                    ) : null}
                  </div>

                  <div className="shrink-0 text-right">
                    <MoneyText
                      value={delivery.totalAmount}
                      tone="emerald"
                      className="text-[17px] font-semibold"
                    />
                    <div className="mt-2 flex justify-end gap-1">
                      <RowButton
                        label="Edit delivery"
                        onClick={() =>
                          setDeliveryDialog({ open: true, target: delivery })
                        }
                      >
                        <Pencil className="size-4" aria-hidden />
                      </RowButton>
                      <RowButton
                        label="Delete delivery"
                        destructive
                        onClick={() =>
                          setDeleteTarget({ kind: "delivery", row: delivery })
                        }
                      >
                        <Trash2 className="size-4" aria-hidden />
                      </RowButton>
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
          </motion.div>
        </TabsContent>

        <TabsContent value="purchases">
            {/* Radix mounts a panel only when it becomes active, so this
                motion.div is fresh on every tab switch and its entrance
                plays each time — no AnimatePresence needed for a panel that
                Radix itself unmounts. */}
            <motion.div {...enterUp(reduceMotion, TWEEN.page)} className="space-y-3">
          {purchases.length === 0 ? (
            <EmptyState
              icon={ShoppingBasket}
              accent="emerald"
              title="No purchases yet"
              description="Cow food, milk, yogurt or anything else this farmer took from the shop."
            />
          ) : (
            purchases.map((purchase) => (
              <div
                key={purchase.id}
                className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-[15px] font-medium text-zinc-900">
                      {purchase.itemDescription}
                    </p>
                    <p className="num mt-1 text-sm text-zinc-500">
                      {formatDate(purchase.purchaseDate)}
                    </p>
                    {purchase.notes ? (
                      <p className="mt-1 text-sm text-zinc-500">
                        {purchase.notes}
                      </p>
                    ) : null}
                  </div>

                  <div className="shrink-0 text-right">
                    {/*
                      Rose: a purchase works AGAINST what the owner owes. Same
                      colour language as the balance itself.
                    */}
                    <MoneyText
                      value={purchase.amount}
                      tone="rose"
                      className="text-[17px] font-semibold"
                    />
                    <div className="mt-2 flex justify-end gap-1">
                      <RowButton
                        label="Edit purchase"
                        onClick={() =>
                          setPurchaseDialog({ open: true, target: purchase })
                        }
                      >
                        <Pencil className="size-4" aria-hidden />
                      </RowButton>
                      <RowButton
                        label="Delete purchase"
                        destructive
                        onClick={() =>
                          setDeleteTarget({ kind: "purchase", row: purchase })
                        }
                      >
                        <Trash2 className="size-4" aria-hidden />
                      </RowButton>
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
          </motion.div>
        </TabsContent>

        <TabsContent value="ledger">
            {/* Radix mounts a panel only when it becomes active, so this
                motion.div is fresh on every tab switch and its entrance
                plays each time — no AnimatePresence needed for a panel that
                Radix itself unmounts. */}
            <motion.div {...enterUp(reduceMotion, TWEEN.page)} className="space-y-2">
          {ledger.length === 0 ? (
            <EmptyState
              icon={Milk}
              accent="emerald"
              title="Nothing recorded yet"
              description="Deliveries and purchases appear here in order, with the running balance after each one."
            />
          ) : (
            ledger.map((entry) => (
              <div
                key={`${entry.kind}-${entry.id}`}
                className="flex items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-white px-4 py-3 shadow-sm"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Badge
                      variant="secondary"
                      className="shrink-0 rounded-md text-[11px] font-medium"
                    >
                      {entry.kind === "delivery" ? "Milk" : "Purchase"}
                    </Badge>
                    <p className="truncate text-sm text-zinc-900">
                      {entry.label}
                    </p>
                  </div>
                  <p className="num mt-1 text-xs text-zinc-500">
                    {formatDate(entry.date)}
                  </p>
                </div>

                <div className="shrink-0 text-right">
                  {/*
                    `amount` is already signed by the server: positive for a
                    delivery, negative for a purchase. `tone="auto"` colours
                    from that sign, so the direction can't be lost here.
                  */}
                  <MoneyText
                    value={entry.amount}
                    tone="auto"
                    className="text-[15px] font-semibold"
                  />
                  <p className="num mt-0.5 text-xs text-zinc-500">
                    Balance {formatPKR(entry.runningBalance)}
                  </p>
                </div>
              </div>
            ))
          )}
          </motion.div>
        </TabsContent>
      </Tabs>

      {/* Dialogs ------------------------------------------------------- */}

      <FarmerDialog
        open={editFarmerOpen}
        onOpenChange={setEditFarmerOpen}
        mode="edit"
        initial={{
          name: farmer.name,
          phone: farmer.phone,
          address: farmer.address,
        }}
        isPending={updateFarmer.isPending}
        onSubmit={(values) =>
          updateFarmer.mutate(
            { id: farmerId, ...values },
            {
              onSuccess: () => {
                toast.success("Farmer updated");
                setEditFarmerOpen(false);
              },
              onError: handleError("Couldn't update the farmer."),
            }
          )
        }
      />

      <DeliveryDialog
        open={deliveryDialog.open}
        onOpenChange={(open) =>
          setDeliveryDialog((current) => ({ ...current, open }))
        }
        mode={deliveryDialog.target ? "edit" : "create"}
        initial={deliveryDialog.target}
        isPending={createDelivery.isPending || updateDelivery.isPending}
        onSubmit={(values) => {
          const target = deliveryDialog.target;
          const done = {
            onSuccess: () => {
              toast.success(target ? "Delivery updated" : "Delivery recorded");
              setDeliveryDialog({ open: false, target: null });
            },
            onError: handleError("Couldn't save the delivery."),
          };
          if (target) {
            updateDelivery.mutate({ deliveryId: target.id, ...values }, done);
          } else {
            createDelivery.mutate(values, done);
          }
        }}
      />

      <PurchaseDialog
        open={purchaseDialog.open}
        onOpenChange={(open) =>
          setPurchaseDialog((current) => ({ ...current, open }))
        }
        mode={purchaseDialog.target ? "edit" : "create"}
        initial={purchaseDialog.target}
        isPending={createPurchase.isPending || updatePurchase.isPending}
        onSubmit={(values) => {
          const target = purchaseDialog.target;
          const done = {
            onSuccess: () => {
              toast.success(target ? "Purchase updated" : "Purchase recorded");
              setPurchaseDialog({ open: false, target: null });
            },
            onError: handleError("Couldn't save the purchase."),
          };
          if (target) {
            updatePurchase.mutate({ purchaseId: target.id, ...values }, done);
          } else {
            createPurchase.mutate(values, done);
          }
        }}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={
          deleteTarget?.kind === "purchase"
            ? "Delete this purchase?"
            : "Delete this delivery?"
        }
        description={
          deleteTarget?.kind === "purchase"
            ? "The purchase will be removed permanently and what you owe this farmer will go up by that amount. This can't be undone."
            : "The delivery will be removed permanently and what you owe this farmer will go down by that amount. This can't be undone."
        }
        confirmLabel={
          deleteTarget?.kind === "purchase" ? "Delete purchase" : "Delete delivery"
        }
        pendingLabel="Deleting…"
        onConfirm={async () => {
          if (!deleteTarget) return;
          try {
            if (deleteTarget.kind === "delivery") {
              await deleteDelivery.mutateAsync(deleteTarget.row.id);
              toast.success("Delivery deleted");
            } else {
              await deletePurchase.mutateAsync(deleteTarget.row.id);
              toast.success("Purchase deleted");
            }
            setDeleteTarget(null);
          } catch (error) {
            handleError("Couldn't delete it.")(error);
            // Rethrow so ConfirmDialog leaves itself open — a failed delete
            // that closes the dialog looks exactly like a successful one.
            throw error;
          }
        }}
      />

      <ConfirmDialog
        open={retireOpen}
        onOpenChange={setRetireOpen}
        title={`Retire ${farmer.name}?`}
        description="They'll be hidden from quick entry and new records, but every delivery, purchase and the balance are kept. You can reactivate them later."
        confirmLabel="Retire farmer"
        pendingLabel="Retiring…"
        onConfirm={async () => {
          try {
            const result = await retireFarmer.mutateAsync(farmerId);
            // The server's own sentence — it says whether money is still owed,
            // and in which direction. Never replace it with a generic toast.
            toast.success(result.message, { duration: 8_000 });
            setRetireOpen(false);
          } catch (error) {
            handleError("Couldn't retire the farmer.")(error);
            throw error;
          }
        }}
      />
    </>
  );
}

/** A 44px icon action. Design System minimum touch target. */
function RowButton({
  label,
  destructive,
  onClick,
  children,
}: {
  label: string;
  destructive?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={cn(
        "flex size-11 items-center justify-center rounded-lg transition-colors",
        destructive
          ? "text-zinc-400 hover:bg-rose-50 hover:text-rose-600"
          : "text-zinc-400 hover:bg-zinc-100 hover:text-zinc-900"
      )}
    >
      {children}
    </button>
  );
}
