import type { CSSProperties } from "react";
import { cn } from "@/lib/cn";

export interface SkeletonProps {
  className?: string;
  style?: CSSProperties;
}

/** Placeholder block: `panel-2` fill, opacity pulse only. Size it with className. */
export function Skeleton({ className, style }: SkeletonProps) {
  return (
    <div
      aria-hidden
      className={cn("rounded-md bg-panel-2", className)}
      style={{ animation: "skeleton-pulse 1.6s ease-in-out infinite", ...style }}
    />
  );
}
