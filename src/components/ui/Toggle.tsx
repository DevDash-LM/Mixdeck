import { useId, type ReactNode } from "react";
import * as RS from "@radix-ui/react-switch";
import { cn } from "@/lib/cn";

export interface ToggleProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  /** Visible label. If omitted, pass `aria-label`. */
  label?: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  "aria-label"?: string;
  className?: string;
}

/** On/off switch (Radix Switch). On = `fg` track, off = `panel-2` track. */
export function Toggle({
  checked,
  onCheckedChange,
  label,
  description,
  disabled,
  className,
  "aria-label": ariaLabel,
}: ToggleProps) {
  const id = useId();
  const descId = description ? `${id}-desc` : undefined;
  const control = (
    <RS.Root
      id={id}
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      aria-label={ariaLabel}
      aria-describedby={descId}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors duration-150 ease-out",
        "disabled:pointer-events-none disabled:opacity-40",
        checked ? "border-fg bg-fg" : "border-line bg-panel-2 hover:border-line-strong",
      )}
    >
      <RS.Thumb
        className={cn(
          "block size-3.5 rounded-full transition-transform duration-150 ease-out",
          checked ? "translate-x-[18px] bg-fg-ink" : "translate-x-[2px] bg-text-dim",
        )}
      />
    </RS.Root>
  );
  if (!label) return <span className={className}>{control}</span>;
  return (
    <div className={cn("flex items-start justify-between gap-6", className)}>
      <div className="flex min-w-0 flex-col">
        <label htmlFor={id} className="text-13 text-text">
          {label}
        </label>
        {description ? (
          <span id={descId} className="text-12 text-text-dim">
            {description}
          </span>
        ) : null}
      </div>
      <div className="pt-0.5">{control}</div>
    </div>
  );
}

/** Alias under the name "Switch". */
export const Switch = Toggle;
