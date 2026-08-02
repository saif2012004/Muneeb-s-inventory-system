import type { Metadata } from "next";

import { LoginForm } from "@/components/auth/login-form";

export const metadata: Metadata = {
  title: "Sign in",
};

// `callbackUrl` is read here on the server and handed to the form as a prop.
// Using useSearchParams inside the form instead would force a Suspense
// boundary, and the owner would see a skeleton flash before the fields appear.
export default function LoginPage({
  searchParams,
}: {
  searchParams: { callbackUrl?: string };
}) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-zinc-50 px-4 py-8">
      <LoginForm callbackUrl={searchParams.callbackUrl} />

      <p className="mt-6 text-center text-[13px] text-zinc-500">
        Business Manager
      </p>
    </main>
  );
}
