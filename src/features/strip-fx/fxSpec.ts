/**
 * Ranges, steps, units and defaults for the Strip FX controls. Ranges are the cheatsheet's.
 * Defaults are what an untouched strip reads on Voicemeeter Potato 3.1.3.0 (checked with
 * `vmr_probe`); the per-section resets write them.
 */
import type { Comp, EqCell, Gate } from "@/lib/bridge";
import { formatDb } from "@/lib/db";
import { strip } from "@/lib/params";

export interface FxSpec {
  label: string;
  min: number;
  max: number;
  step: number;
  fineStep: number;
  def: number;
  unit: string;
  bipolar?: boolean;
  format: (v: number) => string;
}

const db = (v: number) => formatDb(v, -999);
const ms = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(2)} s` : `${Math.round(v)} ms`);
const hz = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 1 : 2)} kHz` : `${Math.round(v)} Hz`);
const fixed = (n: number) => (v: number) => v.toFixed(n);

/** Strip-face amount knobs (Comp, Gate, Denoiser), 0..10. */
export const AMOUNT: Omit<FxSpec, "label"> = {
  min: 0,
  max: 10,
  step: 0.5,
  fineStep: 0.1,
  def: 0,
  unit: "",
  format: fixed(1),
};

export const LIMIT: FxSpec = {
  label: "Limit",
  min: -40,
  max: 12,
  step: 0.5,
  fineStep: 0.1,
  def: 12,
  unit: "dB",
  format: (v) => (v >= 12 ? "Off" : `${db(v)} dB`),
};

type CompNum = Exclude<keyof Comp, "makeup">;
type P = ReturnType<typeof strip>;

export const COMP_FIELDS: readonly { key: CompNum; param: (p: P) => string; spec: FxSpec }[] = [
  { key: "threshold", param: (p) => p.compThreshold(), spec: { label: "Threshold", min: -40, max: -3, step: 0.5, fineStep: 0.1, def: -40, unit: "dB", format: (v) => `${db(v)} dB` } },
  { key: "ratio", param: (p) => p.compRatio(), spec: { label: "Ratio", min: 1, max: 8, step: 0.1, fineStep: 0.01, def: 1, unit: ":1", format: (v) => `${v.toFixed(1)}:1` } },
  { key: "knee", param: (p) => p.compKnee(), spec: { label: "Knee", min: 0, max: 1, step: 0.01, fineStep: 0.002, def: 0.5, unit: "", format: fixed(2) } },
  { key: "attack", param: (p) => p.compAttack(), spec: { label: "Attack", min: 0, max: 200, step: 1, fineStep: 0.1, def: 10, unit: "ms", format: ms } },
  { key: "release", param: (p) => p.compRelease(), spec: { label: "Release", min: 0, max: 5000, step: 10, fineStep: 1, def: 50, unit: "ms", format: ms } },
  { key: "gainIn", param: (p) => p.compGainIn(), spec: { label: "Input gain", min: -24, max: 24, step: 0.5, fineStep: 0.1, def: 0, unit: "dB", bipolar: true, format: (v) => `${db(v)} dB` } },
  { key: "gainOut", param: (p) => p.compGainOut(), spec: { label: "Output gain", min: -24, max: 24, step: 0.5, fineStep: 0.1, def: 0, unit: "dB", bipolar: true, format: (v) => `${db(v)} dB` } },
];
export const COMP_MAKEUP_DEFAULT = true;

export const GATE_FIELDS: readonly { key: keyof Gate; param: (p: P) => string; spec: FxSpec }[] = [
  { key: "threshold", param: (p) => p.gateThreshold(), spec: { label: "Threshold", min: -60, max: -10, step: 0.5, fineStep: 0.1, def: -60, unit: "dB", format: (v) => `${db(v)} dB` } },
  { key: "damping", param: (p) => p.gateDamping(), spec: { label: "Damping", min: -60, max: -10, step: 0.5, fineStep: 0.1, def: -60, unit: "dB", format: (v) => `${db(v)} dB` } },
  { key: "bpSidechain", param: (p) => p.gateBpSidechain(), spec: { label: "Sidechain BP", min: 100, max: 4000, step: 10, fineStep: 1, def: 100, unit: "Hz", format: hz } },
  { key: "attack", param: (p) => p.gateAttack(), spec: { label: "Attack", min: 0, max: 1000, step: 1, fineStep: 0.1, def: 10, unit: "ms", format: ms } },
  { key: "hold", param: (p) => p.gateHold(), spec: { label: "Hold", min: 0, max: 5000, step: 10, fineStep: 1, def: 200, unit: "ms", format: ms } },
  { key: "release", param: (p) => p.gateRelease(), spec: { label: "Release", min: 0, max: 5000, step: 10, fineStep: 1, def: 1250, unit: "ms", format: ms } },
];

/** Virtual-strip 3-band EQ knobs (`EQGain1..3`). */
export const EQ_GAIN: Omit<FxSpec, "label"> = {
  min: -12,
  max: 12,
  step: 0.5,
  fineStep: 0.1,
  def: 0,
  unit: "dB",
  bipolar: true,
  format: (v) => `${db(v)} dB`,
};

/** Parametric EQ cell fields. */
export const CELL_F: Omit<FxSpec, "label" | "def"> = { min: 20, max: 20000, step: 10, fineStep: 1, unit: "Hz", format: hz };
export const CELL_GAIN: Omit<FxSpec, "label" | "def"> = { min: -12, max: 12, step: 0.5, fineStep: 0.1, unit: "dB", format: db };
export const CELL_Q: Omit<FxSpec, "label" | "def"> = { min: 1, max: 100, step: 0.1, fineStep: 0.01, unit: "", format: fixed(2) };

/** Default cell `k` of a strip EQ: on, type 0, gain 0, Q 3, at these frequencies. */
export const DEFAULT_CELL_F = [50, 200, 800, 2000, 8000, 12000] as const;
export function defaultCell(k: number): EqCell {
  return { on: true, kind: 0, f: DEFAULT_CELL_F[k] ?? 1000, gain: 0, q: 3 };
}

export const EQ_CHANNELS = 8;
export const EQ_CELLS = 6;
