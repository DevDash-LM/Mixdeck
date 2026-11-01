import type { ReactNode } from "react";
import * as RS from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";

export interface SelectOption {
  value: string;
  label: ReactNode;
  disabled?: boolean;
}

export interface SelectGroup {
  label: string;
  options: SelectOption[];
}

export interface SelectProps {
  value: string | undefined;
  onValueChange: (value: string) => void;
  /** Flat options, or labelled groups (e.g. WDM / KS / MME / ASIO). */
  options: SelectOption[] | SelectGroup[];
  placeholder?: string;
  disabled?: boolean;
  size?: "sm" | "md";
  "aria-label"?: string;
  className?: string;
  /** Rendered when there are no options (inside the open menu). */
  emptyText?: string;
}

function isGrouped(o: SelectOption[] | SelectGroup[]): o is SelectGroup[] {
  return o.length > 0 && "options" in (o[0] as object);
}

function Item({ option }: { option: SelectOption }) {
  return (
    <RS.Item
      value={option.value}
      disabled={option.disabled}
      className={cn(
        "relative flex h-7 cursor-default items-center rounded-md pr-2 pl-7 text-13 text-text outline-none select-none",
        "data-[highlighted]:bg-panel-2 data-[disabled]:text-text-faint",
      )}
    >
      <RS.ItemIndicator className="absolute left-2 inline-flex">
        <Check size={14} strokeWidth={1.5} />
      </RS.ItemIndicator>
      <RS.ItemText>{option.label}</RS.ItemText>
    </RS.Item>
  );
}

export function Select({
  value,
  onValueChange,
  options,
  placeholder = "Select…",
  disabled,
  size = "md",
  className,
  emptyText = "Nothing to choose from",
  "aria-label": ariaLabel,
}: SelectProps) {
  const grouped = isGrouped(options);
  return (
    <RS.Root value={value} onValueChange={onValueChange} disabled={disabled}>
      <RS.Trigger
        aria-label={ariaLabel}
        className={cn(
          "inline-flex min-w-0 items-center justify-between gap-2 rounded-md border border-line bg-panel-2 px-2.5 text-text",
          "transition-colors duration-150 ease-out hover:border-line-strong disabled:opacity-40 disabled:pointer-events-none",
          "data-[placeholder]:text-text-faint",
          size === "sm" ? "h-7 text-12" : "h-8 text-13",
          className,
        )}
      >
        <span className="truncate">
          <RS.Value placeholder={placeholder} />
        </span>
        <RS.Icon className="shrink-0 text-text-faint">
          <ChevronDown size={14} strokeWidth={1.5} />
        </RS.Icon>
      </RS.Trigger>
      <RS.Portal>
        <RS.Content
          position="popper"
          sideOffset={4}
          collisionPadding={8}
          className="z-50 max-h-[var(--radix-select-content-available-height)] min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-lg bg-panel shadow-overlay"
        >
          <RS.Viewport className="p-1">
            {options.length === 0 ? (
              <div className="px-2 py-1.5 text-12 text-text-faint">{emptyText}</div>
            ) : grouped ? (
              (options as SelectGroup[]).map((g, i) => (
                <RS.Group key={g.label}>
                  {i > 0 ? <RS.Separator className="my-1 h-px bg-line" /> : null}
                  <RS.Label className="px-2 pt-1 pb-0.5 text-11 font-medium tracking-wide text-text-faint uppercase">
                    {g.label}
                  </RS.Label>
                  {g.options.map((o) => (
                    <Item key={o.value} option={o} />
                  ))}
                </RS.Group>
              ))
            ) : (
              (options as SelectOption[]).map((o) => <Item key={o.value} option={o} />)
            )}
          </RS.Viewport>
        </RS.Content>
      </RS.Portal>
    </RS.Root>
  );
}
