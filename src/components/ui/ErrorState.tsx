import { useState, type ReactNode } from "react";
import { CircleAlert, RotateCw } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "./Button";

export interface ErrorStateProps {
  title?: ReactNode;
  /** User-readable error message. */
  message?: ReactNode;
  /** Retry handler; may be async (the button shows a spinner while it runs). */
  retry?: () => void | Promise<void>;
  retryLabel?: string;
  /** Secondary way out (e.g. a QuickLink to Settings). */
  secondary?: ReactNode;
  className?: string;
}

export function ErrorState({
  title = "Something went wrong",
  message,
  retry,
  retryLabel = "Try again",
  secondary,
  className,
}: ErrorStateProps) {
  const [busy, setBusy] = useState(false);
  const run = async () => {
    if (!retry) return;
    setBusy(true);
    try {
      await retry();
    } finally {
      setBusy(false);
    }
  };
  return (
    <div
      role="alert"
      className={cn("flex flex-col items-center justify-center gap-3 px-6 py-10 text-center", className)}
    >
      <div className="flex size-12 items-center justify-center rounded-lg border border-line text-mute">
        <CircleAlert size={20} strokeWidth={1.5} />
      </div>
      <div className="flex max-w-sm flex-col gap-1">
        <h3 className="text-14 font-medium text-text">{title}</h3>
        {message ? <p className="text-13 text-text-dim">{message}</p> : null}
      </div>
      {retry || secondary ? (
        <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
          {retry ? (
            <Button onClick={run} loading={busy} icon={<RotateCw size={14} strokeWidth={1.5} />}>
              {retryLabel}
            </Button>
          ) : null}
          {secondary}
        </div>
      ) : null}
    </div>
  );
}
