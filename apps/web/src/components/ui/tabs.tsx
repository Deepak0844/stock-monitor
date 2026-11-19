import * as React from "react";
import { Tabs as T } from "radix-ui";
import { cn } from "@/lib/utils.js";

export const Tabs = T.Root;
export function TabsList({ className, ...props }: React.ComponentProps<typeof T.List>) {
  return <T.List className={cn("flex gap-6 border-b border-border", className)} {...props} />;
}
export function TabsTrigger({ className, ...props }: React.ComponentProps<typeof T.Trigger>) {
  return (
    <T.Trigger
      className={cn("-mb-px min-h-11 cursor-pointer border-b-2 border-transparent px-0.5 text-sm font-semibold text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring lg:min-h-9 data-[state=active]:border-foreground data-[state=active]:text-foreground", className)}
      {...props}
    />
  );
}
export const TabsContent = T.Content;
