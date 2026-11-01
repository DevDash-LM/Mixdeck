/**
 * Input strip v2. Five fixed zones, top → bottom:
 *   Header 40 · Source 64 · Knobs 78 · Fader (flex) · Footer 72
 * Virtual strips with a registered `StripApps` add an Apps zone (flex) above a 230px fader; when
 * that component renders nothing, CSS (`:has`) drops back to the 5-zone grid.
 * so zone borders line up across every strip on the board. Width 108–168px (set by the board);
 * density follows the card's own width (a ResizeObserver for props, `@container` for captions).
 * Writes go through `useMixer().setParam` with names from `lib/params.ts`.
 */
import { memo, useCallback, useMemo, useState, type CSSProperties } from "react";
import { Fader, faderInset, Knob, Meter, useElementSize } from "@/components/mixer";
import type { Strip } from "@/lib/bridge";
import { cn } from "@/lib/cn";
import { formatDb } from "@/lib/db";
import { strip as stripParams, stripLevelChannels } from "@/lib/params";
import { useMixer } from "@/stores/mixerStore";
import { getStripApps, type DevicePicker, type StripFxTab } from "../extensions";
import { HW_KNOB_CAPTIONS, VIRTUAL_EQ_CAPTIONS, VIRTUAL_EQ_HINT, stripDefaultName, stripName } from "../labels";
import { CardMenu, EditableLabel } from "../parts";
import { DENSITY, STRIP_ROWS, VIRTUAL_STRIP_ROWS } from "./layout";
import { RouteColumn } from "./RouteColumn";
import { SourceCard } from "./SourceCard";
import { StripFooter } from "./StripFooter";

export interface InputStripProps {
  strip: Strip;
  /** Open the Strip FX panel. Absent = shown disabled. */
  onOpenFx?: (i: number, tab?: StripFxTab) => void;
  /** Open Routing with this strip highlighted. Absent = shown disabled. */
  onEditRouting?: (i: number) => void;
  /** Device picker for the HW Source card. */
  DevicePicker?: DevicePicker;
  /** Collapse to a 36px rail. Absent = no Collapse item in ⋯. */
  onCollapse?: (i: number) => void;
}

const set = (name: string, value: number | string) => useMixer.getState().setParam(name, value);
const bool = (b: boolean) => (b ? 1 : 0);
const CAP_INSET = faderInset({ valueInCap: true });

/** Meter bars: HW = L/R; virtual = L max(0,2,4,6), R max(1,3,5,7) (decision D3). */
export function stripBars(i: number, hardware: boolean): number[][] {
  const [start, end] = stripLevelChannels(i);
  if (hardware) return [[start], [start + 1]];
  const l: number[] = [];
  const r: number[] = [];
  for (let c = start; c < end; c++) ((c - start) % 2 === 0 ? l : r).push(c);
  return [l, r];
}

/** Zone wrapper: 1px `line` border under every zone but the last. */
const zone = "min-h-0 min-w-0 border-b border-line";

function InputStripImpl({ strip: s, onOpenFx, onEditRouting, DevicePicker, onCollapse }: InputStripProps) {
  const i = s.index;
  const p = useMemo(() => stripParams(i), [i]);
  const hw = s.kind === "hardware";
  const name = stripName(i, s.label);
  const bars = useMemo(() => stripBars(i, hw), [i, hw]);
  const [renaming, setRenaming] = useState(false);
  const [cardRef, size] = useElementSize<HTMLElement>();
  // contentRect excludes the 1px border on each side.
  const width = size.width + 2;
  const narrow = width < DENSITY.fullKnob;
  const knobSize = narrow ? 34 : 36;
  const q = s.quick;
  const onRoute = useCallback((j: number, on: boolean) => set(p.route(j), bool(on)), [p]);
  const openFx = onOpenFx ? (tab?: StripFxTab) => onOpenFx(i, tab) : undefined;
  const Apps = hw ? undefined : getStripApps("virtual");
  // With an Apps slot the rows come from CSS vars, so `:has()` can pick the 6-zone grid only when
  // the slot actually rendered something. HW strips keep the plain inline rows.
  const gridStyle: CSSProperties = Apps
    ? ({ "--rows-5": STRIP_ROWS, "--rows-6": VIRTUAL_STRIP_ROWS } as CSSProperties)
    : { gridTemplateRows: STRIP_ROWS };

  return (
    <section
      ref={cardRef}
      data-strip={i}
      tabIndex={-1}
      aria-label={s.label.trim() || stripDefaultName(i)}
      className={cn(
        "@container grid h-full min-w-0 flex-1 rounded-lg border border-line bg-panel transition-colors duration-150 ease-out hover:border-line-strong",
        // Inset ring: the inputs scroller would clip an outside one.
        "focus-visible:outline-offset-[-2px]",
        Apps && "[grid-template-rows:var(--rows-5)] [&:has(>[data-apps-zone]:not(:empty))]:[grid-template-rows:var(--rows-6)]",
      )}
      style={gridStyle}
    >
      {/* Header 40 */}
      <div className={cn(zone, "flex items-center gap-1 pr-1 pl-1")}>
        <EditableLabel
          variant="header"
          value={s.label}
          fallback={name}
          name={stripDefaultName(i)}
          editing={renaming}
          onEditingChange={setRenaming}
          onCommit={(label) => set(p.label(), label)}
        />
        {s.mute || s.solo ? (
          <span className="flex shrink-0 items-center gap-1" title={[s.mute && "Muted", s.solo && "Soloed"].filter(Boolean).join(", ")}>
            {s.mute ? <span aria-hidden className="size-1.5 rounded-full bg-mute" /> : null}
            {s.solo ? <span aria-hidden className="size-1.5 rounded-full bg-solo" /> : null}
          </span>
        ) : null}
        <CardMenu
          size="md"
          label={`${name} options`}
          items={[
            { label: "Effects…", onSelect: openFx ? () => openFx() : undefined, soon: true },
            { label: "Edit routing", onSelect: onEditRouting ? () => onEditRouting(i) : undefined, soon: true },
            { label: "Rename", onSelect: () => setRenaming(true), separatorBefore: true },
            ...(onCollapse ? [{ label: "Collapse", onSelect: () => onCollapse(i) }] : []),
          ]}
        />
      </div>

      {/* Source 64 */}
      <div className={cn(zone, "flex items-center px-1.5")}>
        <SourceCard index={i} hardware={hw} device={s.device} Picker={DevicePicker} />
      </div>

      {/* Knobs 78 */}
      <div className={cn(zone, "grid grid-cols-3 items-center px-px")}>
        {q.kind === "hardware"
          ? (
              [
                [q.comp, p.comp(), "comp"],
                [q.gate, p.gate(), "gate"],
                [q.denoiser, p.denoiser(), undefined],
              ] as const
            ).map(([value, param, tab], k) => {
              const c = HW_KNOB_CAPTIONS[k];
              if (!c) return null;
              return (
                <Knob
                  key={c.full}
                  size={knobSize}
                  caption={
                    c.full === c.short ? (
                      c.full
                    ) : (
                      <>
                        {/* 136px = DENSITY.fullCaptions (Tailwind needs the literal class). */}
                        <span className="@min-[136px]:hidden">{c.short}</span>
                        <span className="hidden @min-[136px]:inline">{c.full}</span>
                      </>
                    )
                  }
                  label={`${name} ${c.label}`}
                  value={value}
                  min={0}
                  max={10}
                  defaultValue={0}
                  step={0.5}
                  fineStep={0.1}
                  onChange={(v) => set(param, v)}
                  onContextMenu={openFx ? () => openFx(tab) : undefined}
                />
              );
            })
          : ([1, 2, 3] as const).map((n) => {
              const caption = VIRTUAL_EQ_CAPTIONS[n - 1] ?? `EQ ${n}`;
              return (
                <div key={n} title={VIRTUAL_EQ_HINT} className="flex justify-center">
                  <Knob
                    size={knobSize}
                    caption={caption}
                    label={`${name} ${caption}`}
                    value={q.kind === "virtual" ? (q.eqGain[n - 1] ?? 0) : 0}
                    min={-12}
                    max={12}
                    defaultValue={0}
                    bipolar
                    unit="dB"
                    step={0.5}
                    fineStep={0.1}
                    format={(v) => formatDb(v, -99)}
                    onChange={(v) => set(p.eqGain(n), v)}
                    onContextMenu={openFx ? () => openFx("eq") : undefined}
                  />
                </div>
              );
            })}
      </div>

      {/* Apps (flex, virtual only): hidden while the slot renders nothing */}
      {Apps ? (
        <div data-apps-zone className={cn(zone, "empty:hidden")}>
          <Apps strip={i} />
        </div>
      ) : null}

      {/* Fader zone (flex): [scale?][fader][meter] · route column */}
      <div className={cn(zone, "flex items-stretch justify-between gap-1 py-2.5", width < 128 ? "px-[3px]" : "px-2")}>
        <Fader
          value={s.gain}
          onChange={(v) => set(p.gain(), v)}
          label={`${name} gain`}
          valueInCap
          scaleSide="before"
          scaleLabels={width >= DENSITY.scaleLabels}
          dimmed={s.mute}
          meter={
            <Meter
              kind="in"
              bars={bars}
              barWidth={narrow ? 4 : 5}
              barGap={2}
              inset={CAP_INSET}
              dimmed={s.mute}
              label={`${name} level`}
            />
          }
        />
        <RouteColumn name={name} routes={s.routes} onToggle={onRoute} />
      </div>

      {/* Footer 72 */}
      <StripFooter
        name={name}
        hardware={hw}
        mute={s.mute}
        solo={s.solo}
        mono={hw ? s.mono : s.mc}
        eqOn={q.kind === "virtual" ? q.eqOn : false}
        onMute={(on) => set(p.mute(), bool(on))}
        onSolo={(on) => set(p.solo(), bool(on))}
        onMono={(on) => set(hw ? p.mono() : p.mc(), bool(on))}
        onEq={(on) => set(p.eqOn(), bool(on))}
        onOpenFx={openFx}
      />
    </section>
  );
}

/** Field-wise equality so a strip re-renders only when its own data changed. */
export function sameStrip(a: Strip, b: Strip): boolean {
  if (a === b) return true;
  if (
    a.index !== b.index ||
    a.kind !== b.kind ||
    a.label !== b.label ||
    a.gain !== b.gain ||
    a.mute !== b.mute ||
    a.solo !== b.solo ||
    a.mono !== b.mono ||
    a.mc !== b.mc ||
    a.device !== b.device
  )
    return false;
  if (a.routes.some((r, k) => r !== b.routes[k])) return false;
  const qa = a.quick;
  const qb = b.quick;
  if (qa.kind === "hardware" && qb.kind === "hardware")
    return qa.comp === qb.comp && qa.gate === qb.gate && qa.denoiser === qb.denoiser;
  if (qa.kind === "virtual" && qb.kind === "virtual")
    return qa.eqOn === qb.eqOn && qa.eqGain.every((g, k) => g === qb.eqGain[k]);
  return false;
}

export const InputStrip = memo(
  InputStripImpl,
  (a, b) =>
    sameStrip(a.strip, b.strip) &&
    a.onOpenFx === b.onOpenFx &&
    a.onEditRouting === b.onEditRouting &&
    a.DevicePicker === b.DevicePicker &&
    a.onCollapse === b.onCollapse,
);
