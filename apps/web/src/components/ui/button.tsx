import * as React from "react";
import { Slot } from "radix-ui";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils.js";

export const buttonVariants = cva(
  "relative inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-md border text-sm font-semibold transition-[transform,box-shadow,background-color,border-color] duration-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50 disabled:active:translate-y-0 aria-busy:opacity-100 lg:text-[0.8125rem] [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "border-primary bg-primary text-primary-foreground hover:shadow-[0_0_0_3px_color-mix(in_srgb,var(--foreground)_14%,transparent)] active:shadow-none",
        outline: "border-input bg-transparent text-foreground hover:border-foreground hover:bg-hover",
        ghost: "border-transparent bg-transparent text-foreground hover:bg-hover",
        destructive: "border-destructive bg-destructive text-destructive-foreground hover:shadow-[0_0_0_3px_color-mix(in_srgb,var(--bad)_20%,transparent)] active:shadow-none",
        link: "h-auto border-transparent bg-transparent px-1 text-foreground underline underline-offset-3 hover:text-ink-soft",
      },
      size: {
        default: "h-11 px-4 lg:h-8 lg:px-3",
        sm: "h-10 px-3 lg:h-7 lg:px-2.5",
        icon: "size-11 lg:size-8",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export type ButtonProps = React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean; loading?: boolean };

/** A button. While `loading` it shows a spinner, ignores clicks and tells screen readers it is busy. */
export function Button({ className, variant, size, asChild = false, loading = false, disabled, children, ...props }: ButtonProps) {
  const Comp = asChild ? Slot.Root : "button";
  return (
    <Comp
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {asChild ? (
        children
      ) : (
        <>
          {/* While loading the words stay where they are, see-through, so the button never changes size; the spinner sits over them. */}
          <span className={loading ? "inline-flex items-center gap-2 opacity-0" : "contents"}>{children}</span>
          {loading && (
            <span className="absolute inset-0 grid place-items-center">
              <Loader2 aria-hidden="true" data-spinner="" className="animate-spin" />
            </span>
          )}
        </>
      )}
    </Comp>
  );
}
