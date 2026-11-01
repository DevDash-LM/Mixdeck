/**
 * Segmented level meter: solid segments with 2px gaps, hard colour steps at
 * −12 / −3 dB, a peak-hold tick in `fg`, and a clip latch in `meter-hi` (click to clear).
 *
 * Levels are read from `levelsStore` inside the shared rAF loop and never touch React state.
 * Each bar is pre-rendered once per size into an "unlit" and a "lit" sprite, so a frame is two
 * drawImage calls per bar, and a frame is skipped entirely when nothing visible changed.
 *
 * `orientation="horizontal"` draws the same thing rotated: min on the left,
 * max (and the clip latch) on the right, bar 0 on top. Width follows the parent; height is the bars.
 */
import { useEffect, useRef } from "react";
import { linearToDb } from "@/lib/db";
import { cn } from "@/lib/cn";
import { levelsStore, type LevelKind } from "@/stores/levelsStore";
import { addMeterDraw } from "./meterLoop";
import { SCALE_INSET, SCALE_MAX, SCALE_MIN } from "./scale";

export interface MeterProps {
  kind: LevelKind;
  /** One entry per bar: the level channels whose maximum that bar shows. */
  bars: readonly (readonly number[])[];
  /** dB at the bottom / top (default the fader scale, −60…+12). */
  min?: number;
  max?: number;
  /** Space above and below the segments, to line up with a Fader (default `SCALE_INSET`). */
  inset?: number;
  /** Width of one bar in px (default 4). */
  barWidth?: number;
  /** Gap between bars in px (default 2). */
  barGap?: number;
  /** Accessible description, e.g. "Hardware Input 1 level". */
  label: string;
  /** Default "vertical". */
  orientation?: "vertical" | "horizontal";
  /** Draw at 45 % opacity (muted strip). */
  dimmed?: boolean;
  className?: string;
}

const SEGMENT = 3;
const GAP = 2;
/** Release (fall) speed of the bar. */
const RELEASE_DB_S = 36;
/** Peak hold before the tick starts to fall. */
const PEAK_HOLD_MS = 1200;
const PEAK_FALL_DB_S = 18;

interface Palette {
  off: string;
  lo: string;
  mid: string;
  hi: string;
  fg: string;
}

let palette: Palette | null = null;
function colours(): Palette {
  if (palette) return palette;
  const css = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  palette = {
    off: v("--meter-off", "#1c1c1c"),
    lo: v("--meter-lo", "#d4d4d4"),
    mid: v("--meter-mid", "#ffb224"),
    hi: v("--meter-hi", "#e5484d"),
    fg: v("--fg", "#fafafa"),
  };
  return palette;
}

interface Geometry {
  dpr: number;
  w: number;
  h: number;
  bw: number;
  bg: number;
  inset: number;
  seg: number;
  pitch: number;
  n: number;
  off: HTMLCanvasElement;
  lit: HTMLCanvasElement;
}

function buildGeometry(cssW: number, cssH: number, o: Required<Pick<MeterProps, "min" | "max" | "inset" | "barWidth" | "barGap">>): Geometry | null {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.round(cssW * dpr);
  const h = Math.round(cssH * dpr);
  if (w <= 0 || h <= 0) return null;
  const inset = Math.round(o.inset * dpr);
  const seg = Math.max(1, Math.round(SEGMENT * dpr));
  const gap = Math.max(1, Math.round(GAP * dpr));
  const pitch = seg + gap;
  const travel = h - inset * 2;
  const n = Math.max(1, Math.floor((travel + gap) / pitch));
  const bw = Math.max(1, Math.round(o.barWidth * dpr));
  const bg = Math.round(o.barGap * dpr);
  const p = colours();

  const sprite = (lit: boolean) => {
    const c = document.createElement("canvas");
    c.width = bw;
    c.height = h;
    const ctx = c.getContext("2d");
    if (!ctx) return c;
    for (let k = 0; k < n; k++) {
      const bottom = h - inset - k * pitch;
      const db = o.min + ((k + 0.5) / n) * (o.max - o.min);
      ctx.fillStyle = lit ? (db > -3 ? p.hi : db > -12 ? p.mid : p.lo) : p.off;
      ctx.fillRect(0, bottom - seg, bw, seg);
    }
    return c;
  };

  return { dpr, w, h, bw, bg, inset, seg, pitch, n, off: sprite(false), lit: sprite(true) };
}

export function Meter({
  kind,
  bars,
  min = SCALE_MIN,
  max = SCALE_MAX,
  inset = SCALE_INSET,
  barWidth = 4,
  barGap = 2,
  label,
  orientation = "vertical",
  dimmed = false,
  className,
}: MeterProps) {
  const horizontal = orientation === "horizontal";
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const barsRef = useRef(bars);
  barsRef.current = bars;
  const clip = useRef<boolean[]>([]);
  const clipDirty = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    let geo: Geometry | null = null;
    const count = () => barsRef.current.length;
    let disp: number[] = [];
    let peak: number[] = [];
    let peakAt: number[] = [];
    let lastSig = "";
    let lastNow = performance.now();

    // Geometry is always built "vertical" (w = across the bars, h = along the scale); a horizontal
    // meter swaps the canvas axes and draws through a 90° transform.
    const resize = () => {
      const across = horizontal ? canvas.clientHeight : canvas.clientWidth;
      const along = horizontal ? canvas.clientWidth : canvas.clientHeight;
      geo = buildGeometry(across, along, { min, max, inset, barWidth, barGap });
      if (geo) {
        canvas.width = horizontal ? geo.h : geo.w;
        canvas.height = horizontal ? geo.w : geo.h;
      }
      lastSig = "";
    };
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();

    const draw = (now: number) => {
      const g = geo;
      if (!g) return;
      const dt = Math.min(0.1, Math.max(0, (now - lastNow) / 1000));
      lastNow = now;
      const nb = count();
      if (disp.length !== nb) {
        disp = new Array<number>(nb).fill(min);
        peak = new Array<number>(nb).fill(min);
        peakAt = new Array<number>(nb).fill(0);
        clip.current = new Array<boolean>(nb).fill(false);
      }

      let sig = clipDirty.current ? "!" : "";
      clipDirty.current = false;
      const lit: number[] = [];
      const pk: number[] = [];
      for (let b = 0; b < nb; b++) {
        let lin = 0;
        for (const ch of barsRef.current[b] ?? []) lin = Math.max(lin, levelsStore.get(kind, ch));
        if (lin >= 1) clip.current[b] = true;
        const db = linearToDb(lin, min);
        const prev = disp[b] ?? min;
        const d = db >= prev ? db : Math.max(db, prev - RELEASE_DB_S * dt);
        disp[b] = d;
        const p = peak[b] ?? min;
        if (d >= p) {
          peak[b] = d;
          peakAt[b] = now;
        } else if (now - (peakAt[b] ?? 0) > PEAK_HOLD_MS) {
          peak[b] = Math.max(d, p - PEAK_FALL_DB_S * dt);
        }
        const frac = (v: number) => Math.min(1, Math.max(0, (v - min) / (max - min)));
        const l = Math.round(frac(d) * g.n);
        const pp = Math.round(frac(peak[b] ?? min) * g.n);
        lit.push(l);
        pk.push(pp);
        sig += `${l},${pp},${clip.current[b] ? 1 : 0};`;
      }
      if (sig === lastSig) return;
      lastSig = sig;

      const pal = colours();
      // Logical (x across, y down from max) → canvas: horizontal maps y to x reversed, x to y.
      if (horizontal) ctx.setTransform(0, 1, -1, 0, g.h, 0);
      else ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, g.w, g.h);
      for (let b = 0; b < nb; b++) {
        const x = b * (g.bw + g.bg);
        ctx.drawImage(g.off, x, 0);
        const l = lit[b] ?? 0;
        if (l > 0) {
          const top = g.h - g.inset - l * g.pitch + (g.pitch - g.seg);
          const hgt = g.h - g.inset - top;
          ctx.drawImage(g.lit, 0, top, g.bw, hgt, x, top, g.bw, hgt);
        }
        const p = pk[b] ?? 0;
        if (p > l && p > 0) {
          const y = g.h - g.inset - p * g.pitch + (g.pitch - g.seg);
          ctx.fillStyle = pal.fg;
          ctx.fillRect(x, y, g.bw, Math.max(1, Math.round(g.dpr * 2)));
        }
        if (g.inset >= 3) {
          const ledH = Math.max(1, g.inset - Math.round(GAP * g.dpr));
          ctx.fillStyle = clip.current[b] ? pal.hi : pal.off;
          ctx.fillRect(x, 0, g.bw, ledH);
        }
      }
    };

    const stop = addMeterDraw(draw);
    return () => {
      stop();
      ro.disconnect();
    };
  }, [kind, min, max, inset, barWidth, barGap, horizontal]);

  const thickness = bars.length * barWidth + Math.max(0, bars.length - 1) * barGap;
  return (
    <div
      className={cn("relative shrink-0", horizontal ? "w-full" : "h-full", dimmed && "opacity-45", className)}
      style={horizontal ? { height: thickness } : { width: thickness }}
      onClick={() => {
        clip.current = clip.current.map(() => false);
        clipDirty.current = true;
      }}
      title="Click to clear the clip indicator"
    >
      <canvas ref={canvasRef} role="img" aria-label={label} className="absolute inset-0 size-full" />
    </div>
  );
}
