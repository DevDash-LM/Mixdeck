/**
 * Bus row v2. A grid of `minmax(0,1fr) auto`:
 *   line 1: badge · label · device chip (A) / bus source (B) · mode chip · ⋯
 *   line 2: horizontal value-in-cap fader with the L/R meter under the rail
 *   right:  2×2 Mute · Mono / EQ · Sel, spanning both lines
 * Height flexes 68–104px (the Master column decides); density follows the row's own height.
 * Writes go through `useMixer().setParam` with names from `lib/params.ts`.
 */
import { memo, useMemo, useState } from "react";
import { Fader, Meter, useElementSize } from "@/components/mixer";
import type { Bus } from "@/lib/bridge";
import { cn } from "@/lib/cn";
import { bus as busParams, busLevelChannels } from "@/lib/params";
import { useMixer } from "@/stores/mixerStore";
import { BusModeMenu } from "../BusModeMenu";
import { getBusSource, type DevicePicker } from "../extensions";
import { busName, busTitle } from "../labels";
import { CardMenu, DeviceChip, EditableLabel } from "../parts";
import { BusButtons } from "./BusButtons";
import { LINE1, LINE_GAP, METER, ROW_FADER_INSET, ROW_PAD_Y, rowDensity } from "./layout";

export interface BusRowProps {
  bus: Bus;
  /** Open the Bus EQ editor. Absent = shown disabled. */
  onOpenEq?: (j: number) => void;
  /** Device picker that replaces the static device chip on A buses. */
  DevicePicker?: DevicePicker;
}

const set = (name: string, value: number | string) => useMixer.getState().setParam(name, value);
const bool = (b: boolean) => (b ? 1 : 0);

/** L = max of even channels, R = max of odd channels (same rule as virtual strips, D3). */
function busBars(j: number): number[][] {
  const [start, end] = busLevelChannels(j);
  const l: number[] = [];
  const r: number[] = [];
  for (let c = start; c < end; c++) ((c - start) % 2 === 0 ? l : r).push(c);
  return [l, r];
}

function BusRowImpl({ bus: b, onOpenEq, DevicePicker }: BusRowProps) {
  const j = b.index;
  const p = useMemo(() => busParams(j), [j]);
  const short = busName(j);
  const title = busTitle(j, b.label);
  const custom = b.label.trim() !== "" && b.label.trim() !== short;
  const bars = useMemo(() => busBars(j), [j]);
  const [renaming, setRenaming] = useState(false);
  const mono = Math.max(0, Math.min(2, b.mono)) as 0 | 1 | 2;
  const [rowRef, size] = useElementSize<HTMLElement>();
  // contentRect excludes the 1px borders and the (constant) padding; add them back.
  const density = rowDensity(size.height + 2 + 2 * ROW_PAD_Y);
  const openEq = onOpenEq ? () => onOpenEq(j) : undefined;
  const Source = b.kind === "virtual" ? getBusSource("virtual") : undefined;

  return (
    <section
      ref={rowRef}
      data-bus={j}
      tabIndex={-1}
      aria-label={`Bus ${title}`}
      className="grid min-h-0 min-w-0 flex-1 rounded-lg border border-line bg-panel px-2 transition-colors duration-150 ease-out hover:border-line-strong focus-visible:outline-offset-[-2px]"
      style={{
        gridTemplateColumns: "minmax(0, 1fr) auto",
        gridTemplateRows: `${LINE1}px auto`,
        alignContent: "center",
        columnGap: 10,
        rowGap: LINE_GAP[density],
        paddingBlock: ROW_PAD_Y,
      }}
    >
      {/* Line 1 */}
      <div className="flex min-w-0 items-center gap-1">
        <span
          title={`${short}${custom ? ` · ${b.label.trim()}` : ""} (double-click to rename)`}
          onDoubleClick={() => setRenaming(true)}
          className="tabular flex h-[22px] w-[30px] shrink-0 items-center justify-center rounded-md border border-line-strong text-12 text-text select-none"
        >
          {short}
        </span>
        {custom || renaming ? (
          <div className={cn("flex min-w-0", renaming ? "w-28 shrink" : "shrink")}>
            <EditableLabel
              variant="row"
              value={custom ? b.label : ""}
              fallback=""
              name={short}
              editing={renaming}
              onEditingChange={setRenaming}
              onCommit={(label) => set(p.label(), label)}
            />
          </div>
        ) : null}
        <div className="flex min-w-14 flex-1">
          {b.kind === "physical" ? (
            <DeviceChip index={j} current={b.device} Picker={DevicePicker} />
          ) : Source ? (
            <Source bus={j} />
          ) : (
            <span className="truncate px-1 text-11 text-text-faint">Virtual</span>
          )}
        </div>
        <BusModeMenu
          mode={b.mode}
          busLabel={short}
          onChange={(m) => set(p.mode(m), 1)}
          className="w-[70px] shrink-0"
        />
        <CardMenu
          label={`${title} options`}
          items={[
            { label: "EQ editor…", onSelect: openEq, soon: true },
            { label: "Rename", onSelect: () => setRenaming(true), separatorBefore: true },
          ]}
        />
      </div>

      {/* Buttons: column 2, both lines */}
      <div className="row-span-2 flex items-center">
        <BusButtons
          title={title}
          compact={density === "compact"}
          mute={b.mute}
          mono={mono}
          eqOn={b.eqOn}
          sel={b.sel}
          onMute={(on) => set(p.mute(), bool(on))}
          onMono={(next) => set(p.mono(), next)}
          onEq={(on) => set(p.eqOn(), bool(on))}
          onSel={(on) => set(p.sel(), bool(on))}
          onOpenEq={openEq}
        />
      </div>

      {/* Line 2: fader + meter under the rail */}
      <div className="flex min-w-0 items-center">
        <Fader
          value={b.gain}
          onChange={(v) => set(p.gain(), v)}
          label={`${title} gain`}
          orientation="horizontal"
          valueInCap
          hideScale={density === "compact"}
          scaleLabels={density === "labels"}
          dimmed={b.mute}
          meter={
            <Meter
              kind="out"
              bars={bars}
              orientation="horizontal"
              barWidth={METER.barWidth}
              barGap={METER.barGap}
              inset={ROW_FADER_INSET}
              dimmed={b.mute}
              label={`${title} level`}
            />
          }
        />
      </div>
    </section>
  );
}

/** Field-wise equality so a row re-renders only when its own data changed. */
export function sameBus(a: Bus, b: Bus): boolean {
  return (
    a === b ||
    (a.index === b.index &&
      a.kind === b.kind &&
      a.label === b.label &&
      a.gain === b.gain &&
      a.mute === b.mute &&
      a.mono === b.mono &&
      a.sel === b.sel &&
      a.eqOn === b.eqOn &&
      a.mode === b.mode &&
      a.device === b.device)
  );
}

export const BusRow = memo(
  BusRowImpl,
  (a, b) => sameBus(a.bus, b.bus) && a.onOpenEq === b.onOpenEq && a.DevicePicker === b.DevicePicker,
);
