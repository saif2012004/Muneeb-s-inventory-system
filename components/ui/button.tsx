import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow hover:bg-primary/90",
        destructive:
          "bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90",
        outline:
          "border border-input bg-background shadow-sm hover:bg-accent hover:text-accent-foreground",
        secondary:
          "bg-secondary text-secondary-foreground shadow-sm hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      /**
       * 44px MINIMUM — the Design System's touch target (CHECKLIST #10).
       *
       * shadcn ships these at 36 / 32 / 40 / 36px, which is fine for a desktop
       * app and wrong for this one: the owner uses it one-handed on a cheap
       * Android phone, often with wet hands behind a counter. 151 call sites had
       * already been patched with `h-11` one at a time; the remaining ~84 had
       * not, so the same button was 44px on one screen and 36px on another.
       *
       * Raised HERE, once, rather than at each call site — which is what
       * CLAUDE.md's #10 asks for. The explicit `h-11` overrides are now
       * redundant but harmless (same value), so they can be removed lazily
       * rather than in one risky sweep.
       *
       * `sm` stays SMALLER than default but no longer below the minimum: it is
       * used inside dense rows, and 44px is the floor for anything a finger has
       * to hit.
       */
      size: {
        default: "h-11 px-4 py-2",
        sm: "h-11 rounded-md px-3 text-xs",
        lg: "h-12 rounded-md px-8",
        icon: "size-11",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
