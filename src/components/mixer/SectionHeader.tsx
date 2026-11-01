/**
 * The one section header for the Mixer board: 28px tall, caps label,
 * optional count and a right-aligned action, with a 1px `line` underline. Hardware inputs,
 * Virtual inputs and Master all use it so they share top, height and rule.
 */
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface SectionHeaderProps {
  title: string;
  /** Shown after the title in mono ("5", "8 buses"). */
  count?: ReactNode;
  /** Right-aligned slot (a link, a chip, a status). */
  action?: ReactNode;
  className?: string;
}

export function SectionHeader({ title, count, action, className }: SectionHeaderProps) {
  return (
    <div className={cn("flex h-7 min-w-0 shrink-0 items-center gap-2 border-b border-line", className)}>
      <h2 className="truncate text-11 font-medium tracking-wider text-text-dim uppercase">{title}</h2>
      {count !== undefined && count !== null && (
        <span className="tabular shrink-0 text-11 text-text-faint">{count}</span>
      )}
      {action !== undefined && action !== null && <div className="ml-auto flex shrink-0 items-center gap-1">{action}</div>}
    </div>
  );
}
