/**
 * Batched EQ writes. Every edit shows at once (`showPending`) and the queued edits go out as ONE
 * `setParams` script per ~30 Hz tick, so a node drag (f + gain) on "all channels" is a single
 * `set_script` across channels 0–7, never 16 separate writes.
 */
import { useEffect, useMemo } from "react";
import type { ParamValue } from "@/lib/bridge";
import type { EqField } from "@/lib/params";
import { throttle } from "@/lib/throttle";
import { useMixer, WRITE_MS } from "@/stores/mixerStore";

export const EQ_CHANNELS = 8;
export const EQ_CELLS = 6;

/** Which channels an edit targets: all 8 (linked) or one. */
export type EqChannelSel = "all" | number;

/** Builds a cell param name, e.g. `bus(0).eqCell`. */
export type EqCellName = (ch: number, cell: number, field: EqField) => string;

/** A partial cell edit, by param field. */
export type EqCellPatch = Partial<Record<EqField, number>>;

export const channelsOf = (sel: EqChannelSel): number[] =>
  sel === "all" ? Array.from({ length: EQ_CHANNELS }, (_, c) => c) : [sel];

export interface EqWriter {
  /** Edits cell `cell` on the selected channels. */
  cell: (sel: EqChannelSel, cell: number, patch: EqCellPatch) => void;
  /** Edits one per-channel param (Trim, Delay) on the selected channels. */
  channel: (sel: EqChannelSel, name: (ch: number) => string, value: number) => void;
  /** Sends whatever is queued now. */
  flush: () => void;
}

export function createEqWriter(cellName: EqCellName): EqWriter {
  let queue = new Map<string, ParamValue>();
  const send = throttle(() => {
    if (queue.size === 0) return;
    const edits = [...queue.entries()];
    queue = new Map();
    void useMixer.getState().setParams(edits);
  }, WRITE_MS);

  const push = (edits: [string, number][]) => {
    if (edits.length === 0) return;
    useMixer.getState().showPending(edits);
    for (const [n, v] of edits) queue.set(n, v);
    send();
  };

  return {
    cell: (sel, cell, patch) => {
      const fields = Object.entries(patch) as [EqField, number][];
      push(channelsOf(sel).flatMap((ch) => fields.map(([f, v]): [string, number] => [cellName(ch, cell, f), v])));
    },
    channel: (sel, name, value) => push(channelsOf(sel).map((ch): [string, number] => [name(ch), value])),
    flush: () => send.flush(),
  };
}

/** A writer for one EQ (re-created when `key` changes); flushes on unmount. */
export function useEqWriter(key: string, cellName: EqCellName): EqWriter {
  const w = useMemo(() => createEqWriter(cellName), [key]);
  useEffect(() => () => w.flush(), [w]);
  return w;
}
