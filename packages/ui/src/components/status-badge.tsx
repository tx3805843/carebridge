import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/cn";

const statusBadgeVariants = cva(
  "inline-flex w-fit items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium",
  {
    variants: {
      variant: {
        critical: "border-critical/20 bg-critical/10 text-critical",
        warning: "border-warning/20 bg-warning/10 text-warning",
        success: "border-success/20 bg-success/10 text-success",
        information: "border-information/20 bg-information/10 text-information",
        neutral: "border-border bg-muted text-muted-foreground",
      },
    },
    defaultVariants: {
      variant: "neutral",
    },
  },
);

export interface StatusBadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof statusBadgeVariants> {
  // The label is the primary carrier of meaning — per the UX review's "never use color alone"
  // rule, the dot is decorative (aria-hidden) and this text is always required, never omitted.
  label: string;
}

export const StatusBadge = React.forwardRef<HTMLSpanElement, StatusBadgeProps>(
  ({ className, variant, label, ...props }, ref) => (
    <span ref={ref} className={cn(statusBadgeVariants({ variant }), className)} {...props}>
      <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" />
      {label}
    </span>
  ),
);
StatusBadge.displayName = "StatusBadge";
