import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * 44px MINIMUM (CHECKLIST #10). shadcn ships `h-9` = 36px; the Design System
 * requires 44 because this app is used one-handed on a phone. Raised here once
 * rather than at ~40 call sites that had not yet been patched individually.
 */

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-11 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }
