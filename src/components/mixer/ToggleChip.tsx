/**
 * Small on/off chip for strip and bus buttons (routes, Mute, Solo, Mono, MC, Sel, EQ).
 * "on" is an inverted chip (`fg` fill, `fg-ink` text); off is `panel-2` with a
 * `line` border. Mute and Solo are the only coloured fills.
 */
import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";
import { cn } from "@/lib/cn";
import { Tooltip } from "@/components/ui";

export type ToggleChipTone = "fg" | "mute" | "solo";
export type ToggleChipSize = "xs" | "sm" | "md" | "lg";

const sizeClass: Record<ToggleChipSize, string> = {
  xs: "h-5 px-1 text-11",
  sm: "h-[22px] px-1 text-11",
  md: "h-[var(--ctl-md)] px-1.5 text-12",
  lg: "h-[var(--ctl-lg)] px-2 text-12",
};

export interface ToggleChipProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onClick" | "children"> {
  pressed: boolean;
  /** Called with the next state. Use `onClick` instead for multi-state chips. */
  onPressedChange?: (pressed: boolean) => void;
  onClick?: ButtonHTMLAttributes<HTMLButtonElement>["onClick"];
  tone?: ToggleChipTone;
  children: ReactNode;
  /** Accessible name when the visible text is abbreviated. */
  label?: string;
  /** Optional hover tooltip. */
  tooltip?: ReactNode;
  /** Height: xs = 20px (route grid), sm = 22px, md = 28px (`--ctl-md`), lg = 32px (`--ctl-lg`). md/lg use 12px text. */
  size?: ToggleChipSize;
  /** Render with aria-pressed="mixed" (e.g. Mono = stereo reverse). */
  mixed?: boolean;
  ref?: Ref<HTMLButtonElement>;
}

const onTone: Record<ToggleChipTone, string> = {
  fg: "bg-fg text-fg-ink border-fg",
  mute: "bg-mute text-fg border-mute",
  solo: "bg-solo text-fg-ink border-solo",
};

export function ToggleChip({
  pressed,
  onPressedChange,
  onClick,
  tone = "fg",
  children,
  label,
  tooltip,
  size = "sm",
  mixed,
  className,
  disabled,
  ref,
  ...rest
}: ToggleChipProps) {
  const chip = (
    <button
      ref={ref}
      type="button"
      aria-pressed={mixed ? "mixed" : pressed}
      aria-label={label}
      disabled={disabled}
      onClick={(e) => {
        onClick?.(e);
        if (!e.defaultPrevented) onPressedChange?.(!pressed);
      }}
      className={cn(
        "inline-flex min-w-0 items-center justify-center gap-1 rounded-md border font-medium whitespace-nowrap",
        "transition-colors duration-120 ease-out disabled:pointer-events-none disabled:opacity-40",
        sizeClass[size],
        pressed ? onTone[tone] : "border-line bg-panel-2 text-text-dim hover:border-line-strong hover:text-text",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
  return tooltip ? <Tooltip content={tooltip}>{chip}</Tooltip> : chip;
}
