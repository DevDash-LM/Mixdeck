/**
 * EQ cell filter shapes (`….cell[k].type`, 0..6), shared by the strip EQ and the EQ
 * graph. The SDK PDF only says "0 to 6", so which number is which shape is unknown
 * until someone calibrates it against Voicemeeter's EQ UI (cheatsheet
 * "EQ cell types — CALIBRATE").
 *
 * To calibrate: fill in `NAMES` and `SHAPES` (index = `type` value), then set `CALIBRATED = true`.
 * Until then labels read "Type 0…6" and every shape is `null`, which the graph draws as a flat
 * line (the node still moves, only the curve is unknown).
 */
import type { EqShape } from "./biquad";

export const CALIBRATED = false;

export const EQ_TYPE_COUNT = 7;

/** Index = `type` value. Generic until calibrated. */
const NAMES: readonly string[] = ["Type 0", "Type 1", "Type 2", "Type 3", "Type 4", "Type 5", "Type 6"];

/**
 * Index = `type` value → RBJ shape drawn by the graph. `null` = unknown (flat line).
 * Shapes available: "peak", "lowShelf", "highShelf", "lowPass", "highPass", "bandPass", "notch".
 */
const SHAPES: readonly (EqShape | null)[] = [null, null, null, null, null, null, null];

export function eqTypeLabel(type: number): string {
  return NAMES[type] ?? `Type ${type}`;
}

/** The filter shape of `type`, or `null` when it isn't calibrated (or out of range). */
export function eqTypeShape(type: number): EqShape | null {
  return SHAPES[type] ?? null;
}

export const EQ_TYPE_OPTIONS: { value: string; label: string }[] = NAMES.map((label, i) => ({
  value: String(i),
  label,
}));
