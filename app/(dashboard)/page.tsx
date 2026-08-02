import { GlassWater, Milk, ShoppingBag } from "lucide-react";

import { PageHeader } from "@/components/shared/PageHeader";
import { StatCard } from "@/components/shared/StatCard";
import { formatDate } from "@/lib/format";

export default function DashboardPage() {
  // Placeholder figures. Real aggregates arrive in Phase 7 (reports/charts).
  const today = formatDate(new Date());

  return (
    <>
      <PageHeader title="Dashboard" description={`Today · ${today}`} />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          label="Beverages"
          value={0}
          icon={<GlassWater />}
          accent="blue"
          format="money"
        />
        <StatCard
          label="Bakery"
          value={0}
          icon={<ShoppingBag />}
          accent="amber"
          format="money"
        />
        <StatCard
          label="Milk Shop"
          value={0}
          icon={<Milk />}
          accent="emerald"
          format="money"
        />
      </div>
    </>
  );
}
