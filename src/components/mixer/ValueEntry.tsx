/**
 * Small "type a value" popover anchored to a control (Alt-click or Enter on a Fader/Knob).
 * Enter applies, Escape or clicking away cancels.
 */
import { useState, type ReactNode } from "react";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui";

export interface ValueEntryProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Current value, shown pre-selected. */
  value: number;
  /** Text for the field when it opens (default: value with `decimals`). */
  initialText?: string;
  decimals?: number;
  unit?: string;
  label: string;
  min: number;
  max: number;
  onCommit: (value: number) => void;
  /** The control the popover attaches to. */
  children: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
}

/** Accepts "-6", "−6", "+3.5", "6 dB", "-inf". Returns null when it isn't a number. */
export function parseNumber(text: string, min: number): number | null {
  const t = text.trim().replace(/−/g, "-").replace(/db$/i, "").trim();
  if (/^-?(inf|∞)$/i.test(t)) return min;
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export function ValueEntry({
  open,
  onOpenChange,
  value,
  initialText,
  decimals = 1,
  unit,
  label,
  min,
  max,
  onCommit,
  children,
  side = "right",
}: ValueEntryProps) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverAnchor asChild>{children}</PopoverAnchor>
      {open ? (
        <PopoverContent side={side} align="center" className="p-2">
          <EntryForm
            initial={initialText ?? value.toFixed(decimals)}
            unit={unit}
            label={label}
            min={min}
            max={max}
            onDone={(v) => {
              if (v !== null) onCommit(v);
              onOpenChange(false);
            }}
          />
        </PopoverContent>
      ) : null}
    </Popover>
  );
}

function EntryForm({
  initial,
  unit,
  label,
  min,
  max,
  onDone,
}: {
  initial: string;
  unit?: string;
  label: string;
  min: number;
  max: number;
  onDone: (v: number | null) => void;
}) {
  const [text, setText] = useState(initial);
  const parsed = parseNumber(text, min);
  const invalid = text.trim() !== "" && parsed === null;
  return (
    <form
      className="flex flex-col gap-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        if (parsed !== null) onDone(parsed);
      }}
    >
      <label className="text-11 text-text-dim" htmlFor="value-entry">
        {label}
      </label>
      <div className="flex items-center gap-1.5">
        <input
          id="value-entry"
          autoFocus
          onFocus={(e) => e.currentTarget.select()}
          value={text}
          onChange={(e) => setText(e.currentTarget.value)}
          inputMode="decimal"
          spellCheck={false}
          aria-invalid={invalid || undefined}
          className="tabular h-7 w-20 rounded-md border border-line-strong bg-panel-2 px-2 text-12 text-text outline-none focus:border-text-dim aria-invalid:border-mute"
        />
        {unit ? <span className="text-11 text-text-faint">{unit}</span> : null}
      </div>
      <span className="tabular text-11 text-text-faint">
        {min} to {max >= 0 ? `+${max}` : max} · Enter to apply
      </span>
    </form>
  );
}
