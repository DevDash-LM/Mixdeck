/**
 * Meter levels, outside React. The engine pushes `Levels` ~60×/s over an ipc Channel; they're
 * written into typed arrays here and `Meter` components read them in requestAnimationFrame.
 * Never put levels into React state.
 */
import { bridge, inTauri, type Levels } from "@/lib/bridge";
import { linearToDb } from "@/lib/db";
import { IN_LEVEL_CH, OUT_LEVEL_CH } from "@/lib/params";

export type LevelKind = "in" | "out";

const inputs = new Float32Array(IN_LEVEL_CH);
const outputs = new Float32Array(OUT_LEVEL_CH);
let frame = 0;
let receivedAt = 0;
let started: Promise<void> | null = null;

function write(l: Levels) {
  inputs.set(l.inputs.slice(0, IN_LEVEL_CH));
  outputs.set(l.outputs.slice(0, OUT_LEVEL_CH));
  frame++;
  receivedAt = performance.now();
}

export const levelsStore = {
  /** Linear level of one channel (0 when unknown). */
  get(kind: LevelKind, ch: number): number {
    return (kind === "in" ? inputs[ch] : outputs[ch]) ?? 0;
  },
  /** Level in dB (floored at -60). */
  getDb(kind: LevelKind, ch: number): number {
    return linearToDb(levelsStore.get(kind, ch));
  },
  /** Highest linear level in channels [start, end), e.g. from `stripLevelChannels(i)`. */
  peak(kind: LevelKind, [start, end]: readonly [number, number]): number {
    const arr = kind === "in" ? inputs : outputs;
    let max = 0;
    for (let c = start; c < end && c < arr.length; c++) max = Math.max(max, arr[c] ?? 0);
    return max;
  },
  /** Increments on every received frame; a meter can skip redraws when it hasn't changed. */
  frame: () => frame,
  /** ms since the last frame (Infinity before the first). */
  age: () => (receivedAt ? performance.now() - receivedAt : Number.POSITIVE_INFINITY),
  /** Opens the level stream. Idempotent; `useMixer().init()` calls it. */
  start(): Promise<void> {
    if (!inTauri) return Promise.resolve();
    if (!started) {
      started = bridge.startLevels(write).catch((err: unknown) => {
        started = null;
        throw err;
      });
    }
    return started;
  },
};
