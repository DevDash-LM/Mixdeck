import type { ComponentProps } from "react";
import * as RT from "@radix-ui/react-tabs";
import { cn } from "@/lib/cn";

/**
 * In-view tabs (e.g. Strip FX: EQ / Comp / Gate). shadcn-style composition over Radix Tabs.
 * The title-bar view tabs are separate (app/TitleBar.tsx + slots/TabIndicator).
 */
export const Tabs = RT.Root;

export function TabsList({ className, ...props }: ComponentProps<typeof RT.List>) {
  return (
    <RT.List
      className={cn("inline-flex h-8 items-center gap-0.5 rounded-md border border-line bg-panel-2 p-0.5", className)}
      {...props}
    />
  );
}

export function TabsTrigger({ className, ...props }: ComponentProps<typeof RT.Trigger>) {
  return (
    <RT.Trigger
      className={cn(
        "inline-flex h-full items-center justify-center rounded-sm px-2.5 text-12 font-medium text-text-dim",
        "transition-colors duration-150 ease-out hover:text-text disabled:opacity-40",
        "data-[state=active]:bg-fg data-[state=active]:text-fg-ink",
        className,
      )}
      {...props}
    />
  );
}

export function TabsContent({ className, ...props }: ComponentProps<typeof RT.Content>) {
  return <RT.Content className={cn("mt-3 outline-none", className)} {...props} />;
}
