"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { motion, useReducedMotion } from "framer-motion";
import { signIn } from "next-auth/react";
import { AlertCircle, Eye, EyeOff, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  DEFAULT_LOGIN_REDIRECT,
  LOGIN_ROUTE,
  NO_JS_LOGIN_ROUTE,
} from "@/lib/routes";
import { signInSchema, type SignInInput } from "@/lib/validations/auth";

/**
 * `callbackUrl` arrives from the query string, so it is attacker-controlled.
 * Resolve it against our own origin and discard anything that points off-site,
 * otherwise the login page becomes an open redirect.
 */
function resolveCallbackUrl(raw: string | undefined): string {
  if (!raw) return DEFAULT_LOGIN_REDIRECT;
  try {
    const url = new URL(raw, window.location.origin);
    if (url.origin !== window.location.origin) return DEFAULT_LOGIN_REDIRECT;
    // Never bounce straight back to the login page.
    if (url.pathname === LOGIN_ROUTE) return DEFAULT_LOGIN_REDIRECT;
    return `${url.pathname}${url.search}`;
  } catch {
    return DEFAULT_LOGIN_REDIRECT;
  }
}

export function LoginForm({
  callbackUrl,
  initialError,
}: {
  callbackUrl?: string;
  /** Set when the no-JS POST bounced back with `?error=` — see the login page. */
  initialError?: string;
}) {
  const router = useRouter();
  const reduceMotion = useReducedMotion();

  const [showPassword, setShowPassword] = useState(false);
  const [formError, setFormError] = useState<string | null>(
    initialError ?? null
  );

  const form = useForm<SignInInput>({
    resolver: zodResolver(signInSchema),
    defaultValues: { email: "", password: "" },
  });

  const isPending = form.formState.isSubmitting;

  async function onSubmit(values: SignInInput) {
    setFormError(null);

    const result = await signIn("credentials", {
      ...values,
      redirect: false,
    });

    if (!result || result.error) {
      // Deliberately vague: don't reveal whether the email exists.
      setFormError("Incorrect email or password.");
      form.setValue("password", "");
      return;
    }

    router.push(resolveCallbackUrl(callbackUrl));
    // Re-run server components so the new session is picked up.
    router.refresh();
  }

  return (
    <motion.div
      initial={reduceMotion ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      className="w-full max-w-[400px]"
    >
      <Card className="rounded-xl shadow-sm">
        <CardHeader className="space-y-1 p-5 pb-3">
          <CardTitle className="text-2xl font-semibold text-zinc-900">
            Sign in
          </CardTitle>
          <CardDescription className="text-sm text-zinc-500">
            Enter your details to open your dashboard.
          </CardDescription>
        </CardHeader>

        <CardContent className="p-5 pt-2">
          <Form {...form}>
            {/*
              `method` and `action` are LOAD-BEARING, not decoration. Without
              them a native submit (JS absent, or a click before hydration)
              defaults to GET and puts the owner's email and password in the
              URL — history, access logs, Referer. The route they post to
              exports POST only. Do not remove either attribute.

              With JS working this never fires: react-hook-form's handleSubmit
              calls preventDefault() synchronously, so the browser's native
              submit is cancelled and the client signIn() below runs instead.
            */}
            <form
              method="post"
              action={NO_JS_LOGIN_ROUTE}
              onSubmit={form.handleSubmit(onSubmit)}
              className="space-y-4"
              noValidate
            >
              {/* Carries the redirect target through the no-JS POST. */}
              <input
                type="hidden"
                name="callbackUrl"
                value={callbackUrl ?? ""}
              />

              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-[13px] font-medium text-zinc-700">
                      Email
                    </FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type="email"
                        inputMode="email"
                        autoComplete="username"
                        autoCapitalize="none"
                        spellCheck={false}
                        placeholder="owner@example.com"
                        disabled={isPending}
                        className="h-11 rounded-lg text-[15px]"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-[13px] font-medium text-zinc-700">
                      Password
                    </FormLabel>
                    <FormControl>
                      <div className="relative">
                        <Input
                          {...field}
                          type={showPassword ? "text" : "password"}
                          autoComplete="current-password"
                          placeholder="••••••••"
                          disabled={isPending}
                          className="h-11 rounded-lg pr-11 text-[15px]"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword((v) => !v)}
                          disabled={isPending}
                          aria-label={
                            showPassword ? "Hide password" : "Show password"
                          }
                          aria-pressed={showPassword}
                          className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-lg text-zinc-500 transition-colors hover:text-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                        >
                          {showPassword ? (
                            <EyeOff className="size-4" />
                          ) : (
                            <Eye className="size-4" />
                          )}
                        </button>
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {formError ? (
                <motion.p
                  initial={reduceMotion ? false : { opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.15 }}
                  role="alert"
                  className="flex items-start gap-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700"
                >
                  <AlertCircle className="mt-0.5 size-4 shrink-0" />
                  {formError}
                </motion.p>
              ) : null}

              <Button
                type="submit"
                disabled={isPending}
                className="h-11 w-full rounded-lg text-[15px] font-medium"
              >
                {isPending ? (
                  <>
                    <Loader2 className="mr-2 size-4 animate-spin" />
                    Signing in…
                  </>
                ) : (
                  "Sign in"
                )}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>
    </motion.div>
  );
}
