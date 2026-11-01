import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

/** Single-line text field styled to the design tokens (preset names). */
export const TextInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(
  function TextInput({ className, invalid, ...props }, ref) {
    return (
      <input
        ref={ref}
        spellCheck={false}
        aria-invalid={invalid || undefined}
        className={cn(
          "h-8 w-full min-w-0 rounded-md border bg-panel-2 px-2.5 text-13 text-text outline-none",
          "placeholder:text-text-faint focus-visible:border-text-dim",
          invalid ? "border-mute" : "border-line hover:border-line-strong",
          className,
        )}
        {...props}
      />
    );
  },
);
