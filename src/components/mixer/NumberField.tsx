/**
 * Numeric readout that edits in place: drag left/right to scrub (Shift = fine), click to type,
 * arrow keys step, Enter edits, Escape cancels. Used for the dB readout under each fader.
 */
import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { cn } from "@/lib/cn";
import { clamp } from "@/lib/db";
import { parseNumber } from "./ValueEntry";

export interface NumberFieldProps {
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step: number;
  /** Shift step; also the rounding quantum (default step / 5). */
  fineStep?: number;
  /** Display text (default one decimal). */
  format?: (v: number) => string;
  /** Text placed in the input when editing starts (default `value.toFixed(1)`). */
  editText?: (v: number) => string;
  unit?: string;
  /** Accessible name. */
  label: string;
  disabled?: boolean;
  className?: string;
}

/** Pixels of horizontal drag per step. */
const PX_PER_STEP = 4;

export function NumberField({
  value,
  onChange,
  min,
  max,
  step,
  fineStep = step / 5,
  format = (v) => v.toFixed(1),
  editText = (v) => v.toFixed(1),
  unit,
  label,
  disabled,
  className,
}: NumberFieldProps) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const drag = useRef<{ id: number; x: number; acc: number; moved: boolean } | null>(null);

  const emit = (v: number) => {
    const q = clamp(Number((Math.round(v / fineStep) * fineStep).toFixed(6)), min, max);
    if (q !== value) onChange(q);
  };

  const startEdit = () => {
    if (disabled) return;
    setText(editText(value));
    setEditing(true);
  };

  const onPointerDown = (e: PointerEvent<HTMLButtonElement>) => {
    if (disabled || e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { id: e.pointerId, x: e.clientX, acc: value, moved: false };
  };
  const onPointerMove = (e: PointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x;
    if (!d.moved && Math.abs(dx) < 3) return;
    d.moved = true;
    d.x = e.clientX;
    d.acc = clamp(d.acc + (dx / PX_PER_STEP) * (e.shiftKey ? fineStep : step), min, max);
    emit(d.acc);
  };
  const onPointerUp = (e: PointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    if (!d.moved) startEdit();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    const s = e.shiftKey ? fineStep : step;
    if (e.key === "ArrowUp" || e.key === "ArrowRight") emit(value + s);
    else if (e.key === "ArrowDown" || e.key === "ArrowLeft") emit(value - s);
    else if (e.key === "Enter" || e.key === "F2") startEdit();
    else return;
    e.preventDefault();
  };

  const finish = (apply: boolean) => {
    if (apply) {
      const n = parseNumber(text, min);
      if (n !== null) emit(n);
    }
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        autoFocus
        aria-label={label}
        value={text}
        inputMode="decimal"
        spellCheck={false}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => setText(e.currentTarget.value)}
        onBlur={() => finish(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter") finish(true);
          else if (e.key === "Escape") finish(false);
        }}
        className={cn(
          "tabular h-[22px] w-full min-w-0 rounded-md border border-text-dim bg-panel-2 px-1 text-center text-12 text-text outline-none",
          className,
        )}
      />
    );
  }

  return (
    <button
      type="button"
      aria-label={`${label}: ${format(value)}${unit ? ` ${unit}` : ""}. Drag or press Enter to edit`}
      disabled={disabled}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => (drag.current = null)}
      onKeyDown={onKeyDown}
      className={cn(
        "tabular inline-flex h-[22px] min-w-0 cursor-ew-resize touch-none items-center justify-center gap-0.5 rounded-md border border-transparent px-0.5 text-12 text-text",
        "hover:border-line hover:bg-panel-2 disabled:pointer-events-none disabled:opacity-40",
        className,
      )}
    >
      <span className="truncate">{format(value)}</span>
      {unit ? <span className="text-11 text-text-faint">{unit}</span> : null}
    </button>
  );
}
