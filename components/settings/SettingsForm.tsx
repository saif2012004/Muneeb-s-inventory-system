"use client";

import { useEffect } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertTriangle, CheckCircle2, Loader2, LogIn } from "lucide-react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { EmptyState } from "@/components/shared/EmptyState";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError, redirectToLogin } from "@/lib/api-client";
import { useSettings, useUpdateSettings } from "@/lib/hooks/use-settings";
import {
  SETTINGS_PLACEHOLDERS,
  isConfigured,
  isPlaceholderValue,
  type Settings,
} from "@/lib/settings-display";

/**
 * /settings — the owner's own shop details.
 *
 * Neutral ZINC, not a module accent. This is app-level rather than beverages /
 * bakery / milk, and the Design System's rule is one accent per screen — an
 * app-wide page borrowing a module's colour would imply it belongs to that
 * module.
 *
 * ---------------------------------------------------------------------------
 * THE PLACEHOLDERS ARE NEVER PRE-FILLED INTO THE INPUTS
 * ---------------------------------------------------------------------------
 * The stored row ships with `SET SHOP NAME IN SETTINGS` and friends. If the form
 * pre-filled those, the owner would fix the shop name, press Save, and silently
 * promote the untouched "SET PHONE IN SETTINGS" into a real phone number that
 * then prints on every receipt as though he had chosen it.
 *
 * So a field holding a placeholder renders EMPTY, with the placeholder shown as
 * the input's own `placeholder` attribute — visible, obviously not a value, and
 * impossible to submit by accident. The server rejects them too
 * (lib/validations/settings.ts); this is the half that stops it being annoying.
 */

const formSchema = z.object({
  shopName: z
    .string()
    .trim()
    .min(1, { message: "Shop name is required" })
    .max(80, { message: "Shop name must be 80 characters or fewer" }),
  shopPhone: z
    .string()
    .trim()
    .max(60, { message: "Phone must be 60 characters or fewer" }),
  shopAddress: z
    .string()
    .trim()
    .max(200, { message: "Address must be 200 characters or fewer" }),
});

type FormValues = z.infer<typeof formSchema>;

/** A stored placeholder is "nothing yet", so the input starts empty. */
function realValueOrEmpty(value: string | null): string {
  return value === null || isPlaceholderValue(value) ? "" : value;
}

function toFormValues(settings: Settings): FormValues {
  return {
    shopName: realValueOrEmpty(settings.shopName),
    shopPhone: realValueOrEmpty(settings.shopPhone),
    shopAddress: realValueOrEmpty(settings.shopAddress),
  };
}

export function SettingsForm() {
  const settingsQuery = useSettings();
  const updateSettings = useUpdateSettings();

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { shopName: "", shopPhone: "", shopAddress: "" },
  });

  const { reset } = form;
  const settings = settingsQuery.data;

  /**
   * Seed the form once the row arrives.
   *
   * Keyed on the FIELDS rather than on the query object. Structural sharing
   * means a refetch returning identical data keeps the same reference, so an
   * effect keyed on `settingsQuery.data` would not re-run — the trap documented
   * in CLAUDE.md that let a milk quick-entry box show a value that was not
   * stored. Keying on the values themselves cannot go stale that way, and there
   * is no half-typed state to protect here because the mutation writes the
   * server's response straight into the cache.
   */
  useEffect(() => {
    if (settings) reset(toFormValues(settings));
    // Keyed on the FIELDS, not the `settings` object — see the structural-sharing
    // note above. Adding `settings` back is precisely what this guards against,
    // so the exhaustive-deps suggestion is wrong here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reset, settings?.shopName, settings?.shopPhone, settings?.shopAddress]);

  function onSubmit(values: FormValues) {
    updateSettings.mutate(
      {
        shopName: values.shopName,
        // "" -> null: the receipt omits an absent line rather than printing a
        // blank one. The zod schema on the server does the same transform.
        shopPhone: values.shopPhone === "" ? null : values.shopPhone,
        shopAddress: values.shopAddress === "" ? null : values.shopAddress,
      },
      {
        onSuccess: () => toast.success("Shop details saved."),
        onError: (error) => {
          if (error instanceof ApiError) {
            toast.error(error.message);
            if (error.isSessionExpired) redirectToLogin();
            return;
          }
          toast.error("Couldn't save your shop details.");
        },
      }
    );
  }

  // ------------------------------------------------------------------
  // Loading / session / error states
  // ------------------------------------------------------------------

  if (settingsQuery.error instanceof ApiError && settingsQuery.error.isSessionExpired) {
    return (
      <>
        <PageHeader title="Settings" />
        <EmptyState
          icon={LogIn}
          title="Your session expired"
          description="Please sign in again to change your shop details."
          action={
            <Button className="h-11 rounded-lg" onClick={redirectToLogin}>
              Sign in
            </Button>
          }
        />
      </>
    );
  }

  if (settingsQuery.isError) {
    return (
      <>
        <PageHeader title="Settings" />
        <EmptyState
          icon={AlertTriangle}
          title="Couldn't load your settings"
          description={
            settingsQuery.error instanceof ApiError
              ? settingsQuery.error.message
              : "Something went wrong."
          }
          action={
            <Button
              className="h-11 rounded-lg"
              onClick={() => settingsQuery.refetch()}
            >
              Try again
            </Button>
          }
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Settings"
        description="Your shop details. These print on every receipt."
      />

      {settingsQuery.isPending || !settings ? (
        <Card className="rounded-xl shadow-sm">
          <CardContent className="space-y-6 p-5">
            <Skeleton className="h-16 w-full rounded-lg" />
            <Skeleton className="h-16 w-full rounded-lg" />
            <Skeleton className="h-16 w-full rounded-lg" />
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          <ConfigurationNotice settings={settings} />

          <Card className="rounded-xl shadow-sm">
            <CardContent className="p-5">
              <Form {...form}>
                <form
                  onSubmit={form.handleSubmit(onSubmit)}
                  className="space-y-5"
                  // The login form's no-JS GET fallback is a known credential
                  // leak (CHECKLIST #1). Nothing secret is posted here, but the
                  // same defect would put the shop's details in the URL, so the
                  // method is pinned rather than left to the browser default.
                  method="post"
                >
                  <FormField
                    control={form.control}
                    name="shopName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Shop name</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            className="h-11 rounded-lg"
                            placeholder={SETTINGS_PLACEHOLDERS.shopName}
                            autoComplete="organization"
                          />
                        </FormControl>
                        <FormDescription>
                          Printed at the top of every receipt.
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="shopPhone"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Phone (optional)</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            className="h-11 rounded-lg"
                            placeholder={SETTINGS_PLACEHOLDERS.shopPhone}
                            inputMode="tel"
                            autoComplete="tel"
                          />
                        </FormControl>
                        <FormDescription>
                          Leave blank to keep it off the receipt.
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="shopAddress"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Address (optional)</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            className="h-11 rounded-lg"
                            placeholder={SETTINGS_PLACEHOLDERS.shopAddress}
                            autoComplete="street-address"
                          />
                        </FormControl>
                        <FormDescription>
                          Leave blank to keep it off the receipt.
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <Button
                    type="submit"
                    className="h-11 w-full rounded-lg sm:w-auto"
                    disabled={updateSettings.isPending}
                  >
                    {updateSettings.isPending ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Saving…
                      </>
                    ) : (
                      "Save shop details"
                    )}
                  </Button>
                </form>
              </Form>
            </CardContent>
          </Card>
        </div>
      )}
    </>
  );
}

/**
 * The loud unconfigured banner.
 *
 * Rose, because this is a "something is wrong and a customer will see it" state
 * rather than a neutral hint — the same semantic the Design System gives to
 * money owed. It reads from `configuredAt`, the recorded fact, so it cannot be
 * fooled by text that merely looks real.
 *
 * The confirmation state is shown too, and deliberately quiet: at handoff
 * someone needs to be able to glance at this screen and see that the step is
 * actually done (CHECKLIST #2b), not just that the warning is absent.
 */
function ConfigurationNotice({ settings }: { settings: Settings }) {
  if (!isConfigured(settings)) {
    return (
      <div
        role="alert"
        className="flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4"
      >
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-rose-600" />
        <div className="min-w-0 text-sm">
          <p className="font-semibold text-rose-900">
            Your shop details are not set yet
          </p>
          <p className="mt-1 text-rose-800">
            Receipts are currently printing{" "}
            <span className="font-medium">“{SETTINGS_PLACEHOLDERS.shopName}”</span>{" "}
            instead of your shop name. Fill in the fields below and save.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
      <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
      <p className="text-sm text-emerald-900">
        Your shop details are set and printing on receipts.
      </p>
    </div>
  );
}
