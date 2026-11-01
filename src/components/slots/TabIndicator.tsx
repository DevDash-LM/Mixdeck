/**
 * Slot: active marker under the title-bar view tabs.
 * Props: { layoutId: string }. Rendered inside the active tab (position: relative).
 * Default: a 1px `fg` underline that springs between tabs via motion `layoutId`.
 */
import { motion } from "motion/react";

export interface TabIndicatorProps {
  layoutId: string;
}

export default function TabIndicator({ layoutId }: TabIndicatorProps) {
  return (
    <motion.span
      layoutId={layoutId}
      aria-hidden
      className="pointer-events-none absolute inset-x-2 -bottom-px h-px bg-fg"
      transition={{ type: "spring", stiffness: 500, damping: 40 }}
    />
  );
}
