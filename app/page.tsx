import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// Placeholder home page. Replaced by the dashboard in a later phase — it exists
// so the scaffold has something that exercises the design system tokens.
const MODULES = [
  { name: "Beverages", accent: "text-blue-600", amount: "Rs. 0" },
  { name: "Bakery", accent: "text-amber-600", amount: "Rs. 0" },
  { name: "Milk Shop", accent: "text-emerald-600", amount: "Rs. 0" },
] as const;

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-[640px] px-4 py-8">
      <h1 className="text-2xl font-semibold text-zinc-900">Business Manager</h1>
      <p className="mt-1 text-sm text-zinc-500">
        Scaffold ready. Modules arrive in the next phases.
      </p>

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        {MODULES.map((m) => (
          <Card key={m.name} className="rounded-xl shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-[13px] font-medium uppercase tracking-wide text-zinc-500">
                {m.name}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className={`num text-[28px] font-bold ${m.accent}`}>
                {m.amount}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
    </main>
  );
}
