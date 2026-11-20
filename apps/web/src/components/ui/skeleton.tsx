import * as React from "react";
import { cn } from "@/lib/utils.js";

/** A grey block that shimmers while something loads. The shimmer rests under reduced motion. */
export function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return <div aria-hidden="true" className={cn("skeleton h-3 rounded-sm", className)} {...props} />;
}
