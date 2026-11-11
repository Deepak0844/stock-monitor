import * as React from "react";
import { Tabs as T } from "radix-ui";
import { cn } from "@/lib/utils.js";

export const Tabs = T.Root;
export function TabsList({ className, ...props }: React.ComponentProps<typeof T.List>) {
  return <T.List className={cn("inline-flex rounded-lg bg-muted p-1", className)} {...props} />;
}
export function TabsTrigger({ className, ...props }: React.ComponentProps<typeof T.Trigger>) {
  return (
    <T.Trigger
      className={cn("min-h-9 rounded-md px-4 text-sm font-semibold text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring data-[state=active]:bg-primary data-[state=active]:text-primary-foreground", className)}
      {...props}
    />
  );
}
export const TabsContent = T.Content;
