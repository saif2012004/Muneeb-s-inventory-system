import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

import { ACCENTS, type AccentKey } from "@/lib/nav";
import { cn } from "@/lib/utils";

/**
 * Design System: every list/table needs a designed empty state — a friendly
 * message plus the primary action, e.g. "No sales yet. Add your first sale."
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  accent = "zinc",
  action,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  accent?: AccentKey;
  action?: ReactNode;
  className?: string;
}) {
  const tone = ACCENTS[accent];

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-xl border border-dashed border-zinc-200 bg-white px-6 py-12 text-center",
        className
      )}
    >
      {Icon ? (
        <span
          className={cn(
            "mb-4 flex size-12 items-center justify-center rounded-xl",
            tone.icon
          )}
        >
          <Icon className="size-6" aria-hidden />
        </span>
      ) : null}

      <p className="text-[15px] font-medium text-zinc-900">{title}</p>
      {description ? (
        <p className="mt-1 max-w-[38ch] text-sm text-zinc-500">{description}</p>
      ) : null}

      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
