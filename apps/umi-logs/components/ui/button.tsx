import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-none text-xs transition-all disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[2px] aria-invalid:ring-destructive/20 aria-invalid:border-destructive",
  {
    variants: {
      variant: {
        default:
          "border border-primary/60 bg-primary/10 text-primary hover:bg-primary/20 hover:border-primary",
        destructive:
          "border border-destructive/60 bg-destructive/10 text-destructive hover:bg-destructive/20 hover:border-destructive",
        outline:
          "border border-border bg-transparent text-foreground/70 hover:bg-secondary hover:text-foreground",
        secondary:
          "border border-border bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost:
          "border border-transparent text-foreground/60 hover:bg-secondary hover:text-foreground",
        link:
          "border-transparent text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-7 px-3 py-1 has-[>svg]:px-2.5",
        xs:      "h-5 gap-1 px-1.5 text-[10px] has-[>svg]:px-1 [&_svg:not([class*='size-'])]:size-3",
        sm:      "h-6 gap-1 px-2.5 has-[>svg]:px-2",
        lg:      "h-8 px-5 has-[>svg]:px-4",
        icon:    "size-7",
        "icon-xs": "size-5 [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-6",
        "icon-lg": "size-8",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
