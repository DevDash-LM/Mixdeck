/**
 * Gain fader with an optional meter beside it on the same dB scale.
 * Relative drag (Shift = fine), wheel ±0.5 dB (Shift ±0.1), arrow keys,
 * PageUp/PageDown ±3 dB, double-click / Delete → 0 dB, Alt-click or Enter → type a value.
 * Never animated: the cap is positioned directly from `value`, and colours swap instantly.
 *
 * Opt-in (defaults keep the plain look):
 * - `orientation="horizontal"`: the rail runs left → right, ticks and the `meter` slot sit under it.
 *   Drag is horizontal; ←/→ and ↑/↓ both work; wheel, double-click and Alt-click are unchanged.
 * - `valueInCap`: a 38×24 (vertical) / 44×22 (horizontal) cap that shows the value. Its inset is
 *   `faderInset(...)`; give the slot's `<Meter>` the same `inset`.
 * - `detent`: sticky unity while dragging (default 0.4 dB, 0 = off).
 * - `dimmed`: 45 % opacity on the fader and scale (the meter slot has its own `dimmed`).
 * - `scaleSide="before"`: scale left of the fader, meter right against it.
 * - `hideScale`: no scale at all (compact bus rows); the unity notch on the rail stays.
 * Always on: when the set gain rounds above 0.0 dB the cap and the rail from the
 * 0 dB notch to the cap turn `boost`, the "0" tick turns `boost`, and the value text says "boosted".
 */
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { boostState, formatDb, formatSignedDb, GAIN_MAX, GAIN_MIN } from "@/lib/db";
import { faderInset, scaleFrac, scaleTicks, tickLabel, useElementSize, VALUE_CAP_H, VALUE_CAP_V } from "./scale";
import { useContinuous } from "./useContinuous";
import { ValueEntry } from "./ValueEntry";

export interface FaderProps {
  /** dB. */
  value: number;
  onChange: (db: number) => void;
  /** Accessible name, e.g. "Mic gain". */
  label: string;
  min?: number;
  max?: number;
  defaultValue?: number;
  disabled?: boolean;
  /** Show numeric tick labels (default true); ticks only when false. */
  scaleLabels?: boolean;
  /** Rendered right of the scale (vertical) or under it (horizontal), sharing its length and inset (usually a `<Meter>`). */
  meter?: ReactNode;
  /** Default "vertical". */
  orientation?: "vertical" | "horizontal";
  /** Show the value inside a larger cap (default false). */
  valueInCap?: boolean;
  /** Sticky 0 dB while dragging without Shift, in dB of travel (default 0.4; 0 = off). */
  detent?: number;
  /** Draw at 45 % opacity (muted strip). Still interactive. */
  dimmed?: boolean;
  /**
   * Vertical only: "after" (default) = [fader][scale][meter]; "before" = [scale][fader][meter],
   * so the meter sits right against the cap.
   */
  scaleSide?: "after" | "before";
  /** Leave out the scale (labels and ticks); the 0 dB notch on the rail still shows (default false). */
  hideScale?: boolean;
  className?: string;
}

export function Fader({
  value,
  onChange,
  label,
  min = GAIN_MIN,
  max = GAIN_MAX,
  defaultValue = 0,
  disabled,
  scaleLabels = true,
  meter,
  orientation = "vertical",
  valueInCap = false,
  detent = 0.4,
  dimmed = false,
  scaleSide = "after",
  hideScale = false,
  className,
}: FaderProps) {
  const horizontal = orientation === "horizontal";
  const inset = faderInset({ orientation, valueInCap });
  const [wellRef, size] = useElementSize<HTMLDivElement>();
  const length = horizontal ? size.width : size.height;
  const travel = Math.max(0, length - inset * 2);
  const c = useContinuous({
    value,
    min,
    max,
    defaultValue,
    step: 0.5,
    fineStep: 0.1,
    pageStep: 3,
    travel: () => travel,
    disabled,
    onChange,
    axis: horizontal ? "x" : "y",
    detent,
  });
  /** Position along the travel axis: px from the top (vertical) or the left (horizontal). */
  const pos = (db: number) => {
    const f = scaleFrac(db, min, max);
    return inset + (horizontal ? f : 1 - f) * travel;
  };
  const ticks = scaleTicks(travel);
  const boost = boostState(value);
  const hasUnity = min < 0 && max > 0;

  // Cap box: [along travel, across travel].
  const capAlong = valueInCap ? (horizontal ? VALUE_CAP_H.w : VALUE_CAP_V.h) : inset * 2;
  const capAcross = valueInCap ? (horizontal ? VALUE_CAP_H.h : VALUE_CAP_V.w) : 20;
  const railW = valueInCap ? 4 : 2;
  const p0 = pos(0);
  const pv = pos(value);

  const slider = (
    <ValueEntry
      open={c.entryOpen}
      onOpenChange={c.setEntryOpen}
      value={value}
      unit="dB"
      label={label}
      min={min}
      max={max}
      onCommit={c.commit}
    >
      <div
        ref={c.wheelRef}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={label}
        aria-orientation={orientation}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={Math.round(value * 10) / 10}
        aria-valuetext={`${formatDb(value, min)} dB${boost ? ", boosted" : ""}`}
        aria-disabled={disabled || undefined}
        {...c.bind}
        className={cn(
          "group relative shrink-0 touch-none rounded-sm outline-offset-0",
          c.dragging ? "cursor-grabbing" : "cursor-grab",
          disabled && "pointer-events-none opacity-40",
        )}
        style={horizontal ? { height: capAcross } : { width: capAcross }}
      >
        {/* rail */}
        <div
          aria-hidden
          className="absolute rounded-full bg-line-strong"
          style={
            horizontal
              ? { left: inset, right: inset, top: "50%", height: railW, transform: "translateY(-50%)" }
              : { top: inset, bottom: inset, left: "50%", width: railW, transform: "translateX(-50%)" }
          }
        />
        {/* boost fill: rail from the 0 dB notch to the cap */}
        {boost && hasUnity && (
          <div
            aria-hidden
            className="absolute rounded-full bg-boost"
            style={
              horizontal
                ? { left: p0, width: pv - p0, top: "50%", height: railW, transform: "translateY(-50%)" }
                : { top: pv, height: p0 - pv, left: "50%", width: railW, transform: "translateX(-50%)" }
            }
          />
        )}
        {/* unity notch */}
        {hasUnity && (
          <div
            aria-hidden
            className={cn("absolute", boost ? "bg-boost" : "bg-line-strong")}
            style={horizontal ? { left: p0, top: 2, bottom: 2, width: 1 } : { top: p0, left: 2, right: 2, height: 1 }}
          />
        )}
        {/* cap */}
        <div
          aria-hidden
          className={cn(
            "absolute top-0 left-0 flex items-center justify-center rounded-sm",
            boost ? "bg-boost text-boost-ink" : cn("bg-fg text-fg-ink group-hover:bg-text", c.dragging && "bg-text"),
          )}
          style={
            horizontal
              ? { width: capAlong, height: capAcross, transform: `translateX(${pv - capAlong / 2}px)` }
              : { width: capAcross, height: capAlong, transform: `translateY(${pv - capAlong / 2}px)` }
          }
        >
          {valueInCap ? (
            <span className="tabular text-11 leading-none font-medium tracking-tight">{formatSignedDb(value, min)}</span>
          ) : (
            <span className={cn(horizontal ? "h-3 w-px" : "h-px w-3", boost ? "bg-boost-ink" : "bg-fg-ink")} />
          )}
        </div>
      </div>
    </ValueEntry>
  );

  const tickClass = (t: number) => (t === 0 ? (boost ? "text-boost" : "text-text-dim") : "text-text-faint");
  const scale = hideScale ? null : horizontal ? (
    <div aria-hidden className={cn("relative shrink-0", scaleLabels ? "h-3.5" : "h-1.5")}>
      {ticks.map((t) => (
        <div key={t} className="absolute inset-y-0 flex justify-center" style={{ left: pos(t), transform: "translateX(-50%)" }}>
          {scaleLabels ? (
            <span className={cn("tabular text-11 leading-none", tickClass(t))}>{tickLabel(t)}</span>
          ) : (
            <span className={cn("h-full w-px", t === 0 ? (boost ? "bg-boost" : "bg-text-faint") : "bg-line-strong")} />
          )}
        </div>
      ))}
    </div>
  ) : (
    <div aria-hidden className={cn("relative shrink-0", scaleLabels ? "w-[22px]" : "w-1.5")}>
      {ticks.map((t) => (
        <div key={t} className="absolute inset-x-0 flex items-center" style={{ top: pos(t), transform: "translateY(-50%)" }}>
          {scaleLabels ? (
            <span className={cn("tabular w-full text-right text-11 leading-none", tickClass(t))}>{tickLabel(t)}</span>
          ) : (
            <span className={cn("h-px w-full", t === 0 ? (boost ? "bg-boost" : "bg-text-faint") : "bg-line-strong")} />
          )}
        </div>
      ))}
    </div>
  );

  return (
    <div
      ref={wellRef}
      className={cn(
        "relative flex min-h-0 min-w-0",
        horizontal ? "w-full flex-col gap-1" : "h-full items-stretch gap-1",
        className,
      )}
    >
      <div className={cn("contents", dimmed && "[&>*]:opacity-45")}>
        {scaleSide === "before" && !horizontal ? (
          <>
            {scale}
            {slider}
          </>
        ) : (
          <>
            {slider}
            {scale}
          </>
        )}
      </div>
      {meter}
    </div>
  );
}
