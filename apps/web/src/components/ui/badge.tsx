import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils.js";

/** A status: a small dot and its words. The words always carry the meaning; the dot only repeats it in colour. */
const badgeVariants = cva("inline-flex items-center gap-1.5 whitespace-nowrap text-sm lg:text-[0.8125rem]", {
  variants: {
    variant: {
      success: "font-medium text-foreground [&>[data-dot]]:bg-good",
      warning: "font-semibold text-bad [&>[data-dot]]:bg-bad",
      danger: "font-semibold text-bad [&>[data-dot]]:bg-bad",
      neutral: "font-medium text-muted-foreground [&>[data-dot]]:bg-neutral",
      accent: "font-semibold text-bad [&>[data-dot]]:bg-bad",
    },
  },
  defaultVariants: { variant: "neutral" },
});

const TONE = { success: "good", warning: "bad", danger: "bad", neutral: "neutral", accent: "bad" } as const;

export function Badge({ className, variant, children, ...props }: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return (
    <span data-tone={TONE[variant ?? "neutral"]} className={cn(badgeVariants({ variant }), className)} {...props}>
      <span aria-hidden="true" data-dot="" className="size-[7px] shrink-0 rounded-full" />
      {children}
    </span>
  );
}
