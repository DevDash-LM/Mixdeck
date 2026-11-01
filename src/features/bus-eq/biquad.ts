/**
 * EQ response math: RBJ Audio-EQ-Cookbook biquads evaluated on a log frequency grid.
 * The total response is the sum of every enabled cell's response in dB, plus the channel Trim.
 * Pure functions, no React; the graph memoises the results.
 */
import type { EqCell } from "@/lib/bridge";
import { eqTypeShape } from "./eqTypes";

export type EqShape = "peak" | "lowShelf" | "highShelf" | "lowPass" | "highPass" | "bandPass" | "notch";

/** Shapes whose `gain` changes the curve (the others ignore it). */
export const GAIN_SHAPES: ReadonlySet<EqShape> = new Set(["peak", "lowShelf", "highShelf"]);

export const DEFAULT_SAMPLE_RATE = 48_000;
export const F_MIN = 20;
export const F_MAX = 20_000;
export const GRAPH_POINTS = 256;
/** Lowest value a response point reads (a notch's centre would otherwise be -∞). */
export const RESPONSE_FLOOR_DB = -60;

/** Normalised biquad: a0 = 1. */
export interface Biquad {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

/** `n` log-spaced frequencies from `lo` to `hi` (inclusive). */
export function logFreqs(n = GRAPH_POINTS, lo = F_MIN, hi = F_MAX): number[] {
  const a = Math.log(lo);
  const span = Math.log(hi) - a;
  return Array.from({ length: n }, (_, i) => Math.exp(a + (span * i) / Math.max(1, n - 1)));
}

/** RBJ cookbook coefficients. `f` is clamped below Nyquist, `q` to > 0. */
export function coefficients(shape: EqShape, f: number, gain: number, q: number, sampleRate = DEFAULT_SAMPLE_RATE): Biquad {
  const fc = Math.min(Math.max(f, 1), sampleRate * 0.499);
  const w0 = (2 * Math.PI * fc) / sampleRate;
  const cos = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * Math.max(q, 1e-3));
  const A = Math.pow(10, gain / 40);
  let b0: number, b1: number, b2: number, a0: number, a1: number, a2: number;

  switch (shape) {
    case "peak":
      b0 = 1 + alpha * A;
      b1 = -2 * cos;
      b2 = 1 - alpha * A;
      a0 = 1 + alpha / A;
      a1 = -2 * cos;
      a2 = 1 - alpha / A;
      break;
    case "lowShelf": {
      const s = 2 * Math.sqrt(A) * alpha;
      b0 = A * (A + 1 - (A - 1) * cos + s);
      b1 = 2 * A * (A - 1 - (A + 1) * cos);
      b2 = A * (A + 1 - (A - 1) * cos - s);
      a0 = A + 1 + (A - 1) * cos + s;
      a1 = -2 * (A - 1 + (A + 1) * cos);
      a2 = A + 1 + (A - 1) * cos - s;
      break;
    }
    case "highShelf": {
      const s = 2 * Math.sqrt(A) * alpha;
      b0 = A * (A + 1 + (A - 1) * cos + s);
      b1 = -2 * A * (A - 1 + (A + 1) * cos);
      b2 = A * (A + 1 + (A - 1) * cos - s);
      a0 = A + 1 - (A - 1) * cos + s;
      a1 = 2 * (A - 1 - (A + 1) * cos);
      a2 = A + 1 - (A - 1) * cos - s;
      break;
    }
    case "lowPass":
      b0 = (1 - cos) / 2;
      b1 = 1 - cos;
      b2 = (1 - cos) / 2;
      a0 = 1 + alpha;
      a1 = -2 * cos;
      a2 = 1 - alpha;
      break;
    case "highPass":
      b0 = (1 + cos) / 2;
      b1 = -(1 + cos);
      b2 = (1 + cos) / 2;
      a0 = 1 + alpha;
      a1 = -2 * cos;
      a2 = 1 - alpha;
      break;
    case "bandPass": // constant 0 dB peak gain
      b0 = alpha;
      b1 = 0;
      b2 = -alpha;
      a0 = 1 + alpha;
      a1 = -2 * cos;
      a2 = 1 - alpha;
      break;
    case "notch":
      b0 = 1;
      b1 = -2 * cos;
      b2 = 1;
      a0 = 1 + alpha;
      a1 = -2 * cos;
      a2 = 1 - alpha;
      break;
  }
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

/** |H(e^jw)| in dB at `freq`. */
export function magnitudeDb(c: Biquad, freq: number, sampleRate = DEFAULT_SAMPLE_RATE): number {
  const w = (2 * Math.PI * freq) / sampleRate;
  const c1 = Math.cos(w);
  const c2 = Math.cos(2 * w);
  const num = c.b0 * c.b0 + c.b1 * c.b1 + c.b2 * c.b2 + 2 * (c.b0 * c.b1 + c.b1 * c.b2) * c1 + 2 * c.b0 * c.b2 * c2;
  const den = 1 + c.a1 * c.a1 + c.a2 * c.a2 + 2 * (c.a1 + c.a1 * c.a2) * c1 + 2 * c.a2 * c2;
  if (!(num > 0) || !(den > 0)) return RESPONSE_FLOOR_DB;
  return Math.max(RESPONSE_FLOOR_DB, 10 * Math.log10(num / den));
}

export interface ResponseOptions {
  sampleRate?: number;
  /** Channel Trim in dB, added to every point. */
  trim?: number;
  /** Maps a cell's `kind` to a shape; defaults to the calibrated table (`eqTypeShape`). */
  shapeOf?: (kind: number) => EqShape | null;
}

/**
 * One cell's response in dB at `freqs`, or `null` when the cell is off or its shape is unknown
 * (callers draw nothing / flat for it).
 */
export function cellResponse(cell: EqCell, freqs: readonly number[], opts: ResponseOptions = {}): number[] | null {
  if (!cell.on) return null;
  const shape = (opts.shapeOf ?? eqTypeShape)(cell.kind);
  if (!shape) return null;
  const sr = opts.sampleRate ?? DEFAULT_SAMPLE_RATE;
  const c = coefficients(shape, cell.f, cell.gain, cell.q, sr);
  return freqs.map((f) => magnitudeDb(c, f, sr));
}

/** The summed response (dB) of `cells` at `freqs`, plus Trim. Unknown shapes contribute 0 dB. */
export function response(cells: readonly EqCell[], freqs: readonly number[], opts: ResponseOptions = {}): number[] {
  const out = freqs.map(() => opts.trim ?? 0);
  for (const cell of cells) {
    const r = cellResponse(cell, freqs, opts);
    if (!r) continue;
    for (let i = 0; i < out.length; i++) out[i] = (out[i] ?? 0) + (r[i] ?? 0);
  }
  return out;
}
