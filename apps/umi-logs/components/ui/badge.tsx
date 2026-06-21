import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center justify-center rounded-none border px-1.5 py-px text-[10px] uppercase tracking-wider w-fit whitespace-nowrap shrink-0 [&>svg]:size-3 gap-1 [&>svg]:pointer-events-none transition-[color,border-color] overflow-hidden",
  {
    variants: {
      variant: {
        default:
          "border-primary/40 text-primary bg-primary/8 [a&]:hover:bg-primary/15",
        secondary:
          "border-border text-muted-foreground bg-transparent [a&]:hover:bg-secondary",
        destructive:
          "border-destructive/40 text-destructive bg-destructive/8 [a&]:hover:bg-destructive/15",
        outline:
          "border-border text-muted-foreground bg-transparent",
        ghost:
          "border-transparent text-muted-foreground [a&]:hover:bg-secondary",
        link:
          "border-transparent text-primary underline-offset-4 [a&]:hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span"

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
