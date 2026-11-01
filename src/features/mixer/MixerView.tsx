/**
 * The Mixer page, board frame v2:
 *   HARDWARE INPUTS 5 ┊ VIRTUAL INPUTS 3 ┃ MASTER 8 buses
 * Inputs flex between 108 and 168px per strip; extra width becomes margin. Master is a
 * pinned `--master-w` column on the right. Below the strip minimum the inputs scroll
 * horizontally (a vertical wheel over empty board space scrolls them sideways).
 * Master: eight horizontal bus rows in two sub-groups (A1–A5, B1–B3) that flex
 * 68–104px tall, so all of them fit without scrolling from about 1440×800 up.
 */
import { Fragment, useRef, type ReactNode, type WheelEvent } from "react";
import { SectionHeader } from "@/components/mixer";
import { Skeleton } from "@/components/ui";
import { useAppsSettings } from "@/features/apps/useApps";
import { ConnectionGate } from "@/features/connection/ConnectionGate";
import { cn } from "@/lib/cn";
import { BUS_NAMES, HW_STRIPS, PHYS_BUSES } from "@/lib/params";
import { useMixer } from "@/stores/mixerStore";
import { BusCard } from "./BusCard";
import { setStripCollapsed, useCollapsedStrips, useSettingsSettled } from "./collapse";
import { useMixerKeyboard } from "./keyboard";
import { CollapsedRail } from "./strip/CollapsedRail";
import { MASTER_WIDTH, ROW, SUBGROUP, subgroupStyle } from "./bus/layout";
import { getDevicePicker, getMixerActions, getStripApps, listMixerOverlays } from "./extensions";
import { StripCard } from "./StripCard";
import {
  BOARD_PAD,
  GROUP_GAP,
  HEADER_BLOCK,
  MASTER_GAP,
  STRIP_GAP,
  STRIP_MAX,
  STRIP_MIN,
  STRIP_MIN_HEIGHT,
  STRIP_ROWS,
  RAIL_WIDTH,
  VIRTUAL_STRIP_ROWS,
  mixedGroupWidth,
} from "./strip/layout";

const VIRT_STRIPS = 3;
/** Board height below which the page scrolls vertically. */
const BOARD_MIN_H = STRIP_MIN_HEIGHT + HEADER_BLOCK + BOARD_PAD * 2;

export default function MixerView() {
  // Wait for Settings (collapsed strips, apps on/off) so the first board doesn't shift.
  const settled = useSettingsSettled();
  return <ConnectionGate fallback={<MixerSkeleton />}>{settled ? <MixerBoard /> : <MixerSkeleton />}</ConnectionGate>;
}

/** Flex sizing for a group with `open` full strips and `rails` collapsed ones. */
function groupStyle(open: number, rails: number) {
  return open > 0
    ? { flex: `${open} 1 0px`, minWidth: mixedGroupWidth(open, rails, STRIP_MIN), maxWidth: mixedGroupWidth(open, rails, STRIP_MAX) }
    : { flex: "0 0 auto", width: mixedGroupWidth(0, rails, STRIP_MIN) };
}

/** Inputs can't get narrower than this; below it they scroll. */
const inputsMin = (hwRails: number, virtRails: number) =>
  mixedGroupWidth(HW_STRIPS - hwRails, hwRails, STRIP_MIN) + GROUP_GAP + mixedGroupWidth(VIRT_STRIPS - virtRails, virtRails, STRIP_MIN);

/** One input group: header + a row of strips. Grows in proportion to its open strip count. */
function InputGroup({ title, n, rails, children }: { title: string; n: number; rails: number; children: ReactNode }) {
  return (
    <div role="group" aria-label={title} className="flex h-full min-h-0 flex-col gap-2" style={groupStyle(n - rails, rails)}>
      <SectionHeader title={title} count={n} />
      <div className="flex min-h-0 flex-1" style={{ gap: STRIP_GAP }}>
        {children}
      </div>
    </div>
  );
}

/** Vertical rule centred in a gap: `line` between input groups, `line-strong` before Master. */
function Rule({ width, strong }: { width: number; strong?: boolean }) {
  return (
    <div aria-hidden className="flex shrink-0 justify-center self-stretch" style={{ width }}>
      <div className={cn("w-px", strong ? "bg-line-strong" : "bg-line")} />
    </div>
  );
}

/** Vertical wheel over empty board space scrolls the inputs sideways (controls eat their own wheel). */
function sideScroll(e: WheelEvent<HTMLDivElement>) {
  if (e.defaultPrevented || e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
  const el = e.currentTarget;
  if (el.scrollWidth > el.clientWidth) el.scrollLeft += e.deltaY;
}

function MixerBoard() {
  const state = useMixer((s) => s.state);
  const collapsed = useCollapsedStrips();
  const boardRef = useRef<HTMLDivElement>(null);
  useMixerKeyboard(boardRef, state !== null);
  if (!state) return null;
  const actions = getMixerActions();
  const stripPicker = getDevicePicker("strip");
  const busPicker = getDevicePicker("bus");
  const hw = state.strips.slice(0, HW_STRIPS);
  const virt = state.strips.slice(HW_STRIPS);
  const phys = state.buses.slice(0, PHYS_BUSES);
  const virtBuses = state.buses.slice(PHYS_BUSES);

  const isCollapsed = (i: number) => collapsed.includes(i);
  const hwRails = hw.filter((s) => isCollapsed(s.index)).length;
  const virtRails = virt.filter((s) => isCollapsed(s.index)).length;

  const strip = (s: (typeof state.strips)[number]) =>
    isCollapsed(s.index) ? (
      <CollapsedRail key={s.index} strip={s} onExpand={expand} />
    ) : (
      <StripCard
        key={s.index}
        strip={s}
        onOpenFx={actions.openStripFx}
        onEditRouting={actions.editRouting}
        DevicePicker={stripPicker}
        onCollapse={collapse}
      />
    );
  const bus = (b: (typeof state.buses)[number]) => <BusCard key={b.index} bus={b} onOpenEq={actions.openBusEq} DevicePicker={busPicker} />;

  return (
    <div ref={boardRef} className="relative h-full overflow-y-auto">
      <div className="flex h-full" style={{ minHeight: BOARD_MIN_H, padding: BOARD_PAD }}>
        <div className="min-w-0 flex-1 overflow-x-auto overflow-y-hidden" onWheel={sideScroll}>
          <div className="flex h-full justify-center" style={{ minWidth: inputsMin(hwRails, virtRails) }}>
            <InputGroup title="Hardware inputs" n={hw.length} rails={hwRails}>
              {hw.map(strip)}
            </InputGroup>
            <Rule width={GROUP_GAP} />
            <InputGroup title="Virtual inputs" n={virt.length} rails={virtRails}>
              {virt.map(strip)}
            </InputGroup>
          </div>
        </div>
        <Rule width={MASTER_GAP} strong />
        <section aria-label="Master" className="flex h-full shrink-0 flex-col gap-2" style={{ width: MASTER_WIDTH }}>
          <SectionHeader title="Master" count={`${BUS_NAMES.length} buses`} />
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto" style={{ gap: SUBGROUP.spacing }}>
            <BusGroup title={`Physical · ${BUS_NAMES[0]}–${BUS_NAMES[PHYS_BUSES - 1]}`} n={phys.length}>
              {phys.map(bus)}
            </BusGroup>
            <BusGroup title={`Virtual · ${BUS_NAMES[PHYS_BUSES]}–${BUS_NAMES[BUS_NAMES.length - 1]}`} n={virtBuses.length}>
              {virtBuses.map(bus)}
            </BusGroup>
          </div>
        </section>
      </div>
      {listMixerOverlays().map(({ id, component: Overlay }) => (
        <Fragment key={id}>
          <Overlay />
        </Fragment>
      ))}
    </div>
  );
}

const collapse = (i: number) => setStripCollapsed(i, true);
const expand = (i: number) => {
  setStripCollapsed(i, false);
  // The rail had focus; hand it to the card that replaces it.
  requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-strip="${i}"]:not([data-collapsed])`)?.focus());
};

/** Master sub-group: caps label, then `n` bus rows that share the free height evenly. */
function BusGroup({ title, n, children }: { title: string; n: number; children: ReactNode }) {
  return (
    <div role="group" aria-label={title} className="flex min-h-0 flex-col" style={{ ...subgroupStyle(n), gap: SUBGROUP.headerGap }}>
      <SubgroupTitle>{title}</SubgroupTitle>
      <div className="flex min-h-0 flex-1 flex-col" style={{ gap: ROW.gap }}>
        {children}
      </div>
    </div>
  );
}

function SubgroupTitle({ children }: { children: ReactNode }) {
  return (
    <h3
      className="flex shrink-0 items-center text-11 font-medium tracking-wider text-text-faint uppercase"
      style={{ height: SUBGROUP.header }}
    >
      {children}
    </h3>
  );
}

/** Board-shaped placeholder until the first state arrives: same frame, zones and Master column. */
export function MixerSkeleton() {
  const collapsed = useCollapsedStrips();
  const appsOn = useAppsSettings().enabled && !!getStripApps("virtual");
  const card = (k: number) => {
    if (collapsed.includes(k))
      return <div key={k} className="h-full shrink-0 rounded-lg border border-line bg-panel" style={{ width: RAIL_WIDTH }} />;
    const apps = appsOn && k >= HW_STRIPS;
    return (
      <div
        key={k}
        className="grid h-full min-w-0 flex-1 rounded-lg border border-line bg-panel"
        style={{ gridTemplateRows: apps ? VIRTUAL_STRIP_ROWS : STRIP_ROWS }}
      >
        <div className="flex items-center border-b border-line px-2">
          <Skeleton className="h-4 w-3/5" />
        </div>
        <div className="flex items-center border-b border-line px-1.5">
          <Skeleton className="h-[50px] w-full" />
        </div>
        <div className="grid grid-cols-3 place-items-center border-b border-line">
          <Skeleton className="size-9 rounded-full" />
          <Skeleton className="size-9 rounded-full" />
          <Skeleton className="size-9 rounded-full" />
        </div>
        {apps ? (
          <div className="flex min-h-0 flex-col gap-1 overflow-hidden border-b border-line px-1.5 py-1">
            <Skeleton className="h-10 shrink-0" />
            <Skeleton className="h-10 shrink-0" />
          </div>
        ) : null}
        <div className="flex justify-between border-b border-line px-2 py-2.5">
          <Skeleton className="h-full w-[38px]" />
          <Skeleton className="h-full w-9" />
        </div>
        <div className="grid grid-cols-2 content-center gap-1.5 px-1.5">
          {Array.from({ length: 4 }, (_, r) => (
            <Skeleton key={r} className="h-7" />
          ))}
        </div>
      </div>
    );
  };
  const group = (title: string, n: number, from: number) => {
    const rails = collapsed.filter((k) => k >= from && k < from + n).length;
    return (
      <div className="flex h-full min-h-0 flex-col gap-2" style={groupStyle(n - rails, rails)}>
        <SectionHeader title={title} count={n} />
        <div className="flex min-h-0 flex-1" style={{ gap: STRIP_GAP }}>
          {Array.from({ length: n }, (_, k) => card(from + k))}
        </div>
      </div>
    );
  };
  return (
    <div aria-busy aria-label="Loading the mixer" className="flex h-full overflow-hidden" style={{ padding: BOARD_PAD }}>
      <div className="flex min-w-0 flex-1 justify-center overflow-hidden">
        {group("Hardware inputs", HW_STRIPS, 0)}
        <Rule width={GROUP_GAP} />
        {group("Virtual inputs", VIRT_STRIPS, HW_STRIPS)}
      </div>
      <Rule width={MASTER_GAP} strong />
      <div className="flex h-full shrink-0 flex-col gap-2" style={{ width: MASTER_WIDTH }}>
        <SectionHeader title="Master" count={`${BUS_NAMES.length} buses`} />
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden" style={{ gap: SUBGROUP.spacing }}>
          {[PHYS_BUSES, BUS_NAMES.length - PHYS_BUSES].map((n, g) => (
            <div key={g} className="flex min-h-0 flex-col" style={{ ...subgroupStyle(n), gap: SUBGROUP.headerGap }}>
              <div className="flex shrink-0 items-center" style={{ height: SUBGROUP.header }}>
                <Skeleton className="h-3 w-24" />
              </div>
              <div className="flex min-h-0 flex-1 flex-col" style={{ gap: ROW.gap }}>
                {Array.from({ length: n }, (_, k) => (
                  <div
                    key={k}
                    className="grid min-h-0 flex-1 items-center gap-x-2.5 rounded-lg border border-line bg-panel px-2"
                    style={{ gridTemplateColumns: "minmax(0, 1fr) auto" }}
                  >
                    <div className="flex flex-col gap-2">
                      <Skeleton className="h-[22px] w-4/5" />
                      <Skeleton className="h-[22px] w-full" />
                    </div>
                    <div className="grid grid-cols-2 gap-1">
                      {Array.from({ length: 4 }, (_, r) => (
                        <Skeleton key={r} className="h-[26px] w-11" />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
