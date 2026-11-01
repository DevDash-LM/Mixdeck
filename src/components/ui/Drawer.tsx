import type { ReactNode } from "react";
import * as RD from "@radix-ui/react-dialog";
import { AnimatePresence, motion } from "motion/react";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";
import { IconButton } from "./IconButton";

export interface DrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  /** Extra controls in the header, left of the close button (e.g. prev/next). */
  headerActions?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  side?: "right" | "left";
  /** Width in px (default 420). */
  width?: number;
  /**
   * Non-modal keeps the board behind interactive (faders keep moving); default true.
   * Modal adds the `bg/60` scrim and traps focus.
   */
  modal?: boolean;
  className?: string;
}

const spring = { type: "spring", stiffness: 500, damping: 40 } as const;

/** Side drawer that slides over the content below the title bar. No backdrop blur. */
export function Drawer({
  open,
  onOpenChange,
  title,
  description,
  headerActions,
  children,
  footer,
  side = "right",
  width = 420,
  modal = false,
  className,
}: DrawerProps) {
  const offset = side === "right" ? "100%" : "-100%";
  return (
    <RD.Root open={open} onOpenChange={onOpenChange} modal={modal}>
      <AnimatePresence>
        {open ? (
          <RD.Portal forceMount>
            {modal ? (
              <RD.Overlay asChild forceMount>
                <motion.div
                  className="fixed inset-x-0 bottom-0 z-30 bg-bg/60"
                  style={{ top: "var(--titlebar-h)" }}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                />
              </RD.Overlay>
            ) : null}
            <RD.Content
              asChild
              forceMount
              onInteractOutside={modal ? undefined : (e) => e.preventDefault()}
            >
              <motion.aside
                className={cn(
                  "fixed bottom-0 z-30 flex flex-col bg-panel",
                  side === "right" ? "right-0 border-l border-line" : "left-0 border-r border-line",
                  className,
                )}
                style={{ top: "var(--titlebar-h)", width }}
                initial={{ x: offset }}
                animate={{ x: 0 }}
                exit={{ x: offset }}
                transition={spring}
              >
                <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-4">
                  <div className="flex min-w-0 flex-1 flex-col">
                    <RD.Title className="truncate text-14 font-medium text-text">{title}</RD.Title>
                    {description ? (
                      <RD.Description className="truncate text-12 text-text-dim">{description}</RD.Description>
                    ) : (
                      <RD.Description className="sr-only">{title}</RD.Description>
                    )}
                  </div>
                  {headerActions}
                  <RD.Close asChild>
                    <IconButton label="Close" size="sm" icon={<X size={16} strokeWidth={1.5} />} />
                  </RD.Close>
                </header>
                <div className="min-h-0 flex-1 overflow-auto p-4">{children}</div>
                {footer ? (
                  <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-line px-4 py-3">
                    {footer}
                  </footer>
                ) : null}
              </motion.aside>
            </RD.Content>
          </RD.Portal>
        ) : null}
      </AnimatePresence>
    </RD.Root>
  );
}
