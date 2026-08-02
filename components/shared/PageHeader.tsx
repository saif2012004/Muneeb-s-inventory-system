import type { ReactNode } from "react";

import { ACCENTS, type AccentKey } from "@/lib/nav";
import { cn } from "@/lib/utils";

/**
 * Design System: page title 24/semibold, secondary text zinc-500.
 * `accent` tints only the title, so a module page still reads as one accent.
 */
export function PageHeader({
  title,
  description,
  accent = "zinc",
  action,
  className,
}: {
  title: string;
  description?: string;
  accent?: AccentKey;
  /** Primary action, e.g. an "Add sale" button. Wraps below the title on phones. */
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-start justify-between gap-3 pb-6",
        className
      )}
    >
      <div className="min-w-0">
        <h1
          className={cn(
            "truncate text-2xl font-semibold",
            accent === "zinc" ? "text-zinc-900" : ACCENTS[accent].text
          )}
        >
          {title}
        </h1>
        {description ? (
          <p className="mt-1 text-sm text-zinc-500">{description}</p>
        ) : null}
      </div>

      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
