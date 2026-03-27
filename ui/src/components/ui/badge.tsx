import { cn } from "@/lib/utils";
import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        destructive: "border-transparent bg-destructive text-destructive-foreground",
        outline: "text-foreground",
        dream: "border-purple-500/30 bg-purple-500/10 text-purple-300",
        quest: "border-amber-500/30 bg-amber-500/10 text-amber-300",
        belief: "border-blue-500/30 bg-blue-500/10 text-blue-300",
        episode: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
        loop: "border-rose-500/30 bg-rose-500/10 text-rose-300",
        active: "border-green-500/30 bg-green-500/10 text-green-300",
        disputed: "border-yellow-500/30 bg-yellow-500/10 text-yellow-300",
        stale: "border-gray-500/30 bg-gray-500/10 text-gray-300",
        retired: "border-red-500/30 bg-red-500/10 text-red-400",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

export interface BadgeProps extends HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
