/**
 * Route column beside the fader: A1–A5, a gap, B1–B3.
 * Buttons are 36px wide and grow from 22 to 34px tall with the fader zone.
 */
import { memo } from "react";
import { ToggleChip } from "@/components/mixer";
import { BUS_NAMES, PHYS_BUSES } from "@/lib/params";
import { ROUTE } from "./layout";

/** Column height once every button is at its 34px maximum; beyond that it centres. */
const MAX_HEIGHT = BUS_NAMES.length * ROUTE.maxH + (BUS_NAMES.length - 2) * ROUTE.gap + ROUTE.groupGap;

export interface RouteColumnProps {
  /** Display name of the strip, for accessible names ("Route Mic to A1"). */
  name: string;
  routes: readonly boolean[];
  onToggle: (bus: number, on: boolean) => void;
}

function RouteColumnImpl({ name, routes, onToggle }: RouteColumnProps) {
  const chip = (b: string, j: number) => (
    <ToggleChip
      key={b}
      pressed={routes[j] ?? false}
      onPressedChange={(on) => onToggle(j, on)}
      label={`Route ${name} to ${b}`}
      className="tabular h-auto min-h-0 w-full flex-1 px-0 text-12"
      style={{ minHeight: ROUTE.minH, maxHeight: ROUTE.maxH }}
    >
      {b}
    </ToggleChip>
  );
  const group = (from: number, to: number, label: string) => (
    // Basis = its gaps, so the free height splits per button and A/B buttons stay the same height.
    <div
      role="group"
      aria-label={label}
      className="flex flex-col"
      style={{ gap: ROUTE.gap, flex: `${to - from} 1 ${(to - from - 1) * ROUTE.gap}px` }}
    >
      {BUS_NAMES.slice(from, to).map((b, k) => chip(b, from + k))}
    </div>
  );
  return (
    <div
      role="group"
      aria-label={`${name} routing`}
      className="flex h-full min-h-0 shrink-0 flex-col self-center"
      style={{ width: ROUTE.width, gap: ROUTE.groupGap, maxHeight: MAX_HEIGHT }}
    >
      {group(0, PHYS_BUSES, `${name} to physical outputs`)}
      {group(PHYS_BUSES, BUS_NAMES.length, `${name} to virtual outputs`)}
    </div>
  );
}

export const RouteColumn = memo(
  RouteColumnImpl,
  (a, b) => a.name === b.name && a.onToggle === b.onToggle && a.routes.every((r, k) => r === b.routes[k]),
);
