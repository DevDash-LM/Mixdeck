/**
 * The dB scale shared by Fader and Meter. Both are linear in dB over the same range and the
 * same vertical inset, so a meter drawn beside a fader lines up with its ticks.
 */
import { useLayoutEffect, useRef, useState } from "react";
import { GAIN_MAX, GAIN_MIN } from "@/lib/db";

/** Distance (px) from the top/bottom of the well to the ends of the travel (half a fader cap). */
export const SCALE_INSET = 6;
export const SCALE_MIN = GAIN_MIN;
export const SCALE_MAX = GAIN_MAX;

/** 0..1 from the bottom for `db` on [min, max]. */
export const scaleFrac = (db: number, min = SCALE_MIN, max = SCALE_MAX) =>
  Math.min(1, Math.max(0, (db - min) / (max - min)));

/** Tick marks for a travel height: fewer labels when there's less room. */
export function scaleTicks(travel: number): number[] {
  if (travel >= 220) return [12, 6, 0, -6, -12, -24, -36, -48, -60];
  if (travel >= 130) return [12, 0, -12, -24, -36, -60];
  return [12, 0, -24, -60];
}

/** "12" "6" "0" "−6"… with a real minus sign. */
export const tickLabel = (db: number) => (db < 0 ? `−${-db}` : `${db}`);

/** Tracks an element's content-box size (no per-frame layout reads). */
export function useElementSize<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setSize((s) => (s.width === width && s.height === height ? s : { width, height }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}

/** Value-carrying caps. Vertical 38×24, horizontal 44×22 (w × h). */
export const VALUE_CAP_V = { w: 38, h: 24 } as const;
export const VALUE_CAP_H = { w: 44, h: 22 } as const;

/**
 * The inset (half the cap along the travel axis) a Fader uses for these options. Pass it as the
 * `inset` of a `<Meter>` in the fader's `meter` slot so the meter lines up with the scale.
 * Default faders use `SCALE_INSET` (6), value-in-cap ones 12 (vertical) / 22 (horizontal).
 */
export function faderInset(o: { orientation?: "vertical" | "horizontal"; valueInCap?: boolean } = {}): number {
  if (!o.valueInCap) return SCALE_INSET;
  return o.orientation === "horizontal" ? VALUE_CAP_H.w / 2 : VALUE_CAP_V.h / 2;
}
