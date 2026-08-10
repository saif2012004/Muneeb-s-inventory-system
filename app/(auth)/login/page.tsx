import type { Metadata } from "next";

import { LoginForm } from "@/components/auth/login-form";

export const metadata: Metadata = {
  title: "Sign in",
};

/**
 * `?error=` is set by two callers: Auth.js (this route is its `pages.error`)
 * and the no-JS POST route, which has no other way to report a failure to a
 * browser with no client bundle. The code is mapped to a fixed string here —
 * never rendered — so a crafted `?error=<anything>` cannot put attacker text
 * on the page, and so the no-JS message matches what the JS path shows.
 */
function errorMessage(code: string | undefined): string | undefined {
  if (!code) return undefined;
  if (code === "CredentialsSignin") return "Incorrect email or password.";
  return "Something went wrong signing you in. Please try again.";
}

// `callbackUrl` is read here on the server and handed to the form as a prop.
// Using useSearchParams inside the form instead would force a Suspense
// boundary, and the owner would see a skeleton flash before the fields appear.
export default function LoginPage({
  searchParams,
}: {
  searchParams: { callbackUrl?: string; error?: string };
}) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-zinc-50 px-4 py-8">
      <LoginForm
        callbackUrl={searchParams.callbackUrl}
        initialError={errorMessage(searchParams.error)}
      />

      <p className="mt-6 text-center text-[13px] text-zinc-500">
        Business Manager
      </p>
    </main>
  );
}
