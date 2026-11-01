import type { ComponentProps } from "react";
import * as RP from "@radix-ui/react-popover";
import { cn } from "@/lib/cn";

export const Popover = RP.Root;
export const PopoverTrigger = RP.Trigger;
export const PopoverAnchor = RP.Anchor;
export const PopoverClose = RP.Close;

export function PopoverContent({ className, sideOffset = 6, ...props }: ComponentProps<typeof RP.Content>) {
  return (
    <RP.Portal>
      <RP.Content
        sideOffset={sideOffset}
        collisionPadding={8}
        className={cn("z-50 rounded-lg bg-panel p-3 text-13 text-text shadow-overlay outline-none", className)}
        {...props}
      />
    </RP.Portal>
  );
}
