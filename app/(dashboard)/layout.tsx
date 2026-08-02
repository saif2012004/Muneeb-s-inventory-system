import { redirect } from "next/navigation";

import { BottomNav } from "@/components/shared/BottomNav";
import { Sidebar } from "@/components/shared/Sidebar";
import { auth } from "@/lib/auth";
import { LOGIN_ROUTE } from "@/lib/routes";

// auth() reads the session via Prisma-free JWT decoding, but keep this on Node
// for consistency with every other authenticated server surface.
export const runtime = "nodejs";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Middleware already gates this, but a layout-level check is the backstop:
  // it also gives us the session, and it keeps the page safe if the matcher is
  // ever narrowed by mistake. v5 uses auth(), never getServerSession().
  const session = await auth();
  if (!session?.user) redirect(LOGIN_ROUTE);

  const ownerName = session.user.name ?? session.user.email ?? "Owner";

  return (
    <div className="min-h-dvh bg-zinc-50">
      <Sidebar ownerName={ownerName} />
      <BottomNav />

      {/* md:pl-60 clears the fixed sidebar; pb-24 clears the fixed bottom nav
          (plus the iOS home indicator) and is dropped once the sidebar shows. */}
      <div className="md:pl-60">
        <main className="mx-auto w-full max-w-[640px] px-4 pb-24 pt-6 md:px-8 md:pb-10 lg:max-w-[1100px]">
          {children}
        </main>
      </div>
    </div>
  );
}
