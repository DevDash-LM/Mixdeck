/**
 * The parametric EQ section shared by the Bus EQ drawer and the Strip FX EQ tab: channel picker
 * (all channels linked, or one), the graph, the band table for exact values, and (buses) the
 * channel's Trim and Delay. All writes go through one batched `EqWriter`.
 */
import { useState } from "react";
import { NumberField } from "@/components/mixer";
import { Select } from "@/components/ui";
import type { EqCell, ParamValue } from "@/lib/bridge";
import type { EqField } from "@/lib/params";
import { useMixer } from "@/stores/mixerStore";
import { Section } from "@/features/strip-fx/controls";
import { EqCellTable } from "@/features/strip-fx/EqCellTable";
import { defaultCell } from "@/features/strip-fx/fxSpec";
import { DEFAULT_SAMPLE_RATE } from "./biquad";
import { EqGraph } from "./EqGraph";
import { CALIBRATED } from "./eqTypes";
import { EQ_CELLS, EQ_CHANNELS, channelsOf, useEqWriter, type EqCellName, type EqChannelSel } from "./eqWriter";

export interface EqEditorChannel {
  cells: readonly EqCell[];
  trim?: number;
  delay?: number;
}

export interface EqEditorProps {
  /** Identifies the EQ ("bus:0", "strip:3"); a change resets the writer. */
  id: string;
  /** Accessible name prefix ("A1 EQ"). */
  label: string;
  cellName: EqCellName;
  /** `EQ_CHANNELS` long. */
  channels: readonly EqEditorChannel[];
  /** Per-channel Trim/Delay params (buses). */
  channelParams?: { trim: (ch: number) => string; delay: (ch: number) => string };
  sampleRate?: number | null;
  /** EQ is off: draw the curve dimmed. */
  bypassed?: boolean;
  /** Defaults the reset writes for cell `k` (default: the verified strip defaults). */
  defaults?: (k: number) => EqCell;
}

const CHANNEL_OPTIONS = [
  { value: "all", label: "All channels" },
  ...Array.from({ length: EQ_CHANNELS }, (_, c) => ({ value: String(c), label: `Channel ${c + 1}` })),
];

const FIELD_KEY: Record<EqField, keyof EqCell> = { on: "on", type: "kind", f: "f", gain: "gain", q: "q" };
const num = (v: number | boolean) => (typeof v === "boolean" ? (v ? 1 : 0) : v);

const TRIM = { min: -24, max: 24, step: 0.5, fineStep: 0.1 };
const DELAY = { min: 0, max: 500, step: 1, fineStep: 0.1 };

function sameCells(a: readonly EqCell[] | undefined, b: readonly EqCell[] | undefined) {
  if (!a || !b || a.length !== b.length) return false;
  return a.every((c, k) => {
    const d = b[k];
    return d && c.on === d.on && c.kind === d.kind && c.f === d.f && c.gain === d.gain && c.q === d.q;
  });
}

export function EqEditor({
  id,
  label,
  cellName,
  channels,
  channelParams,
  sampleRate,
  bypassed,
  defaults = defaultCell,
}: EqEditorProps) {
  const [sel, setSel] = useState<EqChannelSel>("all");
  const [band, setBand] = useState<number | null>(null);
  const writer = useEqWriter(id, cellName);
  const pending = useMixer((s) => s.pending);

  const ch = sel === "all" ? 0 : sel;
  const live = (name: string, backend: number) => {
    const edit = pending[name];
    return edit ? Number(edit.value) : backend;
  };
  const base = channels[ch];
  const cells = (base?.cells ?? []).map((c, k): EqCell => {
    const get = (field: EqField) => live(cellName(ch, k, field), num(c[FIELD_KEY[field]]));
    return { on: get("on") >= 0.5, kind: Math.round(get("type")), f: get("f"), gain: get("gain"), q: get("q") };
  });
  const trim = channelParams ? live(channelParams.trim(ch), base?.trim ?? 0) : 0;
  const delay = channelParams ? live(channelParams.delay(ch), base?.delay ?? 0) : 0;

  const linkedDiffer =
    sel === "all" &&
    channels.some(
      (c) =>
        !sameCells(c.cells, channels[0]?.cells) ||
        (channelParams && (c.trim !== channels[0]?.trim || c.delay !== channels[0]?.delay)),
    );

  const onTable = (k: number, field: EqField, value: number) => writer.cell(sel, k, { [field]: value });

  const resetEdits = (): [string, ParamValue][] =>
    channelsOf("all").flatMap((c) => [
      ...Array.from({ length: EQ_CELLS }).flatMap((_, k): [string, ParamValue][] => {
        const d = defaults(k);
        return [
          [cellName(c, k, "on"), d.on ? 1 : 0],
          [cellName(c, k, "type"), d.kind],
          [cellName(c, k, "f"), d.f],
          [cellName(c, k, "gain"), d.gain],
          [cellName(c, k, "q"), d.q],
        ];
      }),
      ...(channelParams
        ? ([
            [channelParams.trim(c), 0],
            [channelParams.delay(c), 0],
          ] as [string, ParamValue][])
        : []),
    ]);

  return (
    <Section
      title="Parametric EQ"
      actions={
        <Select
          size="sm"
          value={String(sel)}
          onValueChange={(v) => setSel(v === "all" ? "all" : Number(v))}
          options={CHANNEL_OPTIONS}
          aria-label={`${label} channel`}
          className="w-[132px]"
        />
      }
      reset={{
        description: `Sets all ${EQ_CELLS} bands on all ${EQ_CHANNELS} channels back to on, flat, Q 3${
          channelParams ? ", with Trim and Delay at 0" : ""
        }.`,
        edits: resetEdits,
      }}
    >
      <p className="text-12 text-text-dim">
        {sel === "all"
          ? linkedDiffer
            ? "Channels differ. Showing channel 1; an edit sets that value on all channels."
            : "Linked: edits apply to all channels."
          : `Editing channel ${sel + 1} only.`}
      </p>

      <EqGraph
        cells={cells}
        onChange={(k, patch) => writer.cell(sel, k, patch)}
        sampleRate={sampleRate ?? DEFAULT_SAMPLE_RATE}
        trim={trim}
        bypassed={bypassed}
        label={label}
        selected={band}
        onSelect={setBand}
      />
      {!CALIBRATED ? (
        <p className="text-11 text-text-faint">
          Filter types aren't calibrated yet, so their curves are drawn flat. Nodes still set frequency, gain and Q (see the
          setup guide, EQ type calibration).
        </p>
      ) : null}

      <EqCellTable cells={cells} onChange={onTable} label={label} />

      {channelParams ? (
        <div className="grid grid-cols-2 gap-3 pt-1">
          <div className="flex items-center justify-between gap-2 text-12 text-text-dim">
            Trim
            <NumberField
              value={trim}
              onChange={(v) => writer.channel(sel, channelParams.trim, v)}
              {...TRIM}
              format={(v) => `${v > 0 ? "+" : ""}${v.toFixed(1)}`}
              unit="dB"
              label={`${label} trim`}
              className="w-[96px] justify-end"
            />
          </div>
          <div className="flex items-center justify-between gap-2 text-12 text-text-dim">
            Delay
            <NumberField
              value={delay}
              onChange={(v) => writer.channel(sel, channelParams.delay, v)}
              {...DELAY}
              format={(v) => v.toFixed(1)}
              unit="ms"
              label={`${label} delay`}
              className="w-[96px] justify-end"
            />
          </div>
        </div>
      ) : null}
    </Section>
  );
}
