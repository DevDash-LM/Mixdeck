/**
 * Parameter names and Potato layout: the TS mirror of `src-tauri/src/vmr/{params,layout}.rs`.
 * Names come from docs/reference/vmr-api-cheatsheet.md. Build every name here; never hand-type
 * "Strip[0].Gain" elsewhere.
 */
import type { BusMode } from "./generated/BusMode";

// ---- Layout ----
export const STRIPS = 8;
export const HW_STRIPS = 5;
export const VIRTUAL_STRIPS = STRIPS - HW_STRIPS;
export const BUSES = 8;
export const PHYS_BUSES = 5;
export const IN_LEVEL_CH = 34;
export const OUT_LEVEL_CH = 64;
export const HW_STRIP_CH = 2;
export const VIRTUAL_STRIP_CH = 8;
export const BUS_CH = 8;

export const BUS_NAMES = ["A1", "A2", "A3", "A4", "A5", "B1", "B2", "B3"] as const;
export type BusName = (typeof BUS_NAMES)[number];

/** Voicemeeter Potato's default strip names (shown when a strip has no label). */
export const STRIP_DEFAULT_NAMES = [
  "Hardware Input 1",
  "Hardware Input 2",
  "Hardware Input 3",
  "Hardware Input 4",
  "Hardware Input 5",
  "Virtual Input",
  "Virtual AUX",
  "VAIO3",
] as const;

export const isHardwareStrip = (i: number) => i >= 0 && i < HW_STRIPS;
export const isVirtualStrip = (i: number) => i >= HW_STRIPS && i < STRIPS;
export const isPhysicalBus = (j: number) => j >= 0 && j < PHYS_BUSES;

/** Input level channels of strip `i` as [start, end) (empty when out of range). */
export function stripLevelChannels(i: number): [number, number] {
  if (isHardwareStrip(i)) return [i * HW_STRIP_CH, i * HW_STRIP_CH + HW_STRIP_CH];
  if (isVirtualStrip(i)) {
    const start = HW_STRIPS * HW_STRIP_CH + (i - HW_STRIPS) * VIRTUAL_STRIP_CH;
    return [start, start + VIRTUAL_STRIP_CH];
  }
  return [0, 0];
}

/** Output level channels of bus `j` as [start, end) (empty when out of range). */
export function busLevelChannels(j: number): [number, number] {
  if (j < 0 || j >= BUSES) return [0, 0];
  return [j * BUS_CH, j * BUS_CH + BUS_CH];
}

// ---- Enums ----
export type EqField = "on" | "type" | "f" | "gain" | "q";
export type DeviceParam = "wdm" | "ks" | "mme" | "asio";
export const DEVICE_PARAMS: readonly DeviceParam[] = ["wdm", "ks", "mme", "asio"];

/** Bus mode id (bridge `BusMode`) → its `mode.*` parameter suffix. */
export const BUS_MODE_PARAM: Readonly<Record<BusMode, string>> = {
  normal: "normal",
  amix: "Amix",
  bmix: "Bmix",
  repeat: "Repeat",
  composite: "Composite",
  tvMix: "TVMix",
  upMix21: "UpMix21",
  upMix41: "UpMix41",
  upMix61: "UpMix61",
  centerOnly: "CenterOnly",
  lfeOnly: "LFEOnly",
  rearOnly: "RearOnly",
};
export const BUS_MODES = Object.keys(BUS_MODE_PARAM) as BusMode[];

// ---- Builders ----
function eqCell(prefix: string, ch: number, cell: number, field: EqField) {
  return `${prefix}.EQ.channel[${ch}].cell[${cell}].${field}`;
}

export function strip(i: number) {
  const p = `Strip[${i}]`;
  const f = (field: string) => `${p}.${field}`;
  return {
    gain: () => f("Gain"),
    mute: () => f("Mute"),
    solo: () => f("Solo"),
    mono: () => f("Mono"),
    mc: () => f("MC"),
    /** Route to bus index 0..7 (A1..B3). */
    route: (bus: number) => f(BUS_NAMES[bus] ?? "A1"),
    label: () => f("Label"),
    limit: () => f("Limit"),
    denoiser: () => f("Denoiser"),
    comp: () => f("Comp"),
    compGainIn: () => f("Comp.GainIn"),
    compRatio: () => f("Comp.Ratio"),
    compThreshold: () => f("Comp.Threshold"),
    compAttack: () => f("Comp.Attack"),
    compRelease: () => f("Comp.Release"),
    compKnee: () => f("Comp.Knee"),
    compGainOut: () => f("Comp.GainOut"),
    compMakeup: () => f("Comp.MakeUp"),
    gate: () => f("Gate"),
    gateThreshold: () => f("Gate.Threshold"),
    gateDamping: () => f("Gate.Damping"),
    gateBpSidechain: () => f("Gate.BPSidechain"),
    gateAttack: () => f("Gate.Attack"),
    gateHold: () => f("Gate.Hold"),
    gateRelease: () => f("Gate.Release"),
    eqOn: () => f("EQ.on"),
    eqAb: () => f("EQ.AB"),
    eqCell: (ch: number, cell: number, field: EqField) => eqCell(p, ch, cell, field),
    /** Virtual strips: EQGain1..3. */
    eqGain: (n: 1 | 2 | 3) => f(`EQGain${n}`),
    /** Write-only device selector; "" unselects. */
    device: (kind: DeviceParam) => f(`device.${kind}`),
    deviceName: () => f("device.name"),
    deviceSr: () => f("device.sr"),
  };
}

export function bus(j: number) {
  const p = `Bus[${j}]`;
  const f = (field: string) => `${p}.${field}`;
  return {
    gain: () => f("Gain"),
    mute: () => f("Mute"),
    /** 0 off, 1 mono, 2 stereo reverse. */
    mono: () => f("Mono"),
    sel: () => f("Sel"),
    monitor: () => f("Monitor"),
    label: () => f("Label"),
    limit: () => f("Limit"),
    eqOn: () => f("EQ.on"),
    eqAb: () => f("EQ.AB"),
    eqCell: (ch: number, cell: number, field: EqField) => eqCell(p, ch, cell, field),
    eqTrim: (ch: number) => f(`EQ.channel[${ch}].Trim`),
    eqDelay: (ch: number) => f(`EQ.channel[${ch}].Delay`),
    /** Write 1 to select this mode. */
    mode: (mode: BusMode) => f(`mode.${BUS_MODE_PARAM[mode]}`),
    device: (kind: DeviceParam) => f(`device.${kind}`),
    deviceName: () => f("device.name"),
    deviceSr: () => f("device.sr"),
  };
}

export const command = {
  restart: () => "Command.Restart",
  show: () => "Command.Show",
  save: () => "Command.Save",
  load: () => "Command.Load",
  saveBusEq: (j: number) => `Command.SaveBUSEQ[${j}]`,
  loadBusEq: (j: number) => `Command.LoadBUSEQ[${j}]`,
  lock: () => "Command.Lock",
};

// ---- Scripts (mirror of vmr::params::script) ----
export const SCRIPT_MAX_BYTES = 48 * 1024 - 1;

/** Quotes a string value; the SDK has no escape, so `"` → `'` and CR/LF/TAB → space. */
export function quote(value: string): string {
  return `"${value.replace(/"/g, "'").replace(/[\r\n\t]/g, " ")}"`;
}

/** Builds a `SetParameters` script, one `name = value` per line. */
export class ScriptBuilder {
  private lines: string[] = [];
  float(name: string, value: number): this {
    if (Number.isFinite(value)) this.lines.push(`${name} = ${+value.toFixed(4)}`);
    return this;
  }
  bool(name: string, value: boolean): this {
    this.lines.push(`${name} = ${value ? 1 : 0}`);
    return this;
  }
  string(name: string, value: string): this {
    this.lines.push(`${name} = ${quote(value)}`);
    return this;
  }
  get isEmpty(): boolean {
    return this.lines.length === 0;
  }
  build(): string {
    return this.lines.join("\n");
  }
  /** Splits at line boundaries into pieces of at most SCRIPT_MAX_BYTES (each is atomic). */
  chunks(): string[] {
    const out: string[] = [];
    let cur = "";
    const enc = new TextEncoder();
    for (const line of this.lines) {
      const next = cur ? `${cur}\n${line}` : line;
      if (cur && enc.encode(next).length > SCRIPT_MAX_BYTES) {
        out.push(cur);
        cur = line;
      } else {
        cur = next;
      }
    }
    if (cur) out.push(cur);
    return out;
  }
}
