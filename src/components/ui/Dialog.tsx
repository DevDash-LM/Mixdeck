import type { ReactNode } from "react";
import * as RD from "@radix-ui/react-dialog";
import { AnimatePresence, motion } from "motion/react";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";
import { IconButton } from "./IconButton";

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  /** Right-aligned action row (buttons). */
  footer?: ReactNode;
  /** Max width in px (default 440). */
  width?: number;
  /** Hide the corner close button (Esc and the scrim still close). */
  hideClose?: boolean;
  className?: string;
}

const fade = { duration: 0.15, ease: [0.16, 1, 0.3, 1] as const };

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  width = 440,
  hideClose = false,
  className,
}: DialogProps) {
  return (
    <RD.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open ? (
          <RD.Portal forceMount>
            <RD.Overlay asChild forceMount>
              <motion.div
                className="fixed inset-0 z-40 bg-bg/60"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={fade}
              />
            </RD.Overlay>
            <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center p-6">
              <RD.Content asChild forceMount>
                <motion.div
                  className={cn(
                    "pointer-events-auto flex max-h-full w-full flex-col rounded-lg bg-panel shadow-overlay",
                    className,
                  )}
                  style={{ maxWidth: width }}
                  initial={{ opacity: 0, scale: 0.98 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.98 }}
                  transition={fade}
                >
                  <div className="flex items-start justify-between gap-4 px-5 pt-4 pb-2">
                    <div className="flex min-w-0 flex-col gap-1">
                      <RD.Title className="text-14 font-medium text-text">{title}</RD.Title>
                      {description ? (
                        <RD.Description className="text-13 text-text-dim">{description}</RD.Description>
                      ) : (
                        <RD.Description className="sr-only">{title}</RD.Description>
                      )}
                    </div>
                    {hideClose ? null : (
                      <RD.Close asChild>
                        <IconButton label="Close" size="sm" tooltip={false} icon={<X size={16} strokeWidth={1.5} />} />
                      </RD.Close>
                    )}
                  </div>
                  {children ? <div className="min-h-0 overflow-auto px-5 py-2">{children}</div> : null}
                  {footer ? (
                    <div className="flex items-center justify-end gap-2 px-5 pt-2 pb-4">{footer}</div>
                  ) : (
                    <div className="h-3" />
                  )}
                </motion.div>
              </RD.Content>
            </div>
          </RD.Portal>
        ) : null}
      </AnimatePresence>
    </RD.Root>
  );
}
