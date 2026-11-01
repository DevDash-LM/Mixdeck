import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface EmptyStateProps {
  /** Usually a slot `<EmptyIllustration variant=…/>` or a lucide icon. */
  illustration?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  /** The next action(s). Every empty state should offer one (no dead ends). */
  actions?: ReactNode;
  className?: string;
}

export function EmptyState({ illustration, title, description, actions, className }: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-3 px-6 py-10 text-center", className)}>
      {illustration}
      <div className="flex max-w-sm flex-col gap-1">
        <h3 className="text-14 font-medium text-text">{title}</h3>
        {description ? <p className="text-13 text-text-dim">{description}</p> : null}
      </div>
      {actions ? <div className="mt-1 flex flex-wrap items-center justify-center gap-2">{actions}</div> : null}
    </div>
  );
}
