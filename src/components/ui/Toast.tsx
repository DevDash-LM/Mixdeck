import type { ReactNode } from "react";
import { Toaster as Sonner, toast as sonnerToast } from "sonner";

/** Mount once (Shell does this). Bottom-right, stacked, themed to tokens. */
export function Toaster() {
  return (
    <Sonner
      position="bottom-right"
      theme="dark"
      gap={8}
      offset={16}
      visibleToasts={4}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast:
            "flex w-[356px] items-start gap-2.5 rounded-lg bg-panel px-3.5 py-3 text-13 text-text shadow-overlay",
          title: "font-medium text-text",
          description: "text-12 text-text-dim",
          icon: "mt-0.5 shrink-0",
          actionButton:
            "ml-auto h-7 shrink-0 rounded-md border border-fg bg-fg px-2.5 text-12 font-medium text-fg-ink",
          cancelButton:
            "h-7 shrink-0 rounded-md border border-line bg-panel-2 px-2.5 text-12 text-text",
          error: "[&_[data-icon]]:text-mute",
          success: "[&_[data-icon]]:text-text",
        },
      }}
    />
  );
}

export interface ToastOptions {
  /** Toasts with the same id replace each other. */
  id?: string | number;
  description?: ReactNode;
  action?: { label: string; onClick: () => void };
  duration?: number;
}

/** Toast API. Errors stay up longer. */
export const toast = {
  message: (title: ReactNode, o?: ToastOptions) => sonnerToast(title, o),
  success: (title: ReactNode, o?: ToastOptions) => sonnerToast.success(title, o),
  info: (title: ReactNode, o?: ToastOptions) => sonnerToast.info(title, o),
  error: (title: ReactNode, o?: ToastOptions) => sonnerToast.error(title, { duration: 8000, ...o }),
  dismiss: (id?: string | number) => sonnerToast.dismiss(id),
};

export function useToast() {
  return toast;
}
