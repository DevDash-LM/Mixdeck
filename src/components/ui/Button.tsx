import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";
import { Slot } from "@radix-ui/react-slot";
import { cn } from "@/lib/cn";
import { Spinner } from "./Spinner";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a spinner and disables the button. */
  loading?: boolean;
  /** Leading icon (16px lucide icon). */
  icon?: ReactNode;
  /** Render the child element instead of a <button> (Radix Slot). */
  asChild?: boolean;
  ref?: Ref<HTMLButtonElement>;
}

const base =
  "inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border font-medium " +
  "transition-colors duration-150 ease-out disabled:pointer-events-none disabled:opacity-40 select-none";

const variants: Record<ButtonVariant, string> = {
  primary: "bg-fg text-fg-ink border-fg hover:bg-text hover:border-text",
  secondary: "bg-panel-2 text-text border-line hover:border-line-strong hover:bg-line",
  ghost: "bg-transparent text-text-dim border-transparent hover:bg-panel-2 hover:text-text",
  danger: "bg-mute text-fg border-mute hover:opacity-90",
};

const sizes: Record<ButtonSize, string> = {
  sm: "h-7 px-2.5 text-12",
  md: "h-8 px-3 text-13",
};

export function buttonClasses(variant: ButtonVariant = "secondary", size: ButtonSize = "md"): string {
  return cn(base, variants[variant], sizes[size]);
}

export function Button({
  variant = "secondary",
  size = "md",
  loading = false,
  icon,
  asChild = false,
  className,
  disabled,
  children,
  type,
  ref,
  ...rest
}: ButtonProps) {
  const classes = cn(buttonClasses(variant, size), className);
  if (asChild) {
    return (
      <Slot ref={ref} className={classes} {...rest}>
        {children}
      </Slot>
    );
  }
  return (
    <button
      ref={ref}
      type={type ?? "button"}
      className={classes}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Spinner size={14} /> : icon}
      {children}
    </button>
  );
}
