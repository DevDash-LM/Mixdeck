import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded-sm border border-line bg-panel-2 px-1",
        "tabular text-11 text-text-dim",
        className,
      )}
    >
      {children}
    </kbd>
  );
}
