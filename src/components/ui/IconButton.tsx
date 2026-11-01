import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";
import { cn } from "@/lib/cn";
import { Tooltip } from "./Tooltip";

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  /** Accessible name; also the tooltip text unless `tooltip={false}`. Required. */
  label: string;
  icon: ReactNode;
  size?: "sm" | "md";
  /** Show `label` as a tooltip on hover/focus (default true). */
  tooltip?: boolean;
  /** Pressed/active appearance (inverted chip). Sets aria-pressed. */
  active?: boolean;
  ref?: Ref<HTMLButtonElement>;
}

export function IconButton({
  label,
  icon,
  size = "md",
  tooltip = true,
  active,
  className,
  type,
  ref,
  ...rest
}: IconButtonProps) {
  const button = (
    <button
      ref={ref}
      type={type ?? "button"}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-md border transition-colors duration-150 ease-out",
        "disabled:pointer-events-none disabled:opacity-40",
        size === "sm" ? "size-7" : "size-8",
        active
          ? "bg-fg text-fg-ink border-fg"
          : "bg-transparent text-text-dim border-transparent hover:bg-panel-2 hover:text-text",
        className,
      )}
      {...rest}
    >
      {icon}
    </button>
  );
  return tooltip ? <Tooltip content={label}>{button}</Tooltip> : button;
}
