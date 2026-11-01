/** Pieces shared by the input strips (`strip/*`) and the bus rows (`bus/*`). */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown, Ellipsis } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Tooltip,
} from "@/components/ui";
import { cn } from "@/lib/cn";
import type { DevicePicker } from "./extensions";

/** Strip / bus card frame. */
export function Card({ children, className, label }: { children: ReactNode; className?: string; label: string }) {
  return (
    <section
      aria-label={label}
      className={cn("flex h-full shrink-0 flex-col gap-1.5 rounded-lg border border-line bg-panel p-1", className)}
    >
      {children}
    </section>
  );
}

/**
 * Label with inline rename: double-click (or `editing` from the ⋯ menu) turns it into an input.
 * Enter or blur saves, Escape cancels. An empty name restores the default.
 */
export function EditableLabel({
  value,
  fallback,
  name,
  variant = "title",
  editing,
  onEditingChange,
  onCommit,
}: {
  /** The stored label ("" = default). */
  value: string;
  /** Shown when `value` is empty (may be ""). */
  fallback: string;
  /** What is being renamed, for the accessible name ("Hardware Input 1", "A1"). */
  name: string;
  /**
   * "title" = card header (12px medium); "header" = v2 strip header (14px medium); "row" = bus row
   * label (13px medium, 22px tall, max 96px); "sub" = a quieter second line (11px).
   */
  variant?: "title" | "header" | "row" | "sub";
  editing: boolean;
  onEditingChange: (editing: boolean) => void;
  onCommit: (label: string) => void;
}) {
  const [text, setText] = useState(value);
  const cancelled = useRef(false);
  useEffect(() => {
    if (editing) {
      setText(value);
      cancelled.current = false;
    }
  }, [editing, value]);

  if (editing) {
    return (
      <input
        autoFocus
        aria-label={`Rename ${name}`}
        value={text}
        placeholder={fallback || name}
        maxLength={64}
        spellCheck={false}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => setText(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          else if (e.key === "Escape") {
            cancelled.current = true;
            e.currentTarget.blur();
          }
        }}
        onBlur={() => {
          const next = text.trim();
          if (!cancelled.current && next !== value.trim()) onCommit(next);
          onEditingChange(false);
        }}
        className={cn(
          "w-full min-w-0 rounded-md border border-text-dim bg-panel-2 px-1 text-text outline-none placeholder:text-text-faint",
          variant === "title"
            ? "h-6 text-12"
            : variant === "header"
              ? "h-7 text-14"
              : variant === "row"
                ? "h-[22px] text-13"
                : "h-4 text-11 leading-none",
        )}
      />
    );
  }
  const shown = value.trim() || fallback;
  return (
    <button
      type="button"
      aria-label={`${shown || name}. Double-click to rename`}
      onDoubleClick={() => onEditingChange(true)}
      onKeyDown={(e) => {
        if (e.key === "F2" || e.key === "Enter") {
          e.preventDefault();
          onEditingChange(true);
        }
      }}
      title={`${shown || name} (double-click to rename)`}
      className={cn(
        "flex min-w-0 items-center rounded-md px-1 text-left hover:bg-panel-2",
        variant === "title"
          ? "h-6 flex-1 text-12 font-medium text-text"
          : variant === "header"
            ? "h-7 flex-1 px-1.5 text-14 font-medium text-text"
            : variant === "row"
              ? "h-[22px] max-w-24 shrink text-13 font-medium text-text"
              : "h-4 w-full shrink-0 text-11 leading-none text-text-dim",
      )}
    >
      <span className="truncate">{shown}</span>
    </button>
  );
}

export interface MenuItemDef {
  label: string;
  onSelect?: () => void;
  /** Shown disabled with "Coming soon" when there's no handler yet. */
  soon?: boolean;
  separatorBefore?: boolean;
}

/** The ⋯ menu in a card header. */
export function CardMenu({ label, items, size = "sm" }: { label: string; items: MenuItemDef[]; size?: "sm" | "md" }) {
  return (
    <DropdownMenu>
      <Tooltip content="More">
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={label}
            className={cn(
              "inline-flex shrink-0 items-center justify-center rounded-sm text-text-faint transition-colors duration-150 ease-out hover:bg-panel-2 hover:text-text data-[state=open]:bg-panel-2 data-[state=open]:text-text",
              size === "md" ? "h-7 w-6" : "h-6 w-4",
            )}
          >
            <Ellipsis size={14} strokeWidth={1.5} />
          </button>
        </DropdownMenuTrigger>
      </Tooltip>
      <DropdownMenuContent align="start" className="min-w-48">
        {items.map((it) => (
          <MenuEntry key={it.label} item={it} />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function MenuEntry({ item }: { item: MenuItemDef }) {
  const disabled = !item.onSelect;
  return (
    <>
      {item.separatorBefore ? <DropdownMenuSeparator /> : null}
      <DropdownMenuItem disabled={disabled} onSelect={item.onSelect} shortcut={disabled && item.soon ? "Coming soon" : undefined}>
        {item.label}
      </DropdownMenuItem>
    </>
  );
}

/**
 * Device chip (HW strips, A1–A5). Shows the current device. A registered picker
 * replaces it; until then it's informational with a "coming soon" tooltip.
 */
export function DeviceChip({
  index,
  current,
  Picker,
}: {
  index: number;
  current: string | null;
  Picker: DevicePicker | undefined;
}) {
  if (Picker) return <Picker index={index} current={current} />;
  const name = current?.trim() || "No device";
  return (
    <Tooltip
      content={
        <span className="flex max-w-64 flex-col gap-0.5">
          <span className="break-words">{name}</span>
          <span className="text-11 text-text-faint">Device selection is coming soon</span>
        </span>
      }
    >
      <button
        type="button"
        aria-disabled
        aria-label={`Device: ${name}. Device selection is coming soon`}
        className={cn(
          "flex h-[22px] w-full min-w-0 cursor-default items-center gap-1 rounded-md border border-line bg-panel-2 pr-1 pl-1.5 text-left text-11",
          current ? "text-text-dim" : "text-text-faint",
        )}
      >
        <span className="min-w-0 flex-1 truncate">{name}</span>
        <ChevronDown size={12} strokeWidth={1.5} className="shrink-0 text-text-faint" aria-hidden />
      </button>
    </Tooltip>
  );
}

