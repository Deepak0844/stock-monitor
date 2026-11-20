import type { ReactElement, ReactNode } from "react";
import { Tooltip as T } from "radix-ui";

export const TooltipProvider = T.Provider;

/** Each tip carries its own provider, so it works on any page or in any test without setup.
 *
 * A short explanation that appears on hover and on keyboard focus. Only ever extra detail: anything the owner must know is
 * already on the page, and an icon-only control still needs its own aria-label. */
export function Tip({
  label,
  children,
  side = "top",
}: {
  label: ReactNode;
  children: ReactElement;
  side?: "top" | "bottom" | "left" | "right";
}) {
  return (
    <T.Provider delayDuration={400}>
      <T.Root>
        <T.Trigger asChild>{children}</T.Trigger>
        <T.Portal>
          <T.Content
            side={side}
            sideOffset={6}
            collisionPadding={8}
            className="z-[80] max-w-xs rounded-md bg-foreground px-2 py-1 text-xs font-medium text-background shadow-[0_10px_30px_-10px_rgba(0,0,0,0.35)] data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in-0"
          >
            {label}
            <T.Arrow className="fill-foreground" width={8} height={4} />
          </T.Content>
        </T.Portal>
      </T.Root>
    </T.Provider>
  );
}
