/**
 * Shared interaction model for continuous controls (Fader, Knob):
 * drag (relative, never jumps), mouse wheel (±step, Shift = ±fineStep), arrow keys,
 * double-click resets, Alt-click opens a value entry. Emits quantised values only when they
 * change; the caller writes them (the mixer store throttles and suppresses echoes).
 */
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { clamp } from "@/lib/db";

export interface ContinuousOptions {
  value: number;
  min: number;
  max: number;
  /** Double-click / Delete resets to this. */
  defaultValue: number;
  /** Arrow-key and wheel-notch step. */
  step: number;
  /** Step with Shift held (also the rounding quantum). */
  fineStep: number;
  /** PageUp / PageDown step (default 6 × step). */
  pageStep?: number;
  /** Pointer travel in px for the whole range (a function is read at drag start). */
  travel: number | (() => number);
  disabled?: boolean;
  onChange: (value: number) => void;
  /** Drag axis: "y" (default; up = more) or "x" (right = more). Keys and wheel are the same either way. */
  axis?: "x" | "y";
  /**
   * Unity detent: while dragging without Shift, the value sticks at 0 for this
   * much travel (in value units) once it reaches or crosses 0. 0/undefined = off. Only applies when
   * min < 0 < max.
   */
  detent?: number;
}

export interface Continuous {
  dragging: boolean;
  entryOpen: boolean;
  setEntryOpen: (open: boolean) => void;
  /** Spread on the focusable control element. */
  bind: {
    onPointerDown: (e: PointerEvent<HTMLElement>) => void;
    onPointerMove: (e: PointerEvent<HTMLElement>) => void;
    onPointerUp: (e: PointerEvent<HTMLElement>) => void;
    onPointerCancel: (e: PointerEvent<HTMLElement>) => void;
    onDoubleClick: () => void;
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => void;
  };
  /** Attach to the element that should take the wheel (non-passive listener). */
  wheelRef: (el: HTMLElement | null) => void;
  /** Clamp + quantise + emit (used by the value entry). */
  commit: (value: number) => void;
}

/** Shift slows dragging down by this factor. */
const FINE_DRAG = 0.2;
/** deltaY of one mouse-wheel notch in Chromium/WebView2. */
const WHEEL_NOTCH = 100;

/**
 * One drag step with a sticky 0: reaching or crossing 0 parks the value there, and the travel
 * past it accumulates in `stick` until it exceeds `detent`; the excess then carries on.
 */
function applyDetent(d: { acc: number; stick: number }, dv: number, detent: number): number {
  let stick: number;
  if (d.acc === 0) {
    stick = d.stick + dv;
  } else {
    const next = d.acc + dv;
    if (next !== 0 && Math.sign(next) === Math.sign(d.acc)) return next;
    stick = next; // landed on or crossed unity: the overshoot counts toward breaking free
  }
  if (Math.abs(stick) <= detent) {
    d.stick = stick;
    return 0;
  }
  d.stick = 0;
  return stick - Math.sign(stick) * detent;
}

export function useContinuous(opts: ContinuousOptions): Continuous {
  const o = useRef(opts);
  o.current = opts;

  const [dragging, setDragging] = useState(false);
  const [entryOpen, setEntryOpen] = useState(false);
  const drag = useRef<{ id: number; last: number; acc: number; stick: number; travel: number; moved: boolean } | null>(null);
  const lastEmitted = useRef<number | null>(null);
  const wheelAcc = useRef(0);

  const quantise = useCallback((v: number) => {
    const { min, max, fineStep } = o.current;
    const q = Math.round(v / fineStep) * fineStep;
    // Trim float noise (0.30000000000000004 → 0.3).
    return clamp(Number(q.toFixed(6)), min, max);
  }, []);

  const emit = useCallback(
    (raw: number) => {
      const v = quantise(raw);
      if (v === lastEmitted.current && v === o.current.value) return;
      lastEmitted.current = v;
      if (v !== o.current.value) o.current.onChange(v);
    },
    [quantise],
  );

  const nudge = useCallback(
    (steps: number, fine: boolean) => {
      const { value, step, fineStep } = o.current;
      emit(value + steps * (fine ? fineStep : step));
    },
    [emit],
  );

  const onPointerDown = (e: PointerEvent<HTMLElement>) => {
    if (o.current.disabled || e.button !== 0) return;
    if (e.altKey) {
      e.preventDefault();
      setEntryOpen(true);
      return;
    }
    e.currentTarget.focus({ preventScroll: true });
    e.currentTarget.setPointerCapture(e.pointerId);
    const t = o.current.travel;
    drag.current = {
      id: e.pointerId,
      last: o.current.axis === "x" ? e.clientX : e.clientY,
      acc: o.current.value,
      stick: 0,
      travel: Math.max(24, typeof t === "function" ? t() : t),
      moved: false,
    };
    lastEmitted.current = o.current.value;
    setDragging(true);
  };

  const onPointerMove = (e: PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const x = o.current.axis === "x";
    const pos = x ? e.clientX : e.clientY;
    const dp = x ? pos - d.last : d.last - pos; // up / right = increase
    d.last = pos;
    if (dp === 0) return;
    d.moved = true;
    const { min, max, detent = 0 } = o.current;
    const dv = (dp / d.travel) * (max - min) * (e.shiftKey ? FINE_DRAG : 1);
    if (detent > 0 && !e.shiftKey && min < 0 && max > 0) {
      d.acc = applyDetent(d, dv, detent);
    } else {
      d.acc += dv;
    }
    d.acc = clamp(d.acc, min, max);
    emit(d.acc);
  };

  const end = (e: PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    setDragging(false);
  };

  const onDoubleClick = () => {
    if (o.current.disabled) return;
    emit(o.current.defaultValue);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (o.current.disabled) return;
    const fine = e.shiftKey;
    const page = o.current.pageStep ?? o.current.step * 6;
    switch (e.key) {
      case "ArrowUp":
      case "ArrowRight":
        nudge(1, fine);
        break;
      case "ArrowDown":
      case "ArrowLeft":
        nudge(-1, fine);
        break;
      case "PageUp":
        emit(o.current.value + page);
        break;
      case "PageDown":
        emit(o.current.value - page);
        break;
      case "Delete":
      case "Backspace":
        emit(o.current.defaultValue);
        break;
      case "Enter":
        setEntryOpen(true);
        break;
      default:
        return;
    }
    e.preventDefault();
  };

  // Wheel needs a non-passive listener so it can stop the board from scrolling.
  const wheelEl = useRef<HTMLElement | null>(null);
  const onWheel = useCallback(
    (e: WheelEvent) => {
      if (o.current.disabled) return;
      e.preventDefault();
      // Shift+wheel arrives as deltaX on Windows.
      let delta = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
      if (e.deltaMode === 1) delta *= 33;
      else if (e.deltaMode === 2) delta *= WHEEL_NOTCH * 3;
      if (Math.sign(delta) !== Math.sign(wheelAcc.current)) wheelAcc.current = 0;
      wheelAcc.current += delta;
      let steps = 0;
      while (Math.abs(wheelAcc.current) >= WHEEL_NOTCH) {
        const s = Math.sign(wheelAcc.current);
        steps -= s; // wheel down (positive) = decrease
        wheelAcc.current -= s * WHEEL_NOTCH;
      }
      // A small first touchpad flick still moves one step.
      if (steps === 0 && Math.abs(delta) >= WHEEL_NOTCH / 4 && Math.abs(wheelAcc.current) === Math.abs(delta)) {
        steps = -Math.sign(delta);
        wheelAcc.current = 0;
      }
      if (steps !== 0) nudge(steps, e.shiftKey);
    },
    [nudge],
  );

  const wheelRef = useCallback(
    (el: HTMLElement | null) => {
      if (wheelEl.current) wheelEl.current.removeEventListener("wheel", onWheel);
      wheelEl.current = el;
      if (el) el.addEventListener("wheel", onWheel, { passive: false });
    },
    [onWheel],
  );

  useEffect(() => () => wheelEl.current?.removeEventListener("wheel", onWheel), [onWheel]);

  return {
    dragging,
    entryOpen,
    setEntryOpen,
    bind: { onPointerDown, onPointerMove, onPointerUp: end, onPointerCancel: end, onDoubleClick, onKeyDown },
    wheelRef,
    commit: emit,
  };
}
