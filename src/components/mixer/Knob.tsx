/**
 * Rotary knob for the strip-face quick controls (Comp / Gate / Denoiser, virtual EQGain1..3).
 * Same interaction model as Fader (vertical drag, wheel, arrows, double-click resets, Alt-click
 * or Enter types a value). The caption swaps to the value while hovered, focused or dragged.
 * Right-click calls `onContextMenu` (the Mixer uses it to open the detail panel).
 */
import { useState, type MouseEvent, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { useContinuous } from "./useContinuous";
import { ValueEntry } from "./ValueEntry";

export interface KnobProps {
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  defaultValue?: number;
  /** Caption under the knob ("Comp", "EQ 1"). A node is allowed (e.g. a responsive short/long pair). */
  caption: ReactNode;
  /** Accessible name (defaults to `caption` when it's a string; set it when `caption` is a node). */
  label?: string;
  /** Value text (default one decimal). */
  format?: (v: number) => string;
  unit?: string;
  /** Arc grows from the centre (for ±dB controls). */
  bipolar?: boolean;
  step?: number;
  fineStep?: number;
  disabled?: boolean;
  size?: number;
  onContextMenu?: (e: MouseEvent) => void;
  className?: string;
}

const START = -135;
const END = 135;

function polar(cx: number, cy: number, r: number, deg: number) {
  const a = ((deg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as const;
}

function arc(cx: number, cy: number, r: number, from: number, to: number) {
  if (Math.abs(to - from) < 0.01) return "";
  const [x0, y0] = polar(cx, cy, r, Math.min(from, to));
  const [x1, y1] = polar(cx, cy, r, Math.max(from, to));
  const large = Math.abs(to - from) > 180 ? 1 : 0;
  return `M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1}`;
}

export function Knob({
  value,
  onChange,
  min,
  max,
  defaultValue = bipolarDefault(min, max),
  caption,
  label,
  format = (v) => v.toFixed(1),
  unit,
  bipolar = false,
  step = (max - min) / 20,
  fineStep = (max - min) / 100,
  disabled,
  size = 28,
  onContextMenu,
  className,
}: KnobProps) {
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const c = useContinuous({ value, min, max, defaultValue, step, fineStep, travel: 160, disabled, onChange });

  const frac = Math.min(1, Math.max(0, (value - min) / (max - min)));
  const angle = START + frac * (END - START);
  const zeroAngle = bipolar ? START + ((0 - min) / (max - min)) * (END - START) : START;
  const cx = size / 2;
  const r = size / 2 - 2;
  const [px0, py0] = polar(cx, cx, r * 0.35, angle);
  const [px1, py1] = polar(cx, cx, r - 1.5, angle);
  const atDefault = Math.abs(value - defaultValue) < fineStep / 2;
  const showValue = hover || focus || c.dragging || c.entryOpen;
  const name = label ?? (typeof caption === "string" ? caption : "Value");

  return (
    <div className={cn("flex min-w-0 flex-col items-center gap-0.5", className)}>
      <ValueEntry
        open={c.entryOpen}
        onOpenChange={c.setEntryOpen}
        value={value}
        unit={unit}
        label={name}
        min={min}
        max={max}
        onCommit={c.commit}
        side="bottom"
      >
        <div
          ref={c.wheelRef}
          role="slider"
          tabIndex={disabled ? -1 : 0}
          aria-label={name}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={Math.round(value * 10) / 10}
          aria-valuetext={`${format(value)}${unit ? ` ${unit}` : ""}`}
          aria-disabled={disabled || undefined}
          {...c.bind}
          onContextMenu={(e) => {
            if (!onContextMenu) return;
            e.preventDefault();
            onContextMenu(e);
          }}
          onPointerEnter={() => setHover(true)}
          onPointerLeave={() => setHover(false)}
          onFocus={() => setFocus(true)}
          onBlur={() => setFocus(false)}
          className={cn(
            "touch-none rounded-full",
            c.dragging ? "cursor-grabbing" : "cursor-grab",
            disabled && "pointer-events-none opacity-40",
          )}
          style={{ width: size, height: size }}
        >
          <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
            <circle cx={cx} cy={cx} r={r - 3.5} fill="var(--panel-2)" stroke="var(--line)" />
            <path d={arc(cx, cx, r, START, END)} fill="none" stroke="var(--line-strong)" strokeWidth={2} strokeLinecap="round" />
            <path
              d={arc(cx, cx, r, zeroAngle, angle)}
              fill="none"
              stroke={atDefault ? "var(--text-faint)" : "var(--text)"}
              strokeWidth={2}
              strokeLinecap="round"
            />
            <line x1={px0} y1={py0} x2={px1} y2={py1} stroke="var(--fg)" strokeWidth={1.5} strokeLinecap="round" />
          </svg>
        </div>
      </ValueEntry>
      <span
        aria-hidden
        className={cn("text-11 leading-4 tracking-tight whitespace-nowrap", showValue ? "tabular text-text" : "text-text-dim")}
      >
        {showValue ? format(value) : caption}
      </span>
    </div>
  );
}

function bipolarDefault(min: number, max: number) {
  return min < 0 && max > 0 ? 0 : min;
}
