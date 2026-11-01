import type { ReactNode } from "react";
import * as RT from "@radix-ui/react-tooltip";

/** Mount once near the root (Shell does this). */
export function TooltipProvider({ children }: { children: ReactNode }) {
  return (
    <RT.Provider delayDuration={400} skipDelayDuration={200}>
      {children}
    </RT.Provider>
  );
}

export interface TooltipProps {
  content: ReactNode;
  /** A single focusable element. */
  children: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  /** Optional keyboard shortcut shown after the text. */
  shortcut?: string;
}

export function Tooltip({ content, children, side = "bottom", shortcut }: TooltipProps) {
  return (
    <RT.Root>
      <RT.Trigger asChild>{children}</RT.Trigger>
      <RT.Portal>
        <RT.Content
          side={side}
          sideOffset={6}
          collisionPadding={8}
          className="z-50 flex items-center gap-2 rounded-md bg-panel px-2 py-1 text-12 text-text shadow-overlay"
        >
          {content}
          {shortcut ? <span className="tabular text-11 text-text-faint">{shortcut}</span> : null}
        </RT.Content>
      </RT.Portal>
    </RT.Root>
  );
}
